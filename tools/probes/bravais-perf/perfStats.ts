import { describeLook, perfGroupKey, type PerfJob } from './perfConfig';

// dev/probes/bravais-perf/perfStats.ts
// 一轮测量的读数类型与汇总（纯函数）：rAF 间隔 → fps / 分位数 / 长帧数；多次重复 → 每组取中位数的结果表。
// rAF 间隔反映的是主线程 + 合成器交付帧的节奏，不是 GPU 耗时；GPU 占用要在任务管理器 / DevTools 里另看（见 README）。

export type PhaseStats = {
    frames: number;
    fps: number;
    mean: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
    over20: number;
    /** 超过 33.4ms（两帧 @60Hz）的帧：肉眼可见的顿。 */
    over33: number;
    /** 长动画帧（LoAF，>50ms 的一帧）数量与阻塞时长合计 / 最大一帧时长。 */
    loafCount: number;
    loafBlockingMs: number;
    loafMaxMs: number;
};

export type MountStats = {
    /** 从挂载 stage 到第一张有内容的磁贴出现在 DOM 里。 */
    firstTileMs: number;
    /** 预热阶段（含挂载与首屏翻入）最长的一帧间隔、最长的长任务 / 长动画帧。 */
    worstFrameMs: number;
    longTaskMaxMs: number;
    loafMaxMs: number;
    /** 预热结束时挂着的磁贴数（虚拟化：与条目数无关，上限 400）。 */
    tiles: number;
};

export type PerfCounts = {
    /** 运动阶段 BravaisTile 函数体执行次数（StrictMode 下挂载 / 更新都是两次）。 */
    tileRenders: number;
    /**
     * 运动阶段块底板的重画次数（B12b 起底板按块画）：已挂着的块底板 <path d> 被改写的次数（MutationObserver，含聚焦卡
     * 让位期间的逐帧重画；不含新挂的块）。拖动 / 补挂只新挂块，不该有重画。
     */
    plateRedraws: number;
    /** 被重画过的块数（去重）。 */
    plateRedrawBlocks: number;
    /** 其中不是「这一轮里展开过 / 收起过聚焦卡」的块：应为 0（只重画放大的块）。 */
    strayPlateRedraws: number;
    /** 运动阶段新挂进 DOM 的块底板。 */
    platesAdded: number;
    /** 运动阶段 stage 子树的 React 提交次数与 actualDuration 合计（React.Profiler）。 */
    stageCommits: number;
    stageCommitMs: number;
    /** 运动阶段新挂进 DOM 的磁贴（重新裁剪带进来的）。 */
    tilesAdded: number;
};

export type PerfAnimation = {
    /** 运动阶段触发了几次（翻牌、换页签、放大）。 */
    triggers: number;
    /** 一次触发里内容层有 WAAPI 动画的磁贴数，取各次的最大值（翻牌上限 FLIP_MAX_TILES = 400）。 */
    peakAnimated: number;
    /** 其中完全落在「视口 + 翻牌外扩」之外的磁贴数（应为 0：屏外的只换不翻）。 */
    maxOffscreen: number;
    /** 第一张被算成屏外的磁贴（slot、矩形、外扩），排查用。 */
    offscreenExample?: string;
};

export type PerfResult = {
    job: PerfJob;
    mount: MountStats;
    motion: PhaseStats;
    settle: PhaseStats;
    counts: PerfCounts;
    animation: PerfAnimation;
    tiles: { peak: number; windows: number };
    /** performance.memory（只有 Chromium 有，粒度粗；GPU 纹理不在里面）。 */
    memory: { usedMB: number; totalMB: number } | null;
    /** 运动阶段结束时墙下面有没有 visualizer 的 canvas（实色档应当没有）。 */
    visualizerMounted: boolean;
    viewport: string;
};

const percentile = (sorted: readonly number[], q: number) => sorted[Math.floor((sorted.length - 1) * q)] ?? 0;

/** 一段 rAF 间隔 + 长动画帧 → 阶段读数。 */
export const summarizePhase = (frames: readonly number[], loafs: readonly { duration: number; blocking: number }[]): PhaseStats => {
    const sorted = [...frames].sort((a, b) => a - b);
    const total = frames.reduce((sum, value) => sum + value, 0);
    return {
        frames: frames.length,
        fps: total > 0 ? (frames.length * 1000) / total : 0,
        mean: total / Math.max(1, frames.length),
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99),
        max: sorted.at(-1) ?? 0,
        over20: frames.filter(value => value > 20).length,
        over33: frames.filter(value => value > 33.4).length,
        loafCount: loafs.length,
        loafBlockingMs: loafs.reduce((sum, value) => sum + value.blocking, 0),
        loafMaxMs: loafs.reduce((max, value) => Math.max(max, value.duration), 0),
    };
};

export const median = (values: readonly number[]) => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

/** 结果表的一行：同一组（条目数 × 场景 × 档位）各次重复的中位数。 */
export type PerfRow = {
    key: string;
    items: number;
    scenario: string;
    look: string;
    runs: number;
    fps: number;
    p95: number;
    p99: number;
    over33: number;
    loaf: number;
    plateRedraws: number;
    platesAdded: number;
    tileRenders: number;
    stageCommits: number;
    peakAnimated: number;
    firstTileMs: number;
    mountLongTaskMs: number;
    heapMB: number | null;
    visualizer: string;
};

export const aggregateResults = (results: readonly PerfResult[]): PerfRow[] => {
    const groups = new Map<string, PerfResult[]>();
    for (const result of results) {
        const key = perfGroupKey(result.job);
        groups.set(key, [...(groups.get(key) ?? []), result]);
    }
    return [...groups.entries()].map(([key, runs]) => {
        const first = runs[0]!.job;
        const pick = (read: (result: PerfResult) => number) => median(runs.map(read));
        const heaps = runs.map(result => result.memory?.usedMB).filter((value): value is number => value !== undefined);
        const mounted = runs.filter(result => result.visualizerMounted).length;
        return {
            key,
            items: first.items,
            scenario: first.scenario,
            look: describeLook(first),
            runs: runs.length,
            fps: pick(result => result.motion.fps),
            p95: pick(result => result.motion.p95),
            p99: pick(result => result.motion.p99),
            over33: pick(result => result.motion.over33),
            loaf: pick(result => result.motion.loafCount),
            plateRedraws: pick(result => result.counts.plateRedraws),
            platesAdded: pick(result => result.counts.platesAdded),
            tileRenders: pick(result => result.counts.tileRenders),
            stageCommits: pick(result => result.counts.stageCommits),
            peakAnimated: pick(result => result.animation.peakAnimated),
            firstTileMs: pick(result => result.mount.firstTileMs),
            mountLongTaskMs: pick(result => Math.max(result.mount.longTaskMaxMs, result.mount.loafMaxMs)),
            heapMB: heaps.length ? median(heaps) : null,
            visualizer: first.visualizer === 'none' ? 'none' : `${mounted}/${runs.length}`,
        };
    });
};

const fixed = (value: number, digits = 1) => value.toFixed(digits);

/** 结果表 → Markdown（复制进交接记录 / 报告）。 */
export const formatPerfTable = (rows: readonly PerfRow[]) => {
    const header = '| 条目 | 场景 | 档位 | 次数 | fps | p95 | p99 | >33ms | LoAF | 底板重画 | 新挂底板 | 磁贴渲染 | stage 提交 | 动画磁贴峰值 | 首块 ms | 首屏长任务 ms | JS 堆 MB | visualizer |';
    const divider = `|${' --- |'.repeat(18)}`;
    const lines = rows.map(row => `| ${row.items} | ${row.scenario} | ${row.look} | ${row.runs} | ${fixed(row.fps)} | ${fixed(row.p95)} | ${fixed(row.p99)} | ${fixed(row.over33, 0)} | ${fixed(row.loaf, 0)} | ${fixed(row.plateRedraws, 0)} | ${fixed(row.platesAdded, 0)} | ${fixed(row.tileRenders, 0)} | ${fixed(row.stageCommits, 0)} | ${fixed(row.peakAnimated, 0)} | ${fixed(row.firstTileMs, 0)} | ${fixed(row.mountLongTaskMs, 0)} | ${row.heapMB === null ? '—' : fixed(row.heapMB, 0)} | ${row.visualizer} |`);
    return [header, divider, ...lines].join('\n');
};
