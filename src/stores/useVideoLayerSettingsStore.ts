import { create } from 'zustand';
import { getStoredBoolean, getStoredString, setStoredBoolean, setStoredString } from './storagePrimitives';
import {
    canPersistVideoLayerFile,
    canStoreVideoLayerFileCopy,
    clearVideoLayerFileCopy,
    clearVideoLayerFileHandle,
    loadVideoLayerFileCopy,
    saveVideoLayerFileCopy,
    loadVideoLayerFileHandle,
    pickVideoLayerFile,
    readVideoLayerFileHandle,
    saveVideoLayerFileHandle,
} from '../services/videoLayerFile';
import { findStoredWallpaper, type WallpaperLibraryEntry } from '../services/onlineWallpaper/library';
import type { WallpaperKind } from '../services/onlineWallpaper/types';

// src/stores/useVideoLayerSettingsStore.ts
// The built-in video layer behind the lyrics: a muted video (a picked local file, else a URL) that
// follows playback. Deliberately outside the appearance import/export payload, and therefore out of
// the OBS sources too (they are configured from that same payload). The local file is a handle in
// this window's IndexedDB: a shortcode cannot carry it, and an OBS browser source runs in OBS's own
// browser profile, which cannot open it.

export type VideoLayerFit = 'cover' | 'contain';

/** `needs-permission`: a stored pick exists but the browser wants a click to read it again. */
export type VideoLayerLocalFileStatus = 'none' | 'ready' | 'needs-permission';

export const VIDEO_LAYER_OPACITY_BOUNDS = { min: 0.1, max: 1 } as const;
const VIDEO_LAYER_OPACITY_DEFAULT = 0.6;

const VIDEO_LAYER_ENABLED_KEY = 'video_layer_enabled';
const VIDEO_LAYER_URL_KEY = 'video_layer_url';
const VIDEO_LAYER_OPACITY_KEY = 'video_layer_opacity';
const VIDEO_LAYER_FIT_KEY = 'video_layer_fit';
/** 选中的在线壁纸：只记 id/类型/名字，地址按本机端口在启动时重建。 */
const ONLINE_WALLPAPER_KEY = 'video_layer_online_wallpaper';

type StoredOnlineWallpaper = { id: string; kind: WallpaperKind; name: string };

const readStoredOnlineWallpaper = (): StoredOnlineWallpaper | null => {
    try {
        const raw = getStoredString(ONLINE_WALLPAPER_KEY, '');
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<StoredOnlineWallpaper>;
        if (!parsed || typeof parsed.id !== 'string' || !parsed.id) return null;
        return {
            id: parsed.id,
            kind: parsed.kind === 'image' ? 'image' : 'video',
            name: typeof parsed.name === 'string' ? parsed.name : '',
        };
    } catch {
        return null;
    }
};

const persistOnlineWallpaper = (value: StoredOnlineWallpaper | null) => {
    setStoredString(ONLINE_WALLPAPER_KEY, value ? JSON.stringify(value) : '');
};

export const clampVideoLayerOpacity = (value: number) => (
    Number.isFinite(value)
        ? Math.max(VIDEO_LAYER_OPACITY_BOUNDS.min, Math.min(VIDEO_LAYER_OPACITY_BOUNDS.max, value))
        : VIDEO_LAYER_OPACITY_DEFAULT
);

const persistString = (key: string, value: string) => {
    if (typeof window !== 'undefined') localStorage.setItem(key, value);
};

export type VideoLayerSettingsState = {
    videoLayerEnabled: boolean;
    videoLayerUrl: string;
    videoLayerOpacity: number;
    videoLayerFit: VideoLayerFit;
    /** Runtime only: a blob URL for the picked file, rebuilt from the stored handle on each start. */
    localFileUrl: string | null;
    localFileName: string | null;
    localFileStatus: VideoLayerLocalFileStatus;
    /** False where the pick falls back to <input type=file> and is forgotten on restart. */
    canPersistLocalFile: boolean;
    /** 选中的在线壁纸（下载在应用内），本地视频优先于它。 */
    onlineWallpaperId: string | null;
    onlineWallpaperKind: WallpaperKind | null;
    onlineWallpaperName: string | null;
    /** 运行时地址：本机回环服务的 /wallpaper/ 路由，重启后按新端口重建。 */
    onlineWallpaperUrl: string | null;
    setVideoLayerEnabled: (enabled: boolean) => void;
    setVideoLayerUrl: (url: string) => void;
    setVideoLayerOpacity: (opacity: number) => void;
    setVideoLayerFit: (fit: VideoLayerFit) => void;
    /** 换上一张已下载的在线壁纸；本地视频会被清掉，因为它优先于壁纸。 */
    applyOnlineWallpaper: (entry: WallpaperLibraryEntry) => Promise<void>;
    clearOnlineWallpaper: () => void;
    /** 启动时按存下的 id 找回壁纸地址；文件已经不在时静默清掉记录。 */
    restoreOnlineWallpaper: () => Promise<void>;
    /** Opens the file picker; resolves to the picked name, or null when cancelled. */
    pickLocalFile: () => Promise<string | null>;
    clearLocalFile: () => Promise<void>;
    /** Rebuilds the pick from the stored handle without prompting. */
    restoreLocalFile: () => Promise<void>;
    /** Asks the browser again for a stored pick whose permission lapsed. Needs a user gesture. */
    regrantLocalFile: () => Promise<void>;
};

// A pick or clear in this session supersedes the stored one, so it also counts as restored.
let restoreStarted = false;

export const useVideoLayerSettingsStore = create<VideoLayerSettingsState>((set, get) => {
    // Bumped by every pick/clear so a slow restore or re-grant cannot overwrite a newer choice.
    let fileRevision = 0;

    const showFile = (file: File) => {
        const previous = get().localFileUrl;
        if (previous) URL.revokeObjectURL(previous);
        set({ localFileUrl: URL.createObjectURL(file), localFileName: file.name, localFileStatus: 'ready' });
    };

    const dropFile = () => {
        const previous = get().localFileUrl;
        if (previous) URL.revokeObjectURL(previous);
        set({ localFileUrl: null, localFileName: null, localFileStatus: 'none' });
    };

    const loadStoredFile = async (request: boolean) => {
        const revision = fileRevision;
        const handle = await loadVideoLayerFileHandle();
        console.log('[VideoLayerDIAG] restore hasHandle', Boolean(handle), handle?.name);
        if (!handle) {
            // 安卓没有句柄：读存下的视频副本，直接可用，不需要再授权。
            const copy = await loadVideoLayerFileCopy();
            console.log('[VideoLayerDIAG] restore attempt', {
                hasHandle: false,
                gotCopy: Boolean(copy),
                name: copy?.name ?? null,
                size: copy?.size ?? null,
            });
            if (revision !== fileRevision) return;
            if (copy) {
                showFile(copy);
            } else {
                dropFile();
            }
            return;
        }
        if (revision !== fileRevision) return;
        let result: Awaited<ReturnType<typeof readVideoLayerFileHandle>>;
        try {
            result = await readVideoLayerFileHandle(handle, request);
        } catch (error) {
            console.warn('[VideoLayer] Failed to read the stored video handle:', error);
            return;
        }
        if (revision !== fileRevision) return;
        console.log('[VideoLayerDIAG] read result', result.status);
        if (result.status === 'ready') {
            showFile(result.file);
            return;
        }
        if (revision !== fileRevision) return;
        // 句柄读不出来（安卓重启后必然如此，或文件被移动）：回退到存下的视频副本。
        // 不能像过去那样直接清句柄 —— 那正是"重启就丢"的直接原因。
        const fallback = await loadVideoLayerFileCopy();
        console.log('[VideoLayerDIAG] handle unusable, copy=', Boolean(fallback));
        if (revision !== fileRevision) return;
        if (fallback) {
            showFile(fallback);
            return;
        }
        // 副本也没有（真正被删掉了）：这时才清理。
        if (result.status === 'needs-permission') {
            set({ localFileName: handle.name, localFileStatus: 'needs-permission' });
        } else {
            await clearVideoLayerFileHandle();
            if (revision === fileRevision) dropFile();
        }
    };

    const storedOnlineWallpaper = readStoredOnlineWallpaper();

    return {
        videoLayerEnabled: getStoredBoolean(VIDEO_LAYER_ENABLED_KEY, false),
        videoLayerUrl: getStoredString(VIDEO_LAYER_URL_KEY, ''),
        videoLayerOpacity: clampVideoLayerOpacity(Number(getStoredString(VIDEO_LAYER_OPACITY_KEY, String(VIDEO_LAYER_OPACITY_DEFAULT)))),
        videoLayerFit: getStoredString(VIDEO_LAYER_FIT_KEY, 'cover') === 'contain' ? 'contain' : 'cover',
        localFileUrl: null,
        localFileName: null,
        localFileStatus: 'none',
        // 句柄（Chromium/Electron）或本地副本（安卓 WebView）任一可行，重启后都能恢复。
        canPersistLocalFile: canPersistVideoLayerFile() || canStoreVideoLayerFileCopy(),
        onlineWallpaperId: storedOnlineWallpaper?.id ?? null,
        onlineWallpaperKind: storedOnlineWallpaper?.kind ?? null,
        onlineWallpaperName: storedOnlineWallpaper?.name ?? null,
        onlineWallpaperUrl: null,
        setVideoLayerEnabled: (enabled) => {
            set({ videoLayerEnabled: enabled });
            setStoredBoolean(VIDEO_LAYER_ENABLED_KEY, enabled);
        },
        setVideoLayerUrl: (url) => {
            const normalized = url.trim();
            set({ videoLayerUrl: normalized });
            persistString(VIDEO_LAYER_URL_KEY, normalized);
        },
        setVideoLayerOpacity: (opacity) => {
            const normalized = clampVideoLayerOpacity(opacity);
            set({ videoLayerOpacity: normalized });
            persistString(VIDEO_LAYER_OPACITY_KEY, String(normalized));
        },
        setVideoLayerFit: (fit) => {
            set({ videoLayerFit: fit });
            persistString(VIDEO_LAYER_FIT_KEY, fit);
        },
        applyOnlineWallpaper: async (entry) => {
            // 本地视频优先于壁纸：换上壁纸时必须把它清掉，否则界面上点了没有任何变化。
            await get().clearLocalFile();
            persistOnlineWallpaper({ id: entry.id, kind: entry.kind, name: entry.title });
            set({
                onlineWallpaperId: entry.id,
                onlineWallpaperKind: entry.kind,
                onlineWallpaperName: entry.title,
                onlineWallpaperUrl: entry.url || null,
            });
            get().setVideoLayerEnabled(true);
        },
        clearOnlineWallpaper: () => {
            persistOnlineWallpaper(null);
            set({
                onlineWallpaperId: null,
                onlineWallpaperKind: null,
                onlineWallpaperName: null,
                onlineWallpaperUrl: null,
            });
        },
        restoreOnlineWallpaper: async () => {
            const stored = readStoredOnlineWallpaper();
            if (!stored) return;
            const entry = await findStoredWallpaper(stored.id);
            if (!entry) {
                // 文件被清掉了（换机、清数据、删掉了下载）：别把一个打不开的地址留在设置里。
                persistOnlineWallpaper(null);
                set({
                    onlineWallpaperId: null,
                    onlineWallpaperKind: null,
                    onlineWallpaperName: null,
                    onlineWallpaperUrl: null,
                });
                return;
            }
            set({
                onlineWallpaperId: entry.id,
                onlineWallpaperKind: entry.kind,
                onlineWallpaperName: entry.title,
                onlineWallpaperUrl: entry.url || null,
            });
        },
        pickLocalFile: async () => {
            const picked = await pickVideoLayerFile();
            if (!picked) return null;
            fileRevision += 1;
            restoreStarted = true;
            console.log('[VideoLayerDIAG] picked', {
                hasHandle: Boolean(picked.handle),
                name: picked.file.name,
                size: picked.file.size,
                canPersist: canPersistVideoLayerFile(),
                canCopy: canStoreVideoLayerFileCopy(),
            });
            // 句柄与副本都存。
            //
            // 为什么要副本：安卓 WebView 虽然给了 FileSystemFileHandle，但它跨重启后
            // handle.getFile() 会失败（日志里 read result missing），句柄等于废的。
            // 副本存的是视频内容本身，重启后一定能读回来；有句柄的平台优先用句柄（不占空间）。
            if (picked.handle) {
                try {
                    await saveVideoLayerFileHandle(picked.handle);
                } catch (error) {
                    console.warn('[VideoLayer] 句柄保存失败（副本仍可用）：', error);
                }
            } else {
                await clearVideoLayerFileHandle();
            }
            try {
                await saveVideoLayerFileCopy(picked.file);
                // saveToCache 内部会吞掉错误，所以这里读回来验证：
                // 21 MB 的视频若超出配额，写入会静默失败，必须自己确认。
                const stored = await loadVideoLayerFileCopy();
                console.log('[VideoLayerDIAG] copy verify', {
                    stored: Boolean(stored),
                    size: stored?.size ?? null,
                    expected: picked.file.size,
                    quota: 'checking',
                });
                try {
                    const est = await navigator.storage?.estimate?.();
                    console.log('[VideoLayerDIAG] storage', {
                        usageMB: est?.usage ? Math.round(est.usage / 1048576) : null,
                        quotaMB: est?.quota ? Math.round(est.quota / 1048576) : null,
                    });
                } catch { /* estimate 不支持就算了 */ }
            } catch (error) {
                console.warn('[VideoLayer] 存视频副本失败：', error instanceof Error ? error.message : String(error));
            }
            showFile(picked.file);
            // 本地视频优先：选了它就把在线壁纸的记录清掉，避免恢复时又冒出来。
            get().clearOnlineWallpaper();
            get().setVideoLayerEnabled(true);
            return picked.file.name;
        },
        clearLocalFile: async () => {
            fileRevision += 1;
            restoreStarted = true;
            dropFile();
            await clearVideoLayerFileHandle();
            await clearVideoLayerFileCopy();
        },
        restoreLocalFile: () => loadStoredFile(false),
        regrantLocalFile: () => loadStoredFile(true),
    };
});

/**
 * Restores the pick from an earlier session, once. Called lazily by the layer and the settings
 * section rather than at import time, so windows that never show the layer never touch IndexedDB.
 */
export const ensureVideoLayerFileRestored = () => {
    if (restoreStarted) return;
    restoreStarted = true;
    const state = useVideoLayerSettingsStore.getState();
    void state.restoreLocalFile();
    void state.restoreOnlineWallpaper();
};
