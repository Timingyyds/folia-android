import { describe, expect, it } from 'vitest';
import { planPresetFrame } from '../../../src/services/videoExportFramePipeline';

// test/unit/videoExport/videoExportFramePipeline.test.ts

const preset1080 = { width: 1920, height: 1080 };

describe('planPresetFrame', () => {
    it('passes a frame that already matches the preset', () => {
        expect(planPresetFrame(1920, 1080, preset1080)).toEqual({ mode: 'pass' });
    });

    it('center-crops a slightly larger frame on even offsets', () => {
        // Typical self-capture: window content lands a pixel or two above the preset.
        expect(planPresetFrame(1922, 1082, preset1080)).toEqual({
            mode: 'crop',
            rect: { x: 0, y: 0, width: 1920, height: 1080 },
        });
        expect(planPresetFrame(1925, 1087, preset1080)).toEqual({
            mode: 'crop',
            rect: { x: 2, y: 2, width: 1920, height: 1080 },
        });
        expect(planPresetFrame(3842, 2162, { width: 3840, height: 2160 })).toEqual({
            mode: 'crop',
            rect: { x: 0, y: 0, width: 3840, height: 2160 },
        });
    });

    it('crops only the overflowing axis when one side matches', () => {
        expect(planPresetFrame(1920, 1090, preset1080)).toEqual({
            mode: 'crop',
            rect: { x: 0, y: 4, width: 1920, height: 1080 },
        });
    });

    it('covers a smaller frame, clipping the overflowing axis instead of letterboxing', () => {
        // Pre-resize frame from a smaller window with a wider aspect than the preset.
        const plan = planPresetFrame(1600, 800, preset1080);
        expect(plan.mode).toBe('cover');
        if (plan.mode !== 'cover') return;
        expect(plan.rect.height).toBeCloseTo(800);
        expect(plan.rect.width).toBeCloseTo(800 * 16 / 9);
        expect(plan.rect.x).toBeCloseTo((1600 - 800 * 16 / 9) / 2);
        expect(plan.rect.y).toBeCloseTo(0);
    });

    it('covers a frame that is larger on one axis but smaller on the other', () => {
        const plan = planPresetFrame(2000, 1000, preset1080);
        expect(plan.mode).toBe('cover');
        if (plan.mode !== 'cover') return;
        expect(plan.rect.width / plan.rect.height).toBeCloseTo(1920 / 1080);
        expect(plan.rect.width).toBeLessThanOrEqual(2000);
        expect(plan.rect.height).toBeLessThanOrEqual(1000);
    });
});
