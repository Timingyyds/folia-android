// src/svc/aiNativeFetch.ts
// 浏览器直接请求 AI 服务会被 CORS 拦掉，安卓容器里改用已经存在的原生 OkHttp 桥转发。
// 桥返回的是 base64 + 头数组，这里包装成标准 Response，让共享的请求逻辑不需要知道区别。

type NativeHeaderEntry = { name?: string; value?: string };

type NativeHttpResponse = {
    status: number;
    headers?: NativeHeaderEntry[] | Record<string, string>;
    bodyBase64?: string;
};

type NativeAiPlugin = {
    httpRequest: (options: {
        url: string;
        method: string;
        headers: Record<string, string>;
        bodyText: string;
        bodyBase64: string;
        redirect: string;
        timeoutMs?: number;
    }) => Promise<NativeHttpResponse>;
};

/** AI 请求通常比接口调用慢，给一个比默认 45s 更宽的上限。 */
export const AI_REQUEST_TIMEOUT_MS = 180_000;

const getNativePlugin = (): NativeAiPlugin | null => {
    if (typeof window === 'undefined') return null;
    const capacitor = (window as unknown as {
        Capacitor?: {
            isNativePlatform?: () => boolean;
            getPlatform?: () => string;
            Plugins?: { FoliaNative?: NativeAiPlugin };
        };
    }).Capacitor;
    if (!capacitor) return null;
    const native = capacitor.isNativePlatform?.() === true || capacitor.getPlatform?.() === 'android';
    if (!native) return null;
    return capacitor.Plugins?.FoliaNative ?? null;
};

export const isAiBridgeFetchAvailable = (): boolean => getNativePlugin() !== null;

const base64ToBytes = (value?: string): Uint8Array => {
    if (!value) return new Uint8Array();
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
};

const buildHeaders = (entries: NativeHttpResponse['headers']): Headers => {
    const headers = new Headers();
    if (Array.isArray(entries)) {
        entries.forEach((entry) => {
            if (!entry?.name || entry.value == null) return;
            const name = entry.name.toLowerCase();
            if (name === 'set-cookie') headers.append(entry.name, String(entry.value));
            else headers.set(entry.name, String(entry.value));
        });
    } else if (entries) {
        Object.entries(entries).forEach(([name, value]) => {
            if (value != null) headers.set(name, String(value));
        });
    }
    return headers;
};

/**
 * 返回一个与 fetch 同形的函数：安卓上走原生桥，其他平台回落到全局 fetch。
 * 只覆盖 AI 需要的用法（JSON 文本请求体），不做流式读取。
 */
export const createAiFetch = (): typeof fetch => {
    const plugin = getNativePlugin();
    if (!plugin?.httpRequest) {
        return ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)) as typeof fetch;
    }

    return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const request = input instanceof Request ? input : null;
        const url = request?.url ?? String(input);
        const method = (init?.method || request?.method || 'GET').toUpperCase();
        const headers = new Headers(request?.headers || init?.headers || {});

        let bodyText = '';
        const rawBody = init?.body ?? null;
        if (typeof rawBody === 'string') {
            bodyText = rawBody;
        } else if (rawBody instanceof URLSearchParams) {
            bodyText = rawBody.toString();
            if (!headers.has('content-type')) headers.set('content-type', 'application/x-www-form-urlencoded');
        } else if (rawBody != null) {
            bodyText = String(rawBody);
        }

        const headerObject: Record<string, string> = {};
        headers.forEach((value, name) => {
            headerObject[name] = value;
        });

        const result = await plugin.httpRequest({
            url,
            method,
            headers: headerObject,
            bodyText,
            bodyBase64: '',
            redirect: init?.redirect || request?.redirect || 'follow',
            timeoutMs: AI_REQUEST_TIMEOUT_MS,
        });

        const bytes = base64ToBytes(result.bodyBase64);
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        return new Response(buffer, {
            status: result.status,
            headers: buildHeaders(result.headers),
        });
    }) as typeof fetch;
};
