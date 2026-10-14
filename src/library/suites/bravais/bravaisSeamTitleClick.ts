// src/library/suites/bravais/bravaisSeamTitleClick.ts
// 点缝里的竖排标题切换开口（设计稿 §5「开口等级」）：完整信息条上点标题区域收成书脊，书脊上点竖排标题展开回完整信息条。
// 这里是纯规则：一次点击算不算「点标题」。键盘激活（Enter / Space，click 的 detail 为 0）总是算；指针点按时，按下到
// 松开挪动超过阈值（在标题上拖了一段，像是想拖选文字）或此刻有落在标题里的文字选区，就不算。

/** 按下到松开挪动超过它就当成拖动，不切换（px）。 */
export const BRAVAIS_SEAM_TITLE_DRAG_PX = 4;

export type BravaisSeamTitleClick = {
    /** click 事件的 detail：0 = 键盘激活。 */
    detail: number;
    /** 按下时的指针位置（主键按下才有；没记到为 null）。 */
    down: { x: number; y: number } | null;
    /** click 时的指针位置。 */
    at: { x: number; y: number };
    /** 此刻有没有落在标题区域里的、非空的文字选区。 */
    hasSelection: boolean;
};

/** 这一下点击要不要切换开口。 */
export const shouldToggleSeamFromTitle = ({ detail, down, at, hasSelection }: BravaisSeamTitleClick): boolean => {
    if (detail === 0) return true;
    if (hasSelection) return false;
    if (!down) return true;
    return Math.hypot(at.x - down.x, at.y - down.y) <= BRAVAIS_SEAM_TITLE_DRAG_PX;
};
