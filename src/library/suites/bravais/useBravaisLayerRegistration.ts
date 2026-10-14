import { useEffect, useState } from 'react';
import type { BravaisLayer } from './bravaisLayer';
import {
    registerBravaisLayer,
    releaseBravaisLayer,
    takeBravaisLayerToken,
    type BravaisLayerSlot,
} from './bravaisStageStore';

// src/library/suites/bravais/useBravaisLayerRegistration.ts
// surface 把自己的层描述推进 stage store：挂载时拿一个 token，层描述变了就更新，卸载（或 present 变假：
// AnimatePresence 里正在退场）时放掉自己的登记。层描述只在数据真的变了时才换身份（surface 里 useMemo），
// 所以这里每次 effect 都写一次也不会让 stage 白渲染（applyLayerRegistration 对同一对象是 no-op）。

export const useBravaisLayerRegistration = (slot: BravaisLayerSlot, layer: BravaisLayer, present = true) => {
    const [token] = useState(takeBravaisLayerToken);

    useEffect(() => {
        if (!present) {
            releaseBravaisLayer(slot, token);
            return;
        }
        registerBravaisLayer(slot, token, layer);
    }, [layer, present, slot, token]);

    useEffect(() => () => releaseBravaisLayer(slot, token), [slot, token]);
};
