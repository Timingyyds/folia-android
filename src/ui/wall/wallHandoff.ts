import { FLIP_MAX_DELAY_MS, FLIP_STAGGER_MS_PER_CELL } from './flipPlan';
import { getPitch, type WallMetrics } from './layout';

// src/ui/wall/wallHandoff.ts
// 两面墙的「翻牌交接」（资料库墙 bravais ↔ Lattice，设计稿 §7「进入队列」）的时间表与对齐几何，纯计算、两边共用。
// 交接期间两面墙同时挂着、叠在同一个视口里：每个视口位置上先是离开的那面墙翻出半圈（0 → 90°），再是进来的那面墙
// 翻进半圈（−90° → 0），像同一面墙换了内容。两面墙的格子不一定对齐（各自的相机），所以错开按「到起点的屏幕距离」算，
// 而不是按 slot：同一个屏幕位置在两面墙上拿到同一个延迟，翻出与翻进首尾相接。
// 半圈的时长与缓动与 bravais 磁贴的翻牌相同（bravaisConstants 的 150 / 210ms），错开沿用 flipPlan（18ms/格，上限 420ms）。

/** 离开的那面墙翻出半圈（0 → 90°）。 */
export const WALL_HANDOFF_FLIP_OUT_MS = 150;
/** 进来的那面墙翻进半圈（−90° → 0）。 */
export const WALL_HANDOFF_FLIP_IN_MS = 210;
export const WALL_HANDOFF_STAGGER_MS_PER_CELL = FLIP_STAGGER_MS_PER_CELL;
export const WALL_HANDOFF_MAX_DELAY_MS = FLIP_MAX_DELAY_MS;
/** 一整波：最远的位置开始翻出，到它翻进落定。 */
export const WALL_HANDOFF_WAVE_MS = WALL_HANDOFF_MAX_DELAY_MS + WALL_HANDOFF_FLIP_OUT_MS + WALL_HANDOFF_FLIP_IN_MS;
/** 降低动态效果：整面短淡入淡出交叉，不翻牌。 */
export const WALL_HANDOFF_FADE_MS = 180;
/** 回到资料库墙时翻完之后，缝张开、窗打开的那一段（缝的开口补间 0.36s 加一点余量）。 */
export const WALL_HANDOFF_OPEN_MS = 400;
/** 进 Lattice：等两边都准备好（缝合上、窗关上；Lattice 量好尺寸）最多这么久，到点照样开翻。 */
export const WALL_HANDOFF_CLOSE_TIMEOUT_MS = 1200;
/** 回资料库墙：等它挂上并画好最多这么久，到点放弃交接，Lattice 照旧淡出。 */
export const WALL_HANDOFF_WAIT_TIMEOUT_MS = 1600;
/** 半圈翻牌的透视（与 bravais 磁贴的 rotation() 相同）。 */
export const WALL_HANDOFF_PERSPECTIVE_PX = 1400;
/** 翻出 / 翻进的缓动（与 BravaisTile 的翻牌相同）。 */
export type WallHandoffEase = readonly [number, number, number, number];
export const WALL_HANDOFF_OUT_EASE: WallHandoffEase = [0.55, 0, 0.9, 0.45];
export const WALL_HANDOFF_IN_EASE: WallHandoffEase = [0.2, 0.7, 0.25, 1];

export const cubicBezierCss = (ease: WallHandoffEase) => (
    `cubic-bezier(${ease.join(',')})`
);

export type WallHandoffPoint = { x: number; y: number };
export type WallHandoffRect = { x: number; y: number; width: number; height: number };

/** 格距在屏幕上的长度（世界单位的格距 × 相机缩放）：错开按「隔了几格」算。 */
export const getWallHandoffPitchPx = (metrics: WallMetrics, scale: number) => getPitch(metrics) * scale;

/** 某个屏幕位置（客户区坐标）从开翻起要等多久才翻出（毫秒）。翻进 = 这个值 + 翻出半圈。 */
export const getWallHandoffDelay = (point: WallHandoffPoint, origin: WallHandoffPoint, pitchPx: number) => {
    const distance = Math.hypot(point.x - origin.x, point.y - origin.y);
    return Math.min(WALL_HANDOFF_MAX_DELAY_MS, (distance / Math.max(pitchPx, 1)) * WALL_HANDOFF_STAGGER_MS_PER_CELL);
};

/** 往哪边转：起点左边的往左翻（−1），其余往右（与 flipPlan 的 direction 相同）。 */
export const getWallHandoffDirection = (point: WallHandoffPoint, origin: WallHandoffPoint): -1 | 1 => (
    point.x < origin.x ? -1 : 1
);

export const rectCenter = (rect: WallHandoffRect): WallHandoffPoint => ({
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
});

/** 一个位置的排期：翻出在 outAt 开始，翻进在 inAt 开始（都相对开翻时刻，毫秒）。 */
export const getWallHandoffSpot = (rect: WallHandoffRect, origin: WallHandoffPoint, pitchPx: number) => {
    const center = rectCenter(rect);
    const outAt = getWallHandoffDelay(center, origin, pitchPx);
    return { outAt, inAt: outAt + WALL_HANDOFF_FLIP_OUT_MS, direction: getWallHandoffDirection(center, origin) };
};

/** 两个矩形在客户区里相交（只翻视口里看得见的那些）。 */
export const rectsIntersect = (a: WallHandoffRect, b: WallHandoffRect) => (
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
);

/**
 * 把 `from` 挪到与 `to` 同一套间距为 `pitch` 的网格线上要挪多少：结果在 [−pitch/2, pitch/2) 里，取最小的那一步。
 * 交接时 Lattice 用它让自己的格线与资料库墙的格线重合（两面墙的格距与缩放相同，只差相机的余数）。
 */
export const alignToPitch = (from: number, to: number, pitch: number) => {
    if (!(pitch > 0)) return 0;
    let delta = (to - from) % pitch;
    if (delta >= pitch / 2) delta -= pitch;
    if (delta < -pitch / 2) delta += pitch;
    return delta;
};

/**
 * Lattice 进场时相机要挪多少才和资料库墙对齐（客户区像素）：两边都有展开的聚焦卡时让两张卡重合（同为 6×6 档、
 * 同一缩放，尺寸相同——起点那张卡原地换成 Lattice 的展开海报）；否则只对齐格线（挪动不超过半个格距）。
 */
export const resolveWallHandoffAlignment = ({
    homeCard,
    latticeCard,
    homeGridPoint,
    latticeGridPoint,
    pitchPx,
}: {
    homeCard: WallHandoffRect | null;
    latticeCard: WallHandoffRect | null;
    homeGridPoint: WallHandoffPoint;
    latticeGridPoint: WallHandoffPoint;
    pitchPx: number;
}): WallHandoffPoint => {
    if (homeCard && latticeCard) {
        return { x: homeCard.x - latticeCard.x, y: homeCard.y - latticeCard.y };
    }
    return {
        x: alignToPitch(latticeGridPoint.x, homeGridPoint.x, pitchPx),
        y: alignToPitch(latticeGridPoint.y, homeGridPoint.y, pitchPx),
    };
};

/** 交接各段的时长（director 交给 store）。 */
export const WALL_HANDOFF_TIMING = {
    waveMs: WALL_HANDOFF_WAVE_MS,
    fadeMs: WALL_HANDOFF_FADE_MS,
    openMs: WALL_HANDOFF_OPEN_MS,
    closeTimeoutMs: WALL_HANDOFF_CLOSE_TIMEOUT_MS,
    waitTimeoutMs: WALL_HANDOFF_WAIT_TIMEOUT_MS,
} as const;
