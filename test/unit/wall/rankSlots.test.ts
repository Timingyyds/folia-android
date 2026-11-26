import { describe, expect, it } from 'vitest';
import { isReservedSlot } from '../../../src/components/wall/blockReservedSlots';
import type { WallMetrics } from '../../../src/components/wall/layout';
import {
    indexRanks,
    rankSlots,
    scoreWallSlot,
    withoutReservedSlots,
} from '../../../src/components/wall/rankSlots';
import { collectBlockRangeSlots } from '../../../src/components/wall/wallSlots';

// Strict rank -> slot, with reserved slots skipped and an optional start tile pinned to rank 0.

const METRICS: WallMetrics = { cellSize: 128, gap: 8 };
const SLOTS = collectBlockRangeSlots({ from: -2, to: 2 }, { from: -1, to: 2 }, METRICS);
const SEAM = { x: -4, y: 500 };

describe('rank slots', () => {
    it('orders by score: distance to the origin minus the size bonus', () => {
        const order = rankSlots(SLOTS, { origin: SEAM, metrics: METRICS });
        expect(order).toHaveLength(SLOTS.length);
        const scores = order.map(slot => scoreWallSlot(slot, SEAM, METRICS));
        for (let index = 1; index < scores.length; index += 1) {
            expect(scores[index]).toBeGreaterThanOrEqual(scores[index - 1]);
        }
        // A big slot right at the seam beats a small one at the same distance.
        expect(order[0].area).toBeGreaterThanOrEqual(4);
    });

    it('does not depend on the input order (ties break on world position)', () => {
        const forward = rankSlots(SLOTS, { origin: SEAM, metrics: METRICS }).map(slot => slot.key);
        const backward = rankSlots([...SLOTS].reverse(), { origin: SEAM, metrics: METRICS }).map(slot => slot.key);
        expect(backward).toEqual(forward);
    });

    it('is strict: a filter only shortens the prefix that carries content', () => {
        const order = rankSlots(SLOTS, { origin: SEAM, metrics: METRICS });
        const ranks = indexRanks(order);
        order.forEach((slot, rank) => expect(ranks.get(slot.key)).toBe(rank));
        const all = order.slice(0, 40).map(slot => slot.key);
        const filtered = order.slice(0, 12).map(slot => slot.key);
        expect(all.slice(0, 12)).toEqual(filtered);
    });

    it('pins the start tile to rank 0 and spreads the rest from it', () => {
        const start = SLOTS.find(slot => slot.column === 1 && slot.row === 1 && slot.slotIndex === 7)!;
        const origin = { x: start.centerX, y: start.centerY };
        const order = rankSlots(SLOTS, { origin, metrics: METRICS, startSlotKey: start.key });
        expect(order[0].key).toBe(start.key);
        const rest = rankSlots(SLOTS.filter(slot => slot.key !== start.key), { origin, metrics: METRICS });
        expect(order.slice(1).map(slot => slot.key)).toEqual(rest.map(slot => slot.key));
    });

    it('skips reserved slots: rank i lands on the i-th non-reserved slot', () => {
        const plain = rankSlots(SLOTS, { origin: SEAM, metrics: METRICS });
        for (const reservedPerBlock of [1, 3, 6]) {
            const order = rankSlots(SLOTS, { origin: SEAM, metrics: METRICS, reservedPerBlock });
            expect(order).toHaveLength(SLOTS.length - 12 * reservedPerBlock);
            expect(order.some(slot => isReservedSlot(slot.column, slot.row, slot.slotIndex, reservedPerBlock))).toBe(false);
            const expected = plain.filter(slot => !isReservedSlot(slot.column, slot.row, slot.slotIndex, reservedPerBlock));
            expect(order.map(slot => slot.key)).toEqual(expected.map(slot => slot.key));
        }
        expect(withoutReservedSlots(SLOTS, 0)).toEqual(SLOTS);
    });

    it('ignores a start slot that is reserved', () => {
        const reserved = SLOTS.find(slot => isReservedSlot(slot.column, slot.row, slot.slotIndex, 3))!;
        const order = rankSlots(SLOTS, {
            origin: { x: reserved.centerX, y: reserved.centerY },
            metrics: METRICS,
            reservedPerBlock: 3,
            startSlotKey: reserved.key,
        });
        expect(order.map(slot => slot.key)).not.toContain(reserved.key);
    });
});
