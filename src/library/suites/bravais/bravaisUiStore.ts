import { create } from 'zustand';

// src/library/suites/bravais/bravaisUiStore.ts
// stage 与集合 surface 之间、层描述以外的几样小状态（模块作用域，跨 stage 卸载存活）：
// - panelFor：列表面板开在哪一层（层 key）。面板是导航状态（设计稿 §5「面板」）：打开时写一条 history 记录
//   （bravaisPanelHistory），浏览器后退、Esc、‹ 都先关它；换到别的层不清掉——压栈后返回时面板仍开着，与 history 一致。
// - linkedKey / wallHoverKey：列表 ↔ 墙的联动（悬停列表行高亮墙上的副本；悬停磁贴高亮并滚到列表行）。
// - filterEditing：缝里的过滤输入位正在输入（打字触发、点输入位、命令面板的 openCommandFilter 请求）：书脊 / 折叠的缝
//   临时展开（bravaisSeamTarget 的 filterOpen），输入位挂载时拿焦点；Esc（空词时）、↓ / Enter、点别处结束。
// - filterComposing：输入位里正在输入法组词（墙用的过滤词停在组词开始前的那一个）。
// - filterInput：此刻挂着的输入位（翻牌途中新旧两份同时在，后挂上的那份是要换上的；inert 的不算）。
// - focusFirst：stage 注册的「把键盘焦点交给墙上第 1 项」（输入位里按 ↓ / Enter、命令面板过滤框里按 ↓）。
// - removalOrigin：聚焦卡「⋯ → 移出」时记下的 slot，移除的两段翻牌从它开始。

export type BravaisRemovalOrigin = { layerKey: string; slotKey: string };

export type BravaisUiState = {
    panelFor: string | null;
    linkedKey: string | null;
    wallHoverKey: string | null;
    filterEditing: boolean;
    filterComposing: boolean;
    filterInput: HTMLInputElement | null;
    focusFirst: (() => boolean) | null;
    removalOrigin: BravaisRemovalOrigin | null;
};

export const useBravaisUiStore = create<BravaisUiState>(() => ({
    panelFor: null,
    linkedKey: null,
    wallHoverKey: null,
    filterEditing: false,
    filterComposing: false,
    filterInput: null,
    focusFirst: null,
    removalOrigin: null,
}));

export const setBravaisFilterEditing = (editing: boolean) => {
    if (useBravaisUiStore.getState().filterEditing !== editing) useBravaisUiStore.setState({ filterEditing: editing });
};

export const setBravaisFilterComposing = (composing: boolean) => {
    if (useBravaisUiStore.getState().filterComposing !== composing) useBravaisUiStore.setState({ filterComposing: composing });
};

/** 输入位挂上时登记自己；返回注销（只注销自己，后挂上的那份不被先卸载的旧份清掉）。 */
export const registerBravaisFilterInput = (input: HTMLInputElement) => {
    useBravaisUiStore.setState({ filterInput: input });
    return () => {
        if (useBravaisUiStore.getState().filterInput === input) useBravaisUiStore.setState({ filterInput: null, filterComposing: false });
    };
};

export const setBravaisLinkedKey = (key: string | null) => {
    if (useBravaisUiStore.getState().linkedKey !== key) useBravaisUiStore.setState({ linkedKey: key });
};

export const setBravaisWallHoverKey = (key: string | null) => {
    if (useBravaisUiStore.getState().wallHoverKey !== key) useBravaisUiStore.setState({ wallHoverKey: key });
};

/** 取走移除的翻牌起点：只认这一层记下的。 */
export const takeBravaisRemovalOrigin = (layerKey: string): string | null => {
    const origin = useBravaisUiStore.getState().removalOrigin;
    if (!origin) return null;
    useBravaisUiStore.setState({ removalOrigin: null });
    return origin.layerKey === layerKey ? origin.slotKey : null;
};
