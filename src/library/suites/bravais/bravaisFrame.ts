import { getSeamGeometry, getSeamSplitOffsets } from '../../../ui/wall/seamPlan';
import { cameraFromViewCenter, type WallView, type WallViewCenter } from '../../../ui/wall/wallView';
import { BRAVAIS_METRICS } from './bravaisConstants';

// src/library/suites/bravais/bravaisFrame.ts
// 每一帧要写到 DOM 上的几何（纯计算）：墙的左右两半各自的 transform、缝的屏幕位置与宽度、缝内容的透明度、
// 边缘标签在不在、在哪一侧。缝开在块边界上，没有磁贴跨过它，所以墙按锚点分成左右两个世界层，各自平移让出
// 半个开口（加半个 GAP），不需要裁剪。stage 在相机移动、缝开合时调用它，只写 transform / 尺寸，不经过 React。

export type BravaisFrameInput = {
    center: WallViewCenter;
    view: WallView;
    /** 缝锚点的世界 x；没有层时为 null（墙合拢，没有缝）。 */
    anchorX: number | null;
    /** 此刻（动画中）的目标开口宽度，屏幕 px。 */
    openWidth: number;
    /** 缝里此刻渲染的那套内容的排版宽度（翻转不重排：不跟目标宽度走）。 */
    contentWidth: number;
    /** 折叠等级（hidden）：标签换成悬浮按钮，常驻。 */
    hidden: boolean;
};

export type BravaisFrame = {
    left: { x: number; y: number };
    right: { x: number; y: number };
    scale: number;
    seam: { x: number; width: number; visible: boolean };
    /** 缝内容的透明度：开口比排版宽度窄时随之淡出。 */
    contentOpacity: number;
    /** 边缘标签：自动出屏收起（collapsed）或手动折叠（hidden）时出现。 */
    tab: { visible: boolean; side: 'left' | 'right' };
};

export const computeBravaisFrame = ({ center, view, anchorX, openWidth, contentWidth, hidden }: BravaisFrameInput): BravaisFrame => {
    const camera = cameraFromViewCenter(center, view);
    if (anchorX === null) {
        return {
            left: { x: camera.x, y: camera.y },
            right: { x: camera.x, y: camera.y },
            scale: view.scale,
            seam: { x: view.width / 2, width: 0, visible: false },
            contentOpacity: 0,
            tab: { visible: false, side: 'left' },
        };
    }
    const geometry = getSeamGeometry({ anchorX, cameraX: center.x, openWidth, view });
    const offsets = getSeamSplitOffsets(geometry.width, view.scale, BRAVAIS_METRICS);
    const layoutWidth = Math.max(contentWidth, 1);
    return {
        left: { x: camera.x + offsets.left, y: camera.y },
        right: { x: camera.x + offsets.right, y: camera.y },
        scale: view.scale,
        seam: { x: geometry.screenX, width: geometry.width, visible: geometry.width >= 1 },
        // 原型：(开口 / 排版宽度 − .35) / .65，开到三成五以下就看不见。
        contentOpacity: Math.max(0, Math.min(1, (geometry.width / layoutWidth - 0.35) / 0.65)),
        tab: { visible: hidden || geometry.collapsed, side: geometry.side },
    };
};
