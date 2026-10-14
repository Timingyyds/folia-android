import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { loadImagePixels } from '../../../lib/colorExtractor';
import { getSizedCoverUrl } from '../../../lib/coverUrl';
import { rgbToHsl, type Rgb } from '../../../lib/themeColorMath';

// src/library/suites/bravais/bravaisArtistTone.ts
// 歌手双色调人像的亮端「取自头像」（设计稿 §7.7）：头像的平均色 → 同色相、提饱和提亮度的一色 hsl(h 62% 66%)。
// - 取色复用 lib/colorExtractor 的 loadImagePixels（匿名跨源请求、缩到 50×50 读像素）；读不到（加载失败、没有 CORS
//   头、画布被污染）或头像几乎没有色相（黑白照）时结果是 null，磁贴回退到主题强调色（CSS 里的默认值）。
// - 结果按头像 URL 缓存在模块里（含失败），同一个头像在墙上出现多少次、翻牌多少次都只取一次；同时最多取 3 张，
//   其余排队。墙的首帧不等它：没有结果时先画回退色，结果到了磁贴只换一个 CSS 变量，由 CSS 过渡过去。

/** 取色用的头像尺寸（与墙上最小的封面档同一档，多半已经在缓存里）。 */
const SAMPLE_COVER_PX = 256;
const MAX_ACTIVE = 3;
const MAX_ENTRIES = 800;
/** 平均色的色度（max − min，0–1）低于它就当没有色相：黑白照取不出「同色相」，回退强调色。 */
const MIN_CHROMA = 0.04;

/** 像素的平均色（跳过半透明的像素）；没有可用像素时为 null。 */
export const averagePixelColor = (pixels: Uint8ClampedArray): Rgb | null => {
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3] < 128) continue;
        r += pixels[index];
        g += pixels[index + 1];
        b += pixels[index + 2];
        count += 1;
    }
    return count ? { r: r / count, g: g / count, b: b / count } : null;
};

/** 平均色 → 双色调的亮端：同色相、饱和 62%、亮度 66%；几乎没有色相时为 null（回退强调色）。 */
export const resolveArtistToneLight = (average: Rgb): string | null => {
    const chroma = (Math.max(average.r, average.g, average.b) - Math.min(average.r, average.g, average.b)) / 255;
    if (!(chroma >= MIN_CHROMA)) return null;
    return `hsl(${Math.round(rgbToHsl(average).h)} 62% 66%)`;
};

/**
 * 取色结果：颜色 = 取到了；null = 取不到（没有 CORS 头、黑白照……），回退强调色；false = 头像本身加载不出来（坏地址），
 * 磁贴不画人像层（与任何加载不出来的封面一样露出空卡底色）。
 */
export type BravaisArtistTone = string | null | false;

/** url → 取色结果。没有条目 = 还没取。 */
const tones = new Map<string, BravaisArtistTone>();
const listeners = new Map<string, Set<() => void>>();
const queued: string[] = [];
const pending = new Set<string>();
let active = 0;

const settle = (url: string, tone: BravaisArtistTone) => {
    tones.delete(url);
    tones.set(url, tone);
    while (tones.size > MAX_ENTRIES) {
        const oldest = tones.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        tones.delete(oldest);
    }
    listeners.get(url)?.forEach(listener => listener());
};

/** 不带 CORS 再加载一次：分清「图片本身坏了」与「只是读不了像素」（多半命中海报已经加载过的那份缓存）。 */
const imageLoads = (url: string): Promise<boolean> => new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = url;
});

/** 取一张头像的亮端（不经缓存；队列用）。 */
export const sampleArtistTone = async (url: string): Promise<BravaisArtistTone> => {
    const sampleUrl = getSizedCoverUrl(url, SAMPLE_COVER_PX) || url;
    const pixels = await loadImagePixels(sampleUrl, { silent: true });
    if (!pixels) return (await imageLoads(sampleUrl)) ? null : false;
    const average = averagePixelColor(pixels);
    return average ? resolveArtistToneLight(average) : null;
};

const pump = () => {
    while (active < MAX_ACTIVE && queued.length > 0) {
        const url = queued.shift()!;
        active += 1;
        void sampleArtistTone(url)
            .catch(() => null)
            .then((tone) => {
                active -= 1;
                pending.delete(url);
                settle(url, tone);
                pump();
            });
    }
};

/** 此刻缓存里的结果；undefined = 还没取 / 在取。 */
export const peekArtistTone = (url: string): BravaisArtistTone | undefined => tones.get(url);

/** 排队取色（已缓存或正在取的不重复取）。 */
export const requestArtistTone = (url: string) => {
    if (!url || tones.has(url) || pending.has(url)) return;
    pending.add(url);
    queued.push(url);
    pump();
};

const subscribeTone = (url: string, listener: () => void) => {
    const set = listeners.get(url) ?? new Set<() => void>();
    set.add(listener);
    listeners.set(url, set);
    return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(url);
    };
};

const NO_SUBSCRIPTION = () => () => { };

/**
 * 一张歌手磁贴的取色结果：没有头像 → null（回退，人像层画在程序生成的渐变上）；还没取到 → undefined（先画回退色）；
 * 取到 → 颜色；头像加载不出来 → false。enabled 为假（不是歌手、全透明档不画人像）时什么都不做。
 */
export const useBravaisArtistTone = (coverUrl: string | undefined, enabled: boolean): BravaisArtistTone | undefined => {
    const url = enabled ? coverUrl ?? '' : '';
    const subscribe = useCallback((listener: () => void) => (url ? subscribeTone(url, listener) : NO_SUBSCRIPTION()), [url]);
    const tone = useSyncExternalStore(subscribe, () => (url ? tones.get(url) : undefined));
    useEffect(() => {
        if (url) requestArtistTone(url);
    }, [url]);
    if (!enabled) return undefined;
    return url ? tone : null;
};
