import React, { useEffect, useMemo, useRef } from 'react';
import type { MotionValue } from 'framer-motion';
import { colorWithAlpha } from '../colorMix';
import { drawPendoloClockwork2d } from './pendoloClockworkDraw2d';
import {
    createPendoloClockworkMotionState,
    stepPendoloClockworkMotion,
} from './pendoloClockworkMotion';
import type { PendoloMotionProfile } from './pendoloMotionProfile';
import {
    resolvePendoloClockworkBox,
    type PendoloClockworkFrameInput,
    type PendoloGearDecorMode,
} from './pendoloClockworkScene';
import { PendoloClockworkRenderer } from './pendoloClockworkWebGL';

// src/ui/visualizer/pendolo/PendoloClockworkCanvas.tsx

export interface PendoloClockworkCanvasProps {
    centerX: number;
    centerY: number;
    viewportWidth: number;
    viewportHeight: number;
    baseRadius: number;
    lyricRingRadius: number;
    escapementAngleMotionValue: MotionValue<number>;
    audioBassMotionValue?: MotionValue<number>;
    audioBass?: number;
    primaryTextColor: string;
    accentTextColor: string;
    backgroundColor?: string;
    showGearDecor: PendoloGearDecorMode;
    showCenterGradient?: boolean;
    showCover?: boolean;
    coverUrl?: string | null;
    enableLineGlow?: boolean;
    paused?: boolean;
    motionProfile: PendoloMotionProfile;
}

/**
 * PendoloClockworkCanvas: Renders dynamic wireframe clockwork gear train background.
 * PendoloClockworkCanvas: Wireframe clockwork gear train.
 * Prefers WebGL2; falls back to Canvas2D when unavailable.
 */
const PendoloClockworkCanvas: React.FC<PendoloClockworkCanvasProps> = ({
    centerX,
    centerY,
    viewportWidth,
    viewportHeight,
    baseRadius,
    lyricRingRadius,
    escapementAngleMotionValue,
    audioBassMotionValue,
    audioBass = 0.18,
    primaryTextColor,
    accentTextColor,
    backgroundColor = '#000000',
    showGearDecor,
    showCenterGradient = true,
    showCover = false,
    coverUrl = null,
    enableLineGlow = false,
    paused = false,
    motionProfile,
}) => {
    const webglCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const canvas2dRef = useRef<HTMLCanvasElement | null>(null);
    const rendererRef = useRef<PendoloClockworkRenderer | null>(null);
    const useWebglRef = useRef(false);
    const motionStateRef = useRef(createPendoloClockworkMotionState());
    const lastTimestampRef = useRef<number | null>(null);
    const coverImageRef = useRef<HTMLImageElement | null>(null);

    // The canvases cover only the clockwork, not the viewport; everything is drawn relative to
    // the box, so the frame's centre is shifted by its offset.
    const contentBox = useMemo(
        () => resolvePendoloClockworkBox(
            centerX,
            centerY,
            baseRadius,
            lyricRingRadius,
            viewportWidth,
            viewportHeight,
            showCenterGradient,
        ),
        [baseRadius, centerX, centerY, lyricRingRadius, showCenterGradient, viewportHeight, viewportWidth],
    );

    const propsRef = useRef({
        contentBox,
        centerX,
        centerY,
        baseRadius,
        lyricRingRadius,
        audioBass,
        primaryTextColor,
        accentTextColor,
        backgroundColor,
        showGearDecor,
        showCenterGradient,
        showCover,
        coverUrl,
        enableLineGlow,
        paused,
        motionProfile,
    });

    useEffect(() => {
        propsRef.current = {
            contentBox,
            centerX,
            centerY,
            baseRadius,
            lyricRingRadius,
            audioBass,
            primaryTextColor,
            accentTextColor,
            backgroundColor,
            showGearDecor,
            showCenterGradient,
            showCover,
            coverUrl,
            enableLineGlow,
            paused,
            motionProfile,
        };
    }, [
        contentBox, centerX, centerY, baseRadius, lyricRingRadius, audioBass,
        primaryTextColor, accentTextColor, backgroundColor, showGearDecor,
        showCenterGradient, showCover, coverUrl, enableLineGlow, paused, motionProfile,
    ]);

    useEffect(() => {
        // The previous song's cover must not stay on screen (or be uploaded under the new song)
        // while the new one loads.
        coverImageRef.current = null;
        if (!showCover || !coverUrl) return undefined;
        let cancelled = false;
        let img: HTMLImageElement | null = null;
        // CORS first, like the other cover consumers: WebGL cannot upload a tainted image. A
        // host without CORS headers still gets a plain load, which the Canvas2D path can draw.
        const load = (crossOrigin: boolean) => {
            const next = new Image();
            if (crossOrigin) next.crossOrigin = 'anonymous';
            next.onload = () => {
                if (!cancelled) coverImageRef.current = next;
            };
            next.onerror = () => {
                if (cancelled) return;
                if (crossOrigin) load(false);
                else coverImageRef.current = null;
            };
            next.src = coverUrl;
            img = next;
        };
        load(true);
        return () => {
            cancelled = true;
            if (img) {
                img.onload = null;
                img.onerror = null;
            }
        };
    }, [coverUrl, showCover]);

    useEffect(() => {
        const webglCanvas = webglCanvasRef.current;
        // A renderer belongs to one canvas. Turning every layer off unmounts the canvases, and
        // turning one back on mounts new ones, so a renderer for any other canvas is dropped.
        if (rendererRef.current && rendererRef.current.canvas !== webglCanvas) {
            rendererRef.current.release();
            rendererRef.current = null;
            useWebglRef.current = false;
        }
        if (showGearDecor === 'none' && !showCenterGradient && !showCover) return undefined;

        const attachRenderer = () => {
            if (!webglCanvas || rendererRef.current) return;
            const created = new PendoloClockworkRenderer(webglCanvas);
            if (created.isReady) {
                rendererRef.current = created;
                useWebglRef.current = true;
                if (canvas2dRef.current) canvas2dRef.current.style.visibility = 'hidden';
            } else {
                created.release();
                useWebglRef.current = false;
                webglCanvas.style.visibility = 'hidden';
                if (canvas2dRef.current) canvas2dRef.current.style.visibility = 'visible';
            }
        };
        attachRenderer();

        // A lost context (GPU reset, driver update, too many contexts) draws with Canvas2D until
        // the browser restores it; preventDefault is what allows the restore.
        const handleContextLost = (event: Event) => {
            event.preventDefault();
            rendererRef.current?.dispose();
            rendererRef.current = null;
            useWebglRef.current = false;
        };
        const handleContextRestored = () => attachRenderer();
        webglCanvas?.addEventListener('webglcontextlost', handleContextLost);
        webglCanvas?.addEventListener('webglcontextrestored', handleContextRestored);

        let animationFrameId = 0;

        const render = (timestamp: number) => {
            const p = propsRef.current;
            if (p.showGearDecor === 'none' && !p.showCenterGradient && !p.showCover) return;

            if (lastTimestampRef.current === null) {
                lastTimestampRef.current = timestamp;
            }
            const dt = Math.min((timestamp - lastTimestampRef.current) / 1000, 0.05);
            lastTimestampRef.current = timestamp;

            const rawBass = audioBassMotionValue ? audioBassMotionValue.get() : p.audioBass;
            const motion = stepPendoloClockworkMotion(
                motionStateRef.current,
                dt,
                rawBass,
                p.paused,
                p.motionProfile,
            );
            // 2. Main gear wheel angle is strictly tied to lyric line ratchet steps
            // Gears remain stationary while a line is being sung, and ratchet ONLY when lyrics switch
            const escapementAngle = escapementAngleMotionValue.get();

            const box = p.contentBox;
            const frame: PendoloClockworkFrameInput = {
                centerX: p.centerX - box.left,
                centerY: p.centerY - box.top,
                baseRadius: p.baseRadius,
                lyricRingRadius: p.lyricRingRadius,
                escapementAngle,
                phase: motion.phase,
                bassOscillation: motion.bassOscillation,
                secondGearAngle: motion.secondGearAngle,
                primaryTextColor: p.primaryTextColor,
                accentTextColor: p.accentTextColor,
                backgroundColor: p.backgroundColor || '#000000',
                showGearDecor: p.showGearDecor,
                showCenterGradient: p.showCenterGradient,
                showCover: p.showCover,
                coverImage: coverImageRef.current,
            };

            const width = box.width;
            const height = box.height;
            if (width <= 0 || height <= 0) {
                animationFrameId = window.requestAnimationFrame(render);
                return;
            }
            const dpr = window.devicePixelRatio || 1;

            const renderer = rendererRef.current;
            if (useWebglRef.current && !renderer?.isReady) useWebglRef.current = false;
            // WebGL cannot upload a cover served without CORS headers, so frames that show such
            // a cover are drawn with Canvas2D, which can. The renderer stays attached.
            const coverNeeds2d = Boolean(
                frame.showCover && renderer?.isCoverRejected(frame.coverImage),
            );

            if (useWebglRef.current && renderer && !coverNeeds2d) {
                if (webglCanvasRef.current) webglCanvasRef.current.style.visibility = 'visible';
                if (canvas2dRef.current) canvas2dRef.current.style.visibility = 'hidden';
                // Glow comes from the same CSS drop-shadow as Canvas2D, so both backends match.
                renderer.draw({
                    input: frame,
                    cssWidth: width,
                    cssHeight: height,
                    dpr,
                });
            } else {
                if (webglCanvasRef.current) webglCanvasRef.current.style.visibility = 'hidden';
                const canvas = canvas2dRef.current;
                if (!canvas) {
                    animationFrameId = window.requestAnimationFrame(render);
                    return;
                }
                canvas.style.visibility = 'visible';
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    animationFrameId = window.requestAnimationFrame(render);
                    return;
                }
                const pixelWidth = Math.round(width * dpr);
                const pixelHeight = Math.round(height * dpr);
                if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
                    canvas.width = pixelWidth;
                    canvas.height = pixelHeight;
                }
                ctx.save();
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                ctx.clearRect(0, 0, width, height);
                drawPendoloClockwork2d(ctx, frame);
                ctx.restore();
            }

            animationFrameId = window.requestAnimationFrame(render);
        };

        animationFrameId = window.requestAnimationFrame(render);

        return () => {
            if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
            webglCanvas?.removeEventListener('webglcontextlost', handleContextLost);
            webglCanvas?.removeEventListener('webglcontextrestored', handleContextRestored);
        };
    }, [showGearDecor, showCenterGradient, showCover, audioBassMotionValue, escapementAngleMotionValue]);

    useEffect(() => () => {
        rendererRef.current?.release();
        rendererRef.current = null;
    }, []);

    if (showGearDecor === 'none' && !showCenterGradient && !showCover) {
        return null;
    }

    const canvasClass = 'absolute inset-0 w-full h-full pointer-events-none';
    const boxStyle: React.CSSProperties = {
        left: `${contentBox.left}px`,
        top: `${contentBox.top}px`,
        width: `${contentBox.width}px`,
        height: `${contentBox.height}px`,
        zIndex: 1,
    };
    // Same CSS glow on both backends so WebGL/Canvas2D luminance stays aligned.
    const lineGlow = enableLineGlow
        ? `drop-shadow(0 0 4px ${colorWithAlpha(accentTextColor, 0.65)}) drop-shadow(0 0 12px ${colorWithAlpha(accentTextColor, 0.3)})`
        : undefined;

    return (
        <div className="absolute pointer-events-none" style={boxStyle}>
            <canvas
                ref={webglCanvasRef}
                className={canvasClass}
                style={{ filter: lineGlow }}
                aria-hidden="true"
            />
            <canvas
                ref={canvas2dRef}
                className={canvasClass}
                style={{ visibility: 'hidden', filter: lineGlow }}
                aria-hidden="true"
            />
        </div>
    );
};

export default PendoloClockworkCanvas;
