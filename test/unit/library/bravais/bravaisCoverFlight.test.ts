import { describe, expect, it } from 'vitest';
import { lerpQuad } from '@/library/suites/bravais/bravaisCoverFlight';

// test/unit/library/bravais/bravaisCoverFlight.test.ts
// 封面飞行的插值：中心、宽高线性走，角度走最近的那一边（不绕一整圈）。

describe('cover flight interpolation', () => {
    const quad = (x: number, size: number, angle: number) => ({ center: { x, y: 0 }, width: size, height: size, angle });

    it('moves the centre and the size linearly', () => {
        expect(lerpQuad(quad(0, 100, 0), quad(200, 300, 0), 0.5)).toEqual(quad(100, 200, 0));
    });

    it('turns the short way round', () => {
        const half = lerpQuad(quad(0, 100, Math.PI - 0.1), quad(0, 100, -Math.PI + 0.1), 0.5);
        expect(Math.abs(Math.abs(half.angle) - Math.PI)).toBeLessThan(1e-9);
    });
});
