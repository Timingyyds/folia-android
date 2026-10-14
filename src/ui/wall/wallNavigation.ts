// src/ui/wall/wallNavigation.ts

import { SLOTS_PER_BLOCK } from './blockTemplates';
import {
    getInstanceBlock,
    locateInstanceAt,
    type LatticeGeometry,
    type QueueInstance,
    type WallMetrics,
} from './layout';

// Directional focus movement. The lattice has no edge, so a step always lands somewhere; the
// search runs on geometry rather than the rendered set, and freely crosses into the next cell.

export type WallDirection = 'up' | 'down' | 'left' | 'right';

type Axis = {
    along: 'x' | 'y';
    cross: 'y' | 'x';
    alongSize: 'width' | 'height';
    crossSize: 'height' | 'width';
    sign: 1 | -1;
};

const AXES: Record<WallDirection, Axis> = {
    right: { along: 'x', cross: 'y', alongSize: 'width', crossSize: 'height', sign: 1 },
    left: { along: 'x', cross: 'y', alongSize: 'width', crossSize: 'height', sign: -1 },
    down: { along: 'y', cross: 'x', alongSize: 'height', crossSize: 'width', sign: 1 },
    up: { along: 'y', cross: 'x', alongSize: 'height', crossSize: 'width', sign: -1 },
};

/** Anything with a drawn rect: Lattice instances and bravais slots both qualify. */
export type WallRect = { x: number; y: number; width: number; height: number };

const centerOf = (rect: WallRect, axis: 'x' | 'y', size: 'width' | 'height') => (
    rect[axis] + rect[size] / 2
);

// Positive when the two spans truly share a band, zero when they merely touch, negative by the
// size of the gap when they miss entirely.
const crossOverlap = (a: WallRect, b: WallRect, axis: Axis) => {
    const aStart = a[axis.cross];
    const bStart = b[axis.cross];
    return Math.min(aStart + a[axis.crossSize], bStart + b[axis.crossSize]) - Math.max(aStart, bStart);
};

// Gap between the trailing edge of `from` and the leading edge of `candidate` along the travel
// axis; negative whenever the candidate is not wholly ahead, which disqualifies it.
const alongGap = (from: WallRect, candidate: WallRect, axis: Axis) => (
    axis.sign === 1
        ? candidate[axis.along] - (from[axis.along] + from[axis.alongSize])
        : from[axis.along] - (candidate[axis.along] + candidate[axis.alongSize])
);

/**
 * The scoring behind every directional step, over already-drawn rects. A candidate has to sit
 * wholly ahead on the travel axis; the score prefers a short step and penalises both sideways drift
 * and failing to share a band with the rect being left. On a full tie the earlier candidate wins,
 * so callers control tie order through the order they list candidates in.
 */
export const pickAdjacentRect = <T>(
    source: WallRect,
    candidates: Iterable<{ value: T; rect: WallRect }>,
    direction: WallDirection,
    metrics: WallMetrics,
): T | null => {
    const axis = AXES[direction];
    const missPenalty = metrics.cellSize + metrics.gap;
    let best: T | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    let bestCross = Number.POSITIVE_INFINITY;

    for (const { value, rect } of candidates) {
        const step = alongGap(source, rect, axis);
        if (step < 0) continue;

        const overlap = crossOverlap(source, rect, axis);
        const score = step + (overlap > 0 ? 0 : -overlap * 2 + missPenalty);
        const crossDelta = Math.abs(
            centerOf(rect, axis.cross, axis.crossSize)
            - centerOf(source, axis.cross, axis.crossSize),
        );
        if (score < bestScore || (score === bestScore && crossDelta < bestCross)) {
            bestScore = score;
            bestCross = crossDelta;
            best = value;
        }
    }

    return best;
};

/**
 * Picks the poster a directional key should move to, scanning the blocks around the current one.
 * A candidate has to sit wholly ahead on the travel axis; the score then prefers a short step and
 * penalises both sideways drift and failing to share a band with the poster being left, so arrows
 * walk a row instead of cutting corners.
 */
export const findAdjacentInstance = (
    from: QueueInstance,
    direction: WallDirection,
    geometry: LatticeGeometry,
    totalEntries: number,
    metrics: WallMetrics,
    rendered?: Map<string, { x: number; y: number; width: number; height: number }>,
): QueueInstance | null => {
    if (totalEntries <= 0) return null;

    // Inside the block holding an expanded card every poster has been re-geared, so navigate by
    // where things are actually drawn; otherwise the ring lands somewhere the arrow did not point.
    const drawn = (instance: QueueInstance): QueueInstance => {
        const override = rendered?.get(instance.instanceId);
        return override ? { ...instance, ...override } : instance;
    };

    const source = drawn(from);
    const origin = getInstanceBlock(geometry, from);

    // Row, column, slot order: the same order the scan always used, so ties resolve as before.
    function* candidates() {
        for (let row = origin.row - 1; row <= origin.row + 1; row += 1) {
            for (let column = origin.column - 1; column <= origin.column + 1; column += 1) {
                for (let slotIndex = 0; slotIndex < SLOTS_PER_BLOCK; slotIndex += 1) {
                    const base = locateInstanceAt(geometry, totalEntries, column, row, slotIndex, metrics);
                    if (!base || base.instanceId === from.instanceId) continue;
                    yield { value: base, rect: drawn(base) };
                }
            }
        }
    }

    return pickAdjacentRect(source, candidates(), direction, metrics);
};

// Seeds keyboard focus from whatever is already on screen when nothing is focused yet.
export const findNearestInstance = <T extends WallRect>(
    instances: readonly T[],
    point: { x: number; y: number },
): T | null => {
    let best: T | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const instance of instances) {
        const dx = instance.x + instance.width / 2 - point.x;
        const dy = instance.y + instance.height / 2 - point.y;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
            bestDistance = distance;
            best = instance;
        }
    }

    return best;
};
