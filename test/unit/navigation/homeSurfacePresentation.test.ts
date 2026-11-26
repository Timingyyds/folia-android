import { describe, expect, it } from 'vitest';
import { buildHomeSurfacePresentation } from '../../../src/components/app/presentation/buildHomeSurfacePresentation';

// test/unit/navigation/homeSurfacePresentation.test.ts

describe('buildHomeSurfacePresentation', () => {
    it('shows Home only on an unobstructed home view', () => {
        expect(buildHomeSurfacePresentation({
            currentView: 'home',
            isSettingsModalOpen: false,
            isPanelOpen: false,
        })).toEqual({
            shouldKeepHomeMounted: true,
            shouldShowHomeSurface: true,
            shouldRevealHomeSurface: true,
        });
    });

    it('does not remount Home behind player panel overlays', () => {
        expect(buildHomeSurfacePresentation({
            currentView: 'player',
            isSettingsModalOpen: false,
            isPanelOpen: true,
        })).toEqual({
            shouldKeepHomeMounted: false,
            shouldShowHomeSurface: false,
            shouldRevealHomeSurface: false,
        });
    });

    it('does not remount Home behind settings opened from the player view', () => {
        expect(buildHomeSurfacePresentation({
            currentView: 'player',
            isSettingsModalOpen: true,
            isPanelOpen: false,
        })).toEqual({
            shouldKeepHomeMounted: false,
            shouldShowHomeSurface: false,
            shouldRevealHomeSurface: false,
        });
    });

    it('does not reveal Home while player view waits for delayed unmount', () => {
        expect(buildHomeSurfacePresentation({
            currentView: 'player',
            isSettingsModalOpen: false,
            isPanelOpen: false,
        })).toEqual({
            shouldKeepHomeMounted: false,
            shouldShowHomeSurface: false,
            shouldRevealHomeSurface: false,
        });
    });

    // 2026-10-09：设置弹窗盖在首页上时资料库原地留着——挂着、显示在半透明遮罩下面，只是不可交互。
    it('keeps Home mounted and visible, but not interactive, under the settings dialog', () => {
        expect(buildHomeSurfacePresentation({
            currentView: 'home',
            isSettingsModalOpen: true,
            isPanelOpen: false,
        })).toEqual({
            shouldKeepHomeMounted: true,
            shouldShowHomeSurface: false,
            shouldRevealHomeSurface: true,
        });
    });

    it('hides Home while the player panel covers it', () => {
        for (const isSettingsModalOpen of [false, true]) {
            expect(buildHomeSurfacePresentation({
                currentView: 'home',
                isSettingsModalOpen,
                isPanelOpen: true,
            })).toEqual({
                shouldKeepHomeMounted: true,
                shouldShowHomeSurface: false,
                shouldRevealHomeSurface: false,
            });
        }
    });

    it('keeps Home mounted and visible, but not interactive, while a wall handoff lands Lattice on it', () => {
        expect(buildHomeSurfacePresentation({
            currentView: 'lattice',
            isSettingsModalOpen: false,
            isPanelOpen: false,
            keepsHomeForHandoff: true,
        })).toEqual({
            shouldKeepHomeMounted: true,
            shouldShowHomeSurface: false,
            shouldRevealHomeSurface: true,
        });
    });
});
