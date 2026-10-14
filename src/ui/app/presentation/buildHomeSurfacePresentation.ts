// src/ui/app/presentation/buildHomeSurfacePresentation.ts

type BuildHomeSurfacePresentationInput = {
    currentView: string;
    isSettingsModalOpen: boolean;
    isPanelOpen: boolean;
    /** 翻牌交接进 Lattice 期间（wallHandoffPresentation.keepsHome）：首页层留着、保持显示，Lattice 叠在上面落下来。 */
    keepsHomeForHandoff?: boolean;
};

// Derives independent mount and visibility state for the Home surface.
// 三个值各管一件事：
// - shouldKeepHomeMounted：首页外壳挂着（为假 350ms 后 Home 返回 null，surface / stage 一起卸载）；
// - shouldRevealHomeSurface：首页层看得见（visibility / 整层 opacity）；
// - shouldShowHomeSurface：首页可交互（isInteractive、pointer-events）。
// 设置弹窗盖在首页上时（2026-10-09，用户要求）：首页照常显示在半透明遮罩下面、只是不可交互——资料库原地留着，
// 关掉设置不重新淡入，bravais 实色墙也继续遮挡 visualizer（见 playerVisualizerMount）。
export const buildHomeSurfacePresentation = ({
    currentView,
    isSettingsModalOpen,
    isPanelOpen,
    keepsHomeForHandoff = false,
}: BuildHomeSurfacePresentationInput) => {
    // Overlays may hide Home while it is active, but must not remount it from the player view.
    const shouldKeepHomeMounted = currentView === 'home' || keepsHomeForHandoff;
    const shouldShowHomeSurface = currentView === 'home' && !isSettingsModalOpen && !isPanelOpen;
    // 显示比可交互多两种情况：设置弹窗盖着首页（墙在遮罩下面看得见），交接进 Lattice 时首页墙还看得见；两者都不接输入。
    const shouldRevealHomeSurface = (currentView === 'home' && !isPanelOpen) || keepsHomeForHandoff;

    return {
        shouldKeepHomeMounted,
        shouldShowHomeSurface,
        shouldRevealHomeSurface,
    };
};
