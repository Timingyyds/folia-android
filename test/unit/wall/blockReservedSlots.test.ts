import { describe, expect, it } from 'vitest';
import {
    MAX_RESERVED_PER_BLOCK,
    blockReservedSlots,
    clampReservedPerBlock,
    getBlockCapacity,
    getBlockReservedMask,
    getBlockSlotShuffle,
    isReservedSlot,
} from '../../../src/components/wall/blockReservedSlots';
import { SLOTS_PER_BLOCK } from '../../../src/components/wall/blockTemplates';

// Reserved structural slots: k per block, picked by a hash of the block coordinates.

const BLOCKS = Array.from({ length: 49 }, (_, index) => [index % 7 - 3, Math.floor(index / 7) - 3]);

describe('block reserved slots', () => {
    it('shuffles each block into a permutation of its twelve slots', () => {
        for (const [column, row] of BLOCKS) {
            expect([...getBlockSlotShuffle(column, row)].sort((a, b) => a - b))
                .toEqual([...Array(SLOTS_PER_BLOCK).keys()]);
        }
    });

    it('is deterministic for the same block coordinates', () => {
        for (const [column, row] of BLOCKS) {
            expect(blockReservedSlots(column, row, 4)).toEqual(blockReservedSlots(column, row, 4));
        }
        expect(blockReservedSlots(5, -2, 6)).toEqual([...getBlockSlotShuffle(5, -2)].slice(0, 6));
    });

    it('varies between blocks', () => {
        const distinct = new Set(BLOCKS.map(([column, row]) => blockReservedSlots(column, row, 3).join(',')));
        expect(distinct.size).toBeGreaterThan(BLOCKS.length / 2);
    });

    it('only adds one reserved slot per step up, never moving the existing ones', () => {
        for (const [column, row] of BLOCKS) {
            for (let count = 0; count < MAX_RESERVED_PER_BLOCK; count += 1) {
                const current = blockReservedSlots(column, row, count);
                const next = blockReservedSlots(column, row, count + 1);
                expect(next).toHaveLength(count + 1);
                expect(next.slice(0, count)).toEqual(current);
                expect(current).not.toContain(next[count]);
            }
        }
    });

    it('clamps k into 0..6', () => {
        expect(clampReservedPerBlock(-2)).toBe(0);
        expect(clampReservedPerBlock(9)).toBe(6);
        expect(clampReservedPerBlock(Number.NaN)).toBe(0);
        expect(clampReservedPerBlock(2.6)).toBe(3);
        expect(blockReservedSlots(1, 1, 99)).toHaveLength(6);
        expect(blockReservedSlots(1, 1, -1)).toHaveLength(0);
        expect(getBlockCapacity(3)).toBe(9);
        expect(getBlockCapacity(40)).toBe(6);
    });

    it('agrees between list, mask and point lookups', () => {
        const reserved = blockReservedSlots(-4, 2, 5);
        const mask = getBlockReservedMask(-4, 2, 5);
        for (let slotIndex = 0; slotIndex < SLOTS_PER_BLOCK; slotIndex += 1) {
            expect(mask[slotIndex]).toBe(reserved.includes(slotIndex));
            expect(isReservedSlot(-4, 2, slotIndex, 5)).toBe(reserved.includes(slotIndex));
        }
    });
});
