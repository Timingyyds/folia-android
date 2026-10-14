import { WallTitle } from '../../wall/WallTitle';
import { lazy, memo, Suspense, useMemo } from 'react';
import { motion, type TransformProperties, type Variants } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useRef, type KeyboardEvent, type MouseEvent, type MutableRefObject, type PointerEvent } from 'react';
import type { ReflowTile } from '../../wall/layout';
import type { LatticeTile } from './latticeModel';
import { useLatticeChromeDisclosure } from './useLatticeChromeDisclosure';
import LatticePlaybackControls from './LatticePlaybackControls';
import { useLatticeExpansionSettled } from './useLatticeExpansionSettled';
import { prewarmLatticeLyrics } from './lyrics/prewarmLatticeLyrics';
import { prewarmWallPosterArtwork, useWallPosterArtwork } from '../../wall/useWallPosterArtwork';
import { countRender } from '../../../dev/renderCount';
import { useLatticeSettingsStore } from '../../../state/useLatticeSettingsStore';
import {
    WALL_HANDOFF_FLIP_IN_MS,
    WALL_HANDOFF_FLIP_OUT_MS,
    WALL_HANDOFF_IN_EASE,
    WALL_HANDOFF_OUT_EASE,
    WALL_HANDOFF_PERSPECTIVE_PX,
} from '../../wall/wallHandoff';
import type { LatticePosterHandoff } from './useLatticeWallHandoff';
import { WALL_REFLOW_CONTROLS_REVEAL } from '../../wall/wallReflowMotion';

// Renders one poster and its expanded Player Chrome controls.
const LatticeLyrics = lazy(() => import('./lyrics/LatticeLyrics'));

type LatticePosterProps = {
    instanceId: string;
    isFocused: boolean;
    tile: LatticeTile;
    rect: Omit<ReflowTile, 'instanceId'>;
    /** Empty world-space distance between neighbouring poster slots. */
    gap: number;
    /** World units to device pixels: the camera's scale times the display's pixel ratio. */
    pixelScale: number;
    /** World-space edge of the gear an expanded card takes, so a press can warm that variant. */
    expandedSize: number;
    /** Seconds this poster waits before dropping into its slot, or null outside the opening wave. */
    entranceDelay: number | null;
    /**
     * Reverse-wave delay for the moment the complete wall leaves the viewport. A function, not a
     * number, because it measures from a corner that moves with the camera: a card is not
     * re-rendered before it leaves, and a number handed down per render would either go stale or
     * re-render every mounted card on each re-cull. Identity must stay stable.
     */
    getExitDelay: (rect: { x: number; y: number }) => number;
    /**
     * 翻牌交接（设计稿 §7「进入队列」）里这张海报的排期：hold = 侧立着等开翻；in / out = 过 delay 秒后翻进 / 翻出半圈；
     * static = 淡入淡出交叉里进来（不跑入场）。不在交接里为 null。同一段里是同一个对象（PosterWall 缓存）。
     */
    handoff: LatticePosterHandoff | null;
    expanded: boolean;
    reducedMotion: boolean | null;
    didDragRef: MutableRefObject<boolean>;
    onExpand: (instanceId: string) => void;
    onPlay: (tile: LatticeTile) => void;
    onTogglePlayback: () => void;
    onSeek: (time: number) => void;
    onOpenPlayer: () => void;
};

// How far above its slot a landing tile starts, in world units.
const ENTRANCE_LIFT = 90;

/**
 * 性能优先时封面最多按这么大取档（ coverUrl.ts 的档位是 256 / 512 / 1024，再往上就是原图）。
 * 展开的那张不压：它是此刻的主角，糊了比多解一张图更碍眼。
 */
const PERFORMANCE_COVER_MAX_PX = 512;

// Resolved at exit time from the card's own `custom`, so the leaving wave reads the live camera.
const LEAVING: Variants = {
    leaving: (resolve: () => { y: number; delay: number }) => {
        const { y, delay } = resolve();
        return { y, opacity: 0, scale: 0.88, scaleX: 1, scaleY: 1,
            transition: { duration: 0.28, delay, ease: [0.4, 0, 1, 1] } };
    },
};

// Lift for the card under the pointer or the wall's keyboard cursor. It scales the whole article,
// which is why it has to run through Framer Motion - Framer owns the inline transform, so CSS
// cannot add to it. Zooming only the artwork inside a fixed frame was tried and abandoned: the wall
// carries a fractional scale, so a card's box sits on fractional device pixels, and a composited
// child snaps to them independently of the card itself. That left a 1px seam of unmasked artwork
// along the card outline on roughly half the frames of every hover. Measured across inset, clip-path
// and opacity-crossfade variants, all of which showed it. Scaling the whole card has no such second
// snapping unit and measured clean, so do NOT reintroduce `will-change` here as an optimization:
// promoting the card is what would give it a layer to misalign against. X and Y use independent
// ratios so every edge grows outward by exactly one layout gap even when its aspect ratio or span differs.

// `tile` and `rect` are rebuilt by the wall's own memos whenever the queue, the selection or the
// camera moves, so comparing them by identity would re-render every poster for values that did not
// change. Every other prop is a scalar, a ref or a permanently-identified callback. Transport state
// is deliberately absent: it reaches the expanded chrome through `LatticeTransportContext`, because
// as a prop it changed on every pause and resume and no comparison here could absorb that.
const sameRect = (a: LatticePosterProps['rect'], b: LatticePosterProps['rect']) => (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
);

const sameTile = (a: LatticeTile, b: LatticeTile) => (
    a.id === b.id && a.queueIndex === b.queueIndex && a.section === b.section
    && a.title === b.title && a.artist === b.artist && a.coverUrl === b.coverUrl && a.song === b.song
);

const arePosterPropsEqual = (previous: LatticePosterProps, next: LatticePosterProps) => {
    for (const key of Object.keys(next) as (keyof LatticePosterProps)[]) {
        if (key === 'tile' || key === 'rect') continue;
        if (!Object.is(previous[key], next[key])) return false;
    }
    return sameTile(previous.tile, next.tile) && sameRect(previous.rect, next.rect);
};

/**
 * 交接翻牌时的 transform：透视要放在平移之后（以海报自己的中心为视点）。Framer 自带的 transformPerspective 排在
 * 最前面，透视中心落在世界原点上，离原点远的海报侧立时会被看成一大块斜着的梯形。不转（rotateY 为 0）时原样返回
 * Framer 生成的那一串——交接以外 transform 里没有 3D 项。
 */
const handoffTransform = (transform: TransformProperties, generated: string) => {
    const rotate = transform.rotateY;
    if (rotate === undefined || parseFloat(String(rotate)) === 0) return generated;
    const length = (value: unknown) => (value === undefined ? '0px' : typeof value === 'number' ? `${value}px` : String(value));
    const factor = (value: unknown) => (value === undefined ? '1' : String(value));
    return `translateX(${length(transform.x)}) translateY(${length(transform.y)}) perspective(${WALL_HANDOFF_PERSPECTIVE_PX}px) `
        + `scale(${factor(transform.scale)}) scaleX(${factor(transform.scaleX)}) scaleY(${factor(transform.scaleY)}) `
        + `rotateY(${typeof rotate === 'number' ? `${rotate}deg` : String(rotate)})`;
};

const fallbackBackground = (id: string) => {
    const hue = [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 360;
    return `linear-gradient(145deg, hsl(${hue} 68% 58%), hsl(${(hue + 52) % 360} 62% 18%))`;
};

function LatticePoster({
    instanceId,
    isFocused,
    tile,
    rect,
    gap,
    pixelScale,
    expandedSize,
    entranceDelay,
    getExitDelay,
    handoff,
    expanded,
    reducedMotion,
    didDragRef,
    onExpand,
    onPlay,
    onTogglePlayback,
    onSeek,
    onOpenPlayer,
}: LatticePosterProps) {
    countRender('LatticePoster');
    const { t } = useTranslation();
    const chrome = useLatticeChromeDisclosure(expanded);
    // The open card is already the foreground and carries the lyric canvas, so it never pops.
    const popped = !expanded && (chrome.hovered || isFocused);
    const popScaleX = popped && rect.width > 0 ? (rect.width + gap * 2) / rect.width : 1;
    const popScaleY = popped && rect.height > 0 ? (rect.height + gap * 2) / rect.height : 1;
    const isCurrent = tile.section === 'now';
    // The lyric scene is a Pixi renderer whose layout is rebuilt from the card's box, so mounting it
    // mid-expansion would rasterize every line once per animation frame. It waits for the spring.
    const [expansionSettled, onExpansionComplete] = useLatticeExpansionSettled(expanded, Boolean(reducedMotion));
    // The artwork only has to cover the card's own box, and a square cover is scaled to the longer
    // edge. Both inputs are discrete - gears are integer spans and the camera only rescales on a
    // breakpoint - so this is not a per-frame value even while the card animates towards the size.
    // 性能优先时封面不再按设备像素取档：高 DPR 屏上那意味着每张卡都要解一张大一档的图。
    const performanceMode = useLatticeSettingsStore(state => state.latticePerformanceMode);
    const lightsOn = useLatticeSettingsStore(state => state.latticeLightsOn);
    const coverTargetPx = Math.max(rect.width, rect.height) * pixelScale;
    const coverUrl = useWallPosterArtwork(
        tile.coverUrl,
        performanceMode && !expanded ? Math.min(coverTargetPx, PERFORMANCE_COVER_MAX_PX) : coverTargetPx,
    );
    // Hover and press are the last moments before the open: warming here keeps the lyric chunk,
    // the Pixi module and the first shader compile off the click path.
    const warmLyrics = () => { if (isCurrent) prewarmLatticeLyrics(); };
    // Deliberately not on hover: a pointer sweeping the wall would pull a full-size cover per card,
    // which costs more than the swap it saves. A press is already an open in all but name.
    const warmExpandedArtwork = () => prewarmWallPosterArtwork(tile.coverUrl, expandedSize * pixelScale);
    // Frozen at mount: the wave's own delay must not follow later camera moves.
    const landingDelay = useRef(entranceDelay).current;
    const landing = entranceDelay === null ? null : landingDelay;
    // 翻牌交接：绕 Y 轴半圈（与资料库墙磁贴的翻牌同一种），只在交接期间带透视（handoffTransform）——交接以外 transform
    // 里没有 3D 项，海报不会因此单独升层（见下面关于 will-change 的说明）。翻进用关键帧（从侧立的那一边转回来），按排期对象记住。
    const flipping = handoff !== null && handoff.kind !== 'static';
    const flipRotate = useMemo(() => {
        if (!handoff || handoff.kind === 'static') return 0;
        if (handoff.kind === 'hold') return -90;
        if (handoff.kind === 'in') return [-90 * handoff.direction, 0];
        return 90 * handoff.direction;
    }, [handoff]);
    const flipTransition = !handoff || handoff.kind === 'static'
        ? { duration: 0.2, ease: 'easeOut' as const }
        : handoff.kind === 'hold'
            ? { duration: 0 }
            : handoff.kind === 'in'
                ? { duration: WALL_HANDOFF_FLIP_IN_MS / 1000, delay: handoff.delay, ease: WALL_HANDOFF_IN_EASE }
                : { duration: WALL_HANDOFF_FLIP_OUT_MS / 1000, delay: handoff.delay, ease: WALL_HANDOFF_OUT_EASE };
    const baseTransition = reducedMotion
        ? { duration: 0 }
        : landing === null
            ? {
                // Width/height are layout properties. A spring keeps repainting every poster
                // in the expanded block longer than this interaction needs; a timed ease-out
                // gives Android WebView a bounded amount of work per selection.
                duration: 0.46,
                ease: [0.22, 1, 0.36, 1] as const,
                opacity: { duration: 0.26, ease: 'easeOut' as const },
                scaleX: { duration: 0.3, ease: 'easeOut' as const },
                scaleY: { duration: 0.3, ease: 'easeOut' as const },
            }
            : {
                type: 'spring' as const, stiffness: 360, damping: 24, delay: landing,
                opacity: { duration: 0.24, delay: landing },
            };

    const handleClick = (event: MouseEvent<HTMLElement>) => {
        if (event.target instanceof Element && event.target.closest('button, input')) return;
        if (didDragRef.current) {
            didDragRef.current = false;
            return;
        }
        if (!expanded) onExpand(instanceId);
        else chrome.toggleTouch();
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter') {
            event.preventDefault();
            if (!expanded) {
                onExpand(instanceId);
                return;
            }
            if (isCurrent) onTogglePlayback();
            else onPlay(tile);
            return;
        }
        if (event.key === ' ') {
            event.preventDefault();
            if (!expanded) onExpand(instanceId);
            else chrome.toggleKeyboard();
        }
    };

    return (
        <motion.article
            ref={chrome.articleRef}
            onPointerEnter={(event: PointerEvent<HTMLElement>) => { warmLyrics(); chrome.onPointerEnter(event); }}
            onPointerLeave={chrome.onPointerLeave}
            onPointerDownCapture={(event: PointerEvent<HTMLElement>) => { warmLyrics(); warmExpandedArtwork(); chrome.onPointerDownCapture(event); }}
            onFocusCapture={chrome.onFocusCapture}
            onBlurCapture={chrome.onBlurCapture}
            key={instanceId}
            className={`lattice-poster ${expanded ? 'is-expanded' : ''} ${isFocused ? 'is-focused' : ''} ${isCurrent ? 'is-current' : ''}`}
            data-instance-id={instanceId}
            initial={reducedMotion || handoff?.kind === 'static'
                ? false
                // 交接进来：落在原位、不透明，只是侧立着（看不见），等自己的时刻翻进来。
                : handoff?.kind === 'hold' || handoff?.kind === 'in'
                    ? { ...rect, opacity: 1, scale: 1, rotateY: -90 }
                : landing === null
                    // Outside the opening wave a poster still fades up in place, so posters
                    // revealed by a pan or a queue change never pop in fully drawn.
                    ? { ...rect, opacity: 0, scale: 0.94 }
                    : { ...rect, y: rect.y - ENTRANCE_LIFT, opacity: 0, scale: 0.88 }}
            animate={{
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                opacity: 1,
                scale: 1,
                scaleX: popScaleX,
                scaleY: popScaleY,
                rotateY: flipRotate,
            }}
            transformTemplate={flipping ? handoffTransform : undefined}
            // A dynamic variant rather than a target object: Framer resolves it when the exit
            // actually runs, which is the only moment the wave's delay can be read from the camera
            // where it stands. Nothing else here is a variant, so no label reaches the children.
            variants={LEAVING}
            custom={() => ({ y: rect.y - ENTRANCE_LIFT, delay: getExitDelay(rect) })}
            // 交接里离开（翻完那一刻整层卸掉）：海报已经侧立，不再跑抬起的退场。
            exit={reducedMotion || handoff !== null ? { opacity: 0, transition: { duration: 0 } } : 'leaving'}
            transition={{
                ...baseTransition,
                rotateY: flipTransition,
            }}
            style={{
                backgroundImage: coverUrl ? `url("${coverUrl}")` : fallbackBackground(tile.id),
                zIndex: expanded ? 20 : undefined,
            }}
            onAnimationComplete={onExpansionComplete}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            role={expanded ? 'group' : 'button'}
            tabIndex={expanded ? -1 : 0}
            aria-expanded={expanded ? undefined : false}
            aria-label={`${tile.title} · ${tile.artist}`}
        >
            {/* shade 是标题与播放条的可读性底衬，留着；tint 是纯装饰，性能优先时不渲染；
                lights-out 开灯时是一层永远透明的黑，同样只在真的熄灯时才挂上。 */}
            <span className="lattice-poster-shade" />
            {(!performanceMode || !lightsOn) && <span className="lattice-poster-lights-out" />}
            {!performanceMode && <span className="lattice-poster-tint" />}
            <span className={`lattice-poster-badge ${isCurrent ? 'is-current' : ''}`}>
                {isCurrent && <>{t('home.latticeBadgeNow')} · </>}
                {String(tile.queueIndex + 1).padStart(2, '0')}
            </span>
            {expanded && expansionSettled && isCurrent ? (
                <Suspense fallback={<span className="lattice-poster-copy"><WallTitle title={tile.title} expanded={expanded} targetPosterWidth={rect.width} /><small>{tile.artist}</small></span>}>
                    <LatticeLyrics key={tile.id} tile={tile} reducedMotion={Boolean(reducedMotion)} />
                </Suspense>
            ) : <span className="lattice-poster-copy">
                {/* `rect` is the slot the card is heading for, in world units, so the title is fitted
                    against its final column before the spring has moved it there. */}
                <WallTitle title={tile.title} expanded={expanded} targetPosterWidth={rect.width} />
                <small>{tile.artist}</small>
            </span>}
            {expanded && (
                <motion.div
                    className="lattice-poster-controls"
                    initial={{ opacity: 0, y: WALL_REFLOW_CONTROLS_REVEAL.risePx }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                        delay: reducedMotion ? 0 : WALL_REFLOW_CONTROLS_REVEAL.delayMs / 1000,
                        duration: reducedMotion ? 0 : WALL_REFLOW_CONTROLS_REVEAL.durationMs / 1000,
                    }}
                >
                    <LatticePlaybackControls
                        revealed={chrome.revealed}
                        tile={tile}
                        onPlay={onPlay}
                        onTogglePlayback={onTogglePlayback}
                        onSeek={onSeek}
                        onOpenPlayer={onOpenPlayer}
                    />
                </motion.div>
            )}
        </motion.article>
    );
}

export default memo(LatticePoster, arePosterPropsEqual);
