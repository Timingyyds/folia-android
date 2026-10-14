import { create } from 'zustand';
import { getStoredBoolean, getStoredString, setStoredBoolean } from './storagePrimitives';
import {
    MAX_VIDEO_LAYER_FILE_BYTES,
    VideoLayerFileTooLargeError,
    canPersistVideoLayerFile,
    clearVideoLayerFileBlob,
    clearVideoLayerFileHandle,
    loadVideoLayerFileBlob,
    loadVideoLayerFileHandle,
    pickVideoLayerFile,
    readVideoLayerFileHandle,
    requestVideoLayerStoragePersistence,
    saveVideoLayerFileBlob,
    saveVideoLayerFileHandle,
    usesFileHandlePersistence,
} from '../svc/videoLayerFile';

// src/state/useVideoLayerSettingsStore.ts
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
    setVideoLayerEnabled: (enabled: boolean) => void;
    setVideoLayerUrl: (url: string) => void;
    setVideoLayerOpacity: (opacity: number) => void;
    setVideoLayerFit: (fit: VideoLayerFit) => void;
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
        // 不走句柄的运行时（安卓）直接看整份存储：那边即使残留着旧句柄也读不出文件。
        const handle = usesFileHandlePersistence() ? await loadVideoLayerFileHandle() : null;
        if (revision !== fileRevision) return;
        if (!handle) {
            // 没有 handle 的运行时（安卓 WebView）把视频整份存在 IndexedDB 里，取回来直接用。
            const stored = await loadVideoLayerFileBlob();
            if (revision !== fileRevision) return;
            if (stored) showFile(stored);
            return;
        }
        let result: Awaited<ReturnType<typeof readVideoLayerFileHandle>>;
        try {
            result = await readVideoLayerFileHandle(handle, request);
        } catch (error) {
            console.warn('[VideoLayer] Failed to read the stored video handle:', error);
            return;
        }
        if (revision !== fileRevision) return;
        if (result.status === 'ready') {
            showFile(result.file);
        } else if (result.status === 'needs-permission') {
            set({ localFileName: handle.name, localFileStatus: 'needs-permission' });
        } else {
            // The file was moved or deleted; forget the handle rather than retrying every start.
            await clearVideoLayerFileHandle();
            if (revision === fileRevision) dropFile();
        }
    };

    return {
        videoLayerEnabled: getStoredBoolean(VIDEO_LAYER_ENABLED_KEY, false),
        videoLayerUrl: getStoredString(VIDEO_LAYER_URL_KEY, ''),
        videoLayerOpacity: clampVideoLayerOpacity(Number(getStoredString(VIDEO_LAYER_OPACITY_KEY, String(VIDEO_LAYER_OPACITY_DEFAULT)))),
        videoLayerFit: getStoredString(VIDEO_LAYER_FIT_KEY, 'cover') === 'contain' ? 'contain' : 'cover',
        localFileUrl: null,
        localFileName: null,
        localFileStatus: 'none',
        canPersistLocalFile: canPersistVideoLayerFile(),
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
        pickLocalFile: async () => {
            const picked = await pickVideoLayerFile();
            if (!picked) return null;
            // 整份存下来是占配额的，超限就不收 —— 存进去失败再回退到"只在本次会话可用"更糟。
            if (picked.file.size > MAX_VIDEO_LAYER_FILE_BYTES) {
                throw new VideoLayerFileTooLargeError(picked.file.size);
            }
            fileRevision += 1;
            restoreStarted = true;
            if (picked.handle) {
                // 桌面：handle 只是个引用，不用把视频复制一份。
                await saveVideoLayerFileHandle(picked.handle);
                await clearVideoLayerFileBlob();
            } else {
                // 先申请持久化再写这份文件：persist() 需要用户手势，这里正好在点击链上。
                await requestVideoLayerStoragePersistence();
                await saveVideoLayerFileBlob(picked.file);
                await clearVideoLayerFileHandle();
            }
            showFile(picked.file);
            get().setVideoLayerEnabled(true);
            return picked.file.name;
        },
        clearLocalFile: async () => {
            fileRevision += 1;
            restoreStarted = true;
            dropFile();
            await clearVideoLayerFileHandle();
            await clearVideoLayerFileBlob();
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
    void useVideoLayerSettingsStore.getState().restoreLocalFile();
};
