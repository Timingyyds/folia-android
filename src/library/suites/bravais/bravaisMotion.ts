import { resolveReducedMotion, useMotionSettingsStore, type MotionSettingsState } from '../../../state/useMotionSettingsStore';

// src/library/suites/bravais/bravaisMotion.ts
// bravais 的换层转场怎么解析「降低动态效果」（B11，设计稿 §10.8 的 backdrop 一行）：翻牌换成 0.18s 淡入淡出
// （BRAVAIS_REDUCED_FADE_MS），整墙波次（换首页页签、从搜索 / 播放页整墙入场 / 出场）一并关掉、也换成淡入淡出。
// 「队列拼贴」（lattice，bravais 沿用它的视觉与相机 / 缝 / 悬停的降级）与「歌单展开转场」（collectionMorph，网格的
// 打开集合转场）任一降级就算：两者在 bravais 里都对应「换层时墙怎么动」。透光、相机、缝的补间不受这里影响（相机与缝
// 仍只看 lattice）。
//
// 没有声明成 manifest 的 transitions.backdrop：宿主只拿 backdrop 做两件事——集合层的中性背景板（bravais 的层由 stage
// 画，宿主不垫）与 enabled 门控 beforePush / beforeBack（bravais 的 beforePush 记的是起点磁贴，降级时也要记，
// 不能被门控掉）。所以由 stage 直接读这里。

type MotionState = Pick<MotionSettingsState, 'reducedMotionSurfaces' | 'followSystemReducedMotion' | 'systemPrefersReducedMotion'>;

/** 换层转场要不要降级成淡入淡出。 */
export const resolveBravaisReducedTransitions = (state: MotionState): boolean => (
    resolveReducedMotion(state, 'lattice') || resolveReducedMotion(state, 'collectionMorph')
);

export const useBravaisReducedTransitions = (): boolean => useMotionSettingsStore(resolveBravaisReducedTransitions);
