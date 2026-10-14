// src/ui/wall/rankSlots.ts

import { getBlockReservedMask } from './blockReservedSlots';
import { getPitch, type WallMetrics } from './layout';
import type { WallSlot } from './wallSlots';

// Rank -> slot: every slot gets a priority score and receives ranks 0, 1, 2... in score order, so the
// best results always sit next to the rank origin and rank spirals outward. Strict rank only: rank i
// is always the i-th slot of the order (the prototype's "sticky" variant is not carried over).

export type WallPoint = { x: number; y: number };

export type RankSlotsOptions = {
    /** Seam point (seam-centred layers) or the start tile's centre (start-tile layers). */
    origin: WallPoint;
    metrics: WallMetrics;
    /** k reserved slots per block; ranks skip them, so rank i lands on the i-th non-reserved slot. */
    reservedPerBlock?: number;
    /** Pinned to rank 0 when present among the candidates and not reserved. */
    startSlotKey?: string | null;
};

// Prototype weights: vertical distance counts a little less than horizontal (the field is landscape),
// and bigger slots are pulled forward by sqrt(area) pitches so headline ranks land on big posters.
export const RANK_VERTICAL_WEIGHT = 0.9;
export const RANK_AREA_WEIGHT = 0.35;

/** Lower is better: distance to the origin minus a size bonus. */
export const scoreWallSlot = (slot: WallSlot, origin: WallPoint, metrics: WallMetrics) => (
    Math.abs(slot.centerX - origin.x)
    + Math.abs(slot.centerY - origin.y) * RANK_VERTICAL_WEIGHT
    - Math.sqrt(slot.area) * getPitch(metrics) * RANK_AREA_WEIGHT
);

// Ties break on world position, never on input order, so the same slot set always ranks the same.
const compareSlots = (first: WallSlot, second: WallSlot) => (
    first.row - second.row
    || first.column - second.column
    || first.slotIndex - second.slotIndex
);

/** Drops reserved slots, looking each block's mask up once. */
export const withoutReservedSlots = (slots: readonly WallSlot[], reservedPerBlock: number): WallSlot[] => {
    if (!reservedPerBlock) return [...slots];
    const masks = new Map<string, boolean[]>();
    return slots.filter(slot => {
        const blockKey = `${slot.column},${slot.row}`;
        let mask = masks.get(blockKey);
        if (!mask) {
            mask = getBlockReservedMask(slot.column, slot.row, reservedPerBlock);
            masks.set(blockKey, mask);
        }
        return !mask[slot.slotIndex];
    });
};

/**
 * Orders the candidate slots for strict rank. Reserved slots never appear in the result; the start
 * slot, if given, is rank 0 and everything else spreads out from `origin` by score.
 */
export const rankSlots = (candidates: readonly WallSlot[], options: RankSlotsOptions): WallSlot[] => {
    const open = withoutReservedSlots(candidates, options.reservedPerBlock ?? 0);
    const scored = open.map(slot => ({ slot, score: scoreWallSlot(slot, options.origin, options.metrics) }));
    scored.sort((first, second) => first.score - second.score || compareSlots(first.slot, second.slot));
    const order = scored.map(entry => entry.slot);

    const startIndex = options.startSlotKey ? order.findIndex(slot => slot.key === options.startSlotKey) : -1;
    if (startIndex > 0) order.unshift(...order.splice(startIndex, 1));
    return order;
};

/** Strict rank: slot key -> rank for every ordered slot; ranks below `itemCount` carry content. */
export const indexRanks = (order: readonly WallSlot[]): Map<string, number> => (
    new Map(order.map((slot, rank) => [slot.key, rank]))
);
