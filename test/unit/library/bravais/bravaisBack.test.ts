import { describe, expect, it } from 'vitest';
import { resolveBravaisBackStep } from '@/library/suites/bravais/bravaisBack';

// test/unit/library/bravais/bravaisBack.test.ts
// 左上角隐藏式返回的去处（设计稿 §7.5）：不在首页根层时与缝里的 ‹ 同一个返回（先面板、再表单、再退层），
// 首页根层有歌时回到播放页，没有歌时不显示。

const base = { hasPanel: false, hasForm: false, canLeaveLayer: false, hasPlayer: false };

describe('resolveBravaisBackStep', () => {
    it('closes an open panel first, then a collection form, then leaves the layer', () => {
        expect(resolveBravaisBackStep({ ...base, hasPanel: true, hasForm: true, canLeaveLayer: true, hasPlayer: true })).toBe('panel');
        expect(resolveBravaisBackStep({ ...base, hasForm: true, canLeaveLayer: true, hasPlayer: true })).toBe('form');
        expect(resolveBravaisBackStep({ ...base, canLeaveLayer: true, hasPlayer: true })).toBe('layer');
        // 集合层上没有歌也照样是层返回。
        expect(resolveBravaisBackStep({ ...base, canLeaveLayer: true })).toBe('layer');
    });

    it('at the home root returns to the player only with a song, otherwise hides', () => {
        expect(resolveBravaisBackStep({ ...base, hasPlayer: true })).toBe('player');
        expect(resolveBravaisBackStep(base)).toBeNull();
        // 首页的目录树面板开着：先关面板（缝里有 ‹），与有没有歌无关。
        expect(resolveBravaisBackStep({ ...base, hasPanel: true })).toBe('panel');
    });
});
