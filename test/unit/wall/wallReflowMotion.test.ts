import { describe, expect, it } from 'vitest';
import { calcGeneratorDuration, spring } from 'framer-motion';
import { createWallReflowCurve, wallReflowSettleMs, WALL_REFLOW_SPRING } from '@/components/wall/wallReflowMotion';

// test/unit/wall/wallReflowMotion.test.ts
// 块内让位的共享运动参数：Lattice 海报的弹簧本身，以及 bravais 用的 CSS linear() 采样——与 framer 的弹簧逐点一致、
// 单调不过冲、首尾是 0 和 1、时长是 framer 把这段位移走到静止的时刻。

const framerSpring = (distance: number) => spring({ stiffness: 300, damping: 34, keyframes: [0, distance] });

describe('WALL_REFLOW_SPRING', () => {
    it('is the spring Lattice posters have always used (stiffness 300, damping 34, mass 1)', () => {
        expect(WALL_REFLOW_SPRING).toEqual({ type: 'spring', stiffness: 300, damping: 34 });
        // 阻尼比接近 1：几乎临界阻尼。
        expect(34 / (2 * Math.sqrt(300))).toBeGreaterThan(0.97);
    });

    it('settles a move at the moment framer finishes the same spring', () => {
        for (const distance of [40, 136, 544, 1624]) {
            expect(wallReflowSettleMs(distance)).toBe(calcGeneratorDuration(framerSpring(distance), 1));
        }
        expect(wallReflowSettleMs(1624)).toBeGreaterThan(wallReflowSettleMs(136));
    });
});

describe('createWallReflowCurve', () => {
    const distance = 1624;
    const curve = createWallReflowCurve(distance);

    it('emits a CSS linear() that starts at 0 and ends at 1', () => {
        expect(curve.durationMs).toBe(wallReflowSettleMs(distance));
        expect(curve.css.startsWith('linear(0, ')).toBe(true);
        expect(curve.css.endsWith(', 1)')).toBe(true);
        expect(curve.ease(0)).toBe(0);
        expect(curve.ease(1)).toBe(1);
    });

    it('rises monotonically and never passes the target', () => {
        const points = curve.css.slice('linear('.length, -1).split(', ').map(Number);
        for (let index = 1; index < points.length; index += 1) {
            expect(points[index]).toBeGreaterThanOrEqual(points[index - 1]!);
            expect(points[index]).toBeLessThanOrEqual(1);
        }
    });

    it('tracks the framer spring to within half a world unit on an 816-unit move', () => {
        const generator = framerSpring(816);
        for (let time = 0; time <= curve.durationMs; time += 3) {
            const expected = generator.next(time).value;
            expect(Math.abs(curve.ease(time / curve.durationMs) * 816 - expected)).toBeLessThan(0.5);
        }
    });
});
