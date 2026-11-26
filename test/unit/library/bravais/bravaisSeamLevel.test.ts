import { describe, expect, it } from 'vitest';
import {
    applySeamLevel,
    defaultSeamLevel,
    resolveSeamLevelOnResize,
    resolveSeamOpenWidth,
    resolveSeamVariant,
    restoreSeamLevel,
    seamVariantWidth,
    useBravaisSeamStore,
} from '@/library/suites/bravais/bravaisSeamLevel';

// test/unit/library/bravais/bravaisSeamLevel.test.ts
// 缝的开口等级状态机（设计稿 §5）：宽屏 full / 窄屏 spine 的默认值、折叠记住折叠前的等级、跨 900px 阈值时
// 非 hidden 的等级回到新宽度的默认值、每层每级的开口宽度与内容形态（翻转时排版宽度跟着渲染的那一套走）。

describe('seam level', () => {
    it('defaults to the full strip on wide screens and the spine below 900px', () => {
        expect(defaultSeamLevel(1280)).toBe('full');
        expect(defaultSeamLevel(900)).toBe('full');
        expect(defaultSeamLevel(899)).toBe('spine');
    });

    it('remembers the level it folded from and restores it', () => {
        let state = applySeamLevel({ level: 'full', restoreLevel: 'full' }, 'spine');
        expect(state).toEqual({ level: 'spine', restoreLevel: 'spine' });
        state = applySeamLevel(state, 'hidden');
        expect(state).toEqual({ level: 'hidden', restoreLevel: 'spine' });
        expect(applySeamLevel(state, 'hidden')).toBe(state);
        expect(restoreSeamLevel(state)).toEqual({ level: 'spine', restoreLevel: 'spine' });
        expect(restoreSeamLevel({ level: 'full', restoreLevel: 'full' })).toEqual({ level: 'full', restoreLevel: 'full' });
    });

    it('returns to the new default only when the width crosses the threshold', () => {
        const spine = { level: 'spine' as const, restoreLevel: 'spine' as const };
        expect(resolveSeamLevelOnResize(spine, 1280, 1100)).toBe(spine);
        expect(resolveSeamLevelOnResize(spine, 1280, 800)).toEqual({ level: 'spine', restoreLevel: 'spine' });
        expect(resolveSeamLevelOnResize({ level: 'full', restoreLevel: 'full' }, 1280, 800)).toEqual({ level: 'spine', restoreLevel: 'spine' });
        expect(resolveSeamLevelOnResize({ level: 'spine', restoreLevel: 'spine' }, 800, 1280)).toEqual({ level: 'full', restoreLevel: 'full' });
        // 折叠着跨阈值：仍是折叠，恢复目标换成新宽度的默认值。
        expect(resolveSeamLevelOnResize({ level: 'hidden', restoreLevel: 'full' }, 1280, 800)).toEqual({ level: 'hidden', restoreLevel: 'spine' });
    });

    it('opens 120 on the home layer, 300 on a collection, 64 as a spine and 0 folded', () => {
        expect(resolveSeamOpenWidth('home', 'full')).toBe(120);
        expect(resolveSeamOpenWidth('collection', 'full')).toBe(300);
        expect(resolveSeamOpenWidth('collection', 'spine')).toBe(64);
        expect(resolveSeamOpenWidth('home', 'spine')).toBe(64);
        expect(resolveSeamOpenWidth('home', 'hidden')).toBe(0);
    });

    it('lays each variant out at its own width', () => {
        expect(resolveSeamVariant('home', 'full')).toBe('home');
        expect(resolveSeamVariant('home', 'spine')).toBe('home-spine');
        expect(resolveSeamVariant('collection', 'full')).toBe('full');
        expect(resolveSeamVariant('collection', 'spine')).toBe('spine');
        expect(resolveSeamVariant('collection', 'hidden')).toBe('none');
        expect(['home', 'home-spine', 'full', 'spine', 'none'].map(variant => seamVariantWidth(variant as never))).toEqual([120, 64, 300, 64, 0]);
    });
});

describe('seam level store', () => {
    it('applies the threshold rule only after the first measurement', () => {
        useBravaisSeamStore.setState({ level: 'full', restoreLevel: 'full', viewportWidth: 0 });
        useBravaisSeamStore.getState().syncViewport(1280);
        expect(useBravaisSeamStore.getState().level).toBe('full');
        useBravaisSeamStore.getState().syncViewport(700);
        expect(useBravaisSeamStore.getState().level).toBe('spine');
        useBravaisSeamStore.getState().setLevel('hidden');
        useBravaisSeamStore.getState().restore();
        expect(useBravaisSeamStore.getState().level).toBe('spine');
    });
});
