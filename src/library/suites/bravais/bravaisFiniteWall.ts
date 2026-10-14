import {
    getFiniteCameraRange,
    getRankedContentBounds,
    planFiniteWall,
    type WallCameraRange,
} from '../../../ui/wall/finiteWall';
import type { WallView, WallViewCenter } from '../../../ui/wall/wallView';
import type { WallSlot } from '../../../ui/wall/wallSlots';
import { BRAVAIS_METRICS } from './bravaisConstants';

// src/library/suites/bravais/bravaisFiniteWall.ts
// 双模式里的有限拼贴（设计稿 §4「歌单 / 歌手页的双模式」）：过滤时退化为以缝为中心的有限拼贴，严格 rank（rank i 永远
// 在第 i 个 slot），不重复，剩下的 slot 是墙面。世界与 rank 顺序只在进入有限态、缝换了位置（orderStale）或条目数
// 超出容量时规划一次（B5：用层的全量条目数规划，过滤只改有内容的 rank 数），所以逐字收窄时翻动的只是内容变了的 slot。
// 相机钳制在有内容的部分（带弹性回弹，装得下一屏时锁定）。纯计算。

export type BravaisFiniteState = {
    /** 规划时缝锚点的世界 x 与相机 y（rank 的原点）。 */
    origin: { x: number; y: number };
    capacity: number;
    /** B6b③：规划时跳过的每块结构窗数（部分透明档的 k，其余为 0）；rank 顺序不含这些窗位。 */
    reservedPerBlock: number;
    order: readonly WallSlot[];
    rankOfSlot: ReadonlyMap<string, number>;
};

/**
 * 以缝为中心规划有限拼贴：`count` 是层的全量条目数（过滤前），世界至少铺满当前视口。`reservedPerBlock` 是部分透明档
 * 每块的结构窗数（B6b③）：rank i → 第 i 个非窗 slot，容量相应变小；须与显示的 `reservedPerBlock` 一致。
 */
export const planBravaisFinite = ({
    count,
    anchorX,
    center,
    view,
    reservedPerBlock = 0,
}: {
    count: number;
    anchorX: number | null;
    center: WallViewCenter;
    view: WallView;
    reservedPerBlock?: number;
}): BravaisFiniteState => {
    const origin = { x: anchorX ?? center.x, y: center.y };
    const plan = planFiniteWall({ itemCount: count, metrics: BRAVAIS_METRICS, view, origin, viewCenter: center, reservedPerBlock });
    return { origin, capacity: plan.capacity, reservedPerBlock, order: plan.order, rankOfSlot: plan.rankOfSlot };
};

/**
 * 还能不能沿用上一次的规划：缝换了块边界（orderStale，设计稿 §5「在当前视口另开一道缝」）、条目数超出了容量时重新规划；
 * 只是过滤词变了（N 变了）就沿用，严格 rank 的位置因此不变。透光换档 / 换窗数（每块窗数变了）也重新规划。
 */
export const canReuseFinitePlan = (
    previous: BravaisFiniteState | null | undefined,
    { anchorX, count, reservedPerBlock = 0 }: { anchorX: number | null; count: number; reservedPerBlock?: number },
): previous is BravaisFiniteState => Boolean(
    previous
    && anchorX !== null
    && previous.origin.x === anchorX
    && previous.reservedPerBlock === reservedPerBlock
    && count <= previous.capacity,
);

/** 这个 slot 在有限拼贴里的 rank；不在世界里就是 null（墙面）。 */
export const resolveFiniteRank = (finite: BravaisFiniteState, slot: Pick<WallSlot, 'key'>): number | null => (
    finite.rankOfSlot.get(slot.key) ?? null
);

/** 有限态的相机可行范围：内容外框（前 itemCount 个 rank）减去缝两侧的屏宽，装得下时锁到锚点。 */
export const resolveFiniteCameraRange = ({
    finite,
    itemCount,
    view,
    seamWidth,
}: {
    finite: BravaisFiniteState;
    itemCount: number;
    view: WallView;
    seamWidth: number;
}): WallCameraRange => getFiniteCameraRange({
    contentBounds: getRankedContentBounds(finite.order as WallSlot[], itemCount),
    anchor: finite.origin,
    view,
    seamWidth,
});

/** 拖动时的弹性：超出范围的部分按阻尼缩短（绝对位置的映射，不累积误差）。 */
export const rubberBand = (value: number, min: number, max: number, resistance = 0.35) => {
    if (value < min) return min - (min - value) * resistance;
    if (value > max) return max + (value - max) * resistance;
    return value;
};
