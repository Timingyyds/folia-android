// src/audioNative/fnmusicBridge.ts
// 飞牛音乐（fnOS）在 Android 上的桥：登录、请求、播放地址全部走 FoliaBridge（原生 OkHttp），
// 桌面端用的 electron/fnmusic 主进程桥在安卓没有，这里用同一套协议直接连用户自己的 fnOS 服务器。
// 协议见 docs/fnmusic-protocol.md：基础路径 {base}/music/api/v1，会话是 Cookie: music-token=<userToken>。

import { Capacitor } from '@capacitor/core';
import { bridgeRequest, isNativeBridgeAvailable } from './core';

export interface FnMusicAndroidStatus {
    available: boolean;
    configured: boolean;
    authenticated: boolean;
    base: string | null;
    username: string | null;
    userId: string | null;
    nickname: string | null;
}

export type FnMusicAndroidResult =
    | { ok: true; data: unknown; status?: number }
    | { ok: false; status?: number; error?: { code?: string | number; message?: string } };

type StoredConfig = {
    base: string;
    username: string;
    token: string;
    userId: string;
    nickname: string;
    deviceId: string;
};

const STORAGE_KEY = 'folia.fnmusic.config';
const API_PREFIX = '/music/api/v1';

// 安卓端可用：原生桥在场即可。
export const isFnMusicAndroidBridge = (): boolean => isNativeBridgeAvailable();

const readConfig = (): StoredConfig | null => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<StoredConfig>;
        if (!parsed?.base || !parsed?.token) return null;
        return {
            base: String(parsed.base),
            username: String(parsed.username ?? ''),
            token: String(parsed.token),
            userId: String(parsed.userId ?? ''),
            nickname: String(parsed.nickname ?? ''),
            deviceId: String(parsed.deviceId ?? ''),
        };
    } catch {
        return null;
    }
};

const writeConfig = (config: StoredConfig): void => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
        // 隐私模式写不进存储：这一次运行内仍然可用
    }
};

const randomDeviceId = (): string => {
    const bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('');
};

/** 用户填的服务器地址规范化成 origin：去空白、末尾斜杠、默认补 http://（局域网 fnOS 网页端默认 5666 端口）。 */
export const normalizeFnMusicBase = (raw: string): string | null => {
    let value = String(raw ?? '').trim();
    if (!value) return null;
    if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
    try {
        const url = new URL(value);
        if (!url.hostname) return null;
        return `${url.protocol}//${url.host}`;
    } catch {
        return null;
    }
};

const sha256Hex = async (text: string): Promise<string> => {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
};

/** 发一次 API 请求，回 {ok,data,status,error}，与桌面桥的返回结构一致，便于上层复用同一套错误映射。 */
const apiRequest = async (
    config: StoredConfig,
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    options?: { method?: 'GET' | 'POST'; body?: Record<string, unknown>; signal?: AbortSignal },
): Promise<FnMusicAndroidResult> => {
    const query = params
        ? Object.entries(params)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
            .join('&')
        : '';
    const url = `${config.base}${API_PREFIX}${path}${query ? `?${query}` : ''}`;
    const method = options?.method ?? (options?.body ? 'POST' : 'GET');
    try {
        const response = await bridgeRequest({
            url,
            method,
            headers: {
                Cookie: `music-token=${config.token}`,
                ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
        });
        const text = String(response.body ?? '');
        let payload: any = null;
        try {
            payload = text ? JSON.parse(text) : null;
        } catch {
            return { ok: false, status: response.status, error: { code: 'invalid-response', message: 'response is not JSON' } };
        }
        const code = payload?.code;
        if (response.status >= 400 || (typeof code === 'number' && code !== 0 && code !== 200)) {
            return {
                ok: false,
                status: response.status,
                error: {
                    code: code ?? response.status,
                    message: String(payload?.msg ?? payload?.message ?? `HTTP ${response.status}`),
                },
            };
        }
        return { ok: true, status: response.status, data: payload?.data ?? payload };
    } catch (error) {
        return {
            ok: false,
            status: 0,
            error: { code: 'network', message: error instanceof Error ? error.message : String(error) },
        };
    }
};

export const fnMusicAndroidStatus = async (): Promise<FnMusicAndroidStatus> => {
    const config = readConfig();
    if (!config) {
        return { available: true, configured: false, authenticated: false, base: null, username: null, userId: null, nickname: null };
    }
    // 用 /user/me 验一次登录态；失败也把地址与账号回填给登录表单。
    const me = await apiRequest(config, '/user/me');
    return {
        available: true,
        configured: true,
        authenticated: Boolean(me.ok),
        base: config.base,
        username: config.username || null,
        userId: config.userId || null,
        nickname: config.nickname || null,
    };
};

export const fnMusicAndroidLogin = async (
    input: { base: string; username: string; password: string },
): Promise<FnMusicAndroidResult> => {
    const base = normalizeFnMusicBase(input.base);
    if (!base) return { ok: false, error: { code: 'invalid-base', message: '服务器地址无效' } };
    const shown = readConfig();
    // deviceId 持久复用：同一台机器只注册一个设备（登出也保留）。
    const deviceId = shown?.deviceId || randomDeviceId();
    const password = await sha256Hex(input.password);
    try {
        const response = await bridgeRequest({
            url: `${base}${API_PREFIX}/user/password-login`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: input.username, password, deviceId }),
        });
        const text = String(response.body ?? '');
        let payload: any = null;
        try {
            payload = text ? JSON.parse(text) : null;
        } catch {
            return { ok: false, status: response.status, error: { code: 'invalid-response', message: '登录响应不是 JSON' } };
        }
        const code = payload?.code;
        if (response.status >= 400 || (typeof code === 'number' && code !== 0 && code !== 200)) {
            return {
                ok: false,
                status: response.status,
                error: { code: code ?? response.status, message: String(payload?.msg ?? `HTTP ${response.status}`) },
            };
        }
        const data = payload?.data ?? {};
        const token = String(data?.userToken ?? data?.token ?? '');
        if (!token) return { ok: false, status: response.status, error: { code: 'invalid-response', message: '登录响应缺少 userToken' } };
        const user = data?.user ?? {};
        writeConfig({
            base,
            username: input.username,
            token,
            userId: String(user?.guid ?? user?.id ?? ''),
            nickname: String(user?.nickname ?? user?.name ?? ''),
            deviceId,
        });
        return { ok: true, status: response.status, data: { user } };
    } catch (error) {
        return { ok: false, status: 0, error: { code: 'network', message: error instanceof Error ? error.message : String(error) } };
    }
};

export const fnMusicAndroidRequest = async <T = unknown>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    options?: { method?: 'GET' | 'POST'; body?: Record<string, unknown>; signal?: AbortSignal },
): Promise<T> => {
    const config = readConfig();
    if (!config) throw new Error('unconfigured');
    const result = await apiRequest(config, path, params, options);
    if (!result.ok) throw Object.assign(new Error(result.error?.message || 'fnmusic request failed'), { bridgeResult: result });
    return result.data as T;
};

/** 播放/封面的解析执行器：带 Cookie 与 Range 的地址交给原生本地服务转发。 */
type ProxyPlugin = {
    registerRemoteAudio?: (options: { url: string; headers?: Record<string, string>; allowAnyHost?: boolean }) => Promise<{ url?: string }>;
};

const proxyPlugin = (): ProxyPlugin | null => {
    try {
        if (!Capacitor.isNativePlatform()) return null;
        const plugins = (Capacitor as unknown as { Plugins?: Record<string, ProxyPlugin> }).Plugins;
        const plugin = plugins?.FoliaNative;
        return plugin && typeof plugin.registerRemoteAudio === 'function' ? plugin : null;
    } catch {
        return null;
    }
};

const proxyWithCookie = async (url: string, token: string): Promise<string | null> => {
    const plugin = proxyPlugin();
    if (!plugin?.registerRemoteAudio) return null;
    try {
        const answer = await plugin.registerRemoteAudio({ url, headers: { Cookie: `music-token=${token}` }, allowAnyHost: true });
        return String(answer?.url ?? '') || null;
    } catch (error) {
        console.warn('[FnMusic] proxy failed:', error instanceof Error ? error.message : String(error));
        return null;
    }
};

export const fnMusicAndroidStreamSource = async (trackId: string): Promise<string> => {
    const config = readConfig();
    if (!config) throw new Error('unconfigured');
    const raw = `${config.base}${API_PREFIX}/track/stream?guid=${encodeURIComponent(trackId)}`;
    const proxied = await proxyWithCookie(raw, config.token);
    if (!proxied) throw new Error('播放地址不可用（原生转发未启动）');
    return proxied;
};

/**
 * 封面：<img> 读不到带 Cookie 的跨源图片，这里同样走原生转发。
 * 但调用方要求同步返回字符串，所以先给一个稳定的裸地址；真正带 Cookie 的转发在歌曲对象生成时
 * 由 fnmusicProvider 的 coverUrl 走同步值 + CookieManager（登录响应已写入 CookieManager）。
 */
export const fnMusicAndroidCoverRawUrl = (coverId: string, size = 600): string => {
    const config = readConfig();
    if (!config || !coverId) return '';
    return `${config.base}${API_PREFIX}/static/cover?coverId=${encodeURIComponent(coverId)}&size=${size}`;
};

export const fnMusicAndroidLogout = async (): Promise<void> => {
    const config = readConfig();
    if (config) await apiRequest(config, '/user/logout', undefined, { method: 'POST' });
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        // ignore
    }
};
