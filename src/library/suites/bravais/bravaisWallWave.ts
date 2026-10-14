import { FLIP_MAX_TILES, type FlipSlotChange } from '../../../ui/wall/flipPlan';
import { getPitch, overlaps, type Bounds, type WallMetrics } from '../../../ui/wall/layout';

// src/library/suites/bravais/bravaisWallWave.ts
// 整墙出场 → 入场（设计稿 §7 转场表：换首页页签、切换来源；沿用 Lattice 的 lift wave，PosterWall / LatticePoster）。
// 与从起点开始的翻牌不同，整面墙先按「离视口左上角越远越先走」的反向对角线波次抬起淡出（磁贴往上抬一段、缩小），
// 全部走完之后再按「离左上角越近越先到」的对角线波次落回原位。纯计划：每张变了内容的磁贴一个出场延迟与一个入场延迟
// （都从这次转场开始算），视口加 overscan 以外、或超出 400 张上限的直接换。动画由磁贴的内容层做（外框不动，透光档下
// 露出的是实色底板，见设计稿 §11.3）。降低动态效果时调用方不跑它（磁贴直接换）。

/** 磁贴出场时往上抬的距离（世界单位，与 Lattice 的 ENTRANCE_LIFT 相同）。 */
export const WALL_WAVE_LIFT = 90;
/** 每隔一格（沿对角线）错开的毫秒数、错开的上限（Lattice：0.03s / 0.34s）。 */
export const WALL_WAVE_STAGGER_MS_PER_CELL = 30;
export const WALL_WAVE_MAX_DELAY_MS = 340;
/** 单张出场（抬起淡出）与入场（落回）的时长。 */
export const WALL_WAVE_OUT_MS = 280;
export const WALL_WAVE_IN_MS = 420;
/** 出场波次整体放完的时刻：入场从这之后开始。 */
export const WALL_WAVE_EXIT_TOTAL_MS = WALL_WAVE_MAX_DELAY_MS + WALL_WAVE_OUT_MS;

export type WallWaveStep = {
    key: string;
    to: string | null;
    /** 出场开始（毫秒，从转场开始算）。 */
    outDelay: number;
    /** 入场开始（毫秒，从转场开始算），总在这张磁贴出场放完之后。 */
    inDelay: number;
};

export type WallWavePlan = {
    steps: WallWaveStep[];
    swaps: Array<{ key: string; to: string | null }>;
    /** 最后一张落定的时刻；没有磁贴要动时为 0。 */
    durationMs: number;
};

/** 离视口左上角的对角线距离换成的错开（入场延迟的基础；出场按它反过来）。 */
export const getWaveStagger = (rect: { x: number; y: number }, corner: { left: number; top: number }, metrics: WallMetrics) => {
    const steps = Math.max(0, rect.x - corner.left) + Math.max(0, rect.y - corner.top);
    return Math.min(WALL_WAVE_MAX_DELAY_MS, (steps / getPitch(metrics)) * WALL_WAVE_STAGGER_MS_PER_CELL);
};

/**
 * 整墙出场 / 入场的计划。`viewport` 是此刻视口的世界矩形（波次从它的左上角量），`visible` 是可以动的范围（视口加
 * overscan）。只有前后显示不同的 slot 参与（两边都是墙面的不动）；超出上限时保留离左上角最近的那些。
 */
export const planWallWave = ({
    changes,
    viewport,
    visible,
    metrics,
    maxTiles = FLIP_MAX_TILES,
}: {
    changes: readonly FlipSlotChange[];
    viewport: Bounds;
    visible: Bounds;
    metrics: WallMetrics;
    maxTiles?: number;
}): WallWavePlan => {
    const candidates: Array<{ change: FlipSlotChange; stagger: number }> = [];
    const swaps: WallWavePlan['swaps'] = [];
    for (const change of changes) {
        if (change.from === change.to) continue;
        const { slot } = change;
        const rect = { left: slot.x, right: slot.x + slot.width, top: slot.y, bottom: slot.y + slot.height };
        if (!overlaps(rect, visible)) {
            swaps.push({ key: slot.key, to: change.to });
            continue;
        }
        candidates.push({ change, stagger: getWaveStagger(slot, viewport, metrics) });
    }
    candidates.sort((a, b) => a.stagger - b.stagger);
    const animated = candidates.slice(0, maxTiles);
    candidates.slice(maxTiles).forEach(({ change }) => swaps.push({ key: change.slot.key, to: change.to }));
    const steps = animated.map(({ change, stagger }) => ({
        key: change.slot.key,
        to: change.to,
        outDelay: Math.round(WALL_WAVE_MAX_DELAY_MS - stagger),
        inDelay: Math.round(WALL_WAVE_EXIT_TOTAL_MS + stagger),
    }));
    const durationMs = steps.reduce((latest, step) => Math.max(latest, step.inDelay + WALL_WAVE_IN_MS), 0);
    return { steps, swaps, durationMs };
};
