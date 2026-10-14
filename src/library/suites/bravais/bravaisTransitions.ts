import { useEffect, type MutableRefObject } from 'react';
import { installBravaisTransitionHook } from './entry';
import type { BravaisDisplay } from './bravaisDisplay';
import { setBravaisPendingOrigin, useBravaisStageStore } from './bravaisStageStore';
import { useBravaisUiStore } from './bravaisUiStore';

// src/library/suites/bravais/bravaisTransitions.ts
// manifest 的 transitions 在 stage 一侧的实现（B11，接线见 entry.ts 的 installBravaisTransitionHook）：
// - reset（切 suite）：丢掉还没用掉的起点磁贴与移除的翻牌起点。它们是给切换前那次换层准备的；留着的话，之后在 bravais
//   里第一次不经磁贴的打开会把一张早就不相干的磁贴当起点。本模块随 stage 的 chunk 加载时就装上（stage 卸载后照样有效）。
// - beforePush（宿主真的压栈之前，打开之前读的导航上下文）：墙上点磁贴、聚焦卡的链接已经由 stage 自己记下起点；
//   没经过墙的打开（命令面板对焦点那一项执行 open-album / open-artist）就用此刻键盘焦点所在的 slot 当起点磁贴。
//   没有焦点时清掉别的层留下的起点，新层以记忆或离缝最近的 slot 起翻。
// 不声明 beforeBack：返回由 stage 观察深度变化驱动（一次返回 = 一次深度变浅，只翻一次），见 useBravaisDisplay。

/** 切 suite 时丢掉的东西（宿主经 transitions.reset 调用，每套 suite 都会收到）。 */
export const resetBravaisTransitions = () => {
    setBravaisPendingOrigin(null);
    if (useBravaisUiStore.getState().removalOrigin) useBravaisUiStore.setState({ removalOrigin: null });
};

installBravaisTransitionHook('reset', resetBravaisTransitions);

/**
 * 宿主压栈之前记下起点磁贴：已经有这一层记下的起点（点了磁贴）就不动；否则取键盘焦点所在的 slot。
 * 纯逻辑（读 / 写 stage store），stage 用 useBravaisBeforePush 装上。
 */
export const recordPushOrigin = (layerKey: string | null, focusedSlotKey: string | null) => {
    if (!layerKey) return;
    const pending = useBravaisStageStore.getState().pendingOrigin;
    if (pending?.fromLayerKey === layerKey) return;
    setBravaisPendingOrigin(focusedSlotKey ? { fromLayerKey: layerKey, slotKey: focusedSlotKey } : null);
};

/** stage 挂着时装上 beforePush（卸载时卸下；卸下之后宿主的压栈不记起点，回来时按记忆摆）。 */
export const useBravaisBeforePush = (
    displayRef: MutableRefObject<BravaisDisplay | null>,
    getFocusedSlotKey: () => string | null,
) => {
    useEffect(() => installBravaisTransitionHook('beforePush', () => {
        recordPushOrigin(displayRef.current?.layer.key ?? null, getFocusedSlotKey());
    }), [displayRef, getFocusedSlotKey]);
};
