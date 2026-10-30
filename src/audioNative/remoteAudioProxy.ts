// src/audioNative/remoteAudioProxy.ts
// 把「不带 CORS 头的音频 CDN 地址」换成原生本地服务地址。
//
// 为什么需要：主 <audio> 带 crossOrigin="anonymous"（可视化要读音频数据、要能画频谱），
// 浏览器于是要求音频响应带 Access-Control-Allow-Origin。波点（酷我 kuwo.cn）和网易云
// （music.126.net）的 CDN 都不发这个头，于是 <audio> 直接报
// 「MEDIA_ELEMENT_ERROR: Format error / The element has no supported sources」——
// 看起来像格式问题，实际是被同源策略挡在取字节之前。
//
// 原生侧 LocalAudioServer 早就有转发通道（registerRemoteAudio）：它按 Range 原样转发，
// 回包补上 `Access-Control-Allow-Origin: *`，并且带上这些 CDN 需要的 UA / Referer。
// 这里只负责把地址交过去、拿回 127.0.0.1 的地址。**只在原生平台生效**，
// 网页/桌面预览原样返回，行为不变。

import { Capacitor } from '@capacitor/core';

/** 与原生 LocalAudioServer.REMOTE_AUDIO_HOST_SUFFIXES 保持一致：只有这些主机需要绕。 */
const PROXY_HOST_SUFFIXES = ['kuwo.cn', 'music.126.net'];

type RemoteAudioPlugin = {
    registerRemoteAudio?: (options: { url: string }) => Promise<{ url?: string }>;
};

const nativePlugin = (): RemoteAudioPlugin | null => {
    try {
        if (!Capacitor.isNativePlatform()) return null;
        const plugins = (Capacitor as unknown as { Plugins?: Record<string, RemoteAudioPlugin> }).Plugins;
        const plugin = plugins?.FoliaNative;
        return plugin && typeof plugin.registerRemoteAudio === 'function' ? plugin : null;
    } catch {
        return null;
    }
};

/** 这个地址是不是那种不给 CORS 头的 CDN（需要经原生转发）。 */
export const needsRemoteAudioProxy = (url: string): boolean => {
    try {
        const host = new URL(url).hostname.toLowerCase();
        return PROXY_HOST_SUFFIXES.some(suffix => host === suffix || host.endsWith(`.${suffix}`));
    } catch {
        return false;
    }
};

/**
 * 需要绕的地址换成原生本地服务地址；其余原样返回。
 * 失败时也原样返回：宁可照旧直连试一次，也不要因为代理起不来而整首放不了。
 */
export const proxyRemoteAudioUrl = async (url: string | null): Promise<string | null> => {
    if (!url) return url;
    if (!needsRemoteAudioProxy(url)) return url;
    const plugin = nativePlugin();
    if (!plugin?.registerRemoteAudio) {
        console.warn('[RemoteAudio] 这个构建没有原生转发通道，直连（很可能被 CORS 拒）', url);
        return url;
    }
    try {
        const answer = await plugin.registerRemoteAudio({ url });
        const proxied = String(answer?.url ?? '');
        if (proxied) {
            console.log('[RemoteAudio] 经原生转发', new URL(url).hostname);
            return proxied;
        }
    } catch (error) {
        console.warn('[RemoteAudio] 转发失败，直连试试：', error instanceof Error ? error.message : String(error));
    }
    return url;
};
