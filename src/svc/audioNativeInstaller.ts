// Android-only shim that makes the bundled Folia Bridge API modules believe they
// are running inside a browser extension while all privileged work is delegated
// to the native Capacitor plugin.

const PAGE_SOURCE = 'folia-web-page';
const BRIDGE_SOURCE = 'folia-extension-bridge';
const BRIDGE_VERSION = 'android-0.1.0';
// A hung upstream (one KuGou CDN node that never answers, say) would otherwise hold the page's
// request open until OkHttp's own 45s read timeout, which is long enough to look like a freeze.
// AI and image requests call the plugin directly and keep their own longer budgets.
const BRIDGED_REQUEST_TIMEOUT_MS = 15000;
// 长轮询端点（酷狗扫码状态）会一直挂到状态变化，15 秒必然被误杀：调用方可以在 fetch init 上
// 传 `foliaTimeoutMs` 单独放宽（只从我们自己的桥模块传，普通请求仍是 15 秒）。
const BRIDGED_REQUEST_MAX_TIMEOUT_MS = 120000;
// Cookie calls are millisecond work, but Capacitor can drop a reply (plugin exception,
// WebView reload) and the page-side bridge request has no timer of its own. Login waits on
// these calls, so a lost reply used to leave the QR modal parked on "waiting" after the
// phone had already reported success. Every shim call therefore settles within a budget.
const COOKIE_CALL_TIMEOUT_MS = 4000;

const API_HOSTS = [
  'music.163.com',
  'interface.music.163.com',
  'interface3.music.163.com',
  'c.y.qq.com',
  'u.y.qq.com',
  'ssl.ptlogin2.qq.com',
  'xui.ptlogin2.qq.com',
  'graph.qq.com',
  // 微信扫码通道：qrconnect 取 uuid、qrcode 取图、lp 长轮询都在 weixin.qq.com 下。
  // 这三个请求同样只有走原生代理才能绕开 CORS，漏掉就会是 "Failed to fetch"。
  'weixin.qq.com',
  // KuGou spreads its API over many hosts (songsearch, complexsearch, trackercdn, vip, ...) and the
  // set keeps moving, so match the whole domain instead of listing hosts one by one. Only requests
  // that stay inside the WebView are subject to CORS; anything the bridge calls has to be proxied
  // here, which is why a missing host silently returns an empty result rather than an error.
  'kugou.com',
  'kuwo.cn',
  'api.qrserver.com',
];

type NativePlugin = {
  cookiesGetAll: (options: Record<string, unknown>) => Promise<{ cookies?: unknown[] }>;
  cookiesGet: (options: Record<string, unknown>) => Promise<{ cookie?: unknown }>;
  cookiesSet: (options: Record<string, unknown>) => Promise<{ ok?: boolean }>;
  cookiesRemove: (options: Record<string, unknown>) => Promise<{ ok?: boolean }>;
  cookiesRemoveBatch: (options: Record<string, unknown>) => Promise<{ ok?: boolean; removed?: number }>;
  httpRequest: (options: Record<string, unknown>) => Promise<{
    status: number;
    headers?: Array<{ name?: string; value?: string }> | Record<string, string>;
    bodyBase64?: string;
  }>;
};

type ApiHandler = (input: Record<string, unknown>) => Promise<unknown>;

let apiHandler: ApiHandler | null = null;
const queuedRequests = new Map<string, Record<string, unknown>>();

const getPlugin = (): NativePlugin | null => {
  const capacitor = (window as any).Capacitor;
  return capacitor?.Plugins?.FoliaNative ?? null;
};

const postToPage = (payload: Record<string, unknown>) => {
  window.postMessage({ source: BRIDGE_SOURCE, ...payload }, '*');
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
};

const base64ToBytes = (value?: string): Uint8Array => {
  if (!value) return new Uint8Array();
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

/** True when a request must go through the native OkHttp proxy instead of the WebView's fetch. */
export const isBridgedApiUrl = (url: string): boolean => {
  try {
    const { hostname } = new URL(url, location.href);
    return API_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
};

const serializeBody = async (body: BodyInit | null | undefined): Promise<{
  bodyText?: string;
  bodyBase64?: string;
  contentType?: string;
}> => {
  if (body == null) return {};
  if (typeof body === 'string') return { bodyText: body };
  if (body instanceof URLSearchParams) {
    return {
      bodyText: body.toString(),
      contentType: 'application/x-www-form-urlencoded',
    };
  }
  const response = new Response(body as BodyInit);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    bodyBase64: bytesToBase64(bytes),
    contentType: response.headers.get('content-type') || undefined,
  };
};

const installCookieShim = (plugin: NativePlugin) => {
  const chromeObject = ((globalThis as any).chrome ??= {});
  chromeObject.runtime = {
    id: 'folia-native-android',
    getManifest: () => ({ version: BRIDGE_VERSION }),
  };
  chromeObject.storage = {
    local: {
      get: async (keys?: string | string[] | null) => {
        const result: Record<string, unknown> = {};
        const requested = keys == null
          ? Object.keys(localStorage)
          : Array.isArray(keys)
            ? keys
            : [keys];
        requested.forEach((key) => {
          const value = localStorage.getItem(String(key));
          if (value != null) {
            try {
              result[String(key)] = JSON.parse(value);
            } catch {
              result[String(key)] = value;
            }
          }
        });
        return result;
      },
      set: async (values: Record<string, unknown>) => {
        Object.entries(values || {}).forEach(([key, value]) => {
          localStorage.setItem(key, JSON.stringify(value));
        });
      },
      remove: async (keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys];
        list.forEach((key) => localStorage.removeItem(key));
      },
    },
  };
  const callPlugin = <T,>(label: string, fallback: T, run: () => Promise<T>): Promise<T> => {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const work = (async () => {
      try {
        return await run();
      } catch (error) {
        console.warn(`[FoliaNativeBridge] ${label} failed`, error);
        return fallback;
      }
    })();
    const deadline = new Promise<T>((resolve) => {
      timeoutHandle = setTimeout(() => {
        console.warn(`[FoliaNativeBridge] ${label} timed out after ${COOKIE_CALL_TIMEOUT_MS}ms`);
        resolve(fallback);
      }, COOKIE_CALL_TIMEOUT_MS);
    });
    return Promise.race([work, deadline]).finally(() => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    });
  };
  chromeObject.cookies = {
    getAll: async (details: Record<string, unknown> = {}) => callPlugin(
      'cookies.getAll',
      [] as unknown[],
      async () => (await plugin.cookiesGetAll(details)).cookies || [],
    ),
    get: async (details: Record<string, unknown>) => callPlugin(
      'cookies.get',
      null,
      async () => (await plugin.cookiesGet(details)).cookie || null,
    ),
    set: async (details: Record<string, unknown>) => {
      await callPlugin('cookies.set', { ok: false }, () => plugin.cookiesSet(details));
      return details;
    },
    remove: async (details: Record<string, unknown>) => callPlugin(
      'cookies.remove',
      null,
      async () => ((await plugin.cookiesRemove(details)).ok ? details : null),
    ),
    // 非标准扩展：一次删掉一批 cookie，避免几十条逐个过桥拖过调用方的截止时间。
    // 失败/超时返回 null，调用方会退回逐条删除。
    removeBatch: async (entries: Array<{ url: string; name: string }>) => callPlugin(
      'cookies.removeBatch',
      null,
      async () => {
        await plugin.cookiesRemoveBatch({ entries });
        return entries;
      },
    ),
  };
  chromeObject.declarativeNetRequest = {
    RuleActionType: { MODIFY_HEADERS: 'modifyHeaders' },
    updateSessionRules: async () => undefined,
  };
  chromeObject.tabs = {
    create: async ({ url }: { url?: string } = {}) => {
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      return {};
    },
    query: async () => [],
    onRemoved: { addListener: () => undefined },
    onUpdated: { addListener: () => undefined },
  };
};

const installFetchShim = (plugin: NativePlugin) => {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : null;
    const rawUrl = request?.url ?? String(input);
    if (!isBridgedApiUrl(rawUrl)) {
      return originalFetch(input, init);
    }

    const method = (init?.method || request?.method || 'GET').toUpperCase();
    const headers = new Headers();
    const requestHeaders = request?.headers
      ? Array.from(request.headers.entries()).map(([name, value]) => [name, toHeaderSafeValue(value)] as [string, string])
      : [];
    const initHeaders = toHeaderEntries(init?.headers);
    for (const [name, value] of [...requestHeaders, ...initHeaders]) {
      headers.append(name, value);
    }
    const serialized = await serializeBody(init?.body ?? null);
    if (serialized.contentType && !headers.has('content-type')) {
      headers.set('content-type', serialized.contentType);
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const requestedTimeoutMs = Number(
      (init as (RequestInit & { foliaTimeoutMs?: number }) | undefined)?.foliaTimeoutMs,
    );
    const bridgeTimeoutMs = Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0
      ? Math.min(requestedTimeoutMs, BRIDGED_REQUEST_MAX_TIMEOUT_MS)
      : BRIDGED_REQUEST_TIMEOUT_MS;
    const result = await Promise.race([
      plugin.httpRequest({
        url: rawUrl,
        method,
        headers: Object.fromEntries(headers.entries()),
        bodyText: serialized.bodyText || '',
        bodyBase64: serialized.bodyBase64 || '',
        redirect: init?.redirect || request?.redirect || 'follow',
        timeoutMs: bridgeTimeoutMs,
      }),
      new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`Bridged request timed out after ${bridgeTimeoutMs}ms: ${method} ${rawUrl}`)),
          bridgeTimeoutMs,
        );
      }),
    ]).finally(() => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    });
    const responseBytes = base64ToBytes(result.bodyBase64);
    const responseBuffer = responseBytes.buffer.slice(
      responseBytes.byteOffset,
      responseBytes.byteOffset + responseBytes.byteLength,
    ) as ArrayBuffer;
    const responseHeaders = new Headers();
    const exposedSetCookies: string[] = [];
    if (Array.isArray(result.headers)) {
      result.headers.forEach((entry) => {
        if (!entry?.name || entry.value == null) return;
        // Headers.set() collapses repeats, so append Set-Cookie individually
        // to keep every cookie the server sent.
        if (entry.name.toLowerCase() === 'set-cookie') {
          responseHeaders.append(entry.name, String(entry.value));
          // ...but Set-Cookie is a forbidden response-header name, so a Response built here drops it
          // before JS can read it. The bridge modules need those values (qrsig, p_skey, NMTID ...) and
          // otherwise have to guess them back out of the cookie jar, where a previous session's value
          // may still be sitting. Mirror them into a header JS is allowed to read.
          exposedSetCookies.push(String(entry.value));
        } else {
          responseHeaders.set(entry.name, String(entry.value));
        }
      });
    } else if (result.headers) {
      Object.entries(result.headers).forEach(([name, value]) => {
        if (value != null) responseHeaders.set(name, String(value));
      });
    }
    exposedSetCookies.forEach((value) => responseHeaders.append('x-folia-set-cookie', value));
    return new Response(responseBuffer, {
      status: result.status,
      headers: responseHeaders,
    });
  };
};

/**
 * Headers are decoded by Chromium as ISO-8859-1. A single Chinese character in an upstream
 * cookie/header otherwise throws before the native request is even dispatched. Keep Latin-1
 * intact and percent-encode only the code points Chromium rejects.
 */
export const toHeaderSafeValue = (value: unknown): string => {
  const text = value == null ? '' : String(value);
  let safe = '';
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    safe += codePoint <= 0xff ? character : encodeURIComponent(character);
  }
  return safe;
};

/** Flattens every supported HeadersInit shape without constructing Headers from raw unsafe text. */
export const toHeaderEntries = (headers: HeadersInit | undefined): Array<[string, string]> => {
  if (!headers) return [];
  if (headers instanceof Headers) {
    return Array.from(headers.entries()).map(([name, value]) => [name, toHeaderSafeValue(value)]);
  }
  const entries = Array.isArray(headers)
    ? headers
    : Object.entries(headers);
  return entries.map(([name, value]) => [String(name), toHeaderSafeValue(value)]);
};

const flushQueuedRequests = () => {
  if (!apiHandler) return;
  queuedRequests.forEach((payload, id) => {
    void handleApiRequest(id, payload);
  });
  queuedRequests.clear();
};

const handleApiRequest = async (id: string, payload: Record<string, unknown>) => {
  if (!apiHandler) {
    queuedRequests.set(id, payload);
    return;
  }
  try {
    const data = await apiHandler(payload);
    postToPage({ type: 'FOLIA_API_RESPONSE', id, ok: true, data });
  } catch (error) {
    postToPage({
      type: 'FOLIA_API_RESPONSE',
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const installMessageBridge = () => {
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data as Record<string, any> | null;
    if (!data || data.source !== PAGE_SOURCE) return;

    if (data.type === 'FOLIA_BRIDGE_PING') {
      postToPage({
        type: 'FOLIA_BRIDGE_PONG',
        ready: true,
        version: BRIDGE_VERSION,
        extId: 'folia-native-android',
      });
      return;
    }

    if (data.type === 'FOLIA_API_REQUEST' && typeof data.id === 'string') {
      void handleApiRequest(data.id, data.payload || {});
    }
  });
};

export const installAudioNativeCore = async (): Promise<void> => {
  if (typeof window === 'undefined') return;
  const capacitor = (window as any).Capacitor;
  if (!capacitor?.isNativePlatform?.() && capacitor?.getPlatform?.() !== 'android') return;

  const plugin = getPlugin();
  if (!plugin) {
    console.error('[FoliaNativeBridge] FoliaNative Capacitor plugin is not registered');
    return;
  }

  installCookieShim(plugin);
  installFetchShim(plugin);
  installMessageBridge();
  const { installNativePlaybackBridge } = await import('./nativePlaybackBridge');
  await installNativePlaybackBridge(plugin as any);

  // @ts-ignore The bundled extension module is plain JavaScript.
  const module = await import('../audioNative/api/folia.js');
  apiHandler = module.handleFoliaApiRequest as ApiHandler;
  postToPage({
    type: 'FOLIA_BRIDGE_READY',
    ready: true,
    version: BRIDGE_VERSION,
    extId: 'folia-native-android',
  });
  flushQueuedRequests();
};
