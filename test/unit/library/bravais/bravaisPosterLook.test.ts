import { describe, expect, it } from 'vitest';
import type { BravaisItem } from '@/library/suites/bravais/bravaisLayer';
import {
    hashPosterSeed,
    posterShapeClipPath,
    resolvePosterComposition,
    risePosterPoints,
} from '@/library/suites/bravais/bravaisPosterComposition';
import {
    interleavePosterColors,
    posterPaletteVars,
    resolveBravaisPosterPalette,
    resolvePosterPaletteSources,
} from '@/library/suites/bravais/bravaisPosterPalette';

// test/unit/library/bravais/bravaisPosterLook.test.ts
// 歌手海报的构图与颜色：构图按种子定死（同一个歌手每次一样、换歌手会变，几何形不压到下面的文字区）；颜色从最火的三张
// 专辑封面取（热门歌曲所属专辑在前、去重、不够再用墙上的专辑），走凝彩的渐变调色板，取不到时回退到 CSS 的灰。

const track = (key: string, coverUrl?: string): BravaisItem => ({ key, kind: 'track', title: key, subtitle: '', badge: '', coverUrl });
const album = (key: string, coverUrl?: string): BravaisItem => ({ key, kind: 'album', title: key, subtitle: '', badge: '', coverUrl });

describe('poster composition', () => {
    it('is the same for the same artist and varies between artists', () => {
        expect(resolvePosterComposition('artist:a')).toEqual(resolvePosterComposition('artist:a'));
        const seeds = Array.from({ length: 24 }, (_, index) => `artist:${index}`);
        const shapes = new Set(seeds.map(seed => posterShapeClipPath(resolvePosterComposition(seed).shape)));
        expect(shapes.size).toBeGreaterThan(3);
    });

    it('keeps the shape in the upper part, clear of the name and the buttons, and never a triangle', () => {
        for (let index = 0; index < 64; index += 1) {
            const { shape, scraps, through } = resolvePosterComposition(`seed-${index}`);
            if (shape.kind === 'polygon') shape.points.forEach(([x, y]) => {
                expect(y).toBeLessThanOrEqual(76);
                expect(x).toBeGreaterThanOrEqual(0);
                expect(x).toBeLessThanOrEqual(100);
            });
            else expect(shape.cy).toBeLessThanOrEqual(40);
            expect(scraps).toHaveLength(2);
            // 没有三角形（倒三角太像梗图模板）：多边形至少四个角。
            if (shape.kind === 'polygon') expect(shape.points.length).toBeGreaterThanOrEqual(4);
            expect(through).toHaveLength(2);
        }
    });

    it('keeps the scrap words in the upper half, apart vertically', () => {
        for (let index = 0; index < 64; index += 1) {
            const { scraps } = resolvePosterComposition(`seed-${index}`);
            for (let a = 0; a < scraps.length; a += 1) for (let b = a + 1; b < scraps.length; b += 1) {
                expect(Math.abs(scraps[a].y - scraps[b].y)).toBeGreaterThanOrEqual(10);
            }
            // 都在上半，不压在热门歌与按钮底下。
            scraps.forEach(scrap => expect(scrap.y).toBeLessThan(50));
        }
    });

    it('extends shapes that touch the top edge up along their own sides', () => {
        // 侧边是竖的：直接往上；斜的：沿斜边继续走（[18,0]→[46,74] 这条线在 y = -74 处 x = -10）。
        expect(risePosterPoints([[18, 0], [100, 0], [100, 58], [46, 74]], 74)).toEqual([[-10, -74], [100, -74], [100, 58], [46, 74]]);
        // 不贴上缘的点不动。
        expect(risePosterPoints([[10, 5], [90, 5], [50, 60]])).toEqual([[10, 5], [90, 5], [50, 60]]);
    });

    it('hashes strings to stable 32-bit seeds', () => {
        expect(hashPosterSeed('artist:a')).toBe(hashPosterSeed('artist:a'));
        expect(hashPosterSeed('artist:a')).not.toBe(hashPosterSeed('artist:b'));
    });
});

describe('poster palette', () => {
    it('takes the covers of the top songs first, deduplicated, then the albums on the wall', () => {
        const items = [track('t1', 'a.jpg'), track('t2', 'a.jpg'), track('t3'), track('t4', 'b.jpg'), album('al1', 'c.jpg'), album('al2', 'd.jpg')];
        expect(resolvePosterPaletteSources(items)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
        expect(resolvePosterPaletteSources([track('t1')])).toEqual([]);
    });

    it('interleaves the main colour of each cover before the second ones', () => {
        expect(interleavePosterColors([['#a1', '#a2'], ['#b1', '#b2'], ['#c1']])).toEqual(['#a1', '#b1', '#c1', '#a2', '#b2']);
    });

    it('builds the shared colours from the covers, and falls back without enough colour', () => {
        expect(resolveBravaisPosterPalette(['#c0392b'])).toBeNull();
        expect(posterPaletteVars(null)).toEqual({});
        const palette = resolveBravaisPosterPalette(['#c0392b', '#2c3e50', '#f1c40f'])!;
        expect(palette.extrude).toHaveLength(4);
        const vars = posterPaletteVars(palette);
        expect(vars['--bravais-poster-ground']).toBe(palette.ground);
        expect(vars['--bravais-poster-wall-tint']).toBe(palette.wallTint);
    });
});
