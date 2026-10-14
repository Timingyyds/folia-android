// src/lib/chunkLoadRecovery.ts
// 覆盖安装后 WebView 可能还留着旧 index.html / 旧资源清单，动态 import 会指向新包里已经不存在的
// chunk hash，于是 React.lazy 抛 "Failed to fetch dynamically imported module"，整棵 React 树随之卸载。
// 这里按失效 chunk 的 URL 记一次自动刷新：刷新后拿到新清单，正常继续启动；同一次会话里同一个 URL
// 不会再自动刷新，避免缓存异常时无限 reload。第二次失败交给 ChunkLoadBoundary 显示可重试的提示页。

const RELOAD_MARKER_PREFIX = 'folia:chunk-reload:v1:';

const CHUNK_ERROR_PATTERNS = [
    /failed to fetch dynamically imported module/i,
    /error loading dynamically imported module/i,
    /importing a module script failed/i,
    /loading chunk \d+ failed/i,
    /chunk load error/i,
];

const attemptedChunks = new Set<string>();
let reloadScheduled = false;
let installed = false;

const errorText = (value: unknown): string => {
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
        const reason = (value as { reason?: unknown }).reason;
        if (reason !== undefined) return errorText(reason);
        const message = (value as { message?: unknown }).message;
        if (typeof message === 'string') return message;
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value ?? '');
    }
};

export const isChunkLoadError = (value: unknown): boolean => {
    const message = errorText(value);
    return CHUNK_ERROR_PATTERNS.some(pattern => pattern.test(message));
};

export const chunkUrlFromError = (value: unknown): string | null => {
    const match = errorText(value).match(/https?:\/\/[^\s'"()]+?\.js(?:\?[^\s'"]*)?/i);
    return match?.[0] ?? null;
};

const markerFor = (value: unknown): string => RELOAD_MARKER_PREFIX + (chunkUrlFromError(value) ?? 'unknown');

const hasReloadMarker = (marker: string): boolean => {
    try {
        return window.sessionStorage.getItem(marker) === '1';
    } catch {
        return false;
    }
};

const rememberReloadMarker = (marker: string): void => {
    attemptedChunks.add(marker);
    try {
        window.sessionStorage.setItem(marker, '1');
    } catch {
        // sessionStorage 不可用时仍有进程内标记，至少挡住同一轮内的重复刷新。
    }
};

/**
 * 处理一次可能来自 React.lazy 的分包加载错误。
 *
 * @returns 已经安排自动刷新时为 true；不是分包错误或这个 URL 已经刷新过时为 false。
 */
export const recoverFromChunkLoadError = (value: unknown): boolean => {
    if (!isChunkLoadError(value) || typeof window === 'undefined') return false;
    const marker = markerFor(value);
    if (attemptedChunks.has(marker) || hasReloadMarker(marker)) return false;
    rememberReloadMarker(marker);
    if (!reloadScheduled) {
        reloadScheduled = true;
        window.setTimeout(() => window.location.reload(), 0);
    }
    return true;
};

/** 用户点「重新加载」时清掉一次性标记，让下一次失败仍能自动恢复。 */
export const resetChunkLoadRecovery = (): void => {
    attemptedChunks.clear();
    reloadScheduled = false;
    try {
        const keys: string[] = [];
        for (let index = 0; index < window.sessionStorage.length; index += 1) {
            const key = window.sessionStorage.key(index);
            if (key?.startsWith(RELOAD_MARKER_PREFIX)) keys.push(key);
        }
        keys.forEach(key => window.sessionStorage.removeItem(key));
    } catch {
        // sessionStorage 不可用时没有持久标记可清。
    }
};

/** 在 React 挂载前安装，兜住没有错误边界时抛到全局的分包错误。 */
export const installChunkLoadRecovery = (): void => {
    if (installed || typeof window === 'undefined') return;
    installed = true;
    window.addEventListener('error', event => {
        recoverFromChunkLoadError(event.error ?? event.message);
    });
    window.addEventListener('unhandledrejection', event => {
        recoverFromChunkLoadError(event.reason);
    });
};
