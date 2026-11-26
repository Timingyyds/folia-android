import { BIZHIHUI_CATEGORIES, fetchBizhihuiPage, resolveBizhihuiDownload } from './bizhihui';
import { MOEWALLS_CATEGORIES, fetchMoewallsPage, resolveMoewallsDownload } from './moewalls';
import type { OnlineWallpaperItem, WallpaperCategory, WallpaperPage, WallpaperSource } from './types';

// src/services/onlineWallpaper/index.ts
// 两个壁纸源的统一入口：列表、分类、以及「这一项从哪里下载」。

export type WallpaperResolvedDownload = {
    downloadUrl: string;
    title: string;
    detail?: string;
};

export const WALLPAPER_SOURCES: WallpaperSource[] = ['moewalls', 'bizhihui'];

export const wallpaperCategories = (source: WallpaperSource): WallpaperCategory[] => (
    source === 'moewalls' ? MOEWALLS_CATEGORIES : BIZHIHUI_CATEGORIES
);

export const fetchWallpaperPage = (source: WallpaperSource, page: number, category: string | null): Promise<WallpaperPage> => (
    source === 'moewalls' ? fetchMoewallsPage(page, category) : fetchBizhihuiPage(page, category)
);

export const resolveWallpaperDownload = async (item: OnlineWallpaperItem): Promise<WallpaperResolvedDownload> => {
    if (item.source === 'moewalls') {
        const resolved = await resolveMoewallsDownload(item.pageUrl, item.title);
        return {
            downloadUrl: resolved.downloadUrl,
            title: resolved.title,
            detail: [resolved.resolution, resolved.fileSize].filter(Boolean).join(' · '),
        };
    }
    const resolved = await resolveBizhihuiDownload(item.pageUrl, item.title);
    return {
        downloadUrl: resolved.downloadUrl,
        title: resolved.title,
        detail: [resolved.resolution, resolved.fileSize].filter(Boolean).join(' · '),
    };
};

export type { OnlineWallpaperItem, WallpaperCategory, WallpaperPage, WallpaperSource } from './types';
