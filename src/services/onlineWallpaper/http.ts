import { bridgeRequest, isNativeBridgeAvailable } from '../../audioNative/core';
import type { WallpaperSource } from './types';

// src/services/onlineWallpaper/http.ts
// 在线壁纸库的取页工具：安卓走 FoliaBridge（OkHttp，UA/Referer 可控、不受 CORS 限制），
// 其他环境退回 fetch。两个壁纸站都按 Referer 决定给不给页面，所以 Referer 必须跟着源走。

export const WALLPAPER_USER_AGENT =
    'Mozilla/5.0 (Linux; Android 10; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

export const WALLPAPER_REFERER: Record<WallpaperSource, string> = {
    moewalls: 'https://moewalls.com/',
    bizhihui: 'https://www.bizhihui.com/',
};

/** 站点标题里的 HTML 实体，展示前还原成普通字符。 */
export const decodeHtmlEntities = (value: string): string => String(value || '')
    .replace(/&#(\d+);/g, (_match, code: string) => {
        const point = Number(code);
        return Number.isFinite(point) && point > 0 ? String.fromCodePoint(point) : _match;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => {
        const point = parseInt(code, 16);
        return Number.isFinite(point) && point > 0 ? String.fromCodePoint(point) : _match;
    })
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** 取一个站点的 HTML 页面。失败时抛错，调用方负责把错误展示出来。 */
export const fetchWallpaperText = async (url: string, source: WallpaperSource): Promise<string> => {
    const referer = WALLPAPER_REFERER[source];
    if (isNativeBridgeAvailable()) {
        const response = await bridgeRequest({
            url,
            method: 'GET',
            headers: {
                'User-Agent': WALLPAPER_USER_AGENT,
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                Referer: referer,
            },
            timeoutMs: 25000,
            followRedirects: true,
        });
        if (response.status < 200 || response.status >= 300) {
            throw new Error(`HTTP ${response.status}`);
        }
        return response.body ?? '';
    }
    const response = await fetch(url, {
        headers: {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
};

/** 站点 URL 里的第一张匹配图片。 */
export const firstMatch = (text: string, pattern: RegExp): string => pattern.exec(text)?.[1] ?? '';

/** `<a ...>` 标签里的某个属性值。 */
export const attributeOf = (tag: string, name: string): string => {
    const match = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(tag);
    return match ? decodeHtmlEntities(match[1]) : '';
};

export const stripTags = (html: string): string => decodeHtmlEntities(html.replace(/<[^>]*>/g, ' '));
