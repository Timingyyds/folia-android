import { getFromCache, removeFromCache, saveToCache } from './db';
import { VIDEO_LAYER_FILE_BLOB_KEY, putCacheEntry } from './repositories/cacheRepository';
import { isCapacitorAndroid } from '../platform/runtime';

// src/svc/videoLayerFile.ts
// Local video file for the video layer behind the lyrics. Where the File System Access API exists
// (Chromium, Electron) the pick is a FileSystemFileHandle kept in IndexedDB, so it survives a
// restart without copying the video anywhere. Elsewhere the pick falls back to <input type=file>
// and lasts for the session only.

const VIDEO_LAYER_FILE_HANDLE_KEY = 'video_layer_file_handle';

/**
 * 没有 File System Access API 的运行时（典型是安卓 WebView）走这条：把选中的视频整份存进
 * IndexedDB，重启后再取出来建 blob URL。和上面的 handle 互斥 —— 能存 handle 就不复制文件。
 * key 本体在 cacheRepository，那边还要用它把这份数据从「清除缓存」里排除掉。
 */
export { VIDEO_LAYER_FILE_BLOB_KEY };

/**
 * 上一次写入失败的原因。写入失败时用户只会看到「重启后没了」，而 `console.warn` 在手机上没人
 * 看得到，所以顺手留一份在 localStorage 里 —— 诊断报告里能直接读出来。
 */
const VIDEO_LAYER_STORE_ERROR_KEY = 'video_layer_store_error';

/**
 * 存下来的形状。
 *
 * 刻意不直接存 `File`：内容一样，但 File 的结构化克隆在个别 WebView 上会失败，而文件名和
 * 类型本来就要单独带上，用不着靠 File 自带的元数据。
 */
export type StoredVideoLayerFile = {
    blob: Blob;
    name: string;
    type: string;
};

export const readVideoLayerStoreFailure = (): string => {
    try {
        return localStorage.getItem(VIDEO_LAYER_STORE_ERROR_KEY) ?? '';
    } catch {
        return '';
    }
};

const noteVideoLayerStoreFailure = (error: unknown): void => {
    try {
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        localStorage.setItem(VIDEO_LAYER_STORE_ERROR_KEY, `${new Date().toISOString()} ${detail}`);
    } catch {
        // 记不下来也不能影响本来要做的事。
    }
};

const clearVideoLayerStoreFailure = (): void => {
    try {
        localStorage.removeItem(VIDEO_LAYER_STORE_ERROR_KEY);
    } catch {
        // 同上。
    }
};

/**
 * 本地视频的大小上限。
 *
 * 视频是整份存下来的（不像 handle 只存一个引用），所以它直接占 WebView 的 origin 配额 ——
 * 和媒体缓存、Service Worker 预缓存共用一个池子。200MB 够放常见的循环背景视频，又不至于
 * 把缓存挤掉或者触发配额问题。
 */
export const MAX_VIDEO_LAYER_FILE_BYTES = 200 * 1024 * 1024;

export class VideoLayerFileTooLargeError extends Error {
    constructor(public readonly size: number) {
        super(`Video layer file exceeds ${MAX_VIDEO_LAYER_FILE_BYTES} bytes: ${size}`);
        this.name = 'VideoLayerFileTooLargeError';
    }
}

type PermissionAwareFileHandle = FileSystemFileHandle & {
    queryPermission?: (descriptor: { mode: 'read' }) => Promise<PermissionState>;
    requestPermission?: (descriptor: { mode: 'read' }) => Promise<PermissionState>;
};

type OpenFilePickerWindow = Window & {
    showOpenFilePicker?: (options: {
        multiple?: boolean;
        excludeAcceptAllOption?: boolean;
        types?: Array<{ description?: string; accept: Record<string, string[]> }>;
    }) => Promise<FileSystemFileHandle[]>;
};

export type PickedVideoFile = {
    file: File;
    /** Null when the pick came from the <input> fallback and cannot be restored later. */
    handle: FileSystemFileHandle | null;
};

export const canPersistVideoLayerFile = (): boolean => (
    typeof window !== 'undefined' && (
        canUseFileHandlePersistence()
        || typeof indexedDB !== 'undefined'
    )
);

/**
 * 是否用 File System Access API 的文件句柄来记住选择。**只认桌面。**
 *
 * 安卓 WebView 上 `showOpenFilePicker` 可能是存在的（Chrome 153 实测），但句柄存进 IndexedDB
 * 之后重启会失效：既拿不到可用的 `queryPermission`（于是被当成已授权），底层 SAF 的读权限也没
 * 有持久化，`getFile()` 直接抛错 —— 结果被归成「文件被移动或删除」，句柄被清掉，用户看到的就是
 * 「重启后要重新选」。这条路上 `saveVideoLayerFileBlob` 一次都不会被调用，所以报告里连失败记录
 * 都没有。安卓因此一律走「把视频整份存进 IndexedDB」。
 */
const canUseFileHandlePersistence = (): boolean => (
    typeof window !== 'undefined'
    && !isCapacitorAndroid()
    && typeof (window as OpenFilePickerWindow).showOpenFilePicker === 'function'
);

/** 诊断用：当前走的是句柄还是整份存储。 */
export const usesFileHandlePersistence = canUseFileHandlePersistence;

const pickWithInput = (): Promise<File | null> => new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
});

/** Opens the native picker for one video; null when the user cancels. Must run inside a user gesture. */
export const pickVideoLayerFile = async (): Promise<PickedVideoFile | null> => {
    if (!canUseFileHandlePersistence()) {
        const file = await pickWithInput();
        return file ? { file, handle: null } : null;
    }
    const picker = (window as OpenFilePickerWindow).showOpenFilePicker!;
    try {
        const [handle] = await picker({
            multiple: false,
            types: [{
                description: 'Video',
                accept: { 'video/*': ['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.ogv'] },
            }],
        });
        if (!handle) return null;
        return { file: await handle.getFile(), handle };
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return null;
        throw error;
    }
};

export const saveVideoLayerFileHandle = (handle: FileSystemFileHandle) => saveToCache(VIDEO_LAYER_FILE_HANDLE_KEY, handle);

export const loadVideoLayerFileHandle = () => getFromCache<FileSystemFileHandle>(VIDEO_LAYER_FILE_HANDLE_KEY);

export const clearVideoLayerFileHandle = () => removeFromCache(VIDEO_LAYER_FILE_HANDLE_KEY);

/**
 * Stores the picked video itself. Unlike `saveToCache` this reports failure: a silent failure here
 * is exactly the "我要重新设置一次" complaint, so the caller shows it instead of pretending.
 */
export const saveVideoLayerFileBlob = async (file: File): Promise<boolean> => {
    try {
        const payload: StoredVideoLayerFile = {
            blob: new Blob([file], { type: file.type }),
            name: file.name,
            type: file.type,
        };
        await putCacheEntry(VIDEO_LAYER_FILE_BLOB_KEY, payload);
        clearVideoLayerStoreFailure();
        return true;
    } catch (error) {
        noteVideoLayerStoreFailure(error);
        console.warn('[VideoLayer] Failed to store the picked video:', error);
        return false;
    }
};

export const loadVideoLayerFileBlob = async (): Promise<File | null> => {
    const stored = await getFromCache<StoredVideoLayerFile | File>(VIDEO_LAYER_FILE_BLOB_KEY);
    if (!stored) return null;
    // 认旧格式：早期版本存的是 File 本体，不能让升级把用户已有的选取读没了。
    if (typeof File !== 'undefined' && stored instanceof File) return stored;
    const record = stored as StoredVideoLayerFile;
    if (!record.blob) return null;
    return new File(
        [record.blob],
        record.name || 'video',
        { type: record.type || record.blob.type || 'video/mp4' },
    );
};

export const clearVideoLayerFileBlob = () => removeFromCache(VIDEO_LAYER_FILE_BLOB_KEY);

/**
 * Asks the browser to keep this origin's storage instead of treating it as disposable.
 *
 * Without it the whole origin bucket is best-effort: Chromium may evict it when the disk runs low,
 * which would take the media cache and any stored video with it. Browsers answer from heuristics
 * (no prompt), so a `false` here is normal and only means "kept as best-effort".
 */
export const requestVideoLayerStoragePersistence = async (): Promise<boolean> => {
    try {
        const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
        if (!storage?.persist) return false;
        if (typeof storage.persisted === 'function' && await storage.persisted()) return true;
        return await storage.persist();
    } catch (error) {
        console.warn('[VideoLayer] Storage persistence request failed:', error);
        return false;
    }
};

export type VideoLayerFileReadResult =
    | { status: 'ready'; file: File }
    | { status: 'needs-permission' }
    | { status: 'missing' };

/**
 * Reads the stored handle's file. Without `request` it never prompts: a handle whose read
 * permission lapsed (a browser restart outside Electron) reports `needs-permission`, and the
 * settings UI asks again from a click. `missing` means the file was moved or deleted.
 */
export const readVideoLayerFileHandle = async (
    handle: FileSystemFileHandle,
    request: boolean,
): Promise<VideoLayerFileReadResult> => {
    const permissionAware = handle as PermissionAwareFileHandle;
    let permission: PermissionState = (await permissionAware.queryPermission?.({ mode: 'read' })) ?? 'granted';
    if (permission !== 'granted' && request && permissionAware.requestPermission) {
        permission = await permissionAware.requestPermission({ mode: 'read' });
    }
    if (permission !== 'granted') return { status: 'needs-permission' };
    try {
        return { status: 'ready', file: await handle.getFile() };
    } catch {
        return { status: 'missing' };
    }
};
