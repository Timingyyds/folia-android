// Desktop-PWA bridge to the optional Folia Bridge browser extension.

const PAGE_SOURCE = 'folia-web-page';
const BRIDGE_SOURCE = 'folia-extension-bridge';
const BRIDGE_PING_TIMEOUT_MS = 800;
const BRIDGE_REQUEST_TIMEOUT_MS = 45_000;

export const FOLIA_EXTENSION_API_BASE = 'extension';

export type FoliaBridgeProvider = 'netease' | 'qq' | 'kugou' | 'bodian' | 'qq_raw';

export interface FoliaBridgeRequest {
  provider: FoliaBridgeProvider;
  operation: string;
  method?: string;
  path?: string;
  query?: Record<string, string | number | boolean | undefined>;
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: number;
}

const pendingRequests = new Map<string, PendingRequest>();
let bridgeReadyPromise: Promise<boolean> | null = null;
let bridgeVersion = '';
let bridgeExtensionId = '';

const canUseWindowMessaging = () => (
  typeof window !== 'undefined'
  && typeof window.postMessage === 'function'
  && typeof window.addEventListener === 'function'
);

const createRequestId = () => (
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `folia-${Date.now()}-${Math.random().toString(36).slice(2)}`
);

const postToBridge = (payload: Record<string, unknown>) => {
  window.postMessage({ source: PAGE_SOURCE, ...payload }, '*');
};

const resolvePending = (id: string, result: { ok: boolean; data?: unknown; error?: string }) => {
  const pending = pendingRequests.get(id);
  if (!pending) return;
  pendingRequests.delete(id);
  window.clearTimeout(pending.timer);
  if (result.ok) {
    pending.resolve(result.data);
  } else {
    pending.reject(new Error(result.error || 'Folia Bridge request failed'));
  }
};

if (canUseWindowMessaging()) {
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data as Record<string, any> | null;
    if (!data || data.source !== BRIDGE_SOURCE) return;

    if (data.type === 'FOLIA_BRIDGE_READY' || data.type === 'FOLIA_BRIDGE_PONG') {
      bridgeVersion = String(data.version || '');
      bridgeExtensionId = String(data.extId || '');
      return;
    }

    if (data.type === 'FOLIA_API_RESPONSE' && typeof data.id === 'string') {
      resolvePending(data.id, {
        ok: Boolean(data.ok),
        data: data.data,
        error: typeof data.error === 'string' ? data.error : undefined,
      });
    }
  });
}

export const isFoliaExtensionBridgeConfigured = (value?: string | null): boolean => {
  const normalized = String(value || '').trim().toLowerCase().replace(/\/+$/, '');
  return normalized === FOLIA_EXTENSION_API_BASE
    || normalized === 'folia-extension'
    || normalized === 'folia-extension://netease'
    || normalized === 'folia-extension://qq'
    || normalized === 'folia-extension://kugou';
};

export const getFoliaExtensionBridgeInfo = () => ({
  version: bridgeVersion,
  extensionId: bridgeExtensionId,
});

export const isFoliaExtensionBridgeAvailable = (): Promise<boolean> => {
  if (!canUseWindowMessaging()) return Promise.resolve(false);
  if (bridgeReadyPromise) return bridgeReadyPromise;

  bridgeReadyPromise = new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener('message', onPong);
      if (!ready) bridgeReadyPromise = null;
      resolve(ready);
    };

    const onPong = (event: MessageEvent) => {
      const data = event.data as Record<string, any> | null;
      if (event.source !== window || !data || data.source !== BRIDGE_SOURCE) return;
      if (data.type !== 'FOLIA_BRIDGE_PONG' && data.type !== 'FOLIA_BRIDGE_READY') return;
      bridgeVersion = String(data.version || bridgeVersion);
      bridgeExtensionId = String(data.extId || bridgeExtensionId);
      finish(true);
    };

    const timer = window.setTimeout(() => finish(false), BRIDGE_PING_TIMEOUT_MS);
    window.addEventListener('message', onPong);
    postToBridge({ type: 'FOLIA_BRIDGE_PING' });
  });

  return bridgeReadyPromise;
};

export const requestFoliaExtension = async <T = unknown>(
  request: FoliaBridgeRequest,
): Promise<T> => {
  if (!(await isFoliaExtensionBridgeAvailable())) {
    throw new Error('FOLIA_EXTENSION_BRIDGE_UNAVAILABLE');
  }

  const id = createRequestId();
  return await new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error('FOLIA_EXTENSION_BRIDGE_TIMEOUT'));
    }, BRIDGE_REQUEST_TIMEOUT_MS);

    pendingRequests.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timer,
    });
    postToBridge({ type: 'FOLIA_API_REQUEST', id, payload: request });
  });
};
