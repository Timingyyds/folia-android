// src/services/onlineWallpaper/types.ts
// 在线壁纸库的公共类型：来源、条目、已下载到应用内的壁纸。

export type WallpaperKind = 'video' | 'image';
export type WallpaperSource = 'moewalls' | 'bizhihui';

/** 列表里的一项（还没下载）。 */
export type OnlineWallpaperItem = {
    /** `${source}:${来源内 id}`，下载与去重都用它。 */
    id: string;
    source: WallpaperSource;
    kind: WallpaperKind;
    title: string;
    thumbUrl: string;
    /** 详情页地址（下载前要再抓一次）。 */
    pageUrl: string;
    resolution?: string;
};

export type WallpaperCategory = { slug: string; label: string };

export type WallpaperPage = { items: OnlineWallpaperItem[]; hasMore: boolean };
