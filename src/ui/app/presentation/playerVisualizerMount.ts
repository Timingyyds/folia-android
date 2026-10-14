// src/ui/app/presentation/playerVisualizerMount.ts
// 播放页 visualizer 什么时候挂载（App 的背景层）。两种情况下画面被完全盖住、visualizer 卸载以免在下面空转：
// - Lattice：进入即卸载，退出动画结束（hasLatticeExited）后才重新挂载；
// - 资料库 stage 报告完全遮挡（B6b，bravais 的实色档）：首页完全显示并且遮挡已经稳定（settled）后才卸载；
//   首页不再显示（回播放页、面板盖上）或 stage 改报 false 时立即重新挂载。设置弹窗盖在首页上时首页仍显示着
//   （半透明遮罩下面透出的是墙，不是播放页，2026-10-09），所以不重新挂载。
// - 翻牌交接（资料库墙 ↔ Lattice）：首页墙有窗时，进 Lattice 在窗关上之前、回资料库墙从首页墙报「有窗」起，交接要求它挂着
//   （wallHandoffPresentation.keepsVisualizer），压过上面两条：窗关上之前背后不能是空的，窗打开之前要已经装好。
// 这里只认 stage 的报告，不认识任何 suite id，也不读 suite 的偏好。

type PlayerVisualizerMountInput = {
    currentView: string;
    hasLatticeExited: boolean;
    /** buildHomeSurfacePresentation 的 shouldRevealHomeSurface：首页层看得见（设置弹窗盖着时也算，面板盖着时不算）。 */
    shouldRevealHomeSurface: boolean;
    /** 挂着的 stage 报告自己完全遮挡播放页（selectLibraryOccludesPlayer）。 */
    libraryOccludesPlayer: boolean;
    /** 首页实色盖上之后的稳定标记（useLibraryOcclusionSettled）。 */
    hasLibraryOcclusionSettled: boolean;
    /** 翻牌交接要求 visualizer 挂着（首页墙的窗还开着 / 马上要开）。 */
    handoffKeepsVisualizer?: boolean;
};

/** visualizer 是否挂载。三项遮挡条件缺一不可，任何一项失效都立即恢复挂载；交接要求挂着时一定挂着。 */
export const shouldMountPlayerVisualizer = ({
    currentView,
    hasLatticeExited,
    shouldRevealHomeSurface,
    libraryOccludesPlayer,
    hasLibraryOcclusionSettled,
    handoffKeepsVisualizer = false,
}: PlayerVisualizerMountInput) => handoffKeepsVisualizer || (
    currentView !== 'lattice'
    && hasLatticeExited
    && !(shouldRevealHomeSurface && libraryOccludesPlayer && hasLibraryOcclusionSettled)
);
