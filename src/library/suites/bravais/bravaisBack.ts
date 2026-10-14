// src/library/suites/bravais/bravaisBack.ts
// 左上角隐藏式返回（WallBackButton）此刻做什么（设计稿 §7.5「浮层控件」，纯规则）。用户实测：它原先在首页与集合层都是
// 「回到播放页」，与缝里的 ‹ 不一致；首页上没有歌时点它到的是空的播放页（深色主题下一片黑）。现在：
// - 不在首页根层时，与缝里的 ‹ 同一个返回：面板开着先关面板（列表 / 目录树，与 ‹、Esc 一致），集合层的表单态先撤销表单，
//   否则是这一层的「完成」（onDone：翻牌、N1 折叠往返都由宿主的同一条路径处理）；
// - 首页根层（缝里没有 ‹）：有正在播放 / 已加载的歌才回播放页，没有就不显示这颗按钮（null）。

/**
 * 「有没有可回的播放页」：有正在播放 / 已加载的歌（usePlaybackStore.currentSong）。左上角返回与首页「⋯」里的「回到播放页」
 * 都按它显示 / 隐藏（fb8：「⋯」里的那项原来总是显示，没有歌时点它进的是空的播放页）。
 */
export const selectBravaisHasCurrentSong = (state: { currentSong: unknown }): boolean => state.currentSong !== null;

export type BravaisBackStep = 'panel' | 'form' | 'layer' | 'player';

export const resolveBravaisBackStep = ({
    hasPanel,
    hasForm,
    canLeaveLayer,
    hasPlayer,
}: {
    /** 这一层的面板（集合层的列表、首页的目录树）开着。 */
    hasPanel: boolean;
    /** 集合层的表单态（新建歌单、重命名……）。 */
    hasForm: boolean;
    /** 这一层有「完成」（onDone，首页没有）。 */
    canLeaveLayer: boolean;
    /** 有正在播放 / 已加载的歌，且宿主给了「回到播放页」。 */
    hasPlayer: boolean;
}): BravaisBackStep | null => {
    if (hasPanel) return 'panel';
    if (hasForm) return 'form';
    if (canLeaveLayer) return 'layer';
    return hasPlayer ? 'player' : null;
};
