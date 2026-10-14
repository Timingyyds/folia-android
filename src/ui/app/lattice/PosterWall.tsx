import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SongResult } from '../../../types';
import {
    getLatticeGeometry,
    layoutExpandedBlock,
    layoutLattice,
    overlaps,
    toBounds,
    type Bounds,
    type ReflowTile,
    type WallMetrics,
} from '../../wall/layout';
import { useWallCameraPan, type LatticeCamera } from '../../wall/useWallCameraPan';
import { useLatticePosterSelection } from './useLatticePosterSelection';
import { useWallKeyboardFocus } from './useWallKeyboardFocus';
import { useWallPointerPan } from '../../wall/useWallPointerPan';
import type { LatticeTile } from './latticeModel';
import LatticePoster from './LatticePoster';
import { countRender } from '../../../dev/renderCount';
import {
    useLatticePlaybackFocus,
} from './useLatticePlaybackFocus';
import { setLatticeCurrentSongPosterVisible } from '../../../state/useLatticeControlsStore';
import { getPlaybackSongKey } from '../../../lib/appPlaybackGuards';
import { useDevicePixelRatio } from '../../../hooks/useMediaQuery';
import { useReducedMotionFor } from '../../../hooks/useReducedMotionFor';
import { EXPANSION_SPAN } from '../../wall/blockTemplates';
import { useLatticeSettingsStore } from '../../../state/useLatticeSettingsStore';
import { resolveWallHandoffRole, useWallHandoffStore } from '../../../state/useWallHandoffStore';
import { useLatticeWallHandoff } from './useLatticeWallHandoff';

// Draggable poster field: one greedily packed block template repeats over the queue.
// 翻牌交接（设计稿 §7「进入队列」）：从资料库墙进来时不跑自己的入场波次，海报侧立着等资料库墙翻出、再按到起点的距离翻进；
// 回资料库墙时海报按距离翻出（useLatticeWallHandoff）。

type PosterWallProps = {
    tiles: LatticeTile[];
    /** Only for playback focus and visibility tracking; the chrome reads transport state from context. */
    currentSong: SongResult | null;
    onPlay: (tile: LatticeTile) => void;
    onTogglePlayback: () => void;
    onSeek: (time: number) => void;
    onOpenPlayer: () => void;
    onBack: () => void;
};


const CELL_SIZE = 128;
const GAP = 8;
const OVERSCAN = 500;
// 性能优先时的裁剪余量：默认那 500px 是为了让快速拖动不露白，但它同时也是 world 层被重画的面积。
const PERFORMANCE_OVERSCAN = 140;
// How much of the flight path may stay rendered while the camera travels, in viewports.
const MAX_RESERVED_VIEWPORTS = 3;
// Metro tile landing: the wave starts at the top-left of the viewport and runs down the diagonal.
const ENTRANCE_STAGGER = 0.03;
const ENTRANCE_MAX_DELAY = 0.34;
const ENTRANCE_WINDOW = 1100;
const METRICS: WallMetrics = { cellSize: CELL_SIZE, gap: GAP };
// Longest edge a card can reach, which is the gear expansion hands it.
const EXPANDED_SIZE = EXPANSION_SPAN.cols * (CELL_SIZE + GAP) - GAP;


const getScale = (width: number) => width < 640 ? 0.52 : width < 1100 ? 0.64 : 0.76;

const getWorldBounds = (camera: LatticeCamera, viewport: { width: number; height: number }): Bounds => ({
    left: -camera.x / camera.scale,
    top: -camera.y / camera.scale,
    right: (viewport.width - camera.x) / camera.scale,
    bottom: (viewport.height - camera.y) / camera.scale,
});

export default function PosterWall({
    tiles,
    currentSong,
    onPlay,
    onTogglePlayback,
    onSeek,
    onOpenPlayer,
    onBack,
}: PosterWallProps) {
    countRender('PosterWall');
    const containerRef = useRef<HTMLDivElement>(null);
    const worldRef = useRef<HTMLDivElement>(null);
    const cameraRef = useRef<LatticeCamera>({ x: 34, y: 80, scale: 0.76 });
    const viewportRef = useRef({ width: 1280, height: 720 });
    const frameRef = useRef<number | null>(null);
    const trackedCurrentPosterRef = useRef<{
        enabled: boolean;
        rect: Omit<ReflowTile, 'instanceId'> | null;
    }>({ enabled: false, rect: null });
    const currentPosterVisibleRef = useRef(true);
    const [bounds, setBounds] = useState<Bounds>(() => getWorldBounds(cameraRef.current, viewportRef.current));
    // Nothing is drawn until the field reports its size: the seeded camera and the default
    // viewport would otherwise place the entering wave, and the playing song, off centre.
    const [measured, setMeasured] = useState(false);
    const [entranceDone, setEntranceDone] = useState(false);
    // Camera scale, mirrored into state only so posters can size their artwork. It follows the
    // width breakpoints, so this settles after the first measure and then only moves on a resize.
    const [cameraScale, setCameraScale] = useState(() => cameraRef.current.scale);
    const reducedMotion = useReducedMotionFor('lattice');
    // 从资料库墙翻牌交接进来（或淡入交叉）：入场由交接代替，不跑抬起落下的波次。
    const entranceSuppressed = useWallHandoffStore(state => resolveWallHandoffRole(state.session, 'lattice') === 'in');
    const autoFocusOnSongChange = useLatticeSettingsStore(state => state.autoFocusOnSongChange);
    const performanceMode = useLatticeSettingsStore(state => state.latticePerformanceMode);
    const devicePixelRatio = useDevicePixelRatio();
    // 性能优先：封面按世界尺寸取档（而不是设备像素），高 DPR 屏上不再为每张卡解一张大一档的图。
    const pixelScale = performanceMode
        ? Math.min(cameraScale * devicePixelRatio, 1)
        : cameraScale * devicePixelRatio;
    // 相机行程（见 clampFiniteCamera）与裁剪余量都跟着收窄：性能优先时不再无限铺下去。
    const overscan = performanceMode ? PERFORMANCE_OVERSCAN : OVERSCAN;
    const reservedViewports = performanceMode ? 1 : MAX_RESERVED_VIEWPORTS;

    const geometry = useMemo(() => getLatticeGeometry(tiles.length, METRICS), [tiles.length]);
    const [activePoster, setActivePoster] = useLatticePosterSelection(tiles, geometry, METRICS);

    const publishCurrentPosterVisibility = useCallback((camera: LatticeCamera) => {
        const tracked = trackedCurrentPosterRef.current;
        const visible = !tracked.enabled || Boolean(
            tracked.rect && overlaps(toBounds(tracked.rect), getWorldBounds(camera, viewportRef.current)),
        );
        if (currentPosterVisibleRef.current === visible) return;
        currentPosterVisibleRef.current = visible;
        setLatticeCurrentSongPosterVisible(visible);
    }, []);

    const applyCamera = useCallback((next: LatticeCamera, updateBounds = false) => {
        cameraRef.current = next;
        if (worldRef.current) {
            /*
             * 相机用**二维** transform，不要用 translate3d。
             *
             * translate3d 会把整面墙提成常驻合成层，而 world 的实际 bounds 是
             * 12212x11580（受限的另一头）—— 任何一张磁贴在这个层里 repaint，
             * 都要按这个尺寸重新栅格化一遍 tile。桌面 GPU 撑得住，
             * Android WebView 的合成器面对超限层会反复丢弃重建，用户看到的就是
             * 「选歌时整屏闪烁」。实测 Trajectory：world 层整屏级 paint 6~10 次/次选歌，
             * 改成二维 transform 之后降到 0 —— 层不再存在，重绘被 `.lattice-field`
             * 的 paint containment 裁在保证可见的那一小块里。
             *
             * 平移本身不受影响：2D transform 同样可以被合成器处理，
             * pan 期间 Chromium 会临时提层，pan 结束自动降级。
             */
            worldRef.current.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.scale})`;
        }
        publishCurrentPosterVisibility(next);
        if (!updateBounds || frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
            setBounds(getWorldBounds(cameraRef.current, viewportRef.current));
            frameRef.current = null;
        });
    }, [publishCurrentPosterVisibility]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const observer = new ResizeObserver(([entry]) => {
            viewportRef.current = { width: entry.contentRect.width, height: entry.contentRect.height };
            const scale = getScale(entry.contentRect.width);
            applyCamera({ ...cameraRef.current, scale }, true);
            setCameraScale(previous => previous === scale ? previous : scale);
            setMeasured(true);
        });
        observer.observe(container);
        return () => {
            observer.disconnect();
            if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
        };
    }, [applyCamera]);

    // Widens the culled region to cover a pan's destination the moment it starts. Held arrow
    // keys interrupt each pan before it settles, so bounds cannot wait for the animation to end.
    const reserveBounds = useCallback((camera: LatticeCamera) => {
        const destination = getWorldBounds(camera, viewportRef.current);
        setBounds(current => {
            const covered = destination.left >= current.left && destination.right <= current.right
                && destination.top >= current.top && destination.bottom <= current.bottom;
            if (covered) return current;

            const merged = {
                left: Math.min(current.left, destination.left),
                right: Math.max(current.right, destination.right),
                top: Math.min(current.top, destination.top),
                bottom: Math.max(current.bottom, destination.bottom),
            };
            // A long flight would otherwise reserve more than the render cap can fill, which
            // empties the far end; past that point only the destination is worth keeping.
            const mergedArea = (merged.right - merged.left) * (merged.bottom - merged.top);
            const destinationArea = (destination.right - destination.left)
                * (destination.bottom - destination.top);
            return mergedArea > destinationArea * reservedViewports ? destination : merged;
        });
    }, [reservedViewports]);

    /**
     * 性能优先：把相机拴在「一个格子 + 一屏余量」的框里，拖到底就停住，不再无限铺下去
     * （world 层的 bounds 因此始终在一屏上下，而不是用户拖到哪就长到哪）。
     * 只用在拖动 / 滚轮 / 惯性上：键盘与播放跟随（panTo）要能把任意一张卡带到眼前；它们真把相机带出框外时，
     * 框会把当前视口并进去一起放宽，所以下一次拖动不会被拽回来。
     */
    const clampFiniteCamera = useCallback((camera: LatticeCamera): LatticeCamera => {
        if (!performanceMode) return camera;
        const viewport = viewportRef.current;
        const marginX = viewport.width / camera.scale;
        const marginY = viewport.height / camera.scale;
        const visible = getWorldBounds(camera, viewport);
        const range = {
            left: Math.min(-marginX, visible.left - marginX),
            right: Math.max(geometry.cellWidth + marginX, visible.right + marginX),
            top: Math.min(-marginY, visible.top - marginY),
            bottom: Math.max(geometry.cellHeight + marginY, visible.bottom + marginY),
        };
        const minX = viewport.width - range.right * camera.scale;
        const maxX = -range.left * camera.scale;
        const minY = viewport.height - range.bottom * camera.scale;
        const maxY = -range.top * camera.scale;
        return {
            ...camera,
            x: minX > maxX ? camera.x : Math.min(maxX, Math.max(minX, camera.x)),
            y: minY > maxY ? camera.y : Math.min(maxY, Math.max(minY, camera.y)),
        };
    }, [geometry.cellHeight, geometry.cellWidth, performanceMode]);

    const { panTo, stopPan, animationRef } = useWallCameraPan({ cameraRef, viewportRef, reducedMotion, applyCamera, reserveBounds });

    useEffect(() => {
        if (!measured || entranceDone) return;
        if (reducedMotion || entranceSuppressed) {
            setEntranceDone(true);
            return;
        }
        const timer = setTimeout(() => setEntranceDone(true), ENTRANCE_WINDOW);
        return () => clearTimeout(timer);
    }, [entranceDone, entranceSuppressed, measured, reducedMotion]);

    // Posters landing in the opening wave are held back by their distance from that corner; once
    // the wave is over every poster mounts in place, so panning never replays it.
    const getEntranceDelay = useCallback((rect: { x: number; y: number }) => {
        if (entranceDone || reducedMotion || entranceSuppressed) return null;
        const steps = Math.max(0, rect.x - bounds.left) + Math.max(0, rect.y - bounds.top);
        return Math.min(ENTRANCE_MAX_DELAY, (steps / (CELL_SIZE + GAP)) * ENTRANCE_STAGGER);
    }, [bounds.left, bounds.top, entranceDone, entranceSuppressed, reducedMotion]);

    // The entry wave reaches the top-left first; leaving reverses that order while cards retrace
    // their upward flight, so the wall empties back toward the corner it entered from.
    //
    // Permanently identified, and reading the corner it measures from through a ref, because the
    // posters hold this across camera moves. A delay computed per render would have to be handed
    // down as a changing number, and the corner moves with every pan - which defeated
    // LatticePoster's memo and re-rendered every mounted card on each re-cull. The card calls this
    // when it actually leaves, so the wave is still measured against the corner of the moment.
    const exitWaveRef = useRef({ bounds, reducedMotion });
    exitWaveRef.current = { bounds, reducedMotion };
    const getExitDelay = useCallback((rect: { x: number; y: number }) => {
        const { bounds: corner, reducedMotion: reduced } = exitWaveRef.current;
        if (reduced) return 0;
        const steps = Math.max(0, rect.x - corner.left) + Math.max(0, rect.y - corner.top);
        const entranceDelay = Math.min(ENTRANCE_MAX_DELAY, (steps / (CELL_SIZE + GAP)) * ENTRANCE_STAGGER);
        return ENTRANCE_MAX_DELAY - entranceDelay;
    }, []);

    const instances = useMemo(() => {
        if (!measured) return [];
        const visible = layoutLattice(geometry, tiles.length, bounds, overscan, METRICS);
        if (!activePoster || visible.some(instance => instance.instanceId === activePoster.instance.instanceId)) {
            return visible;
        }
        return [...visible, activePoster.instance];
    }, [activePoster, bounds, geometry, measured, overscan, tiles.length]);

    // Only changes when the mounted instance set changes, not on every camera frame.
    const renderedInstanceIds = useMemo(
        () => new Set(instances.map(instance => instance.instanceId)),
        [instances],
    );

    // World point the viewport is centred on; both the keyboard seed and playback follow need it.
    const getViewportCenter = useCallback(() => {
        const camera = cameraRef.current;
        const viewport = viewportRef.current;
        return {
            x: (viewport.width / 2 - camera.x) / camera.scale,
            y: (viewport.height / 2 - camera.y) / camera.scale,
        };
    }, []);

    const { didDragRef, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture } = useWallPointerPan({
        applyCamera,
        animationRef,
        stopPan,
        containerRef,
        reducedMotion,
        overscan,
        // 性能优先时的相机行程上限（拖动 / 滚轮 / 惯性）；键盘与播放跟随不走这条路。
        clampCamera: clampFiniteCamera,
        bounds,
        cameraRef,
        getWorldBounds,
        viewportRef,
    });

    // Only the block holding the open card is re-geared; every other poster keeps its base rect.
    const layout = useMemo(() => (
        activePoster
            ? layoutExpandedBlock(geometry, tiles.length, activePoster.instance, METRICS)
            : new Map<string, { x: number; y: number; width: number; height: number }>()
    ), [activePoster, geometry, tiles.length]);

    useEffect(() => {
        const currentSongKey = currentSong ? getPlaybackSongKey(currentSong) : null;
        const isTracking = measured && Boolean(currentSongKey);
        const rect = activePoster && activePoster.tile.id === currentSongKey
            ? layout.get(activePoster.instance.instanceId) ?? activePoster.instance
            : null;
        trackedCurrentPosterRef.current = { enabled: isTracking, rect };
        publishCurrentPosterVisibility(cameraRef.current);
    }, [activePoster, currentSong, layout, measured, publishCurrentPosterVisibility]);

    useEffect(() => () => {
        currentPosterVisibleRef.current = true;
        setLatticeCurrentSongPosterVisible(true);
    }, []);

    const { focused, setFocused, handleKeyDown, handleFocusCapture, handleBlurCapture } = useWallKeyboardFocus({
        activePoster,
        containerRef,
        geometry,
        getViewportCenter,
        instances,
        metrics: METRICS,
        panTo,
        rendered: layout,
        setActivePoster,
        tiles,
        worldRef,
        onBack,
    });

    // Permanent identities for the two handlers every poster receives. An arrow per poster is
    // re-created on each wall render, which alone would defeat LatticePoster's memo and put all
    // 50+ poster bodies back on the critical path of every unrelated App re-render.
    const latestWall = useRef({ geometry, instances, tiles });
    latestWall.current = { geometry, instances, tiles };
    const expandPoster = useCallback((instanceId: string) => {
        const { geometry: currentGeometry, instances: currentInstances, tiles: currentTiles } = latestWall.current;
        const instance = currentInstances.find(item => item.instanceId === instanceId);
        const tile = instance ? currentTiles[instance.queueIndex] : undefined;
        if (!instance || !tile) return;
        setFocused(instance);
        setActivePoster({ instance, tile });
        // Expansion reflows both the position and size of the selected slot.
        const expandedRect = layoutExpandedBlock(currentGeometry, currentTiles.length, instance, METRICS).get(instanceId);
        if (expandedRect) panTo(expandedRect);
    }, [panTo, setActivePoster, setFocused]);
    const collapsePoster = useCallback(() => setActivePoster(null), [setActivePoster]);

    useLatticePlaybackFocus({
        currentSong,
        ready: measured,
        tiles,
        activePoster,
        renderedInstanceIds,
        geometry,
        metrics: METRICS,
        getViewportCenter,
        setActivePoster,
        setFocused,
        panTo,
    });
    const currentSongKey = currentSong ? getPlaybackSongKey(currentSong) : null;
    const handoff = useLatticeWallHandoff({
        containerRef,
        cameraRef,
        applyCamera,
        measured,
        metrics: METRICS,
        activePoster,
        layout,
        focused,
        waitingForFocus: autoFocusOnSongChange && !activePoster && currentSongKey !== null
            && tiles.some(tile => tile.id === currentSongKey),
    });
    return (
        <div
            ref={containerRef}
            className="lattice-field"
            tabIndex={-1}
            onKeyDown={handleKeyDown}
            onFocusCapture={handleFocusCapture}
            onBlurCapture={handleBlurCapture}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onLostPointerCapture={event => {
                // Touch transfers implicit capture from the poster to the field when dragging.
                if (event.target === event.currentTarget) onPointerCancel(event);
            }}
            onClickCapture={onClickCapture}
        >
            <div ref={worldRef} className="lattice-world">
                {instances.map(instance => {
                    const tile = tiles[instance.queueIndex];
                    if (!tile) return null;
                    const expanded = activePoster?.instance.instanceId === instance.instanceId;
                    const rect = layout.get(instance.instanceId) ?? instance;
                    return (
                        <LatticePoster
                            key={instance.instanceId}
                            instanceId={instance.instanceId}
                            isFocused={focused?.instanceId === instance.instanceId}
                            tile={tile}
                            rect={rect}
                            gap={METRICS.gap}
                            pixelScale={pixelScale}
                            expandedSize={EXPANDED_SIZE}
                            entranceDelay={getEntranceDelay(rect)}
                            getExitDelay={getExitDelay}
                            handoff={handoff.getPosterHandoff(instance.instanceId, rect)}
                            expanded={expanded}
                            reducedMotion={reducedMotion}
                            didDragRef={didDragRef}
                            onExpand={expandPoster}
                            onPlay={onPlay}
                            onTogglePlayback={onTogglePlayback}
                            onSeek={onSeek}
                            onOpenPlayer={onOpenPlayer}
                        />
                    );
                })}
            </div>

        </div>
    );
}
