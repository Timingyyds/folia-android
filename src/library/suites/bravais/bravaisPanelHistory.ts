import { useBravaisUiStore } from './bravaisUiStore';

// src/library/suites/bravais/bravaisPanelHistory.ts
// 列表面板的 history 记录（设计稿 §5：打开面板是一次导航，面包屑多一级，返回先关面板；要同时写一条 history 记录，
// 与「beforeBack 只执行一次」的约定一致）。沿用 useAppNavigation 的历史状态形状：在当前记录上加一个 bravaisPanel
// 标记、appHistoryIndex 加一后 pushState，视图与集合快照原样带着——浏览器后退回到上一条记录时，宿主的 popstate 恢复的
// 是同一份集合栈（不算弹栈，不跑 beforeBack），stage 只据记录上的标记开合面板。应用内关闭（Esc、‹、面板的关闭按钮）
// 在面板记录正是当前记录时走 history.back()，否则（记录已不在顶上）直接关。

const MARKER = 'bravaisPanel';

type HistoryRecord = Record<string, unknown> & { appHistoryIndex?: number };

const currentRecord = (): HistoryRecord | null => {
    const state = typeof window === 'undefined' ? null : window.history.state;
    return state && typeof state === 'object' ? state as HistoryRecord : null;
};

/** 当前 history 记录上的面板标记（层 key），没有就是 null。 */
export const readPanelHistoryMarker = (): string | null => {
    const marker = currentRecord()?.[MARKER];
    return typeof marker === 'string' ? marker : null;
};

export const openBravaisPanel = (layerKey: string) => {
    if (useBravaisUiStore.getState().panelFor === layerKey) return;
    const record = currentRecord() ?? {};
    const index = typeof record.appHistoryIndex === 'number' ? record.appHistoryIndex : 0;
    try {
        window.history.pushState({ ...record, appHistoryIndex: index + 1, [MARKER]: layerKey }, '', window.location.hash || undefined);
    } catch {
        // 写不了 history（极少见）：面板照开，只是浏览器后退不经过它。
    }
    useBravaisUiStore.setState({ panelFor: layerKey });
};

export const closeBravaisPanel = () => {
    const open = useBravaisUiStore.getState().panelFor;
    if (!open) return;
    if (readPanelHistoryMarker() === open) {
        // popstate 里再按记录收起（见 syncPanelWithHistory），不在这里改 store，免得和后退各收一次。
        window.history.back();
        return;
    }
    useBravaisUiStore.setState({ panelFor: null });
};

/** popstate 之后：面板开合跟着当前记录上的标记走（后退关、前进重开）。 */
export const syncPanelWithHistory = () => {
    const marker = readPanelHistoryMarker();
    if (useBravaisUiStore.getState().panelFor !== marker) useBravaisUiStore.setState({ panelFor: marker });
};

/** 换层时：不是压栈（返回、换页签、换 suite 重挂）而且新层不是面板所在的层，就收起（不动 history）。 */
export const releasePanelOnLayerChange = (kind: 'push' | 'back' | 'replace' | 'first', nextLayerKey: string) => {
    if (kind === 'push') return;
    const open = useBravaisUiStore.getState().panelFor;
    if (open && open !== nextLayerKey) useBravaisUiStore.setState({ panelFor: null });
};
