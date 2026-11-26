import { describe, expect, it } from 'vitest';
import {
    FLIP_DURATION_MS,
    FLIP_MAX_DELAY_MS,
    FLIP_MAX_TILES,
    getFlipDelay,
    planFlip,
    type FlipSlotChange,
} from '../../../src/components/wall/flipPlan';
import type { WallMetrics } from '../../../src/components/wall/layout';
import { collectBlockRangeSlots, getBlockSize } from '../../../src/components/wall/wallSlots';

// Split-flap schedule: diff, stagger from the origin, delay cap, tile budget, off-screen swaps.

const METRICS: WallMetrics = { cellSize: 128, gap: 8 };
const BLOCK = getBlockSize(METRICS);

const changesFor = (columns: { from: number; to: number }, rows: { from: number; to: number }) => (
    collectBlockRangeSlots(columns, rows, METRICS).map((slot, index): FlipSlotChange => ({
        slot,
        from: `old-${index}`,
        to: index % 5 === 0 ? `old-${index}` : `new-${index}`,
    }))
);

describe('flip plan', () => {
    it('staggers 18 ms per cell of distance and caps the delay at 420 ms', () => {
        expect(getFlipDelay(0, METRICS)).toBe(0);
        expect(getFlipDelay(136 * 10, METRICS)).toBeCloseTo(180, 6);
        expect(getFlipDelay(136 * 100, METRICS)).toBe(FLIP_MAX_DELAY_MS);
    });

    it('flips only changed slots on screen and swaps the rest without animating', () => {
        const changes = changesFor({ from: -2, to: 2 }, { from: -1, to: 1 });
        const visible = { left: -BLOCK.width, right: BLOCK.width - 1, top: 0, bottom: BLOCK.height - 1 };
        const plan = planFlip({ changes, origin: { kind: 'point', x: 0, y: 500 }, visible, metrics: METRICS });

        const changed = changes.filter(change => change.from !== change.to);
        expect(plan.unchanged).toBe(changes.length - changed.length);
        expect(plan.flips.length + plan.swaps.length).toBe(changed.length);
        const byKey = new Map(changes.map(change => [change.slot.key, change.slot]));
        for (const flip of plan.flips) {
            const slot = byKey.get(flip.key)!;
            expect(slot.y).toBeLessThan(visible.bottom);
            expect(slot.y + slot.height).toBeGreaterThan(visible.top);
            expect(flip.direction).toBe(slot.centerX < 0 ? -1 : 1);
        }
        for (const swap of plan.swaps) {
            const slot = byKey.get(swap.key)!;
            const onScreen = slot.x < visible.right && slot.x + slot.width > visible.left
                && slot.y < visible.bottom && slot.y + slot.height > visible.top;
            expect(onScreen).toBe(false);
        }
        const maxDelay = Math.max(...plan.flips.map(flip => flip.delay));
        expect(maxDelay).toBeLessThanOrEqual(FLIP_MAX_DELAY_MS);
        expect(plan.durationMs).toBe(maxDelay + FLIP_DURATION_MS);
    });

    it('measures from the split line when the wave starts at both seam edges', () => {
        const changes = changesFor({ from: -1, to: 1 }, { from: 0, to: 1 });
        const visible = { left: -1e6, right: 1e6, top: -1e6, bottom: 1e6 };
        const plan = planFlip({ changes, origin: { kind: 'seam-edges', x: -4 }, visible, metrics: METRICS });
        const byKey = new Map(changes.map(change => [change.slot.key, change.slot]));
        for (const flip of plan.flips) {
            const slot = byKey.get(flip.key)!;
            expect(flip.delay).toBeCloseTo(getFlipDelay(Math.abs(slot.centerX + 4), METRICS), 6);
        }
    });

    it('animates at most 400 tiles, nearest first, and swaps the overflow', () => {
        const changes = changesFor({ from: -5, to: 5 }, { from: -3, to: 3 });
        const visible = { left: -1e6, right: 1e6, top: -1e6, bottom: 1e6 };
        const origin = { kind: 'point' as const, x: 0, y: 0 };
        const plan = planFlip({ changes, origin, visible, metrics: METRICS });
        const changed = changes.filter(change => change.from !== change.to).length;
        expect(changed).toBeGreaterThan(FLIP_MAX_TILES);
        expect(FLIP_MAX_TILES).toBe(400);
        expect(plan.flips).toHaveLength(FLIP_MAX_TILES);
        expect(plan.swaps).toHaveLength(changed - FLIP_MAX_TILES);

        const byKey = new Map(changes.map(change => [change.slot.key, change.slot]));
        const distance = (key: string) => Math.hypot(byKey.get(key)!.centerX, byKey.get(key)!.centerY);
        const farthestFlip = Math.max(...plan.flips.map(flip => distance(flip.key)));
        const nearestSwap = Math.min(...plan.swaps.map(swap => distance(swap.key)));
        expect(farthestFlip).toBeLessThanOrEqual(nearestSwap);
    });

    it('does nothing when nothing changed', () => {
        const changes = changesFor({ from: 0, to: 1 }, { from: 0, to: 1 }).map(change => ({ ...change, to: change.from }));
        const plan = planFlip({ changes, origin: { kind: 'point', x: 0, y: 0 }, visible: { left: 0, right: 1, top: 0, bottom: 1 }, metrics: METRICS });
        expect(plan).toEqual({ flips: [], swaps: [], unchanged: changes.length, durationMs: 0 });
    });
});
