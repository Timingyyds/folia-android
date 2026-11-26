import { WALLPAPER_REFERER } from './http';
import type { OnlineWallpaperItem, WallpaperKind, WallpaperSource } from './types';

// src/services/onlineWallpaper/library.ts
// 已下载壁纸的落盘与索引。
//
// 文件由原生写进 App 私有目录（files/wallpapers），再经 LocalAudioServer 的 /wallpaper/ 路由
// 以 http://127.0.0.1:<port>/wallpaper/<file> 喂给 WebView —— 与本地音频同一条路子：
// WebView 不认 file://，而 50 MB 的视频base64 穿过插件桥会直接顶爆渲染进程内存。
// 端口每次启动都变，所以索引里只存文件名，URL 在读取时按当前端口重新拼。

const LIBRARY_META_KEY = 'folia.online_wallpaper.library';

export type WallpaperLibraryEntry = {
    id: string;
    source: WallpaperSource;
    kind: WallpaperKind;
    title: string;
    /** 私有目录里的文件名。 */
    file: string;
    /** 视频壁纸的封面图文件名；图片壁纸为 null（用 file 本身）。 */
    thumbFile: string | null;
    mime: string;
    size: number;
    addedAt: number;
    /** 运行时地址，不落盘。 */
    url: string;
    thumbUrl: string;
};

type StoredMeta = Omit<WallpaperLibraryEntry, 'url' | 'thumbUrl'>;

type NativeWallpaperAnswer = {
    file?: string;
    thumbFile?: string;
    mime?: string;
    size?: number;
    url?: string;
    thumbUrl?: string;
};

type NativeWallpaperPlugin = {
    downloadWallpaper?: (options: {
        url: string;
        referer?: string;
        id: string;
        kind: WallpaperKind;
        thumbUrl?: string;
        thumbReferer?: string;
        /** 列表项 id：原生按它回传进度事件。 */
        itemId?: string;
    }) => Promise<NativeWallpaperAnswer>;
    listWallpapers?: () => Promise<{
        items?: Array<{ file?: string; thumbFile?: string; mime?: string; size?: number }>;
        port?: number;
    }>;
    deleteWallpaper?: (options: { files: string[] }) => Promise<{ deleted?: string[]; failed?: string[] }>;
    localAudioServerPort?: () => Promise<{ port?: number }>;
    addListener?: (eventName: string, listener: (payload: { itemId?: string; progress?: number }) => void) => unknown;
};

const getPlugin = (): NativeWallpaperPlugin | null => (
    typeof window === 'undefined'
        ? null
        : (window as unknown as { Capacitor?: { Plugins?: { FoliaNative?: NativeWallpaperPlugin } } })
            .Capacitor?.Plugins?.FoliaNative ?? null
);

/** 在线壁纸只能在安卓客户端下载（没有原生下载时，浏览器跨域取不到这两个站）。 */
export const isOnlineWallpaperSupported = (): boolean => Boolean(getPlugin()?.downloadWallpaper);

const readMeta = (): StoredMeta[] => {
    if (typeof localStorage === 'undefined') return [];
    try {
        const raw = localStorage.getItem(LIBRARY_META_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((item): item is StoredMeta => (
            Boolean(item) && typeof item.id === 'string' && typeof item.file === 'string'
        ));
    } catch {
        return [];
    }
};

const writeMeta = (entries: StoredMeta[]) => {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(LIBRARY_META_KEY, JSON.stringify(entries));
    } catch {
        // 索引写不进去时文件仍在，下次打开会少一条记录：不阻塞下载本身。
    }
};

const wallpaperUrl = (port: number, file: string): string => (
    port > 0 && file ? `http://127.0.0.1:${port}/wallpaper/${encodeURIComponent(file)}` : ''
);

const withUrls = (meta: StoredMeta, port: number): WallpaperLibraryEntry => ({
    ...meta,
    url: wallpaperUrl(port, meta.file),
    thumbUrl: wallpaperUrl(port, meta.thumbFile || meta.file),
});

const resolvePort = async (): Promise<number> => {
    const plugin = getPlugin();
    if (!plugin?.localAudioServerPort) return 0;
    try {
        return Number((await plugin.localAudioServerPort())?.port) || 0;
    } catch {
        return 0;
    }
};

let cachedPort = 0;

/** 本机服务端口（缩略图代理要用）。拿到过就缓存，端口在一次会话里不会变。 */
export const resolveWallpaperServerPort = async (): Promise<number> => {
    if (cachedPort > 0) return cachedPort;
    cachedPort = await resolvePort();
    return cachedPort;
};

/**
 * 列表缩略图的实际地址。
 *
 * 壁纸站的图片都查 Referer，WebView 的 `<img>` 带不了请求头：直连就是一片空白。
 * 有本机服务时统一走 `/wallpaper-thumb/`，由原生带 UA/Referer 取回来。
 */
export const wallpaperThumbUrl = (port: number, remoteUrl: string): string => (
    port > 0 && remoteUrl
        ? `http://127.0.0.1:${port}/wallpaper-thumb/${encodeURIComponent(remoteUrl)}`
        : remoteUrl
);

const progressListeners = new Set<(update: { itemId: string; progress: number }) => void>();
let progressAttached = false;

/**
 * 订阅原生下载进度。
 *
 * 原生在下载线程里按字节发 `wallpaperProgress`，这里只做一次订阅并把事件分给界面，
 * 多个下载同时进行时按 itemId 各归各位。
 */
export const subscribeWallpaperProgress = (
    listener: (update: { itemId: string; progress: number }) => void,
): (() => void) => {
    progressListeners.add(listener);
    if (!progressAttached) {
        progressAttached = true;
        const plugin = getPlugin();
        plugin?.addListener?.('wallpaperProgress', payload => {
            const itemId = String(payload?.itemId || '');
            if (!itemId) return;
            const progress = Math.max(0, Math.min(100, Number(payload?.progress) || 0));
            progressListeners.forEach(notify => notify({ itemId, progress }));
        });
    }
    return () => { progressListeners.delete(listener); };
};

const newFileId = (): string => (
    `wp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
);

/** 已下载的壁纸（只返回文件仍在的那些）。 */
export const listStoredWallpapers = async (): Promise<WallpaperLibraryEntry[]> => {
    const stored = readMeta();
    const plugin = getPlugin();
    if (!stored.length || !plugin?.listWallpapers) return [];
    let response: Awaited<ReturnType<NonNullable<NativeWallpaperPlugin['listWallpapers']>>>;
    try {
        response = await plugin.listWallpapers();
    } catch (error) {
        console.warn('[OnlineWallpaper] 读取已下载壁纸失败', error);
        return [];
    }
    const items = Array.isArray(response?.items) ? response.items : [];
    const files = new Map(items.map(item => [String(item.file || ''), item]));
    const kept = stored.filter(meta => files.has(meta.file));
    if (kept.length !== stored.length) writeMeta(kept);
    const port = Number(response?.port) || await resolvePort();
    return kept.map(meta => withUrls(meta, port));
};

export const findStoredWallpaper = async (id: string): Promise<WallpaperLibraryEntry | null> => (
    (await listStoredWallpapers()).find(entry => entry.id === id) ?? null
);

export const hasStoredWallpaper = (id: string): boolean => readMeta().some(entry => entry.id === id);

/**
 * 下载一项并记进索引。
 * 下载地址由各站点自己的解析给出（见 moewalls/bizhihui），这里只管落盘与记账。
 */
export const downloadOnlineWallpaper = async (
    item: OnlineWallpaperItem,
    resolved: { downloadUrl: string; title: string },
): Promise<WallpaperLibraryEntry> => {
    const plugin = getPlugin();
    if (!plugin?.downloadWallpaper) throw new Error('当前设备不支持在线壁纸下载');
    const referer = WALLPAPER_REFERER[item.source];
    const fileId = newFileId();
    const response = await plugin.downloadWallpaper({
        url: resolved.downloadUrl,
        referer,
        id: fileId,
        kind: item.kind,
        itemId: item.id,
        thumbUrl: item.source === 'moewalls' ? item.thumbUrl : undefined,
        thumbReferer: referer,
    });
    if (!response?.file) throw new Error('下载没有返回文件');

    const meta: StoredMeta = {
        id: item.id,
        source: item.source,
        kind: item.kind,
        title: resolved.title || item.title,
        file: response.file,
        thumbFile: response.thumbFile || null,
        mime: response.mime || (item.kind === 'video' ? 'video/mp4' : 'image/jpeg'),
        size: Number(response.size) || 0,
        addedAt: Date.now(),
    };
    // 同一个壁纸重复下载时替换旧记录（旧文件由原生覆盖同一前缀的文件，不会越留越多）。
    const next = readMeta().filter(entry => entry.id !== meta.id && entry.file !== meta.file);
    next.unshift(meta);
    writeMeta(next);

    const port = response.url ? 0 : await resolvePort();
    const entry = withUrls(meta, port);
    if (response.url) entry.url = response.url;
    // 图片壁纸没有单独封面；视频封面下载失败时也退回文件本身（列表里至少有个图标底）。
    entry.thumbUrl = response.thumbUrl || entry.url;
    return entry;
};

/** 删除已下载的壁纸（索引 + 私有目录里的文件）。 */
export const deleteStoredWallpaper = async (entry: WallpaperLibraryEntry): Promise<void> => {
    writeMeta(readMeta().filter(meta => meta.id !== entry.id && meta.file !== entry.file));
    const plugin = getPlugin();
    if (!plugin?.deleteWallpaper) return;
    const files = [entry.file, entry.thumbFile].filter((file): file is string => Boolean(file));
    try {
        await plugin.deleteWallpaper({ files });
    } catch (error) {
        console.warn('[OnlineWallpaper] 删除壁纸文件失败', error);
    }
};
