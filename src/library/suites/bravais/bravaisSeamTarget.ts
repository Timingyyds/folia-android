import { BRAVAIS_SEAM_FULL_WIDTH } from './bravaisConstants';
import type { BravaisLayer, BravaisLayerSurface } from './bravaisLayer';
import {
    resolveSeamOpenWidth,
    resolveSeamVariant,
    seamVariantWidth,
    type BravaisSeamLevel,
    type BravaisSeamVariant,
} from './bravaisSeamLevel';

// src/library/suites/bravais/bravaisSeamTarget.ts
// 缝此刻该开多宽、渲染哪一套内容（B7 在三级开口之上加的三种情形，纯规则）：
// - 表单态（改名、删除确认、加入歌单选择）：缝原地翻成表单，宽度按完整信息条；
// - 列表面板（导航状态）：缝加宽到 min(420, 视口 − 52)，标题横排压在顶部（设计稿 §5「面板」）；
// - 正在输入过滤词：书脊 / 折叠的缝临时展开为完整信息条（首页是窄缝），结束输入后回到原等级（设计稿 §7.6）。
// 优先级：表单 > 面板（折叠时除外）> 过滤的临时展开 > 用户选的等级。用户的等级不被改写，只是暂时不生效。
// B9 首页：目录树面板与列表面板同一种开口（panel）；全局搜索框开着时首页窄缝临时展开成完整宽度（search，
// 折叠时除外——搜索态没有书脊这一级，只能折叠）。首页的表单态在面板里（底部翻牌），不占整条缝。

/** 列表面板的开口：min(420, 视口 − 52)。 */
export const BRAVAIS_PANEL_MAX_WIDTH = 420;
export const BRAVAIS_PANEL_VIEWPORT_MARGIN = 52;
/** 极窄的视口里也留一列能读的宽度。 */
const BRAVAIS_PANEL_MIN_WIDTH = 160;

export const resolvePanelWidth = (viewportWidth: number) => Math.max(
    BRAVAIS_PANEL_MIN_WIDTH,
    Math.min(BRAVAIS_PANEL_MAX_WIDTH, viewportWidth - BRAVAIS_PANEL_VIEWPORT_MARGIN),
);

export type BravaisSeamContentVariant = BravaisSeamVariant | 'panel' | 'form' | 'search' | BravaisAccountSeamVariant;

/** B10：账户的登录态 / 确认态（不属于任何一层，见 bravaisAccountStore）。 */
export type BravaisAccountSeamVariant = 'login' | 'confirm';

export type BravaisSeamTargetInput = {
    surface: BravaisLayerSurface;
    level: BravaisSeamLevel;
    viewportWidth: number;
    formOpen?: boolean;
    panelOpen?: boolean;
    /** 缝里的过滤输入位正在输入（bravaisUiStore.filterEditing）：书脊 / 折叠的缝临时展开。 */
    filterOpen?: boolean;
    /** B9：首页的全局搜索框开着。 */
    searchOpen?: boolean;
};

/** 这一刻的生效等级：过滤框、面板、表单都要求完整的缝。 */
export const resolveEffectiveSeamLevel = ({ level, formOpen, panelOpen, filterOpen }: BravaisSeamTargetInput): BravaisSeamLevel => (
    formOpen || filterOpen || (panelOpen && level !== 'hidden') ? 'full' : level
);

export const resolveSeamTarget = (input: BravaisSeamTargetInput): { width: number; variant: BravaisSeamContentVariant } => {
    // 整条缝翻成表单只在集合层与歌手页（B8）上有；首页的表单在目录树面板底部（B9），不占整条缝。
    // 面板三层都有：集合 / 歌手是列表面板，首页是目录树（只在有批量的那几行，hasPanel 由 surface 给）。
    if (input.surface !== 'home' && input.formOpen) return { width: BRAVAIS_SEAM_FULL_WIDTH, variant: 'form' };
    // 面板里只有「折叠」：折叠后面板仍算开着，恢复时回到面板（设计稿 §5）。
    if (input.panelOpen && input.level !== 'hidden') {
        return { width: resolvePanelWidth(input.viewportWidth), variant: 'panel' };
    }
    if (input.surface === 'home' && input.searchOpen && input.level !== 'hidden') {
        return { width: BRAVAIS_SEAM_FULL_WIDTH, variant: 'search' };
    }
    const level = resolveEffectiveSeamLevel(input);
    return { width: resolveSeamOpenWidth(input.surface, level), variant: resolveSeamVariant(input.surface, level) };
};

/** 一套内容的排版宽度（翻转不重排：跟着此刻渲染的那一套走）。 */
export const resolveVariantWidth = (variant: BravaisSeamContentVariant, viewportWidth: number) => {
    if (variant === 'form' || variant === 'search' || variant === 'login' || variant === 'confirm') return BRAVAIS_SEAM_FULL_WIDTH;
    if (variant === 'panel') return resolvePanelWidth(viewportWidth);
    return seamVariantWidth(variant);
};

/**
 * B10：stage 用的开口——账户的登录态 / 确认态压过层上的一切（表单、面板、搜索、过滤、等级，折叠也一样）：选中未登录的
 * 平台后缝强制拉到完整宽度（300px，放得下 200px 的二维码），关掉或答复后回到原来的开口（用户的等级不被改写）。
 */
export const resolveStageSeamTarget = (
    input: BravaisSeamTargetInput,
    account: BravaisAccountSeamVariant | null,
): { width: number; variant: BravaisSeamContentVariant } => (
    account ? { width: BRAVAIS_SEAM_FULL_WIDTH, variant: account } : resolveSeamTarget(input)
);

/**
 * 缝里的内容换不换（整条翻不翻）的身份：按层 key。首页换页签（`home:<页签>`）同样整条翻一次（2026-10-09 用户：与原型
 * 一致；之前首页各页签算同一套内容、只翻中段，在线页签的中段常常是空的，看上去是硬切）。同一页签里换二级切换不换层，
 * 不翻。
 */
export const resolveSeamContentIdentity = (layer: Pick<BravaisLayer, 'key' | 'surface'>) => layer.key;
