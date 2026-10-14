import { useEffect, useState } from 'react';

// src/hooks/useLibraryOcclusionSettled.ts
// 资料库 stage 遮挡播放页的稳定标记（B6b），时序照 Lattice 的 hasLatticeExited：
// - 进入：首页显示着且 stage 报遮挡（isOccludingHome）持续 LIBRARY_OCCLUSION_SETTLE_MS 之后才置 true，保证首页的
//   0.25s 淡入已经结束、实色已经盖上，再卸载 visualizer（淡入过程中仍能看到它）；
// - 离开：isOccludingHome 一变 false，同一次渲染就返回 false（不等 effect），visualizer 立即重新挂载。
// 每次条件翻转最多一次 setState，没有高频更新。

/** App 首页挂载点的淡入时长（App.tsx 首页 motion.div 的 0.25s）再留一帧余量。 */
export const LIBRARY_OCCLUSION_SETTLE_MS = 250 + 50;

/** isOccludingHome = shouldRevealHomeSurface && libraryOccludesPlayer（设置弹窗盖着首页时仍为真）。返回值可直接用作 hasLibraryOcclusionSettled。 */
export const useLibraryOcclusionSettled = (isOccludingHome: boolean) => {
    const [settled, setSettled] = useState(false);

    useEffect(() => {
        if (!isOccludingHome) {
            setSettled(false);
            return undefined;
        }
        const timer = setTimeout(() => setSettled(true), LIBRARY_OCCLUSION_SETTLE_MS);
        return () => clearTimeout(timer);
    }, [isOccludingHome]);

    return isOccludingHome && settled;
};
