import { describe, expect, it } from 'vitest';
import {
    DEFAULT_LIBRARY_WALL_SEAM_STYLE,
    isLibraryWallSeamStyle,
    isPrintSeamStyle,
    LIBRARY_WALL_SEAM_STYLE_LABEL_KEYS,
    LIBRARY_WALL_SEAM_STYLE_LOOKS,
    LIBRARY_WALL_SEAM_STYLES,
    libraryWallSeamStyleVars,
    normalizeLibraryWallSeamStyle,
} from '@/utils/libraryWallSeamStyle';
import en from '@/i18n/locales/en';
import zh from '@/i18n/locales/zh-CN';
import id from '@/i18n/locales/in';

// test/unit/utils/libraryWallSeamStyle.test.ts
// 信息条实色模式的预设（设计稿 §5「缝的材质」）：取值与规范化、每个预设的材质变量（主题纸色不写变量、印刷系带墨色）、
// 全是静态背景（不引用图片文件、不带动画）、三种语言都有名字。

const lookup = (bundle: unknown, key: string) => key.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    bundle,
);

describe('library wall seam styles', () => {
    it('lists eight presets with theme paper first and as the default', () => {
        expect(LIBRARY_WALL_SEAM_STYLES).toEqual(['paper', 'white', 'black', 'frost', 'dots', 'hatch', 'contour', 'check']);
        expect(DEFAULT_LIBRARY_WALL_SEAM_STYLE).toBe('paper');
        expect(LIBRARY_WALL_SEAM_STYLES.every(isLibraryWallSeamStyle)).toBe(true);
        expect(isLibraryWallSeamStyle('Paper')).toBe(false);
        expect(normalizeLibraryWallSeamStyle('hatch')).toBe('hatch');
        expect(normalizeLibraryWallSeamStyle('neon')).toBe('paper');
        expect(normalizeLibraryWallSeamStyle(null)).toBe('paper');
    });

    it('writes no variables for theme paper and gives ink only to the print presets', () => {
        expect(libraryWallSeamStyleVars('paper')).toBeNull();
        for (const style of LIBRARY_WALL_SEAM_STYLES.filter(value => value !== 'paper')) {
            const vars = libraryWallSeamStyleVars(style)!;
            expect(vars['--bravais-seam-surface']).toBe(LIBRARY_WALL_SEAM_STYLE_LOOKS[style].surface);
            expect(vars['--bravais-seam-paper']).toBe(LIBRARY_WALL_SEAM_STYLE_LOOKS[style].paper);
            expect('--bravais-seam-print-ink' in vars).toBe(isPrintSeamStyle(style));
        }
        expect(libraryWallSeamStyleVars('white')!['--bravais-seam-print-ink']).toBe('#141414');
        expect(libraryWallSeamStyleVars('black')!['--bravais-seam-print-ink']).toBe('#f3f1ec');
    });

    it('builds every surface from gradients and inline SVG only, ending on the paper colour', () => {
        for (const style of LIBRARY_WALL_SEAM_STYLES) {
            const { surface, paper } = LIBRARY_WALL_SEAM_STYLE_LOOKS[style];
            expect(surface.endsWith(paper)).toBe(true);
            const urls = surface.match(/url\(([^)]*)\)/g) ?? [];
            expect(urls.every(url => url.startsWith('url("data:image/svg+xml,'))).toBe(true);
            expect(surface).not.toMatch(/animation|@keyframes/);
        }
    });

    it('names every preset in all three locales', () => {
        for (const key of Object.values(LIBRARY_WALL_SEAM_STYLE_LABEL_KEYS)) {
            for (const bundle of [en, zh, id]) expect(typeof lookup(bundle, key)).toBe('string');
        }
    });
});
