import { create } from 'zustand';
import type { BravaisLayer } from './bravaisLayer';

// src/library/suites/bravais/bravaisStageStore.ts
// bravais 的层栈：surface 推层描述，stage 读。只有两个位：首页层（BravaisHome 一直挂着）与顶层（宿主只挂导航栈
// 栈顶那一层的集合 surface，中间层不在场——返回时那一层重新挂载、重新推）。
// 每次登记拿一个 token：AnimatePresence 换层时新旧 surface 的挂载 / 卸载先后不定，旧的那个卸载时只放掉自己的
// 登记，顶不掉接手的新层。模块作用域的 store 跨 stage 卸载存活（离开首页约 350ms 后 stage 卸载）。
// 另记一条「待用的起点」：stage 在打开一张磁贴之前记下被点的 slot，新层到达时把它当起点磁贴（设计稿 §7）。

export type BravaisLayerSlot = 'home' | 'top';

export type BravaisLayerRegistration = { token: number; layer: BravaisLayer };

/**
 * 打开一张磁贴时记下的起点：哪一层、哪个 slot。slotKey 为 null 是「这次明确没有起点磁贴」（缝里的直达入口打开的
 * 集合不在屏内）：新层不读布局记忆里的起点、beforePush 也不拿键盘焦点补一个，以缝为中心排序。
 */
export type BravaisPendingOrigin = { fromLayerKey: string; slotKey: string | null };

export type BravaisStageState = {
    home: BravaisLayerRegistration | null;
    top: BravaisLayerRegistration | null;
    pendingOrigin: BravaisPendingOrigin | null;
};

const EMPTY: BravaisStageState = { home: null, top: null, pendingOrigin: null };

/** 登记或更新：同一个 token 更新层描述，新 token 顶替旧的持有者。 */
export const applyLayerRegistration = (
    state: BravaisStageState,
    slot: BravaisLayerSlot,
    token: number,
    layer: BravaisLayer,
): BravaisStageState => {
    const current = state[slot];
    if (current && current.token === token && current.layer === layer) return state;
    return { ...state, [slot]: { token, layer } };
};

/** 放掉登记：只放自己的（旧持有者晚一步卸载不清掉新持有者）。 */
export const releaseLayerRegistration = (
    state: BravaisStageState,
    slot: BravaisLayerSlot,
    token: number,
): BravaisStageState => (state[slot]?.token === token ? { ...state, [slot]: null } : state);

/**
 * 此刻该画哪一层：导航深度为 0 时是首页层；否则是顶层。顶层还没到（lazy 的 surface 还在加载、换层时新旧交接的
 * 那一拍，或这一层回退给了 grid）时沿用上一次画的层，不闪成空墙。`owned` 表示这一层确实归 bravais 渲染，
 * stage 只在 owned 时接键盘与外观动作。
 */
export const resolveCurrentLayer = ({
    depth,
    home,
    top,
    previous,
}: {
    depth: number;
    home: BravaisLayerRegistration | null;
    top: BravaisLayerRegistration | null;
    previous: BravaisLayer | null;
}): { layer: BravaisLayer | null; owned: boolean } => {
    if (depth <= 0) return { layer: home?.layer ?? previous, owned: Boolean(home) };
    if (top) return { layer: top.layer, owned: true };
    return { layer: previous, owned: false };
};

export const useBravaisStageStore = create<BravaisStageState>(() => EMPTY);

let nextToken = 1;

/** surface 挂载时拿一个 token（StrictMode 下双挂载各拿各的）。 */
export const takeBravaisLayerToken = () => {
    const token = nextToken;
    nextToken += 1;
    return token;
};

export const registerBravaisLayer = (slot: BravaisLayerSlot, token: number, layer: BravaisLayer) => {
    useBravaisStageStore.setState(state => applyLayerRegistration(state, slot, token, layer));
};

export const releaseBravaisLayer = (slot: BravaisLayerSlot, token: number) => {
    useBravaisStageStore.setState(state => releaseLayerRegistration(state, slot, token));
};

export const setBravaisPendingOrigin = (origin: BravaisPendingOrigin | null) => {
    useBravaisStageStore.setState({ pendingOrigin: origin });
};

/** 取走待用的起点：只有它记下时的那一层正是换层前画的那一层才算数。 */
export const takeBravaisPendingOrigin = (fromLayerKey: string | null): BravaisPendingOrigin | null => {
    const origin = useBravaisStageStore.getState().pendingOrigin;
    if (!origin) return null;
    useBravaisStageStore.setState({ pendingOrigin: null });
    return origin.fromLayerKey === fromLayerKey ? origin : null;
};
