import { describe, expect, it } from 'vitest';
import { isReservedSlot } from '../../../src/components/wall/blockReservedSlots';
import {
    clampToCameraRange,
    getFiniteCameraRange,
    getRankedContentBounds,
    planFiniteWall,
    stepCameraAxis,
} from '../../../src/components/wall/finiteWall';
import { getLatticeGeometry, type WallMetrics } from '../../../src/components/wall/layout';
import { getSeamCameraSpan } from '../../../src/components/wall/seamPlan';
import { getViewWorldBounds } from '../../../src/components/wall/wallView';

// Finite wall: minimal landscape world of whole blocks, strict rank inside it, bare slots, camera clamp.

const METRICS: WallMetrics = { cellSize: 128, gap: 8 };
const BLOCK_W = 12 * 136;
const BLOCK_H = 8 * 136;
const VIEW = { width: 887, height: 800, scale: 0.64 };
const SEAM = { x: -4, y: 544 };

describe('finite wall world', () => {
    it('covers the screen even when the content would fit in fewer blocks', () => {
        const plan = planFiniteWall({ itemCount: 13, reservedPerBlock: 3, metrics: METRICS, view: VIEW, origin: SEAM });
        expect(plan.columns).toEqual({ from: -1, to: 1 });
        expect(plan.rows).toEqual({ from: -1, to: 2 });
        expect(plan.capacity).toBe(6 * 9);
        const screen = getViewWorldBounds(SEAM, VIEW);
        expect(plan.bounds.left).toBeLessThanOrEqual(screen.left);
        expect(plan.bounds.right).toBeGreaterThanOrEqual(screen.right - METRICS.gap);
        expect(plan.bounds.top).toBeLessThanOrEqual(screen.top);
        expect(plan.bounds.bottom).toBeGreaterThanOrEqual(screen.bottom - METRICS.gap);
    });

    it('takes the fewest whole blocks in the landscape layout once content outgrows the screen', () => {
        const plan = planFiniteWall({ itemCount: 500, reservedPerBlock: 3, metrics: METRICS, view: VIEW, origin: SEAM });
        const blocks = Math.ceil(500 / 9);
        const geometry = getLatticeGeometry(blocks * 12, METRICS);
        expect(plan.columns.to - plan.columns.from).toBe(geometry.blocksPerRow);
        expect(plan.rows.to - plan.rows.from).toBe(geometry.blockRows);
        expect(plan.capacity).toBeGreaterThanOrEqual(500);
        expect(plan.capacity - 9 * geometry.blocksPerRow).toBeLessThan(500);
        const aspect = (geometry.blocksPerRow * BLOCK_W) / (geometry.blockRows * BLOCK_H);
        expect(aspect).toBeGreaterThan(1.5);
        expect(aspect).toBeLessThan(2.6);
        // The split stays inside the world, with blocks on both sides of it.
        expect(plan.columns.from).toBeLessThan(0);
        expect(plan.columns.to).toBeGreaterThan(0);
    });

    it('ranks only non-reserved slots and leaves everything past N as bare wall', () => {
        const itemCount = 40;
        const plan = planFiniteWall({ itemCount, reservedPerBlock: 3, metrics: METRICS, view: VIEW, origin: SEAM });
        expect(plan.order).toHaveLength(plan.capacity);
        expect(plan.order.some(slot => isReservedSlot(slot.column, slot.row, slot.slotIndex, 3))).toBe(false);
        const bare = plan.order.slice(itemCount);
        expect(bare).toHaveLength(plan.capacity - itemCount);
        expect(bare.every(slot => plan.rankOfSlot.get(slot.key)! >= itemCount)).toBe(true);

        const content = getRankedContentBounds(plan.order, itemCount)!;
        for (const slot of plan.order.slice(0, itemCount)) {
            expect(slot.x).toBeGreaterThanOrEqual(content.left);
            expect(slot.x + slot.width).toBeLessThanOrEqual(content.right);
        }
        expect(getRankedContentBounds(plan.order, 0)).toBeNull();
    });

    it('keeps rank 0 on the start tile when one is given', () => {
        const probe = planFiniteWall({ itemCount: 30, metrics: METRICS, view: VIEW, origin: SEAM });
        const start = probe.order[17];
        const plan = planFiniteWall({
            itemCount: 30,
            metrics: METRICS,
            view: VIEW,
            origin: { x: start.centerX, y: start.centerY },
            viewCenter: SEAM,
            startSlotKey: start.key,
        });
        expect(plan.order[0].key).toBe(start.key);
    });
});

describe('finite camera range', () => {
    it('locks onto the anchor when the content fits on screen, still letting the split slide on screen', () => {
        const wide = { width: 1600, height: 900, scale: 0.76 };
        const plan = planFiniteWall({ itemCount: 2, metrics: METRICS, view: wide, origin: SEAM });
        const range = getFiniteCameraRange({
            contentBounds: getRankedContentBounds(plan.order, 2),
            anchor: SEAM,
            view: wide,
            seamWidth: 64,
        });
        expect(range.lockedX).toBe(true);
        expect(range.lockedY).toBe(true);
        const span = getSeamCameraSpan({ anchorX: SEAM.x, openWidth: 64, view: wide });
        expect(span.min).toBeCloseTo(-4 - (800 - 46) / 0.76, 6);
        expect(range.minX).toBeCloseTo(span.min, 6);
        expect(range.maxX).toBeCloseTo(span.max, 6);
        expect(range.minY).toBe(SEAM.y);
        expect(range.maxY).toBe(SEAM.y);
    });

    it('clamps to the content minus the screen on each side of the split when content is larger', () => {
        const contentBounds = { left: -6000, right: 5000, top: -3000, bottom: 4000 };
        const range = getFiniteCameraRange({ contentBounds, anchor: SEAM, view: VIEW, seamWidth: 300 });
        expect(range.lockedX).toBe(false);
        expect(range.lockedY).toBe(false);
        expect(range.minX).toBeCloseTo(-6000 + (443.5 - 150) / 0.64 - 60, 6);
        expect(range.maxX).toBeCloseTo(5000 - (443.5 - 150) / 0.64 + 60, 6);
        expect(range.minY).toBeCloseTo(-3000 + 400 / 0.64 - 60, 6);
        expect(range.maxY).toBeCloseTo(4000 - 400 / 0.64 + 60, 6);
        expect(clampToCameraRange({ x: 9000, y: -9000 }, range)).toEqual({ x: range.maxX, y: range.minY });
    });

    it('resists drags past the range so the release can spring back', () => {
        expect(stepCameraAxis(0, 4, -5, 5)).toBe(4);
        expect(stepCameraAxis(4, 10, -5, 5)).toBeCloseTo(7.5, 6);
        expect(stepCameraAxis(-4, -10, -5, 5)).toBeCloseTo(-7.5, 6);
    });
});
