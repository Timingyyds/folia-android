import { create } from 'zustand';
import {
    fetchWallpaperPage,
    resolveWallpaperDownload,
    type OnlineWallpaperItem,
    type WallpaperSource,
} from '../services/onlineWallpaper';
import {
    deleteStoredWallpaper,
    downloadOnlineWallpaper,
    listStoredWallpapers,
    resolveWallpaperServerPort,
    subscribeWallpaperProgress,
    type WallpaperLibraryEntry,
} from '../services/onlineWallpaper/library';
import { useVideoLayerSettingsStore } from './useVideoLayerSettingsStore';

// src/stores/useOnlineWallpaperStore.ts
// 在线壁纸面板的状态：列表分页、下载队列、已下载列表与应用。
// 列表数据只活在这次会话里（站点随时会变，缓存它没有意义），已下载列表才落盘。
// 下载允许并行（同时最多 3 张），进度由原生按字节回传，界面按 itemId 各显示各的。

export type OnlineWallpaperTab = 'online' | 'downloaded';

export type WallpaperDownloadStatus = 'queued' | 'resolving' | 'downloading' | 'done' | 'error';

export type WallpaperDownloadState = {
    status: WallpaperDownloadStatus;
    /** 0–100。 */
    progress: number;
    error?: string;
};

type OnlineWallpaperState = {
    tab: OnlineWallpaperTab;
    source: WallpaperSource;
    category: string | null;
    items: OnlineWallpaperItem[];
    page: number;
    hasMore: boolean;
    loading: boolean;
    loadingMore: boolean;
    error: string | null;
    downloaded: WallpaperLibraryEntry[];
    downloadedLoading: boolean;
    /** 本机服务端口：列表缩略图要经它代理（站点查 Referer，WebView 给不了）。 */
    serverPort: number;
    /** 每张壁纸各自的下载状态：key 是列表项 id。 */
    downloads: Record<string, WallpaperDownloadState>;
    setTab: (tab: OnlineWallpaperTab) => void;
    setSource: (source: WallpaperSource) => void;
    setCategory: (category: string | null) => void;
    /** 打开面板时调用：刷新已下载，并拉第一页。 */
    initialize: () => Promise<void>;
    reload: () => Promise<void>;
    loadMore: () => Promise<void>;
    download: (item: OnlineWallpaperItem) => Promise<void>;
    remove: (entry: WallpaperLibraryEntry) => Promise<void>;
    apply: (entry: WallpaperLibraryEntry) => Promise<void>;
    clearError: () => void;
};

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** 同时下载的数量：再多也不会更快，只会把带宽和内存摊薄。 */
const MAX_CONCURRENT_DOWNLOADS = 3;

export const useOnlineWallpaperStore = create<OnlineWallpaperState>((set, get) => {
    // 切分类 / 切来源时旧请求可能晚到，旧结果不能覆盖新列表。
    let sequence = 0;

    // 下载队列：点一张就入队，最多三张同时跑，其余显示「排队中」。
    const pendingQueue: OnlineWallpaperItem[] = [];
    let activeDownloads = 0;
    let unsubscribeProgress: (() => void) | null = null;

    const patchDownload = (id: string, patch: Partial<WallpaperDownloadState>) => {
        set(state => ({
            downloads: {
                ...state.downloads,
                [id]: { ...(state.downloads[id] ?? { status: 'queued', progress: 0 }), ...patch },
            },
        }));
    };

    const clearDoneLater = (id: string) => {
        window.setTimeout(() => {
            set(state => {
                if (state.downloads[id]?.status !== 'done') return {};
                const next = { ...state.downloads };
                delete next[id];
                return { downloads: next };
            });
        }, 1500);
    };

    const ensureProgressSubscription = () => {
        if (unsubscribeProgress) return;
        unsubscribeProgress = subscribeWallpaperProgress(({ itemId, progress }) => {
            const current = get().downloads[itemId];
            // 已经完成/失败的条目不再被迟到的进度事件改回去。
            if (!current || current.status === 'done' || current.status === 'error') return;
            if (progress < current.progress && progress < 100) return;
            patchDownload(itemId, { status: 'downloading', progress, error: undefined });
        });
    };

    const runDownload = async (item: OnlineWallpaperItem) => {
        patchDownload(item.id, { status: 'resolving', progress: 0, error: undefined });
        try {
            const resolved = await resolveWallpaperDownload(item);
            patchDownload(item.id, { status: 'downloading', progress: 1 });
            const entry = await downloadOnlineWallpaper(item, resolved);
            set(state => ({
                downloaded: [entry, ...state.downloaded.filter(existing => existing.id !== entry.id)],
            }));
            patchDownload(item.id, { status: 'done', progress: 100 });
            clearDoneLater(item.id);
        } catch (error) {
            patchDownload(item.id, { status: 'error', progress: 0, error: errorText(error) });
            set({ error: `${item.title}: ${errorText(error)}` });
        }
    };

    const pump = () => {
        while (activeDownloads < MAX_CONCURRENT_DOWNLOADS && pendingQueue.length > 0) {
            const item = pendingQueue.shift();
            if (!item) break;
            activeDownloads += 1;
            void runDownload(item).finally(() => {
                activeDownloads -= 1;
                pump();
            });
        }
    };

    const load = async (reset: boolean) => {
        // 换分类/来源要立刻重新拉：旧请求的 token 已经作废，不能因为它还在跑就不发新请求。
        if (!reset && (get().loading || get().loadingMore)) return;
        const token = ++sequence;
        const page = reset ? 1 : get().page + 1;
        set(reset
            ? { loading: true, loadingMore: false, error: null, items: [], page: 1, hasMore: false }
            : { loadingMore: true, error: null });
        try {
            const port = await resolveWallpaperServerPort();
            if (port > 0) set({ serverPort: port });
            const result = await fetchWallpaperPage(get().source, page, get().category);
            if (token !== sequence) return;
            set(state => ({
                items: reset ? result.items : state.items.concat(result.items),
                page,
                hasMore: result.hasMore,
            }));
        } catch (error) {
            if (token !== sequence) return;
            set({ error: errorText(error) });
        } finally {
            if (token === sequence) set({ loading: false, loadingMore: false });
        }
    };

    const refreshDownloaded = async () => {
        set({ downloadedLoading: true });
        try {
            set({ downloaded: await listStoredWallpapers() });
        } catch (error) {
            console.warn('[OnlineWallpaper] 读取已下载列表失败', error);
        } finally {
            set({ downloadedLoading: false });
        }
    };

    return {
        tab: 'online',
        source: 'moewalls',
        category: null,
        items: [],
        page: 0,
        hasMore: false,
        loading: false,
        loadingMore: false,
        error: null,
        downloaded: [],
        downloadedLoading: false,
        serverPort: 0,
        downloads: {},
        setTab: (tab) => {
            set({ tab });
            if (tab === 'downloaded') void refreshDownloaded();
        },
        setSource: (source) => {
            if (get().source === source) return;
            set({ source, category: null, items: [], page: 0, hasMore: false, error: null });
            void load(true);
        },
        setCategory: (category) => {
            if (get().category === category) return;
            set({ category, items: [], page: 0, hasMore: false, error: null });
            void load(true);
        },
        initialize: async () => {
            ensureProgressSubscription();
            const tasks: Array<Promise<unknown>> = [refreshDownloaded()];
            if (!get().items.length && !get().loading) tasks.push(load(true));
            await Promise.all(tasks);
        },
        reload: () => load(true),
        loadMore: () => load(false),
        download: async (item) => {
            ensureProgressSubscription();
            // 已经下过、正在下、已经排上队的都不再重复入队。
            if (get().downloaded.some(entry => entry.id === item.id)) return;
            const current = get().downloads[item.id];
            if (current && current.status !== 'error') return;
            if (pendingQueue.some(queued => queued.id === item.id)) return;
            patchDownload(item.id, { status: 'queued', progress: 0, error: undefined });
            pendingQueue.push(item);
            pump();
        },
        remove: async (entry) => {
            await deleteStoredWallpaper(entry);
            set(state => ({ downloaded: state.downloaded.filter(item => item.id !== entry.id) }));
            // 删掉的正好是当前在用的壁纸：一起从视频层上撤下来，别留一个 404 的地址。
            if (useVideoLayerSettingsStore.getState().onlineWallpaperId === entry.id) {
                useVideoLayerSettingsStore.getState().clearOnlineWallpaper();
            }
        },
        apply: async (entry) => {
            await useVideoLayerSettingsStore.getState().applyOnlineWallpaper(entry);
        },
        clearError: () => set({ error: null }),
    };
});
