import { describe, expect, it } from 'vitest';
import { BRAVAIS_SEAM_TITLE_DRAG_PX, shouldToggleSeamFromTitle } from '@/library/suites/bravais/bravaisSeamTitleClick';

// test/unit/library/bravais/bravaisSeamTitleClick.test.ts
// 点缝里的竖排标题切换开口（fb10）：键盘激活总是切；指针点按在原地松开才切，拖了一段或有文字选区时不切。

const at = { x: 100, y: 200 };

describe('shouldToggleSeamFromTitle', () => {
    it('always toggles on keyboard activation (detail 0), even with a selection around', () => {
        expect(shouldToggleSeamFromTitle({ detail: 0, down: null, at, hasSelection: false })).toBe(true);
        expect(shouldToggleSeamFromTitle({ detail: 0, down: { x: 0, y: 0 }, at, hasSelection: true })).toBe(true);
    });

    it('toggles on a click released where it was pressed (within the drag threshold)', () => {
        expect(shouldToggleSeamFromTitle({ detail: 1, down: at, at, hasSelection: false })).toBe(true);
        expect(shouldToggleSeamFromTitle({
            detail: 1,
            down: { x: at.x + BRAVAIS_SEAM_TITLE_DRAG_PX - 1, y: at.y },
            at,
            hasSelection: false,
        })).toBe(true);
    });

    it('does not toggle after a drag across the title', () => {
        expect(shouldToggleSeamFromTitle({ detail: 1, down: { x: at.x - 40, y: at.y + 3 }, at, hasSelection: false })).toBe(false);
        expect(shouldToggleSeamFromTitle({ detail: 1, down: { x: at.x, y: at.y - BRAVAIS_SEAM_TITLE_DRAG_PX - 1 }, at, hasSelection: false })).toBe(false);
    });

    it('does not toggle while text inside the title is selected', () => {
        expect(shouldToggleSeamFromTitle({ detail: 1, down: at, at, hasSelection: true })).toBe(false);
    });

    it('toggles a pointer click whose press was not recorded (synthetic click)', () => {
        expect(shouldToggleSeamFromTitle({ detail: 1, down: null, at, hasSelection: false })).toBe(true);
    });
});
