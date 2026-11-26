import { describe, expect, it } from 'vitest';
import { buildHomeSurfacePresentation } from '../../../src/components/app/presentation/buildHomeSurfacePresentation';
import {
    LIBRARY_BACKDROP_BLUR_PX,
    resolveVisualizerBackdropBlur,
    resolveVisualizerShowText,
    visualizerBackdropStyle,
} from '../../../src/components/app/presentation/playerVisualizerBackdrop';

// test/unit/navigation/playerVisualizerBackdrop.test.ts
// 首页墙后面透出来的 visualizer（bravais「墙后的画面」）：歌词文字只在 stage 报了 lyrics 且首页显示着时才在首页画，
// 播放页照旧；模糊只在首页墙露着（含交接）且 stage 报了 blur 时加，回播放页时撤掉。
// 设置弹窗盖在首页上时首页仍显示在半透明遮罩下面（2026-10-09），墙后的歌词与模糊都不变。

describe('visualizer lyrics behind the library wall', () => {
    const showText = (currentView: string, backdropLyrics: boolean, { isSettingsModalOpen = false, isPanelOpen = false } = {}) => (
        resolveVisualizerShowText({ currentView, isSettingsModalOpen, isPanelOpen, backdropLyrics })
    );

    it('keeps the player page as it was, whatever the stage reports', () => {
        expect(showText('player', false)).toBe(true);
        expect(showText('player', true)).toBe(true);
        expect(showText('player', true, { isSettingsModalOpen: true })).toBe(false);
    });

    it('draws text on the home page only when the stage asks for it and no panel covers the home', () => {
        expect(showText('home', false)).toBe(false);
        expect(showText('home', true)).toBe(true);
        // 设置弹窗盖着：首页仍在遮罩下面显示着，墙后的歌词不变。
        expect(showText('home', true, { isSettingsModalOpen: true })).toBe(true);
        expect(showText('home', false, { isSettingsModalOpen: true })).toBe(false);
        expect(showText('home', true, { isPanelOpen: true })).toBe(false);
        expect(showText('lattice', true)).toBe(false);
    });
});

describe('visualizer blur behind the library wall', () => {
    const blur = (currentView: string, backdropBlur: boolean, keepsHomeForHandoff = false, isSettingsModalOpen = false) => {
        const { shouldRevealHomeSurface } = buildHomeSurfacePresentation({
            currentView,
            isSettingsModalOpen,
            isPanelOpen: false,
            keepsHomeForHandoff,
        });
        return resolveVisualizerBackdropBlur({ shouldRevealHomeSurface, backdropBlur });
    };

    it('blurs only while the home wall shows and the stage reports blur', () => {
        expect(blur('home', true)).toBe(true);
        expect(blur('home', false)).toBe(false);
        expect(blur('player', true)).toBe(false);
        // 设置弹窗盖着首页：墙仍显示在遮罩下面，模糊留着。
        expect(blur('home', true, false, true)).toBe(true);
        // 进 Lattice 的交接期间首页墙还露着（窗还开着）：模糊留着。
        expect(blur('lattice', true, true)).toBe(true);
        expect(blur('lattice', true, false)).toBe(false);
    });

    it('styles the visualizer layer with one stable object per state', () => {
        expect(visualizerBackdropStyle(true)).toBe(visualizerBackdropStyle(true));
        expect(visualizerBackdropStyle(true).filter).toBe(`blur(${LIBRARY_BACKDROP_BLUR_PX}px)`);
        expect(visualizerBackdropStyle(false).filter).toBeUndefined();
    });
});
