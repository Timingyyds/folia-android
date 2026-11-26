// src/services/onlineMusic/qishui/qishuiTransport.ts
// 汽水音乐（字节跳动车机 Luna 开放平台）的渲染进程边界。
// 桌面版经 Electron 主进程的 qishui-music-api；手机版没有主进程，同一个协议在 WebView 里
// （src/audioNative/qishui.ts）直接执行，请求经 FoliaBridge（OkHttp）发出。

import { OnlineProviderError } from '../../../types/onlineMusic';
import type { ProviderErrorCode } from '../../../types/onlineMusic';

export type QishuiOperation =
    | 'login_status' | 'logout' | 'login_qr_key' | 'login_qr_create' | 'login_qr_check' | 'login_qr_cancel'
    | 'search' | 'search_playlists' | 'song_detail' | 'media_details' | 'audio' | 'lyrics'
    | 'user_playlists' | 'playlist_detail' | 'playlist_tracks'
    | 'artist_detail' | 'artist_songs'
    | 'liked_songs' | 'like_song' | 'playlist_add_tracks' | 'playlist_remove_tracks'
    | 'recent_played' | 'check_tracks' | 'dislike_song'
    | 'feed' | 'feed_modes';

export type QishuiParams = Record<string, unknown>;

export const QISHUI_NEEDS_DESKTOP = 'Qishui requires the desktop app';
export const QISHUI_BRIDGE_FAILED = 'Qishui desktop request failed';
export const QISHUI_NEEDS_BRIDGE = 'Qishui requires the Android build';

const STAGES = ['access-code', 'ticket', 'account'] as const;
export type QishuiLoginStage = typeof STAGES[number];

let lastFailure: { stage: QishuiLoginStage | null; code: ProviderErrorCode; upstreamCode?: string } | null = null;
export const getQishuiLastFailure = () => lastFailure;
const isLoginOperation = (operation: QishuiOperation) => operation.startsWith('login_');

export class QishuiRequestError extends OnlineProviderError {
    constructor(
        code: ProviderErrorCode,
        message: string,
        public readonly stage: QishuiLoginStage | null,
        public readonly upstreamCode?: string,
    ) {
        super(code, message, 'qishui');
    }
}

const electronBridge = (): { qishuiRequest?: (operation: string, params: QishuiParams) => Promise<any> } | null => {
    if (typeof window === 'undefined') return null;
    return (window as unknown as { electron?: { qishuiRequest?: (operation: string, params: QishuiParams) => Promise<any> } }).electron ?? null;
};

const isNativeBridge = (): boolean => (
    typeof window !== 'undefined'
    && Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.())
);

export const getQishuiAvailability = () => {
    if (typeof window === 'undefined') return { configured: false, reason: 'runtime-unavailable' as const };
    if (typeof electronBridge()?.qishuiRequest === 'function' || isNativeBridge()) return { configured: true } as const;
    return { configured: false, reason: 'runtime-unavailable' as const };
};

const PROVIDER_CODES: ReadonlySet<string> = new Set([
    'auth-required', 'unsupported', 'unavailable', 'not-playable', 'network', 'invalid-response',
]);

const describeNativeFailure = (error: unknown): QishuiRequestError => {
    const raw = error as { code?: string; message?: string; upstreamCode?: string; stage?: string; cause?: unknown };
    const stage = STAGES.find(value => value === raw?.stage) ?? null;
    const upstreamCode = typeof raw?.upstreamCode === 'string' && /^\d{1,12}$/.test(raw.upstreamCode) ? raw.upstreamCode : undefined;
    const code: ProviderErrorCode = raw?.code && PROVIDER_CODES.has(raw.code) ? raw.code as ProviderErrorCode : 'invalid-response';
    return new QishuiRequestError(code, raw?.message || 'Qishui operation failed', stage, upstreamCode);
};

// 一个操作：Electron 主进程（桌面）或 WebView 内的原生桥（手机）。
export async function requestQishui<T = unknown>(operation: QishuiOperation, params: QishuiParams = {}): Promise<T> {
    if (operation === 'login_qr_key') lastFailure = null;

    const electron = electronBridge();
    if (typeof electron?.qishuiRequest === 'function') {
        let result: any;
        try {
            result = await electron.qishuiRequest(operation, params);
        } catch (error) {
            throw new OnlineProviderError('network', QISHUI_BRIDGE_FAILED, 'qishui', error);
        }
        if (!result?.ok) {
            const failure = result?.error ?? {};
            const stage = STAGES.find(value => value === failure.stage) ?? null;
            const upstreamCode = typeof failure.upstreamCode === 'string' && /^\d{1,12}$/.test(failure.upstreamCode)
                ? failure.upstreamCode : undefined;
            if (isLoginOperation(operation)) lastFailure = { stage, code: failure.code, upstreamCode };
            throw new QishuiRequestError(failure.code ?? 'invalid-response', failure.message ?? 'Qishui operation failed', stage, upstreamCode);
        }
        return result.data as T;
    }

    if (!isNativeBridge()) throw new OnlineProviderError('unavailable', QISHUI_NEEDS_DESKTOP, 'qishui');

    let data: unknown;
    try {
        const { qishuiRequest } = await import('../../../audioNative');
        data = await qishuiRequest(operation, params);
    } catch (error) {
        const described = describeNativeFailure(error);
        if (isLoginOperation(operation)) {
            lastFailure = { stage: described.stage, code: described.code, upstreamCode: described.upstreamCode };
        }
        throw described;
    }
    return data as T;
}

// The image type the bytes themselves say, for the formats a scene icon comes in; null when they say none of them.
function sniffImageType(bytes: Uint8Array): string | null {
    const starts = (...head: number[]) => head.every((byte, index) => bytes[index] === byte);
    if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
    if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
    if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
    if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
    return null;
}
const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

// Scene artwork is public CDN content; it is fetched without any account headers or cookies.
// The data URL carries the image's own type: the CDN's template decides the format, not the address.
export async function readQishuiSceneIcon(raw: string): Promise<string> {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !/(?:^|\.)douyinpic\.com$/.test(url.hostname) || url.username || url.password) {
        throw new Error('Invalid scene artwork URL');
    }
    const response = await fetch(url.href, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(8000) });
    const declared = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    if (!response.ok || !declared.startsWith('image/')) throw new Error('Scene artwork is unavailable');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 512 * 1024) throw new Error('Scene artwork is too large');
    const type = sniffImageType(bytes) ?? (RASTER_TYPES.has(declared) ? declared : null);
    if (!type) throw new Error('Scene artwork is not a raster image');
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `data:${type};base64,${btoa(binary)}`;
}
