import { describe, expect, it } from 'vitest';
import { isReservedSlot } from '../../../src/components/wall/blockReservedSlots';
import { planFiniteWall } from '../../../src/components/wall/finiteWall';
import type { WallMetrics } from '../../../src/components/wall/layout';
import {
    getInfiniteSlotItem,
    getStartWrapOffset,
    getWrapIndex,
    getWrapPeriod,
} from '../../../src/components/wall/startTile';
import { collectBlockRangeSlots } from '../../../src/components/wall/wallSlots';

// Infinite wall wrapping, the start tile's wrap offset, and the dual-mode round trip.

const METRICS: WallMetrics = { cellSize: 128, gap: 8 };
const VIEW = { width: 887, height: 800, scale: 0.64 };

const snapshot = (itemCount: number, offset: number, reservedPerBlock: number) => (
    collectBlockRangeSlots({ from: -3, to: 3 }, { from: -2, to: 2 }, METRICS)
        .map(slot => getInfiniteSlotItem(slot, itemCount, offset, reservedPerBlock))
);

describe('infinite wrap', () => {
    it('puts every item in every period and skips reserved slots', () => {
        for (const [itemCount, reservedPerBlock] of [[1, 0], [17, 0], [50, 3], [301, 6]]) {
            const period = getWrapPeriod(itemCount, reservedPerBlock);
            const seen = new Set<number>();
            const slots = collectBlockRangeSlots(
                { from: 4, to: 4 + period.blocksPerRow },
                { from: -1, to: -1 + period.blockRows },
                METRICS,
            );
            for (const slot of slots) {
                const index = getWrapIndex(slot, itemCount, reservedPerBlock);
                const reserved = isReservedSlot(slot.column, slot.row, slot.slotIndex, reservedPerBlock);
                expect(index === null).toBe(reserved);
                if (index !== null) seen.add(index);
            }
            expect(seen.size).toBe(itemCount);
        }
        expect(getWrapIndex({ column: 0, row: 0, slotIndex: 0 }, 0)).toBeNull();
    });

    it('repeats with the period when nothing is reserved', () => {
        const period = getWrapPeriod(40);
        const slot = { column: 1, row: 1, slotIndex: 5 };
        const repeated = { column: 1 + period.blocksPerRow * 3, row: 1 - period.blockRows * 2, slotIndex: 5 };
        expect(getWrapIndex(repeated, 40)).toBe(getWrapIndex(slot, 40));
    });
});

describe('start tile', () => {
    it('makes the clicked tile item 0 of the new layer', () => {
        for (const reservedPerBlock of [0, 3]) {
            const start = collectBlockRangeSlots({ from: 2, to: 3 }, { from: -1, to: 0 }, METRICS)
                .find(slot => !isReservedSlot(slot.column, slot.row, slot.slotIndex, reservedPerBlock))!;
            const offset = getStartWrapOffset(start, 37, reservedPerBlock);
            expect(getInfiniteSlotItem(start, 37, offset, reservedPerBlock)).toBe(0);
        }
        expect(getStartWrapOffset(null, 37)).toBe(0);
    });

    it('keeps the start offset across the finite detour of the dual mode', () => {
        const itemCount = 64;
        const reservedPerBlock = 3;
        const start = collectBlockRangeSlots({ from: 0, to: 1 }, { from: 0, to: 1 }, METRICS)
            .find(slot => !isReservedSlot(slot.column, slot.row, slot.slotIndex, reservedPerBlock))!;
        const offset = getStartWrapOffset(start, itemCount, reservedPerBlock);
        const before = snapshot(itemCount, offset, reservedPerBlock);

        // Filtering: the layer turns finite and ranks around the seam, so the start tile loses rank 0.
        const seam = { x: -4, y: 544 };
        const finite = planFiniteWall({ itemCount, reservedPerBlock, metrics: METRICS, view: VIEW, origin: seam });
        const finiteRank = finite.rankOfSlot.get(start.key);
        expect(finiteRank === undefined || finiteRank > 0).toBe(true);

        // Clearing the filter flips back to the infinite wall with the offset the layer kept.
        const after = snapshot(itemCount, offset, reservedPerBlock);
        expect(after).toEqual(before);
        expect(getInfiniteSlotItem(start, itemCount, offset, reservedPerBlock)).toBe(0);
    });

    it('re-derives the offset from the start slot when the period changes', () => {
        const start = { column: -1, row: 2, slotIndex: 3 };
        for (const itemCount of [12, 13, 200]) {
            const offset = getStartWrapOffset(start, itemCount);
            expect(getInfiniteSlotItem(start, itemCount, offset)).toBe(0);
        }
    });
});
