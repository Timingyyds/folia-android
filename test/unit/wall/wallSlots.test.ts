import { describe, expect, it } from 'vitest';
import { blockReservedSlots } from '../../../src/components/wall/blockReservedSlots';
import { BLOCK_COLS, BLOCK_ROWS, SLOTS_PER_BLOCK, getBlockReflow } from '../../../src/components/wall/blockTemplates';
import type { WallMetrics } from '../../../src/components/wall/layout';
import {
    collectWallSlots,
    getBlockSize,
    getBlockSlots,
    getWallSlot,
    layoutFocusedBlock,
    parseWallSlotKey,
    wallSlotKey,
    type WallSlot,
} from '../../../src/components/wall/wallSlots';

// Fixed-world slots of the bravais wall: absolute block coordinates, focus reflow keeping slot identity.

const METRICS: WallMetrics = { cellSize: 128, gap: 8 };
const PITCH = 136;

const coverCount = (slots: WallSlot[], column: number, row: number) => {
    const cover = new Int8Array(BLOCK_COLS * BLOCK_ROWS);
    for (const slot of slots) {
        const x0 = Math.round((slot.x - column * BLOCK_COLS * PITCH) / PITCH);
        const y0 = Math.round((slot.y - row * BLOCK_ROWS * PITCH) / PITCH);
        const cols = Math.round((slot.width + METRICS.gap) / PITCH);
        const rows = Math.round((slot.height + METRICS.gap) / PITCH);
        for (let y = y0; y < y0 + rows; y += 1) {
            for (let x = x0; x < x0 + cols; x += 1) cover[y * BLOCK_COLS + x] += 1;
        }
    }
    return cover;
};

describe('wall slots', () => {
    it('tiles every block exactly, negative coordinates included', () => {
        for (const [column, row] of [[0, 0], [-1, 0], [3, -2], [-7, -5], [11, 4]]) {
            const slots = getBlockSlots(column, row, METRICS);
            expect(slots).toHaveLength(SLOTS_PER_BLOCK);
            expect([...coverCount(slots, column, row)].every(count => count === 1)).toBe(true);
            expect(slots.every(slot => slot.key === wallSlotKey(column, row, slot.slotIndex))).toBe(true);
        }
    });

    it('round-trips slot keys and refuses out-of-block slots', () => {
        expect(parseWallSlotKey('-3,2,11')).toEqual({ column: -3, row: 2, slotIndex: 11 });
        expect(parseWallSlotKey('nope')).toBeNull();
        expect(getWallSlot(0, 0, SLOTS_PER_BLOCK, METRICS)).toBeNull();
        expect(getWallSlot(2, -1, 5, METRICS)).toEqual(getBlockSlots(2, -1, METRICS)[5]);
    });

    it('collects the slots overlapping a world rect, honouring the cap', () => {
        const block = getBlockSize(METRICS);
        const bounds = { left: -block.width / 2, right: block.width / 2, top: 0, bottom: block.height - 1 };
        const slots = collectWallSlots(bounds, METRICS);
        expect(new Set(slots.map(slot => slot.column))).toEqual(new Set([-1, 0]));
        expect(slots.every(slot => slot.x < bounds.right && slot.x + slot.width > bounds.left)).toBe(true);
        expect(collectWallSlots(bounds, METRICS, 5)).toHaveLength(5);
    });
});

describe('focused block', () => {
    it('re-covers the 12x8 block with all twelve cards and the 6x6 gear on the focused one', () => {
        for (const [column, row] of [[0, 0], [-2, 1], [5, -3]]) {
            for (let focused = 0; focused < SLOTS_PER_BLOCK; focused += 1) {
                const slots = layoutFocusedBlock(column, row, focused, METRICS)!;
                expect(slots).toHaveLength(SLOTS_PER_BLOCK);
                expect([...coverCount(slots, column, row)].every(count => count === 1)).toBe(true);
                expect(slots[focused].width).toBe(6 * PITCH - METRICS.gap);
                expect(slots[focused].height).toBe(6 * PITCH - METRICS.gap);
            }
        }
    });

    it('moves nothing outside the block: identities stay, neighbours keep their rects', () => {
        const column = 1;
        const row = -1;
        const base = getBlockSlots(column, row, METRICS);
        const focused = layoutFocusedBlock(column, row, 4, METRICS)!;
        expect(focused.map(slot => slot.key)).toEqual(base.map(slot => slot.key));

        const block = getBlockSize(METRICS);
        const all = collectWallSlots({
            left: (column - 1) * block.width,
            right: (column + 2) * block.width - 1,
            top: (row - 1) * block.height,
            bottom: (row + 2) * block.height - 1,
        }, METRICS);
        const reflowed = new Map(focused.map(slot => [slot.key, slot]));
        const moved = all.filter(slot => {
            const next = reflowed.get(slot.key) ?? slot;
            return next.x !== slot.x || next.y !== slot.y || next.width !== slot.width || next.height !== slot.height;
        });
        expect(moved.length).toBeGreaterThan(0);
        expect(moved.every(slot => slot.column === column && slot.row === row)).toBe(true);
    });

    it('carries reserved slots along with the reflow: they are slot identities, not positions', () => {
        const column = 2;
        const row = 3;
        const reserved = blockReservedSlots(column, row, 3);
        const focusedSlot = [...Array(SLOTS_PER_BLOCK).keys()].find(index => !reserved.includes(index))!;
        const focused = layoutFocusedBlock(column, row, focusedSlot, METRICS)!;
        const reflow = getBlockReflow(column, row, focusedSlot)!;
        const origin = { x: column * BLOCK_COLS * PITCH, y: row * BLOCK_ROWS * PITCH };
        for (const slotIndex of reserved) {
            expect(focused[slotIndex].key).toBe(wallSlotKey(column, row, slotIndex));
            expect(focused[slotIndex].x).toBe(origin.x + reflow[slotIndex].x * PITCH);
            expect(focused[slotIndex].y).toBe(origin.y + reflow[slotIndex].y * PITCH);
        }
        expect(blockReservedSlots(column, row, 3)).toEqual(reserved);
    });
});
