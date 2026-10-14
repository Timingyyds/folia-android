// src/lib/frameTimingDiagnostics.ts
// 渲染帧耗时现场。卡顿的用户报告靠这份数据分流：是界面/渲染开销（我们的问题），
// 还是设备本身性能不足（处理器、GPU 跟不上）。
//
// 采样用原生 requestAnimationFrame：frameRateLimiter 会把 window.requestAnimationFrame
// 换成带节流的实现，用它量帧率会把「用户自己设的 60fps 上限」当成掉帧，所以优先取它保存的
// 原生实现。只在页面可见时计时 —— 后台时 rAF 本来就不触发，恢复后的第一条间隔会被丢弃，
// 避免把后台时间算成卡顿。

export type FrameRenderHealth = 'smooth' | 'mild' | 'heavy' | 'unknown';

/** 单帧超过这些阈值分别算「掉帧」「卡顿」「冻结」。32ms ≈ 60Hz 下漏掉一帧。 */
const SLOW_FRAME_MS = 32;
const JANK_FRAME_MS = 50;
const FREEZE_FRAME_MS = 100;
/** 超过这个间隔只可能是挂起/切后台，不计入统计。 */
const MAX_RECORDED_INTERVAL_MS = 5000;
/** 环形缓冲：4096 帧 ≈ 60Hz 下 68 秒，报告里的分位数只看这段「最近窗口」。 */
const INTERVAL_CAPACITY = 4096;
const LONG_TASK_THRESHOLD_MS = 50;
const LONG_ANIMATION_FRAME_THRESHOLD_MS = 50;
/** 触摸/滚动结束后仍算「移动中」的余量：一次滑动收尾的那几帧同样是用户看到的掉帧。 */
const MOTION_WINDOW_MS = 250;
const MOTION_INTERVAL_CAPACITY = 2048;

export type FrameStats = {
    count: number;
    avgMs: number | null;
    p50Ms: number | null;
    p90Ms: number | null;
    p95Ms: number | null;
    p99Ms: number | null;
    maxMs: number | null;
    slowCount: number;
    jankCount: number;
    freezeCount: number;
};

export type LongTaskStats = {
    count: number;
    totalMs: number;
    maxMs: number;
    selfCount: number;
    otherCount: number;
    unknownCount: number;
};

/**
 * Long Animation Frame（Chrome 123+）比 longtask 多说三件事：这一帧被阻塞了多久、
 * 时间花在「脚本」还是「样式/布局」、以及最重的那段脚本在哪。卡顿归因靠它才能落到人头上。
 */
export type LongAnimationFrameStats = {
    count: number;
    maxBlockingMs: number;
    scriptMs: number;
    styleLayoutMs: number;
    worstBlockingMs: number;
    worstScriptMs: number;
    worstStyleLayoutMs: number;
    worstInvoker: string;
    /** 最重那一帧的开始时刻（performance.now 原点），用来和用户的操作对上号。 */
    worstAtMs: number | null;
    /** Bounded sample list so repeat offenders remain visible after the heaviest one is seen. */
    samples: Array<{
        blockingMs: number;
        scriptMs: number;
        styleLayoutMs: number;
        invoker: string;
        atMs: number;
    }>;
};

const MAX_LOAF_SAMPLES = 8;

/** 移动中（滚动 / 触摸拖动）的帧统计：和整体统计分开看，才分得清「日常播放卡」还是「一动就卡」。 */
export type MotionFrameStats = {
    count: number;
    stats: FrameStats;
    slowCount: number;
    jankCount: number;
    freezeCount: number;
};

type LongAnimationFrameEntryLike = {
    duration?: number;
    blockingDuration?: number;
    renderStart?: number;
    styleAndLayoutStart?: number;
    scripts?: Array<{ duration?: number; invoker?: string; sourceURL?: string; sourceFunctionName?: string }>;
};

export type CpuProbeResult = {
    ops: number;
    durationMs: number;
    opsPerSecond: number;
    index: 'fast' | 'moderate' | 'slow' | 'unknown';
};

export type FrameTimingSnapshot = {
    installed: boolean;
    installedAtMs: number | null;
    visibleMs: number;
    hiddenMs: number;
    frameCount: number;
    intervals: number[];
    stats: FrameStats;
    /** 会话累计（不受最近窗口限制）。 */
    sessionSlowCount: number;
    sessionJankCount: number;
    sessionFreezeCount: number;
    longestFreezeMs: number;
    /** 最差的一秒：桶内帧数最少的那一秒折合成的 fps。 */
    worstSecondFps: number | null;
    recentSecondFps: number | null;
    refreshHz: number | null;
    cores: number | null;
    memoryGb: number | null;
    deviceClass: 'low' | 'mid' | 'high' | 'unknown';
    longTasks: LongTaskStats;
    longAnimationFrames: LongAnimationFrameStats;
    motion: MotionFrameStats;
    renderHealth: FrameRenderHealth;
};

const emptyLongTasks = (): LongTaskStats => ({
    count: 0,
    totalMs: 0,
    maxMs: 0,
    selfCount: 0,
    otherCount: 0,
    unknownCount: 0,
});

const emptyLongAnimationFrames = (): LongAnimationFrameStats => ({
    count: 0,
    maxBlockingMs: 0,
    scriptMs: 0,
    styleLayoutMs: 0,
    worstBlockingMs: 0,
    worstScriptMs: 0,
    worstStyleLayoutMs: 0,
    worstInvoker: '',
    worstAtMs: null,
    samples: [],
});

/** 只留文件名：绝对路径不进报告。 */
const scriptSourceLabel = (raw?: string): string => {
    if (!raw) return '';
    try {
        return new URL(raw).pathname.split('/').filter(Boolean).pop() || '';
    } catch {
        const parts = String(raw).split(/[\\/]/);
        return parts[parts.length - 1] || '';
    }
};

/** 把一条 LoAF 记录压成「阻塞多久 / 脚本多久 / 样式布局多久 / 最重的脚本在哪」。 */
export const summarizeLongAnimationFrame = (
    entry: LongAnimationFrameEntryLike,
): { blockingMs: number; scriptMs: number; styleLayoutMs: number; invoker: string } => {
    const duration = Number(entry.duration);
    const blocking = Number(entry.blockingDuration);
    const blockingMs = Number.isFinite(blocking)
        ? Math.max(0, blocking)
        : (Number.isFinite(duration) ? Math.max(0, duration - LONG_ANIMATION_FRAME_THRESHOLD_MS) : 0);

    let scriptMs = 0;
    let worstScriptMs = -1;
    let invoker = '';
    (Array.isArray(entry.scripts) ? entry.scripts : []).forEach((script) => {
        const ms = Number(script?.duration);
        if (!Number.isFinite(ms) || ms <= 0) return;
        scriptMs += ms;
        if (ms <= worstScriptMs) return;
        worstScriptMs = ms;
        const fn = script?.sourceFunctionName ? String(script.sourceFunctionName) : '';
        const file = scriptSourceLabel(script?.sourceURL ? String(script.sourceURL) : '');
        invoker = [String(script?.invoker || ''), fn, file].filter(Boolean).join('@');
    });

    const renderStart = Number(entry.renderStart);
    const styleAndLayoutStart = Number(entry.styleAndLayoutStart);
    const styleLayoutMs = Number.isFinite(renderStart)
        && Number.isFinite(styleAndLayoutStart)
        && renderStart >= styleAndLayoutStart
        ? renderStart - styleAndLayoutStart
        : 0;

    return { blockingMs, scriptMs, styleLayoutMs, invoker };
};

const intervalBuffer = new Float64Array(INTERVAL_CAPACITY);
let intervalCursor = 0;
let intervalCount = 0;

const motionBuffer = new Float64Array(MOTION_INTERVAL_CAPACITY);
let motionCursor = 0;
let motionIntervalCount = 0;
let motionSlowCount = 0;
let motionJankCount = 0;
let motionFreezeCount = 0;
let motionUntilMs = 0;
let motionListener: (() => void) | null = null;

let installed = false;
let installedAtMs: number | null = null;
let frameLoopHandle: number | null = null;
let visibilityListener: (() => void) | null = null;
let lastFrameAt: number | null = null;
let lastTickAtMs: number | null = null;
let hiddenSinceMs: number | null = null;
let visibleMs = 0;
let hiddenMs = 0;
let frameCount = 0;
let sessionSlowCount = 0;
let sessionJankCount = 0;
let sessionFreezeCount = 0;
let longestFreezeMs = 0;
let bucketStartedAt: number | null = null;
let bucketFrames = 0;
let worstSecondFps: number | null = null;
let recentSecondFps: number | null = null;
let longTasks = emptyLongTasks();
let longAnimationFrames = emptyLongAnimationFrames();

// CPU 探针自己会阻塞主线程：那一次长任务和那一帧不算用户的卡顿，按时间窗口跳过。
let probeFromMs: number | null = null;
let probeUntilMs: number | null = null;

const nowMs = (): number => (
    typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()
);

const pushInterval = (value: number): void => {
    intervalBuffer[intervalCursor] = value;
    intervalCursor = (intervalCursor + 1) % INTERVAL_CAPACITY;
    if (intervalCount < INTERVAL_CAPACITY) intervalCount += 1;
};

const readIntervals = (): number[] => {
    const out = new Array<number>(intervalCount);
    const start = (intervalCursor - intervalCount + INTERVAL_CAPACITY) % INTERVAL_CAPACITY;
    for (let index = 0; index < intervalCount; index += 1) {
        out[index] = intervalBuffer[(start + index) % INTERVAL_CAPACITY];
    }
    return out;
};

const readMotionIntervals = (): number[] => {
    const out = new Array<number>(motionIntervalCount);
    const start = (motionCursor - motionIntervalCount + MOTION_INTERVAL_CAPACITY) % MOTION_INTERVAL_CAPACITY;
    for (let index = 0; index < motionIntervalCount; index += 1) {
        out[index] = motionBuffer[(start + index) % MOTION_INTERVAL_CAPACITY];
    }
    return out;
};

/**
 * 触摸拖动 / 滚动开始。接下来 MOTION_WINDOW_MS 内的帧会单独统计：
 * 「日常播放不卡、一移动就掉帧」这种反馈只有把这段拆出来才看得见。
 */
export const noteMotionActivity = (): void => {
    motionUntilMs = nowMs() + MOTION_WINDOW_MS;
};

const isMotionActive = (atMs: number): boolean => atMs <= motionUntilMs;

/** 分位数取「最近的样本序号」，样本少时也能给出可用的 p95 而不是 null。 */
const percentileOf = (sorted: number[], fraction: number): number | null => {
    if (!sorted.length) return null;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
    return sorted[index];
};

export const computeFrameStats = (intervals: number[]): FrameStats => {
    const sorted = intervals.filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
    if (!sorted.length) {
        return {
            count: 0,
            avgMs: null,
            p50Ms: null,
            p90Ms: null,
            p95Ms: null,
            p99Ms: null,
            maxMs: null,
            slowCount: 0,
            jankCount: 0,
            freezeCount: 0,
        };
    }
    let total = 0;
    let slowCount = 0;
    let jankCount = 0;
    let freezeCount = 0;
    sorted.forEach((value) => {
        total += value;
        if (value > SLOW_FRAME_MS) slowCount += 1;
        if (value > JANK_FRAME_MS) jankCount += 1;
        if (value > FREEZE_FRAME_MS) freezeCount += 1;
    });
    return {
        count: sorted.length,
        avgMs: total / sorted.length,
        p50Ms: percentileOf(sorted, 0.5),
        p90Ms: percentileOf(sorted, 0.9),
        p95Ms: percentileOf(sorted, 0.95),
        p99Ms: percentileOf(sorted, 0.99),
        maxMs: sorted[sorted.length - 1],
        slowCount,
        jankCount,
        freezeCount,
    };
};

/**
 * 用帧间隔中位数猜屏幕刷新率。只取 4~40ms 的样本：掉帧的长间隔会把中位数拉偏，
 * 而这些间隔恰恰是我们要衡量的对象，不该反过来决定基准帧率。
 */
export const estimateRefreshRateHz = (intervals: number[]): number | null => {
    const typical = intervals.filter(value => value >= 4 && value <= 40);
    if (typical.length < 30) return null;
    const median = computeFrameStats(typical).p50Ms;
    if (median === null || median <= 0) return null;
    const measured = 1000 / median;
    const candidates = [60, 90, 120, 144];
    let nearest = candidates[0];
    candidates.forEach((candidate) => {
        if (Math.abs(candidate - measured) < Math.abs(nearest - measured)) nearest = candidate;
    });
    return Math.abs(nearest - measured) / nearest <= 0.08 ? nearest : Math.round(measured);
};

export const classifyRenderHealth = (stats: FrameStats, refreshHz: number | null): FrameRenderHealth => {
    if (stats.count < 120) return 'unknown';
    const budgetMs = refreshHz && refreshHz > 0 ? 1000 / refreshHz : 1000 / 60;
    const jankRatio = stats.jankCount / stats.count;
    if ((stats.p95Ms !== null && stats.p95Ms > budgetMs * 2) || jankRatio > 0.04 || stats.freezeCount >= 3) {
        return 'heavy';
    }
    if ((stats.p95Ms !== null && stats.p95Ms > budgetMs * 1.5) || jankRatio > 0.01) return 'mild';
    return 'smooth';
};

/** WebView 拿不到内存或核数时按中位假设，宁可给 mid 也不要瞎报设备差。 */
export const describeDeviceClass = (
    cores: number | null,
    memoryGb: number | null,
): FrameTimingSnapshot['deviceClass'] => {
    if (cores === null && memoryGb === null) return 'unknown';
    const resolvedCores = cores ?? 4;
    const resolvedMemory = memoryGb ?? 4;
    if (resolvedCores >= 8 && resolvedMemory >= 6) return 'high';
    if (resolvedCores <= 4 && resolvedMemory <= 3) return 'low';
    return 'mid';
};

export const describeCpuIndex = (opsPerSecond: number): CpuProbeResult['index'] => {
    if (!Number.isFinite(opsPerSecond) || opsPerSecond <= 0) return 'unknown';
    if (opsPerSecond >= 120e6) return 'fast';
    if (opsPerSecond >= 40e6) return 'moderate';
    return 'slow';
};

const CPU_PROBE_CHUNK = 200_000;
const CPU_PROBE_WARMUP_OPS = 100_000;

const spinWork = (iterations: number, seed: number): number => {
    let accumulator = seed;
    for (let index = 0; index < iterations; index += 1) {
        accumulator = Math.imul(accumulator ^ (accumulator >>> 13), 0x5bd1e995);
        accumulator ^= accumulator >>> 15;
    }
    return accumulator;
};

/**
 * 固定工作量的处理器探针：同样的循环在不同设备上耗时差多少，就是「处理器性能不足」的
 * 直接证据。结果只用于跨设备比较（相对指数），不是绝对跑分。
 */
export const runCpuProbe = (budgetMs = 250): CpuProbeResult => {
    spinWork(CPU_PROBE_WARMUP_OPS, 0x9e3779b9);
    const startedAt = nowMs();
    const wallStartedAt = Date.now();
    probeFromMs = startedAt;
    let ops = 0;
    let accumulator = 0x85ebca6b;
    // 固定时间预算内的工作量：同样的循环在不同设备上跑出的 ops/s 可以直接比较。
    // 上界只是防御性上限 —— performance.now 万一不前进，挂钟兜底到 2 倍预算就收手，
    // 绝不能因为一次诊断把主线程锁死。
    while (ops < CPU_PROBE_CHUNK * 2000) {
        accumulator = spinWork(CPU_PROBE_CHUNK, accumulator);
        ops += CPU_PROBE_CHUNK;
        if (nowMs() - startedAt >= budgetMs) break;
        if (Date.now() - wallStartedAt >= budgetMs * 2) break;
    }
    const durationMs = Math.max(0.001, nowMs() - startedAt);
    probeUntilMs = startedAt + durationMs;
    // 读一下结果，别让引擎把整段循环优化掉。
    if (accumulator === 0x7fffffff) ops += 0;
    const opsPerSecond = ops / (durationMs / 1000);
    return { ops, durationMs, opsPerSecond, index: describeCpuIndex(opsPerSecond) };
};

const insideProbeWindow = (timestamp: number): boolean => (
    probeFromMs !== null
    && probeUntilMs !== null
    && timestamp >= probeFromMs
    && timestamp <= probeUntilMs
);

const recordInterval = (intervalMs: number, timestamp: number): void => {
    if (!(intervalMs > 0) || intervalMs > MAX_RECORDED_INTERVAL_MS) return;
    if (insideProbeWindow(timestamp)) return;
    pushInterval(intervalMs);
    if (isMotionActive(timestamp)) {
        motionBuffer[motionCursor] = intervalMs;
        motionCursor = (motionCursor + 1) % MOTION_INTERVAL_CAPACITY;
        if (motionIntervalCount < MOTION_INTERVAL_CAPACITY) motionIntervalCount += 1;
        if (intervalMs > SLOW_FRAME_MS) motionSlowCount += 1;
        if (intervalMs > JANK_FRAME_MS) motionJankCount += 1;
        if (intervalMs > FREEZE_FRAME_MS) motionFreezeCount += 1;
    }
    if (intervalMs > SLOW_FRAME_MS) sessionSlowCount += 1;
    if (intervalMs > JANK_FRAME_MS) sessionJankCount += 1;
    if (intervalMs > FREEZE_FRAME_MS) {
        sessionFreezeCount += 1;
        longestFreezeMs = Math.max(longestFreezeMs, intervalMs);
    }
    if (bucketStartedAt === null) {
        bucketStartedAt = timestamp;
        bucketFrames = 0;
    }
    bucketFrames += 1;
    const bucketElapsed = timestamp - bucketStartedAt;
    if (bucketElapsed >= 1000) {
        const fps = (bucketFrames * 1000) / bucketElapsed;
        recentSecondFps = fps;
        worstSecondFps = worstSecondFps === null ? fps : Math.min(worstSecondFps, fps);
        bucketStartedAt = timestamp;
        bucketFrames = 0;
    }
};

/** 一帧的间隔进统计（rAF 循环内部走的就是这里；测试也用它喂样本）。 */
export const noteFrameSample = (intervalMs: number, timestampMs: number): void => {
    recordInterval(intervalMs, timestampMs);
};

const nativeRequestAnimationFrame = (callback: FrameRequestCallback): number => {
    const frameWindow = window as Window & { __foliaNativeRequestAnimationFrame?: typeof requestAnimationFrame };
    const native = frameWindow.__foliaNativeRequestAnimationFrame;
    return native ? native.call(window, callback) : window.requestAnimationFrame(callback);
};

const nativeCancelAnimationFrame = (handle: number): void => {
    const frameWindow = window as Window & { __foliaNativeCancelAnimationFrame?: typeof cancelAnimationFrame };
    const native = frameWindow.__foliaNativeCancelAnimationFrame;
    if (native) native.call(window, handle);
    else window.cancelAnimationFrame(handle);
};

const stopFrameLoop = (): void => {
    if (frameLoopHandle !== null) {
        nativeCancelAnimationFrame(frameLoopHandle);
        frameLoopHandle = null;
    }
};

const onFrame = (timestamp: number): void => {
    frameLoopHandle = null;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const tickAtMs = nowMs();
    if (lastTickAtMs !== null) visibleMs += Math.max(0, tickAtMs - lastTickAtMs);
    lastTickAtMs = tickAtMs;
    frameCount += 1;
    if (lastFrameAt !== null) noteFrameSample(timestamp - lastFrameAt, timestamp);
    lastFrameAt = timestamp;
    frameLoopHandle = nativeRequestAnimationFrame(onFrame);
};

const onVisibilityChange = (): void => {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'hidden') {
        hiddenSinceMs = nowMs();
        stopFrameLoop();
        return;
    }
    if (hiddenSinceMs !== null) {
        hiddenMs += Math.max(0, nowMs() - hiddenSinceMs);
        hiddenSinceMs = null;
    }
    // 后台期间的时间不算帧间隔，恢复后从新的一帧重新起算。
    lastFrameAt = null;
    lastTickAtMs = null;
    bucketStartedAt = null;
    bucketFrames = 0;
    if (frameLoopHandle === null) frameLoopHandle = nativeRequestAnimationFrame(onFrame);
};

const installLongTaskObserver = (): void => {
    if (typeof PerformanceObserver === 'undefined') return;
    try {
        const observer = new PerformanceObserver((list) => {
            list.getEntries().forEach((entry) => {
                const duration = entry.duration;
                if (!Number.isFinite(duration) || duration < LONG_TASK_THRESHOLD_MS) return;
                if (insideProbeWindow(entry.startTime)) return;
                longTasks = {
                    ...longTasks,
                    count: longTasks.count + 1,
                    totalMs: longTasks.totalMs + duration,
                    maxMs: Math.max(longTasks.maxMs, duration),
                };
                const attribution = (entry as PerformanceEntry & { attribution?: Array<{ name?: string }> })
                    .attribution?.[0]?.name ?? 'unknown';
                if (attribution === 'self' || attribution === 'same-origin') {
                    longTasks = { ...longTasks, selfCount: longTasks.selfCount + 1 };
                } else if (attribution === 'unknown') {
                    longTasks = { ...longTasks, unknownCount: longTasks.unknownCount + 1 };
                } else {
                    longTasks = { ...longTasks, otherCount: longTasks.otherCount + 1 };
                }
            });
        });
        // buffered 让启动阶段（首屏渲染、会话恢复）的长任务也进入统计，那正是用户投诉最多的一段。
        observer.observe({ type: 'longtask', buffered: true } as PerformanceObserverInit);
    } catch {
        // 浏览器不支持 longtask 就只用帧间隔判断，不影响其它诊断。
    }
};

/**
 * Long Animation Frame：给「这一帧到底被谁占住」做归因。
 * longtask 只能说「主线程卡了 113ms」，LoAF 能说是脚本 90ms 还是样式/布局 60ms，
 * 并给出最重的那个脚本文件/函数名。
 */
const installLongAnimationFrameObserver = (): void => {
    if (typeof PerformanceObserver === 'undefined') return;
    try {
        const observer = new PerformanceObserver((list) => {
            list.getEntries().forEach((entry) => {
                if (insideProbeWindow(entry.startTime)) return;
                const summary = summarizeLongAnimationFrame(entry as unknown as LongAnimationFrameEntryLike);
                if (summary.blockingMs < LONG_ANIMATION_FRAME_THRESHOLD_MS) return;
                longAnimationFrames = {
                    ...longAnimationFrames,
                    count: longAnimationFrames.count + 1,
                    maxBlockingMs: Math.max(longAnimationFrames.maxBlockingMs, summary.blockingMs),
                    scriptMs: longAnimationFrames.scriptMs + summary.scriptMs,
                    styleLayoutMs: longAnimationFrames.styleLayoutMs + summary.styleLayoutMs,
                    samples: [
                        ...longAnimationFrames.samples,
                        {
                            blockingMs: summary.blockingMs,
                            scriptMs: summary.scriptMs,
                            styleLayoutMs: summary.styleLayoutMs,
                            invoker: summary.invoker || 'unknown',
                            atMs: entry.startTime,
                        },
                    ].slice(-MAX_LOAF_SAMPLES),
                };
                if (summary.blockingMs >= longAnimationFrames.worstBlockingMs) {
                    longAnimationFrames = {
                        ...longAnimationFrames,
                        worstBlockingMs: summary.blockingMs,
                        worstScriptMs: summary.scriptMs,
                        worstStyleLayoutMs: summary.styleLayoutMs,
                        worstInvoker: summary.invoker || 'unknown',
                        worstAtMs: entry.startTime,
                    };
                }
            });
        });
        observer.observe({ type: 'long-animation-frame', buffered: true } as PerformanceObserverInit);
    } catch {
        // Chrome < 123 没有 LoAF：longtask / 帧间隔仍然照旧记录。
    }
};

export const installFrameTimingDiagnostics = (): void => {
    if (installed) return;
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return;
    installed = true;
    installedAtMs = nowMs();
    installLongTaskObserver();
    installLongAnimationFrameObserver();
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') hiddenSinceMs = nowMs();
    else frameLoopHandle = nativeRequestAnimationFrame(onFrame);
    if (typeof document !== 'undefined') {
        visibilityListener = onVisibilityChange;
        document.addEventListener('visibilitychange', visibilityListener);
        // 捕获阶段监听：列表、3D 网格这些内部滚动容器的 scroll 事件也会冒到这里。
        motionListener = noteMotionActivity;
        document.addEventListener('scroll', motionListener, { capture: true, passive: true });
        document.addEventListener('touchmove', motionListener, { capture: true, passive: true });
    }
};

/** 测试与诊断用：把采样状态复位，避免用例之间互相污染。 */
export const resetFrameTimingDiagnostics = (): void => {
    stopFrameLoop();
    if (visibilityListener && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', visibilityListener);
    }
    visibilityListener = null;
    if (motionListener && typeof document !== 'undefined') {
        document.removeEventListener('scroll', motionListener, { capture: true } as EventListenerOptions);
        document.removeEventListener('touchmove', motionListener, { capture: true } as EventListenerOptions);
    }
    motionListener = null;
    installed = false;
    intervalCursor = 0;
    intervalCount = 0;
    motionCursor = 0;
    motionIntervalCount = 0;
    motionSlowCount = 0;
    motionJankCount = 0;
    motionFreezeCount = 0;
    motionUntilMs = 0;
    installedAtMs = null;
    lastFrameAt = null;
    lastTickAtMs = null;
    hiddenSinceMs = null;
    visibleMs = 0;
    hiddenMs = 0;
    frameCount = 0;
    sessionSlowCount = 0;
    sessionJankCount = 0;
    sessionFreezeCount = 0;
    longestFreezeMs = 0;
    bucketStartedAt = null;
    bucketFrames = 0;
    worstSecondFps = null;
    recentSecondFps = null;
    longTasks = emptyLongTasks();
    longAnimationFrames = emptyLongAnimationFrames();
    probeFromMs = null;
    probeUntilMs = null;
};

export const readFrameTimingSnapshot = (): FrameTimingSnapshot => {
    const intervals = readIntervals();
    const stats = computeFrameStats(intervals);
    const refreshHz = estimateRefreshRateHz(intervals);
    const navigatorRef = typeof navigator === 'undefined' ? null : navigator;
    const cores = navigatorRef && Number.isFinite(navigatorRef.hardwareConcurrency)
        ? navigatorRef.hardwareConcurrency
        : null;
    const rawMemory = (navigatorRef as (Navigator & { deviceMemory?: number }) | null)?.deviceMemory;
    const memoryGb = typeof rawMemory === 'number' && Number.isFinite(rawMemory) ? rawMemory : null;
    return {
        installed,
        installedAtMs,
        visibleMs,
        hiddenMs,
        frameCount,
        intervals,
        stats,
        sessionSlowCount,
        sessionJankCount,
        sessionFreezeCount,
        longestFreezeMs,
        worstSecondFps,
        recentSecondFps,
        refreshHz,
        cores,
        memoryGb,
        deviceClass: describeDeviceClass(cores, memoryGb),
        longTasks,
        longAnimationFrames,
        motion: {
            count: motionIntervalCount,
            stats: computeFrameStats(readMotionIntervals()),
            slowCount: motionSlowCount,
            jankCount: motionJankCount,
            freezeCount: motionFreezeCount,
        },
        renderHealth: classifyRenderHealth(stats, refreshHz),
    };
};
