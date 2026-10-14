import type { CSSProperties } from 'react';
import type { Theme } from '../../../types';
import { getContrastRatio } from '../../../lib/themeColorMath';

// src/ui/app/presentation/buildAppStyle.ts

/**
 * 画在强调色上的前景色（--text-on-accent）：从底色与正文色里挑与强调色对比度更高的那个。
 * 缺省暗色主题的强调色就是正文色（#f4f4f5），正文色画在强调色上会白底白字；日光缺省主题里底色画在强调色上对比又不够。
 * 只在这两个主题色之间挑（不引入第三种颜色），相同时取底色。
 */
export const resolveTextOnAccent = (accentColor: string, backgroundColor: string, primaryColor: string): string => (
    getContrastRatio(primaryColor, accentColor) > getContrastRatio(backgroundColor, accentColor)
        ? primaryColor
        : backgroundColor
);

// Builds CSS custom properties for the top-level app shell theme surface.
export const buildAppStyle = ({
    bgMode,
    isDaylight,
    theme,
    daylightTheme,
    defaultTheme,
    transparentBackground = false,
}: {
    bgMode: string;
    isDaylight: boolean;
    theme: Theme;
    daylightTheme: Theme;
    defaultTheme: Theme;
    transparentBackground?: boolean;
}) => {
    const backgroundColor = bgMode === 'default' ? (isDaylight ? daylightTheme.backgroundColor : defaultTheme.backgroundColor) : theme.backgroundColor;
    return {
        '--bg-color': backgroundColor,
        '--text-primary': theme.primaryColor,
        '--text-secondary': theme.secondaryColor,
        '--text-accent': theme.accentColor,
        '--text-on-accent': resolveTextOnAccent(theme.accentColor, backgroundColor, theme.primaryColor),
        backgroundColor: transparentBackground ? 'transparent' : 'var(--bg-color)',
        color: 'var(--text-primary)',
    } as CSSProperties;
};
