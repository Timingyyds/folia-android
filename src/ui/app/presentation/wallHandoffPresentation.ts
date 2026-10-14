import type { WallHandoffSession } from '../../../state/useWallHandoffStore';

// src/ui/app/presentation/wallHandoffPresentation.ts
// 翻牌交接（资料库墙 ↔ Lattice，useWallHandoffStore）期间 App 的两个挂载点与 visualizer 怎么摆（纯计算）：
// - 进 Lattice：首页层留着、保持完全显示（不跑自己的 0.25s 淡出），Lattice 叠在上面落下来；会话结束时首页层才卸载。
// - 回资料库墙：Lattice 留到翻牌放完（waiting / flipping），首页层不跑自己的淡入（下面的墙要在 Lattice 变透明之前画实）。
// - visualizer：进 Lattice 时窗关上之前一直垫着（closing；淡入淡出交叉时整段都垫着），回资料库墙时首页墙一报「有窗」就装上，
//   赶在窗打开之前。实色档（没有窗）不碰它，照旧由遮挡规则决定。
// 两边的层在交接期间都不接指针（交接由动画决定，翻完才交给接手的那一面）。

export type WallHandoffPresentation = {
    /** 首页层因为交接留着（进 Lattice）。 */
    keepsHome: boolean;
    /** Lattice 因为交接留着（回资料库墙，翻牌放完之前）。 */
    keepsLattice: boolean;
    /** 交接期间：两层的整层淡入淡出关掉（首页层 opacity 直接到位，Lattice 卸载时不淡出）、都不接指针。 */
    active: boolean;
    /** 交接要求 visualizer 挂着（窗还开着 / 马上要开）。 */
    keepsVisualizer: boolean;
    /** 降低动态效果的淡入淡出交叉：Lattice 挂上时从 0 淡入（进），或淡到 0 再卸载（出）。 */
    latticeOpacity: { initial: number | false; animate: number } | null;
    /** 淡入淡出交叉的时长（秒）。 */
    fadeSeconds: number;
};

export const resolveWallHandoffPresentation = (session: WallHandoffSession | null): WallHandoffPresentation => {
    if (!session) {
        return { keepsHome: false, keepsLattice: false, active: false, keepsVisualizer: false, latticeOpacity: null, fadeSeconds: 0 };
    }
    const toLattice = session.direction === 'to-lattice';
    const fade = session.mode === 'fade';
    const keepsVisualizer = session.seeThrough === true && (
        toLattice ? session.phase === 'closing' || fade : true
    );
    let latticeOpacity: WallHandoffPresentation['latticeOpacity'] = null;
    if (fade) {
        // 进：挂上时透明，等 Lattice 量好（closing 结束）才淡入；出：首页墙画好（waiting 结束）才淡出。
        latticeOpacity = toLattice
            ? { initial: 0, animate: session.phase === 'closing' ? 0 : 1 }
            : { initial: false, animate: session.phase === 'waiting' ? 1 : 0 };
    }
    return {
        keepsHome: toLattice,
        keepsLattice: !toLattice && (session.phase === 'waiting' || session.phase === 'flipping'),
        active: true,
        keepsVisualizer,
        latticeOpacity,
        fadeSeconds: session.timing.fadeMs / 1000,
    };
};
