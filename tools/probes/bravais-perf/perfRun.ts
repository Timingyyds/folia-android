import { BRAVAIS_METRICS, getBravaisScale } from '../../../src/library/suites/bravais/bravaisConstants';
import type { PerfJob } from './perfConfig';
import { summarizePhase, type MountStats, type PerfResult } from './perfStats';
import type { PerfDriver, PerfStageCounters } from './PerfStageHost';

// dev/probes/bravais-perf/perfRun.ts
// 一轮测量：挂 stage（首屏）→ 预热 → 运动 → 停稳，分阶段记 rAF 间隔、长动画帧（LoAF）与长任务；运动阶段另记
// 磁贴渲染（dev 的 countRender，window.__renderCounts）、stage 的 React 提交（Profiler）、新挂进 DOM 的磁贴与块底板、
// 已挂块底板路径的改写（MutationObserver）与每次触发时在动的磁贴数（内容层的脚本动画；让位看 data-bravais-reflowing）。
// B12b：底板改为按块 SVG 后，「遮罩重建」换成「块底板重画」（<path d> 被改写的次数与块）；缝开口补间会补裁剪，
// drift 不再需要先空走一圈。
// 帧采样用原生 rAF：设了帧率限制时 utils/frameRateLimiter 会把 window.requestAnimationFrame 换成限流版。

type RenderCountWindow = Window & {
    __renderCounts?: Record<string, number>;
    __foliaNativeRequestAnimationFrame?: (callback: FrameRequestCallback) => number;
    __foliaNativeCancelAnimationFrame?: (handle: number) => void;
};

const nativeRaf = (callback: FrameRequestCallback) => {
    const frameWindow = window as RenderCountWindow;
    return (frameWindow.__foliaNativeRequestAnimationFrame ?? window.requestAnimationFrame).call(window, callback);
};
const nativeCancelRaf = (handle: number) => {
    const frameWindow = window as RenderCountWindow;
    (frameWindow.__foliaNativeCancelAnimationFrame ?? window.cancelAnimationFrame).call(window, handle);
};

/** 翻牌只在「视口 + 外扩」里动（useBravaisDisplay 的 FLIP_OVERSCAN = 160 世界像素，缝张开时左右各再让出一个开口宽）。 */
const FLIP_OVERSCAN_WORLD = 160;
/** 一次触发之后看几帧的动画：出场 / 转出段在触发那次提交里一起建好（带各自的 delay），几帧内就能数全。 */
const ANIMATION_SAMPLE_FRAMES = 6;
/** 各场景的触发间隔（毫秒）：翻牌 360ms + 错开上限 420ms；整墙出场 280 + 错开 340 + 入场 420；放大让位 500ms。 */
const TRIGGER_INTERVAL_MS: Partial<Record<PerfJob['scenario'], number>> = { flip: 1500, tab: 1300, expand: 900 };

type LoafSample = { start: number; duration: number; blocking: number };

const readCounts = () => ({ ...((window as RenderCountWindow).__renderCounts ?? {}) });
const armCounts = () => { (window as RenderCountWindow).__renderCounts = {}; };

/**
 * 这一个动画是不是在数的那种：翻牌 / 整墙出场入场是脚本建的 WAAPI 动画（内容层 element.animate）。CSS 过渡（换面时内容层的
 * 颜色 / 透明度过渡、悬停）不算——屏外只换不翻的磁贴也会因为换了类名起一段 CSS 过渡，算进来就把「屏外翻牌」误报了。
 * 聚焦放大的让位不是动画对象（2026-10-09 起由 useBravaisReflowDriver 逐帧写外框），按 data-bravais-reflowing 数。
 */
const animatedTileOf = (animation: Animation) => {
    const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
    if (!(target instanceof Element)) return null;
    const isCss = animation instanceof CSSTransition || animation instanceof CSSAnimation;
    return isCss ? null : target.closest('.bravais-tile');
};

/** 此刻在动的磁贴：让位场景是挂着 data-bravais-reflowing 的外框，其余是内容层上没放完的脚本动画。 */
const animatedTiles = (root: HTMLElement, scenario: PerfJob['scenario']): Element[] => {
    if (scenario === 'expand') return [...root.querySelectorAll('.bravais-tile[data-bravais-reflowing]')];
    const tiles: Element[] = [];
    for (const animation of document.getAnimations()) {
        if (animation.playState === 'finished') continue;
        const tile = animatedTileOf(animation);
        if (tile) tiles.push(tile);
    }
    return tiles;
};

/**
 * 翻牌范围在屏幕上的外扩（像素）：世界外扩 × 缩放 + 缝的开口宽（缝张开时两半各让出半个开口，范围两侧各宽一个开口），
 * 再留一格（格距 × 缩放）的容差：换层时起点落在离缝最近的 slot，相机可能在计划翻牌之后的同一次提交里挪一小段，
 * 计划时还在范围边上的磁贴会被量成刚出界一点。护栏要抓的是「屏外整片在翻」，不是边上的这一格。
 */
const animationMargin = (root: HTMLElement) => {
    const view = root.getBoundingClientRect();
    const scale = getBravaisScale(view.width);
    const seamWidth = root.querySelector('[data-bravais-seam]')?.getBoundingClientRect().width ?? 0;
    return { view, margin: (FLIP_OVERSCAN_WORLD + BRAVAIS_METRICS.cellSize + BRAVAIS_METRICS.gap) * scale + seamWidth };
};

/**
 * 记下此刻内容层 / 外框在动的磁贴（Map：磁贴 → 第一次看到时是否完全落在翻牌范围之外）。在第一次看到时判断位置：
 * 换层时相机可能随后补间，过几帧再量会把计划时还在范围里的磁贴算成屏外。
 */
const sampleAnimatedTiles = (root: HTMLElement, seen: Map<Element, string | null>, scenario: PerfJob['scenario']) => {
    let bounds: ReturnType<typeof animationMargin> | null = null;
    for (const tile of animatedTiles(root, scenario)) {
        if (seen.has(tile) || !root.contains(tile)) continue;
        bounds ??= animationMargin(root);
        const { view, margin } = bounds;
        const rect = tile.getBoundingClientRect();
        const outside = rect.right < view.left - margin || rect.left > view.right + margin || rect.bottom < view.top - margin || rect.top > view.bottom + margin;
        // 屏外的记一条可读的描述（slot、矩形、外扩），结果里留一条给人查。
        seen.set(tile, outside
            ? `${(tile as HTMLElement).dataset.bravaisSlot} @ ${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}×${Math.round(rect.height)} margin ${Math.round(margin)} view ${Math.round(view.width)}×${Math.round(view.height)}`
            : null);
    }
};

const hasContentTile = (root: HTMLElement | null) => Boolean(root?.querySelector('[data-library-entry], [data-library-card]'));

const blockOfSlot = (slotKey: string | undefined) => slotKey?.split(',').slice(0, 2).join(',') ?? null;

export type PerfRunHooks = {
    /** 挂上这一轮的 stage，返回它的驱动（挂好之后才 resolve）。 */
    mount: () => Promise<PerfDriver>;
    counters: PerfStageCounters;
    signal: AbortSignal;
    onPhase: (phase: string) => void;
};

/** 跑一轮，返回读数。中途 abort 时 reject AbortError。卸载由调用方负责（finally 里换下一轮或清空）。 */
export const runPerfJob = (job: PerfJob, { mount, counters, signal, onPhase }: PerfRunHooks): Promise<PerfResult> => new Promise((resolve, reject) => {
    const loafs: LoafSample[] = [];
    const longTasks: LoafSample[] = [];
    const observers: PerformanceObserver[] = [];
    const observe = (type: string, sink: LoafSample[]) => {
        try {
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    sink.push({ start: entry.startTime, duration: entry.duration, blocking: (entry as PerformanceEntry & { blockingDuration?: number }).blockingDuration ?? 0 });
                }
            });
            observer.observe({ type, buffered: false });
            observers.push(observer);
        } catch {
            // 不支持这类条目（非 Chromium）：只看帧间隔。
        }
    };
    observe('long-animation-frame', loafs);
    observe('longtask', longTasks);

    let raf = 0;
    let mutation: MutationObserver | null = null;
    const cleanup = () => {
        nativeCancelRaf(raf);
        observers.forEach(observer => observer.disconnect());
        mutation?.disconnect();
    };
    const abort = () => {
        cleanup();
        reject(new DOMException('Stopped', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });

    const mountedAt = performance.now();
    armCounts();
    onPhase('mount');
    void mount().then((driver) => {
        if (signal.aborted) return;
        let phase: 'warmup' | 'motion' | 'settle' = 'warmup';
        let phaseStart = mountedAt;
        let last = mountedAt;
        let frames: number[] = [];
        let firstTileMs = -1;
        let mountStats: MountStats | null = null;
        let motion: PerfResult['motion'] | null = null;
        let counts: PerfResult['counts'] | null = null;
        let tilesAdded = 0;
        let platesAdded = 0;
        let plateRedraws = 0;
        const redrawnBlocks = new Set<string>();
        /** 这一轮里展开过聚焦卡的块（收起时那一块也会重画一次）。 */
        const expandedBlocks = new Set<string>();
        let tilesPeak = 0;
        let windowsPeak = 0;
        let nextTriggerAt = 0;
        let triggers = 0;
        let sampleFramesLeft = 0;
        let animated = new Map<Element, string | null>();
        let offscreenExample: string | undefined;
        let peakAnimated = 0;
        let maxOffscreen = 0;
        let visualizerMounted = false;
        const width = window.innerWidth;
        const height = window.innerHeight;
        let panOffset = { x: 0, y: 0 };

        /** 一次触发的动画数完：记峰值与屏外数。 */
        const closeAnimationSample = () => {
            peakAnimated = Math.max(peakAnimated, animated.size);
            const offscreen = [...animated.values()].filter((value): value is string => value !== null);
            maxOffscreen = Math.max(maxOffscreen, offscreen.length);
            offscreenExample ??= offscreen[0];
            animated = new Map();
        };

        const startMotion = (now: number, root: HTMLElement) => {
            const warmupFrames = frames;
            const warmupLongTasks = longTasks.filter(entry => entry.start >= mountedAt);
            const warmupLoafs = loafs.filter(entry => entry.start >= mountedAt);
            mountStats = {
                firstTileMs,
                worstFrameMs: warmupFrames.reduce((max, value) => Math.max(max, value), 0),
                longTaskMaxMs: warmupLongTasks.reduce((max, entry) => Math.max(max, entry.duration), 0),
                loafMaxMs: warmupLoafs.reduce((max, entry) => Math.max(max, entry.duration), 0),
                tiles: root.querySelectorAll('.bravais-tile').length,
            };
            phase = 'motion';
            phaseStart = now;
            frames = [];
            loafs.length = 0;
            armCounts();
            counters.commits = 0;
            counters.commitMs = 0;
            const noteExpanded = () => {
                const block = blockOfSlot(root.querySelector<HTMLElement>('[data-bravais-expanded]')?.dataset.bravaisSlot);
                if (block) expandedBlocks.add(block);
            };
            noteExpanded();
            mutation = new MutationObserver((records) => {
                for (const record of records) {
                    if (record.type === 'attributes') {
                        if (record.attributeName === 'd') {
                            const block = (record.target as Element).closest<SVGElement>('[data-bravais-plate-block]')?.dataset.bravaisPlateBlock;
                            if (block) {
                                plateRedraws += 1;
                                redrawnBlocks.add(block);
                            }
                        } else {
                            noteExpanded();
                        }
                        continue;
                    }
                    record.addedNodes.forEach((node) => {
                        if (!(node instanceof Element)) return;
                        if (node.classList.contains('bravais-tile')) tilesAdded += 1;
                        else if (node.matches('[data-bravais-plate-block]')) platesAdded += 1;
                    });
                }
            });
            mutation.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['d', 'data-bravais-expanded'] });
            onPhase('motion');
        };

        /** 沿轨迹平移到 progress（0–1）处：x 一个来回、y 两个来回，回到起点。 */
        const panTo = (progress: number) => {
            // pan：振幅约 ±2.2 / ±1.6 屏（跨越大量块边界，会重新裁剪）；drift：缩到 ±110 / ±70px，停在已裁剪的范围里。
            const [ax, ay] = job.scenario === 'pan' ? [2.2 * width, 1.6 * height] : [110, 70];
            const next = { x: ax * Math.sin(progress * Math.PI * 2), y: ay * Math.sin(progress * Math.PI * 4) };
            driver.wheel(panOffset.x - next.x, panOffset.y - next.y);
            panOffset = next;
        };

        const drive = (elapsed: number, progress: number) => {
            if (job.scenario === 'pan' || job.scenario === 'drift') {
                panTo(progress);
                return;
            }
            const interval = TRIGGER_INTERVAL_MS[job.scenario];
            if (!interval || elapsed < nextTriggerAt) return;
            nextTriggerAt = elapsed + interval;
            if (job.scenario === 'flip') driver.toggleFilter();
            else if (job.scenario === 'tab') driver.switchTab();
            else if (job.scenario === 'expand' && !driver.expandNext()) return;
            triggers += 1;
            sampleFramesLeft = ANIMATION_SAMPLE_FRAMES;
            animated = new Map();
        };

        const tick = (now: number) => {
            if (signal.aborted) return;
            const root = driver.root();
            frames.push(now - last);
            last = now;
            if (firstTileMs < 0 && hasContentTile(root)) firstTileMs = now - mountedAt;
            const elapsed = now - phaseStart;
            if (root && sampleFramesLeft > 0) {
                sampleAnimatedTiles(root, animated, job.scenario);
                sampleFramesLeft -= 1;
                if (sampleFramesLeft === 0) closeAnimationSample();
            }
            if (phase === 'warmup' && elapsed >= job.warmupMs && root && firstTileMs >= 0) {
                startMotion(now, root);
            } else if (phase === 'motion') {
                const progress = Math.min(1, elapsed / (job.seconds * 1000));
                drive(elapsed, progress);
                if (root && frames.length % 8 === 0) {
                    tilesPeak = Math.max(tilesPeak, root.querySelectorAll('.bravais-tile').length);
                    windowsPeak = Math.max(windowsPeak, root.querySelectorAll('.bravais-tile[data-bravais-kind="window"]').length);
                }
                if (progress === 1) {
                    if (sampleFramesLeft > 0) closeAnimationSample();
                    sampleFramesLeft = 0;
                    motion = summarizePhase(frames, loafs);
                    const renderCounts = readCounts();
                    counts = {
                        tileRenders: renderCounts.BravaisTile ?? 0,
                        plateRedraws,
                        plateRedrawBlocks: redrawnBlocks.size,
                        strayPlateRedraws: [...redrawnBlocks].filter(block => !expandedBlocks.has(block)).length,
                        platesAdded,
                        stageCommits: counters.commits,
                        stageCommitMs: counters.commitMs,
                        tilesAdded,
                    };
                    mutation?.disconnect();
                    mutation = null;
                    visualizerMounted = Boolean(document.querySelector('[data-perf-visualizer] canvas'));
                    phase = 'settle';
                    phaseStart = now;
                    frames = [];
                    loafs.length = 0;
                    onPhase('settle');
                }
            } else if (phase === 'settle' && elapsed >= job.settleMs) {
                const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
                const result: PerfResult = {
                    job,
                    mount: mountStats!,
                    motion: motion!,
                    settle: summarizePhase(frames, loafs),
                    counts: counts!,
                    animation: { triggers, peakAnimated, maxOffscreen, offscreenExample },
                    tiles: { peak: tilesPeak, windows: windowsPeak },
                    memory: memory ? { usedMB: memory.usedJSHeapSize / 1048576, totalMB: memory.totalJSHeapSize / 1048576 } : null,
                    visualizerMounted,
                    viewport: `${width}×${height}@${window.devicePixelRatio}`,
                };
                signal.removeEventListener('abort', abort);
                cleanup();
                resolve(result);
                return;
            }
            raf = nativeRaf(tick);
        };
        raf = nativeRaf(tick);
    }, (error) => {
        signal.removeEventListener('abort', abort);
        cleanup();
        reject(error);
    });
});
