import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { BLOCK_COLS, BLOCK_ROWS } from '../../../ui/wall/blockTemplates';
import { getPitch } from '../../../ui/wall/layout';
import { loadImagePixels } from '../../../lib/colorExtractor';
import { getCoverIdentity, getSizedCoverUrl } from '../../../lib/coverUrl';
import { BRAVAIS_METRICS } from './bravaisConstants';
import type { BravaisCoverArt, BravaisItem } from './bravaisLayer';
import { createRandom, hashPosterSeed } from './bravaisPosterComposition';

// src/library/suites/bravais/bravaisAlbumWall.ts
// 专辑海报旁那面墙上的曲目怎么画封面（has-album-wall，bravaisAlbumPoster.css）。两种模式，按这张专辑里的封面分：
// - 拼贴（mosaic）：所有曲目都是同一张封面（或没有封面）——按块切：每个块（BLOCK_COLS × BLOCK_ROWS 格）铺一整张封面，
//   铺满块、居中（边长 BRAVAIS_ALBUM_MOSAIC_PX，上下裁掉一点），块里的磁贴拼起来正好是一张；接缝落在块与块之间。
// - 碎片（shard）：有的曲目带自己的封面（单曲）——每张封面第一次出现时完整画出来；重复出现的、没有封面的画成从那张
//   封面上「有内容的地方」切下来的碎片（放大 2–3.5 倍，切点由曲目键定死），套海报的双色调与网点，悬停与正在播放时还原。
// 「有内容的地方」：封面缩到 50×50 读像素（colorExtractor 的 loadImagePixels），按亮度梯度找出细节最多的几块
// （findCoverSpots），结果按封面缓存；读不到像素（没有 CORS 头）时切点落在中心附近。
// 「同一张封面」按 getCoverIdentity 比：尺寸参数、网易云的 p1/p2 主机、QQ/酷狗/酷我写在路径里的尺寸都不算区别。
// 曲目顺序不动。

const PITCH = getPitch(BRAVAIS_METRICS);
/** 一个块里磁贴占的范围（世界坐标的像素；块尾那道缝不算）。 */
const MOSAIC_BLOCK_W = BLOCK_COLS * PITCH - BRAVAIS_METRICS.gap;
const MOSAIC_BLOCK_H = BLOCK_ROWS * PITCH - BRAVAIS_METRICS.gap;
/** 拼贴里一张封面的边长：铺满一个块。 */
export const BRAVAIS_ALBUM_MOSAIC_PX = Math.max(MOSAIC_BLOCK_W, MOSAIC_BLOCK_H);
/** 碎片的放大倍数（相对磁贴长边）。 */
const SHARD_ZOOM = [2, 3.5] as const;
const SPOT_COUNT = 6;
const SAMPLE_COVER_PX = 128;

/** 给专辑墙上的曲目定封面画法（纯投影，不改顺序）。albumCoverUrl 是专辑本身的封面。 */
export const assignAlbumCoverArt = (items: readonly BravaisItem[], albumCoverUrl: string | undefined): readonly BravaisItem[] => {
    const album = getCoverIdentity(albumCoverUrl);
    const covers = new Set(items.map(item => getCoverIdentity(item.coverUrl)).filter(Boolean));
    const single = covers.size === 0 || (covers.size === 1 && (!album || covers.has(album)));
    if (single) {
        const url = albumCoverUrl || items.find(item => item.coverUrl)?.coverUrl;
        if (!url) return items;
        const art: BravaisCoverArt = { mode: 'mosaic', url };
        return items.map(item => ({ ...item, coverArt: art }));
    }
    const seen = new Set<string>();
    return items.map((item) => {
        const cover = getCoverIdentity(item.coverUrl);
        if (!cover) return albumCoverUrl ? { ...item, coverUrl: albumCoverUrl, coverArt: { mode: 'shard', url: albumCoverUrl } } : item;
        if (!seen.has(cover)) {
            seen.add(cover);
            return item;
        }
        return { ...item, coverArt: { mode: 'shard', url: item.coverUrl! } };
    });
};

/** 一处有内容的地方（0–1，块的中心）。 */
export type BravaisCoverSpot = { x: number; y: number };

const FALLBACK_SPOTS: readonly BravaisCoverSpot[] = [
    { x: 0.5, y: 0.5 }, { x: 0.35, y: 0.4 }, { x: 0.65, y: 0.6 }, { x: 0.4, y: 0.65 }, { x: 0.6, y: 0.35 },
];

/**
 * 正方形像素（RGBA，side × side）里细节最多的几块：亮度梯度在 window × window 的窗里求和，窗按半窗步进，
 * 由高到低挑、彼此至少隔一个窗；全平的图（没有梯度）回退到中心附近。
 */
export const findCoverSpots = (pixels: Uint8ClampedArray, side: number, count = SPOT_COUNT): readonly BravaisCoverSpot[] => {
    const lum = new Float32Array(side * side);
    for (let index = 0; index < side * side; index += 1) {
        lum[index] = 0.2126 * pixels[index * 4] + 0.7152 * pixels[index * 4 + 1] + 0.0722 * pixels[index * 4 + 2];
    }
    const energy = new Float32Array(side * side);
    for (let y = 1; y < side - 1; y += 1) {
        for (let x = 1; x < side - 1; x += 1) {
            const index = y * side + x;
            energy[index] = Math.abs(lum[index + 1] - lum[index - 1]) + Math.abs(lum[index + side] - lum[index - side]);
        }
    }
    const window = Math.max(4, Math.round(side / 5));
    const step = Math.max(2, Math.round(window / 2));
    const candidates: { x: number; y: number; score: number }[] = [];
    for (let top = 0; top + window <= side; top += step) {
        for (let left = 0; left + window <= side; left += step) {
            let score = 0;
            for (let y = top; y < top + window; y += 1) for (let x = left; x < left + window; x += 1) score += energy[y * side + x];
            candidates.push({ x: (left + window / 2) / side, y: (top + window / 2) / side, score });
        }
    }
    candidates.sort((a, b) => b.score - a.score);
    if (!candidates.length || candidates[0].score <= 0) return FALLBACK_SPOTS.slice(0, count);
    const gap = window / side;
    const spots: BravaisCoverSpot[] = [];
    for (const candidate of candidates) {
        if (candidate.score <= 0) break;
        if (spots.some(spot => Math.max(Math.abs(spot.x - candidate.x), Math.abs(spot.y - candidate.y)) < gap)) continue;
        spots.push({ x: candidate.x, y: candidate.y });
        if (spots.length >= count) break;
    }
    return spots;
};

type Rect = { width: number; height: number };
export type BravaisArtPlacement = { size: number; x: number; y: number };

/** 拼贴：磁贴所在的块（slot 键里的块坐标）与它在世界里的位置 → 背景偏移，块里居中铺满的那张封面露出这一格。 */
export const mosaicPlacement = (rect: { x: number; y: number }, block: { column: number; row: number }): BravaisArtPlacement => {
    const size = BRAVAIS_ALBUM_MOSAIC_PX;
    const left = block.column * BLOCK_COLS * PITCH + (MOSAIC_BLOCK_W - size) / 2;
    const top = block.row * BLOCK_ROWS * PITCH + (MOSAIC_BLOCK_H - size) / 2;
    return { size, x: left - rect.x, y: top - rect.y };
};

/** 碎片：按种子挑一处、放大，把那一处放到磁贴中间（不露出封面以外）。 */
export const shardPlacement = (spots: readonly BravaisCoverSpot[], seed: string, rect: Rect): BravaisArtPlacement => {
    const random = createRandom(hashPosterSeed(`shard:${seed}`));
    const list = spots.length ? spots : FALLBACK_SPOTS;
    const spot = list[Math.floor(random() * list.length) % list.length];
    const size = Math.max(rect.width, rect.height) * (SHARD_ZOOM[0] + (SHARD_ZOOM[1] - SHARD_ZOOM[0]) * random());
    const clamp = (value: number, extent: number) => Math.min(0, Math.max(extent - size, value));
    return {
        size,
        x: clamp(rect.width / 2 - spot.x * size, rect.width),
        y: clamp(rect.height / 2 - spot.y * size, rect.height),
    };
};

// ---- 切点缓存（按封面地址，含读不到的） ----
const spotsByUrl = new Map<string, readonly BravaisCoverSpot[]>();
const pending = new Set<string>();
const listeners = new Map<string, Set<() => void>>();
const MAX_ENTRIES = 400;

const settle = (url: string, spots: readonly BravaisCoverSpot[]) => {
    pending.delete(url);
    spotsByUrl.set(url, spots);
    while (spotsByUrl.size > MAX_ENTRIES) {
        const oldest = spotsByUrl.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        spotsByUrl.delete(oldest);
    }
    listeners.get(url)?.forEach(listener => listener());
};

const requestSpots = (url: string) => {
    if (spotsByUrl.has(url) || pending.has(url)) return;
    pending.add(url);
    void loadImagePixels(getSizedCoverUrl(url, SAMPLE_COVER_PX) || url, { silent: true })
        .catch(() => null)
        .then(pixels => settle(url, pixels ? findCoverSpots(pixels, Math.round(Math.sqrt(pixels.length / 4))) : FALLBACK_SPOTS));
};

const subscribeSpots = (url: string, listener: () => void) => {
    const set = listeners.get(url) ?? new Set<() => void>();
    set.add(listener);
    listeners.set(url, set);
    return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(url);
    };
};

const NO_SUBSCRIPTION = () => () => { };

/** 一张封面的切点；还没取到时是 undefined（碎片先不画，露出底下的整张封面）。 */
export const useBravaisCoverSpots = (url: string | undefined): readonly BravaisCoverSpot[] | undefined => {
    const key = getCoverIdentity(url) ? url! : '';
    const subscribe = useCallback((listener: () => void) => (key ? subscribeSpots(key, listener) : NO_SUBSCRIPTION()), [key]);
    const spots = useSyncExternalStore(subscribe, () => (key ? spotsByUrl.get(key) : undefined));
    useEffect(() => {
        if (key) requestSpots(key);
    }, [key]);
    return spots;
};
