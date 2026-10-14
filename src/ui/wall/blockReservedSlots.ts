// src/ui/wall/blockReservedSlots.ts

import { SLOTS_PER_BLOCK } from './blockTemplates';

// Structural slots held back from content, k per block. Which ones is decided by the block's own
// coordinates: a hash seeds a fixed shuffle of the block's twelve slots and the first k are taken.
// The shuffle does not depend on k, so raising k by one only ever adds one more reserved slot.
// What a reserved slot shows is the caller's business; this module only answers "is it held back".

export const MIN_RESERVED_PER_BLOCK = 0;
export const MAX_RESERVED_PER_BLOCK = 6;

/** Integer in [0, 6]; anything unparsable counts as none. */
export const clampReservedPerBlock = (count: number): number => {
    if (!Number.isFinite(count)) return MIN_RESERVED_PER_BLOCK;
    return Math.min(MAX_RESERVED_PER_BLOCK, Math.max(MIN_RESERVED_PER_BLOCK, Math.round(count)));
};

// Seeded apart from the template orientation hash so reserved slots do not correlate with reflections.
const hashBlock = (column: number, row: number): number => {
    let value = Math.imul(column | 0, 0x27d4eb2d) ^ Math.imul(row | 0, 0x165667b1) ^ 0x5bd1e995;
    value = Math.imul(value ^ (value >>> 15), 0x85ebca6b);
    value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
    return (value ^ (value >>> 16)) >>> 0;
};

// mulberry32: tiny deterministic PRNG, enough to drive one Fisher-Yates pass.
const createRandom = (seed: number) => {
    let state = seed | 0;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

/** The block's fixed slot shuffle; reserved slots are a prefix of it. */
export const getBlockSlotShuffle = (column: number, row: number): number[] => {
    const order = Array.from({ length: SLOTS_PER_BLOCK }, (_, index) => index);
    const random = createRandom(hashBlock(column, row));
    for (let index = order.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1));
        [order[index], order[swap]] = [order[swap], order[index]];
    }
    return order;
};

/** Slot indices held back in this block, in shuffle order. */
export const blockReservedSlots = (column: number, row: number, count: number): number[] => (
    getBlockSlotShuffle(column, row).slice(0, clampReservedPerBlock(count))
);

/** Per-slot lookup for one block: `mask[slotIndex]` is true when the slot is held back. */
export const getBlockReservedMask = (column: number, row: number, count: number): boolean[] => {
    const mask = new Array<boolean>(SLOTS_PER_BLOCK).fill(false);
    for (const slotIndex of blockReservedSlots(column, row, count)) mask[slotIndex] = true;
    return mask;
};

export const isReservedSlot = (column: number, row: number, slotIndex: number, count: number): boolean => (
    blockReservedSlots(column, row, count).includes(slotIndex)
);

/** Content capacity of one block once k slots are held back. */
export const getBlockCapacity = (count: number) => SLOTS_PER_BLOCK - clampReservedPerBlock(count);
