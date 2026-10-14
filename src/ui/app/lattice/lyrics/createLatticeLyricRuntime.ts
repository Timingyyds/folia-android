import { cubicBezier } from 'framer-motion';
import { loadPixi } from '../../../visualizer/loadPixi';
import { clearMonetMeasurementCaches, type MonetVisibleLineEntry } from '../../../visualizer/monet/monetLyricsModel';
import { MONET_SCROLL_SPRING, MONET_SCALE_SPRING, resolveMonetTone } from '../../../visualizer/monet/monetLyricMotion';
import { createLatticeRaster } from './latticeLyricRaster';
import { layoutLatticeLine, resolveLatticeTypography, resolveLatticeLongLineOffset } from './latticeLyricLayout';
import { createLatticeLineView, type LatticeLineView } from './latticeLyricScene';
import { createLatticeEdgeFilter } from './latticeLyricFilters';
import { createLatticeTimeline, stepLatticeSpring } from './latticeLyricTimeline';
import { createLatticeLyricFrameLoop } from './latticeLyricFrameLoop';
import type { LatticeLyricInput, LatticeLyricRuntime } from './types';
import { resolveSingleTrackSubtitleMode } from '../../../../lib/lyrics/alternateText';

// src/ui/app/lattice/lyrics/createLatticeLyricRuntime.ts
interface Track { view: LatticeLineView; y: number; vy: number; scale: number; vs: number;
    alpha: number; blur: number; fromAlpha: number; fromBlur: number; elapsed: number;
    status: MonetVisibleLineEntry['status']; offset: number; leaving: boolean; }
const ease = cubicBezier(0.32, 0.72, 0, 1);
let initialization: Promise<unknown> = Promise.resolve();

/**
 * Device pixels per CSS pixel the canvas, its filter passes and its glyph textures are rendered at.
 *
 * Tied to the screen rather than fixed at 2: on a 1x display a fixed 2 pushed four times the
 * pixels the screen could show through every blur and edge pass per frame. Always a whole number:
 * the card is composited at camera scale, so a fractional ratio (4K at 125-175%) leaves too little
 * supersampling for that downscale and visibly softens glyph edges. Capped at 2 so a denser screen
 * never costs more than before.
 */
export const latticeLyricResolution = (devicePixelRatio: number) =>
    Math.min(2, Math.max(1, Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? Math.ceil(devicePixelRatio) : 1));

/**
 * 卡顿治理：建行（逐字素测量 + 排版）与建片（建 canvas → fillText → 建 Pixi 纹理 → 上传）
 * 都在 rAF 回调里同步执行。一行长歌词或刚打开卡片时几十个片同时进入视野，一帧内全做完就是
 * 几百毫秒的阻塞（现场 LoAF：FrameRequestCallback 脚本 198ms / 阻塞 150ms / 样式布局 0ms）。
 * 按预算分摊到后续帧：当前行优先，相邻行与剩下的片下一帧补上，视觉上只是晚一两帧出现。
 */
export const LATTICE_NEW_LINES_PER_FRAME = 1;
export const LATTICE_NEW_PIECES_PER_FRAME = 3;

// Passing boolean `true` makes Pixi release module-global pools shared with the Player renderer.
const destroyApplication = (app: import('pixi.js').Application) => {
    app.destroy({ removeView: true }, { children: true });
};

/** Serializes creation so a canceled async mount cannot temporarily allocate a second WebGL context. */
export function createLatticeLyricRuntime(host: HTMLElement, initial: LatticeLyricInput,
    signal: AbortSignal, onError: (error: unknown) => void): Promise<LatticeLyricRuntime | null> {
    const pending = initialization.then(() => initialize(host, initial, signal, onError));
    initialization = pending.catch(() => undefined);
    return pending;
}

async function initialize(host: HTMLElement, initial: LatticeLyricInput, signal: AbortSignal,
    onError: (error: unknown) => void): Promise<LatticeLyricRuntime | null> {
    const pixi = await loadPixi();
    if (signal.aborted) return null;
    const app = new pixi.Application();
    try { await app.init({ preference: 'webgl', backgroundAlpha: 0, antialias: true,
        width: 1, height: 1, resolution: latticeLyricResolution(window.devicePixelRatio), autoDensity: true, autoStart: false, sharedTicker: false }); }
    catch (error) {
        if (app.renderer) destroyApplication(app);
        else { app.ticker?.destroy(); app.stage.destroy({ children: true }); }
        throw error;
    }
    if (signal.aborted) { destroyApplication(app); return null; }
    try { return attachRuntime(pixi, app, host, initial, onError); }
    catch (error) { destroyApplication(app); throw error; }
}

/** Attaches a successfully initialized renderer; failures above this boundary release the WebGL context. */
function attachRuntime(pixi: typeof import('pixi.js'), app: import('pixi.js').Application, host: HTMLElement,
    initial: LatticeLyricInput, onError: (error: unknown) => void): LatticeLyricRuntime {
    const raster = createLatticeRaster(pixi);
    let input = initial, width = 1, height = 1, resolution = app.renderer.resolution, destroyed = false;
    let reportError = onError;
    let typography = resolveLatticeTypography(input, width, height, raster.measure);
    const stage = new pixi.Container(); stage.sortableChildren = true; app.stage.addChild(stage);
    const edge = createLatticeEdgeFilter(pixi, resolution); stage.filters = [edge.filter];
    host.appendChild(app.canvas); app.canvas.setAttribute('aria-hidden', 'true');
    let timeline = createLatticeTimeline(input.lines), lastTime = input.currentTime.get();
    let lastEntries: MonetVisibleLineEntry[] | null = null;
    // 上一帧还有行/片没建完时保持为 true：帧循环据此继续唤醒，直到补完。
    let pendingRefresh = false;
    const tracks = new Map<string, Track>();
    const clear = () => { tracks.forEach(track => track.view.destroy()); tracks.clear(); lastEntries = null; pendingRefresh = false; };
    const refreshEntries = (entries: MonetVisibleLineEntry[], budget: { lines: number }): boolean => {
        for (const track of tracks.values()) {
            track.leaving = true; track.fromAlpha = track.alpha; track.fromBlur = track.blur; track.elapsed = 0;
        }
        // 当前行（offset 0）先建：它是用户此刻在读的那一行，相邻行可以晚一两帧。
        const ordered = entries.length > 1
            ? [...entries].sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset))
            : entries;
        let pending = false;
        for (const entry of ordered) {
            let track = tracks.get(entry.key);
            if (!track) {
                if (budget.lines <= 0) { pending = true; continue; }
                budget.lines -= 1;
                // Lattice draws the translation row inside its own lyric scene, not the shared bottom subtitle, so it
                // cannot stack two rows yet: the 'both' option falls back to translation only (phase 2 will add a track).
                const layout = layoutLatticeLine(entry.line, typography, Math.max(1, width - typography.padding * 2), raster.measure,
                    resolveSingleTrackSubtitleMode(input.subtitleContentMode ?? 'translation') === 'romanization');
                const view = createLatticeLineView(pixi, raster, stage, entry, layout, typography, input, resolution);
                track = { view, y: height * 0.46 + (entry.offset >= 0 ? 34 : -34), vy: 0, scale: 0.7, vs: 0,
                    alpha: 0, blur: 5, fromAlpha: 0, fromBlur: 5, elapsed: 0, status: entry.status, offset: entry.offset, leaving: false };
                tracks.set(entry.key, track);
            }
            track.status = entry.status; track.offset = entry.offset; track.leaving = false;
        }
        // Rapid seeks must not accumulate fading copies of every visited line.
        for (const [key, track] of tracks) if (track.leaving && tracks.size > 5) { track.view.destroy(); tracks.delete(key); }
        return pending;
    };
    const draw = (delta: number) => {
        try {
            if (destroyed || width < 2 || height < 2) return false;
            const time = input.currentTime.get(), quiet = Boolean(input.reducedMotion || input.staticMode);
            if (time < lastTime || Math.abs(time - lastTime) > 0.75) clear();
            lastTime = time;
            const entries = timeline(time);
            if (entries !== lastEntries) { lastEntries = entries; pendingRefresh = true; }
            if (pendingRefresh) pendingRefresh = refreshEntries(entries, { lines: LATTICE_NEW_LINES_PER_FRAME });
            const pieceBudget = { remaining: LATTICE_NEW_PIECES_PER_FRAME };
            let piecesPending = false;
            const anchor = entries.find(e => e.offset === 0);
            const anchorTrack = anchor ? tracks.get(anchor.key) : undefined;
            const room = Math.max(typography.lineHeight, height - typography.padding * 2);
            const activeHeight = anchorTrack ? Math.min(room, anchorTrack.status === 'active' ? anchorTrack.view.layout.height
                : Math.min(anchorTrack.view.layout.textHeight, typography.lineHeight * 2) * resolveMonetTone(anchorTrack.status, 0).scale) : 0;
            const anchorY = Math.max(typography.padding, height * 0.46 - activeHeight / 2);
            let moving = false;
            for (const [key, track] of tracks) {
                const tone = resolveMonetTone(track.status, track.offset);
                const contextHeight = Math.min(track.view.layout.textHeight, typography.lineHeight * 2);
                const gap = Math.max(18, typography.fontPx * 0.49);
                let targetY = track.offset < 0 ? anchorY - contextHeight * tone.scale - gap
                    : track.offset > 0 ? anchorY + activeHeight + gap : anchorY;
                if (track.offset === 0 && track.status === 'active') targetY -= resolveLatticeLongLineOffset(track.view.layout, time, room, typography.lineHeight);
                if (track.leaving) targetY += track.offset < 0 || track.status === 'passed' ? -38 : 38;
                const sy = stepLatticeSpring(track.y, track.vy, targetY, delta, MONET_SCROLL_SPRING);
                const ss = stepLatticeSpring(track.scale, track.vs, tone.scale, delta, MONET_SCALE_SPRING);
                track.y = quiet ? targetY : sy.value; track.vy = quiet ? 0 : sy.velocity;
                track.scale = quiet ? tone.scale : ss.value; track.vs = quiet ? 0 : ss.velocity;
                track.elapsed += delta;
                const targetAlpha = track.leaving ? 0 : tone.alpha;
                const fade = quiet ? 1 : ease(Math.min(1, track.elapsed / 0.28));
                const blurFade = quiet ? 1 : ease(Math.min(1, track.elapsed / 0.32));
                track.alpha = track.fromAlpha + (targetAlpha - track.fromAlpha) * fade;
                track.blur = track.fromBlur + (tone.blur - track.fromBlur) * blurFade;
                if (track.leaving && fade === 1) { track.view.destroy(); tracks.delete(key); continue; }
                moving ||= !quiet && (!sy.settled || !ss.settled || track.elapsed < 0.32);
                track.view.container.position.set(typography.padding, track.y);
                track.view.container.scale.set(track.scale); track.view.container.alpha = track.alpha;
                track.view.container.zIndex = track.status === 'active' ? 4 : track.status === 'waiting' ? 2 : 1;
                track.view.blur.strength = quiet ? 0 : track.blur;
                track.view.blur.enabled = !quiet && track.blur > 0.05;
                piecesPending ||= track.view.update(
                    time, track.status, tone.baseAlpha, height, track.y, track.scale, quiet, pieceBudget,
                );
            }
            app.render();
            return moving || pendingRefresh || piecesPending;
        } catch (error) { reportError(error); return false; }
    };
    const loop = createLatticeLyricFrameLoop(draw);
    let unsubscribe = input.currentTime.on('change', loop.wake);
    const runtime: LatticeLyricRuntime = {
        attach(nextHost) {
            if (!destroyed && app.canvas.parentElement !== nextHost) nextHost.appendChild(app.canvas);
        },
        setErrorHandler(handler) { reportError = handler; },
        update(next) {
            if (destroyed) return;
            const rebuild = next.songKey !== input.songKey || next.lines !== input.lines || next.theme !== input.theme
                || next.subtitleTheme !== input.subtitleTheme || next.fontsEpoch !== input.fontsEpoch
                || next.keywordColoringEnabled !== input.keywordColoringEnabled || next.showSubtitleTranslation !== input.showSubtitleTranslation
                || next.hideTranslationSubtitle !== input.hideTranslationSubtitle || next.subtitleContentMode !== input.subtitleContentMode;
            if (next.currentTime !== input.currentTime) { unsubscribe(); unsubscribe = next.currentTime.on('change', loop.wake); }
            if (next.fontsEpoch !== input.fontsEpoch) { clearMonetMeasurementCaches(); raster.clearMeasureCache(); }
            input = next;
            if (rebuild) { clear(); timeline = createLatticeTimeline(input.lines); typography = resolveLatticeTypography(input, width, height, raster.measure); }
            loop.wake();
        },
        resize(w, h, devicePixelRatio) {
            const nextResolution = latticeLyricResolution(devicePixelRatio);
            if (destroyed || (w === width && h === height && nextResolution === resolution)) return;
            width = w; height = h; resolution = nextResolution;
            app.renderer.resize(Math.max(1, width), Math.max(1, height), resolution);
            edge.filter.resolution = resolution;
            stage.filterArea = new pixi.Rectangle(0, 0, width, height);
            typography = resolveLatticeTypography(input, width, height, raster.measure);
            clear(); loop.wake();
        },
        setVisible(visible) { loop.setVisible(visible); },
        destroy() {
            if (destroyed) return;
            destroyed = true; unsubscribe(); loop.destroy(); clear(); edge.filter.destroy(); destroyApplication(app);
        },
    };
    return runtime;
}
