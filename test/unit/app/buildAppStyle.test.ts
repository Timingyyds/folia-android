import { describe, expect, it } from 'vitest';
import { buildAppStyle, resolveTextOnAccent } from '../../../src/components/app/presentation/buildAppStyle';
import { DAYLIGHT_THEME, DEFAULT_THEME } from '../../../src/services/baseThemes';
import { getContrastRatio } from '../../../src/utils/themeColorMath';
import type { Theme } from '../../../src/types';

// test/unit/app/buildAppStyle.test.ts
// 应用外壳的主题变量：--text-on-accent 从底色与正文色里挑与强调色对比度更高的那个
// （缺省暗色主题强调色就是正文色，日光缺省主题的底色画在橙色强调色上对比不够）。

const styleFor = (theme: Theme, isDaylight: boolean, bgMode = 'default') => buildAppStyle({
    bgMode,
    isDaylight,
    theme,
    daylightTheme: DAYLIGHT_THEME,
    defaultTheme: DEFAULT_THEME,
}) as Record<string, string>;

describe('buildAppStyle --text-on-accent', () => {
    it('uses the background on the default dark theme, whose accent is the text colour', () => {
        const style = styleFor(DEFAULT_THEME, false);
        expect(style['--text-on-accent']).toBe(DEFAULT_THEME.backgroundColor);
        expect(style['--text-on-accent']).not.toBe(style['--text-accent']);
    });

    it('uses the text colour on the default daylight theme, where the background is too light on orange', () => {
        const style = styleFor(DAYLIGHT_THEME, true);
        expect(style['--text-on-accent']).toBe(DAYLIGHT_THEME.primaryColor);
        expect(getContrastRatio(style['--text-on-accent'], DAYLIGHT_THEME.accentColor)).toBeGreaterThan(4.5);
    });

    it('measures against the background actually painted (the default one in default background mode)', () => {
        const theme: Theme = { ...DAYLIGHT_THEME, backgroundColor: '#000000', primaryColor: '#ffffff', accentColor: '#ea580c' };
        // 默认背景模式下 --bg-color 是日光缺省主题的底色（#f5f5f4），不是主题自己的黑色：那时白字对比更高。
        expect(styleFor(theme, true)['--bg-color']).toBe(DAYLIGHT_THEME.backgroundColor);
        expect(styleFor(theme, true)['--text-on-accent']).toBe('#ffffff');
        expect(styleFor(theme, true, 'theme')['--text-on-accent']).toBe('#000000');
    });
});

describe('resolveTextOnAccent', () => {
    it('picks whichever of the two has more contrast against the accent', () => {
        expect(resolveTextOnAccent('#f4f4f5', '#09090b', '#f4f4f5')).toBe('#09090b');
        expect(resolveTextOnAccent('#ea580c', '#f5f5f4', '#1c1917')).toBe('#1c1917');
        expect(resolveTextOnAccent('#1d4ed8', '#09090b', '#f4f4f5')).toBe('#f4f4f5');
    });
});
