import { describe, expect, it } from 'vitest';
import {
    alignToPitch,
    getWallHandoffDelay,
    getWallHandoffDirection,
    getWallHandoffPitchPx,
    getWallHandoffSpot,
    resolveWallHandoffAlignment,
    WALL_HANDOFF_FLIP_IN_MS,
    WALL_HANDOFF_FLIP_OUT_MS,
    WALL_HANDOFF_MAX_DELAY_MS,
    WALL_HANDOFF_WAVE_MS,
} from '../../../src/components/wall/wallHandoff';

// test/unit/wall/wallHandoff.test.ts
// 翻牌交接的时间表与对齐几何（wall 引擎，两面墙共用）：错开按「到起点的屏幕距离 / 屏幕格距」算，同一个屏幕位置在两面墙上
// 拿到同一个时刻，翻出与翻进首尾相接；Lattice 的相机只对齐到资料库墙的格线上（不超过半格），两边都有聚焦卡时让卡重合。

const PITCH = getWallHandoffPitchPx({ cellSize: 128, gap: 8 }, 0.76);

describe('wall handoff timing', () => {
    it('staggers by screen distance in cells and caps the delay like a flip', () => {
        const origin = { x: 500, y: 400 };
        expect(getWallHandoffDelay(origin, origin, PITCH)).toBe(0);
        expect(getWallHandoffDelay({ x: 500 + PITCH * 3, y: 400 }, origin, PITCH)).toBeCloseTo(54);
        expect(getWallHandoffDelay({ x: 9000, y: 9000 }, origin, PITCH)).toBe(WALL_HANDOFF_MAX_DELAY_MS);
        expect(WALL_HANDOFF_WAVE_MS).toBe(WALL_HANDOFF_MAX_DELAY_MS + WALL_HANDOFF_FLIP_OUT_MS + WALL_HANDOFF_FLIP_IN_MS);
    });

    it('turns the incoming half exactly when the outgoing half has turned away on the same spot', () => {
        const spot = getWallHandoffSpot({ x: 900, y: 100, width: 200, height: 200 }, { x: 400, y: 400 }, PITCH);
        expect(spot.inAt - spot.outAt).toBe(WALL_HANDOFF_FLIP_OUT_MS);
        expect(spot.direction).toBe(1);
        expect(getWallHandoffDirection({ x: 100, y: 0 }, { x: 400, y: 0 })).toBe(-1);
    });
});

describe('wall handoff alignment', () => {
    it('moves onto the other grid by the smallest step', () => {
        expect(alignToPitch(10, 110, 100)).toBe(0);
        expect(alignToPitch(10, 40, 100)).toBe(30);
        expect(alignToPitch(10, 90, 100)).toBe(-20);
        expect(alignToPitch(0, 50, 100)).toBe(-50);
        expect(Math.abs(alignToPitch(37, -1234.5, PITCH))).toBeLessThanOrEqual(PITCH / 2);
    });

    it('puts the two expanded cards on top of each other when both walls have one', () => {
        expect(resolveWallHandoffAlignment({
            homeCard: { x: 300, y: 120, width: 614, height: 614 },
            latticeCard: { x: 413, y: 143, width: 614, height: 614 },
            homeGridPoint: { x: 0, y: 0 },
            latticeGridPoint: { x: 7, y: 9 },
            pitchPx: PITCH,
        })).toEqual({ x: -113, y: -23 });
    });

    it('only aligns the grid lines when either side has no expanded card', () => {
        const shift = resolveWallHandoffAlignment({
            homeCard: null,
            latticeCard: { x: 413, y: 143, width: 614, height: 614 },
            homeGridPoint: { x: 20, y: 40 },
            latticeGridPoint: { x: 30, y: 30 },
            pitchPx: 100,
        });
        expect(shift).toEqual({ x: -10, y: 10 });
    });
});
