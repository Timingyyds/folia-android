// src/ui/wall/wallView.ts

import type { Bounds } from './layout';

// Viewport <-> world conversions for the fixed-world wall. The pure geometry here talks about the
// world point under the seam line (the "view centre"); the DOM camera is a translation plus scale.

export type WallView = {
    /** Viewport size in screen px. */
    width: number;
    height: number;
    scale: number;
    /** Screen x of the seam's base line; the viewport's horizontal middle when omitted. */
    lineX?: number;
};

export type WallViewCenter = { x: number; y: number };

/** Same shape as the wall's DOM camera: `screen = camera + world * scale`. */
export type WallViewCamera = { x: number; y: number; scale: number };

export const getViewLineX = (view: WallView) => view.lineX ?? view.width / 2;

export const viewCenterFromCamera = (camera: WallViewCamera, view: WallView): WallViewCenter => ({
    x: (getViewLineX(view) - camera.x) / camera.scale,
    y: (view.height / 2 - camera.y) / camera.scale,
});

export const cameraFromViewCenter = (center: WallViewCenter, view: WallView): WallViewCamera => ({
    x: getViewLineX(view) - center.x * view.scale,
    y: view.height / 2 - center.y * view.scale,
    scale: view.scale,
});

/**
 * World rect on screen around a view centre. An open seam pushes the two halves apart, so the
 * horizontal span is widened by the seam width on both sides (as the prototype's culling does).
 */
export const getViewWorldBounds = (
    center: WallViewCenter,
    view: WallView,
    { seamWidth = 0, overscan = 0 }: { seamWidth?: number; overscan?: number } = {},
): Bounds => {
    const lineX = getViewLineX(view);
    return {
        left: center.x - (lineX + seamWidth) / view.scale - overscan,
        right: center.x + (view.width - lineX + seamWidth) / view.scale + overscan,
        top: center.y - view.height / 2 / view.scale - overscan,
        bottom: center.y + view.height / 2 / view.scale + overscan,
    };
};
