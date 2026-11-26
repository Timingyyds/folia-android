import { describe, expect, it } from 'vitest';
import { createWallWheelClassifier, stepWallWheel, wallWheelDelta, WALL_WHEEL_SMOOTHING } from '@/components/wall/wallPanMotion';

// test/unit/wall/wallPanMotion.test.ts
// 墙面滚轮的判别（鼠标滚轮平滑、触控板直接跟手）、增量换算与平滑的一帧：单调趋近、不过冲、最后精确落到目标。

const wheel = (deltaX: number, deltaY: number, timeStamp: number, deltaMode = 0) => ({ deltaX, deltaY, timeStamp, deltaMode });

describe('createWallWheelClassifier', () => {
    it('treats line and page deltas as a mouse wheel', () => {
        const classify = createWallWheelClassifier();
        expect(classify(wheel(0, 3, 0, 1))).toBe('wheel');
        expect(classify(wheel(0, 1, 500, 2))).toBe('wheel');
    });

    it('treats large single-axis pixel steps as wheel notches, including fast spins', () => {
        const classify = createWallWheelClassifier();
        expect(classify(wheel(0, 100, 0))).toBe('wheel');
        expect(classify(wheel(0, 100, 16))).toBe('wheel');
        expect(classify(wheel(0, -53.33, 400))).toBe('wheel');
        expect(classify(wheel(120, 0, 900))).toBe('wheel');
    });

    it('treats small or two-axis deltas as a trackpad', () => {
        const classify = createWallWheelClassifier();
        expect(classify(wheel(0, 12, 0))).toBe('trackpad');
        expect(classify(wheel(160, 120, 1000))).toBe('trackpad');
        expect(classify(wheel(0, WALL_WHEEL_SMOOTHING.minNotchPx - 1, 2000))).toBe('trackpad');
    });

    it('keeps a trackpad gesture direct when its momentum peaks above the notch size, until the gesture ends', () => {
        const classify = createWallWheelClassifier();
        expect(classify(wheel(0, 8, 0))).toBe('trackpad');
        expect(classify(wheel(0, 140, 16))).toBe('trackpad');
        expect(classify(wheel(0, 90, 32))).toBe('trackpad');
        expect(classify(wheel(0, 100, 32 + WALL_WHEEL_SMOOTHING.gestureGapMs + 1))).toBe('wheel');
    });
});

describe('wallWheelDelta', () => {
    it('converts lines and pages to pixels and maps Shift + vertical wheel to horizontal', () => {
        expect(wallWheelDelta({ deltaMode: 1, deltaX: 0, deltaY: 3, shiftKey: false }, 720)).toEqual({ dx: 0, dy: 3 * WALL_WHEEL_SMOOTHING.lineHeightPx });
        expect(wallWheelDelta({ deltaMode: 2, deltaX: 0, deltaY: 1, shiftKey: false }, 720)).toEqual({ dx: 0, dy: 720 });
        expect(wallWheelDelta({ deltaMode: 0, deltaX: 0, deltaY: 100, shiftKey: true }, 720)).toEqual({ dx: 100, dy: 0 });
        expect(wallWheelDelta({ deltaMode: 0, deltaX: 100, deltaY: 0, shiftKey: true }, 720)).toEqual({ dx: 100, dy: 0 });
    });
});

describe('stepWallWheel', () => {
    it('approaches the target monotonically and lands on it exactly', () => {
        let pending = { x: -100, y: 0 };
        let travelled = 0;
        let previousStep = Number.POSITIVE_INFINITY;
        let frames = 0;
        while (pending.x !== 0 || pending.y !== 0) {
            const result = stepWallWheel(pending, 1000 / 60);
            // 每帧都朝目标走（位置单调）、不越过目标；除了最后落地的不到半像素，每帧走得比上一帧少（减速）。
            expect(result.step.x).toBeLessThan(0);
            expect(result.pending.x).toBeLessThanOrEqual(0);
            if (result.pending.x !== 0) expect(Math.abs(result.step.x)).toBeLessThanOrEqual(previousStep + 1e-9);
            else expect(Math.abs(result.step.x)).toBeLessThan(WALL_WHEEL_SMOOTHING.restDistancePx * 4);
            previousStep = Math.abs(result.step.x);
            travelled += result.step.x;
            pending = result.pending;
            frames++;
            expect(frames).toBeLessThan(60);
        }
        expect(travelled).toBeCloseTo(-100, 9);
        // 一格不是一帧跳完，也不会拖太久。
        expect(frames).toBeGreaterThan(8);
        expect(frames * 1000 / 60).toBeLessThan(600);
    });

    it('caps a long frame so a stalled tab does not land in one jump', () => {
        const { step } = stepWallWheel({ x: 0, y: 200 }, 5000);
        expect(step.y).toBeLessThan(200);
        expect(step.y).toBeCloseTo(200 * (1 - Math.exp(-WALL_WHEEL_SMOOTHING.maxFrameMs / WALL_WHEEL_SMOOTHING.timeConstantMs)), 6);
    });
});
