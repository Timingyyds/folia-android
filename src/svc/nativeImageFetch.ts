// src/svc/nativeImageFetch.ts
// 封面来自远端 CDN 时通常没有 CORS 头，直接在 canvas 里读像素会污染画布并抛异常。
// 安卓容器里改用原生 OkHttp 桥把图片字节取回来，转成同源的 blob URL 再交给 canvas，
// 这样读像素一定是安全的。

type NativeHeaderEntry = { name?: string; value?: string };

type NativeImagePlugin = {
    httpRequest: (options: {
        url: string;
        method: string;
        headers: Record<string, string>;
        bodyText: string;
        bodyBase64: string;
        redirect: string;
    }) => Promise<{
        status: number;
        headers?: NativeHeaderEntry[] | Record<string, string>;
        bodyBase64?: string;
    }>;
};

export interface SameOriginImageSource {
    url: string;
    revoke: () => void;
}

const getNativePlugin = (): NativeImagePlugin | null => {
    if (typeof window === 'undefined') return null;
    const capacitor = (window as unknown as {
        Capacitor?: {
            isNativePlatform?: () => boolean;
            getPlatform?: () => string;
            Plugins?: { FoliaNative?: NativeImagePlugin };
        };
    }).Capacitor;
    if (!capacitor) return null;
    const native = capacitor.isNativePlatform?.() === true || capacitor.getPlatform?.() === 'android';
    if (!native) return null;
    return capacitor.Plugins?.FoliaNative ?? null;
};

const base64ToBytes = (value?: string): Uint8Array => {
    if (!value) return new Uint8Array();
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
};

const readContentType = (headers?: NativeHeaderEntry[] | Record<string, string>): string => {
    const fallback = 'image/jpeg';
    if (!headers) return fallback;
    if (Array.isArray(headers)) {
        const entry = headers.find(item => String(item?.name || '').toLowerCase() === 'content-type');
        return entry?.value ? String(entry.value).split(';')[0] : fallback;
    }
    const match = Object.entries(headers)
        .find(([name]) => name.toLowerCase() === 'content-type');
    return match ? String(match[1]).split(';')[0] : fallback;
};

/**
 * 拿到一个同源的图片地址。
 *
 * - 已经是 blob:/data: 的本地地址原样返回（调用方负责自己的生命周期）。
 * - 安卓容器里走原生桥取字节，返回需要 revoke 的 blob URL。
 * - 其他情况返回 null，让调用方按原来的方式加载。
 */
export const resolveSameOriginImageSource = async (url: string): Promise<SameOriginImageSource | null> => {
    if (!url || !/^https?:/i.test(url)) return null;
    const plugin = getNativePlugin();
    if (!plugin?.httpRequest) return null;

    try {
        const result = await plugin.httpRequest({
            url,
            method: 'GET',
            headers: {},
            bodyText: '',
            bodyBase64: '',
            redirect: 'follow',
        });
        if (result.status < 200 || result.status >= 300) return null;

        const bytes = base64ToBytes(result.bodyBase64);
        if (bytes.length === 0) return null;

        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        const blob = new Blob([buffer], { type: readContentType(result.headers) });
        const objectUrl = URL.createObjectURL(blob);
        return {
            url: objectUrl,
            revoke: () => URL.revokeObjectURL(objectUrl),
        };
    } catch (error) {
        console.warn('[nativeImageFetch] failed to fetch image bytes, falling back to direct load', error);
        return null;
    }
};
