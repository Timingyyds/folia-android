import type { LumiereRenderQuality, VisualizerFrameRate } from '../../../src/types';

// dev/probes/bravais-perf/perfConfig.ts
// bravais 性能探针的参数与任务矩阵（纯函数，不碰 DOM）：URL 参数 / window.__bravaisPerfProbe.run() 的请求 → 一串按顺序跑的
// 任务（条目数 × 场景 × 透光档 × 每块窗数 × 缝 blur × 重复）。每轮重复把档位顺序轮换一格，减少预热 / 温度带来的系统性偏差。

/**
 * 运动场景：
 * - idle：静止；
 * - pan：大范围往返拖动（经真实的滚轮处理，x 一个来回约 ±2.2 屏、y 两个来回约 ±1.6 屏，跨过大量块边界，会重新裁剪）；
 * - drift：小范围拖动（±110 / ±70px，停在已裁剪的范围里：块底板随世界层平移，不重画底板、不重渲染磁贴的护栏）；
 * - flip：整面翻牌（每 1.5s 进出一次有限态过滤，从缝的两侧边缘翻）；
 * - expand：连续聚焦放大（每 0.9s 点另一个块里的一张，新旧两块同时让位重排）；
 * - tab：首页整墙出场 / 入场（每 1.3s 换一次页签）。
 * tab 用首页层（卡片），其余用集合层（曲目），与真实应用里各自出现的地方一致。
 */
export type PerfScenario = 'idle' | 'pan' | 'drift' | 'flip' | 'expand' | 'tab';
export const PERF_SCENARIOS: readonly PerfScenario[] = ['idle', 'pan', 'drift', 'flip', 'expand', 'tab'];
export const DEFAULT_PERF_SCENARIOS: readonly PerfScenario[] = ['idle', 'pan', 'flip', 'expand', 'tab'];

/**
 * 透光档：solid / partial / clear 是 bravais 的三档；solid-keep 是对照组——实色档但 visualizer 仍挂着（今天 App 在实色档
 * 首页卸载 visualizer，这一组量的是「不卸载」要多付多少）。solid 照真实应用：stage 报遮挡后探针卸载 visualizer。
 */
export type PerfLook = 'solid' | 'solid-keep' | 'partial' | 'clear';
export const PERF_LOOKS: readonly PerfLook[] = ['solid', 'solid-keep', 'partial', 'clear'];

export type PerfJob = {
    items: number;
    look: PerfLook;
    /** 部分透明的每块窗数（1–6）；其他档为 0。 */
    windows: number;
    scenario: PerfScenario;
    /** 透明档下缝的纸条是否 backdrop blur（与 bravais.css 的 has-seam-blur 同一条规则，见 probe.css）。 */
    seamBlur: boolean;
    /** 墙下面挂的 visualizer：'none' 或一个 visualizer 模式（默认绘光）。 */
    visualizer: string;
    quality: LumiereRenderQuality;
    /** visualizer 是否渲染歌词文字。真实首页不渲染（useVisualizerRendererModel 的 showText 只在播放页为真），默认 false。 */
    showText: boolean;
    /** 全局 visualizer 帧率限制（utils/frameRateLimiter，与设置「图形 → 帧率限制」同一个开关；它会限住整页的 rAF）。 */
    fpsCap: VisualizerFrameRate;
    seconds: number;
    warmupMs: number;
    settleMs: number;
    repeat: number;
};

export type PerfRequest = {
    items?: readonly number[];
    looks?: readonly PerfLook[];
    windows?: readonly number[];
    scenarios?: readonly PerfScenario[];
    seamBlur?: readonly boolean[];
    repeats?: number;
    seconds?: number;
    warmupMs?: number;
    settleMs?: number;
    visualizer?: string;
    quality?: LumiereRenderQuality;
    showText?: boolean;
    fpsCap?: VisualizerFrameRate;
};

export type PerfDefaults = Required<PerfRequest>;

const BUILTIN_DEFAULTS: PerfDefaults = {
    items: [500, 5000],
    looks: PERF_LOOKS,
    windows: [1, 3, 6],
    scenarios: DEFAULT_PERF_SCENARIOS,
    seamBlur: [false],
    repeats: 1,
    seconds: 6,
    warmupMs: 2500,
    settleMs: 1200,
    visualizer: 'lumiere',
    quality: 'full',
    showText: false,
    fpsCap: 'off',
};

const list = (value: string | null) => value?.split(',').map(part => part.trim()).filter(Boolean) ?? null;

const parseFpsCap = (value: string | null): VisualizerFrameRate | null => {
    if (value === null) return null;
    if (value === 'off') return 'off';
    const parsed = Number(value);
    return parsed === 60 || parsed === 90 || parsed === 120 ? parsed : null;
};

/** URL 参数 → 默认请求（缺省用内置默认）。非法值丢掉、回默认，不抛错：探针是给人手敲 URL 的。 */
export const readPerfDefaults = (search: string): PerfDefaults => {
    const params = new URLSearchParams(search);
    const numbers = (key: string) => list(params.get(key))?.map(Number).filter(value => Number.isFinite(value) && value > 0) ?? null;
    const items = numbers('items');
    const windows = numbers('windows')?.map(value => Math.min(6, Math.max(1, Math.round(value))));
    const looks = list(params.get('looks'))?.filter((value): value is PerfLook => (PERF_LOOKS as readonly string[]).includes(value));
    const scenarios = list(params.get('scenarios'))?.filter((value): value is PerfScenario => (PERF_SCENARIOS as readonly string[]).includes(value));
    const seamBlur = list(params.get('blur'))?.map(value => value === '1' || value === 'true');
    const number = (key: string, fallback: number) => {
        const value = Number(params.get(key));
        return params.has(key) && Number.isFinite(value) && value > 0 ? value : fallback;
    };
    const quality = params.get('quality');
    return {
        items: items?.length ? items : BUILTIN_DEFAULTS.items,
        looks: looks?.length ? looks : BUILTIN_DEFAULTS.looks,
        windows: windows?.length ? windows : BUILTIN_DEFAULTS.windows,
        scenarios: scenarios?.length ? scenarios : BUILTIN_DEFAULTS.scenarios,
        seamBlur: seamBlur?.length ? seamBlur : BUILTIN_DEFAULTS.seamBlur,
        repeats: Math.round(number('repeats', BUILTIN_DEFAULTS.repeats)),
        seconds: number('seconds', BUILTIN_DEFAULTS.seconds),
        warmupMs: number('warmup', BUILTIN_DEFAULTS.warmupMs),
        settleMs: number('settle', BUILTIN_DEFAULTS.settleMs),
        visualizer: params.get('vis') ?? BUILTIN_DEFAULTS.visualizer,
        quality: quality === 'balanced' || quality === 'low' || quality === 'full' ? quality : BUILTIN_DEFAULTS.quality,
        showText: params.has('text') ? params.get('text') === '1' : BUILTIN_DEFAULTS.showText,
        fpsCap: parseFpsCap(params.get('fps')) ?? BUILTIN_DEFAULTS.fpsCap,
    };
};

type PerfVariant = { look: PerfLook; windows: number; seamBlur: boolean };

/** 档位 × 窗数 × 缝 blur 的组合：窗数只对部分透明有意义，blur 只对透明档有意义（实色档的缝是实色纸条）。 */
const expandVariants = (request: PerfDefaults): PerfVariant[] => {
    const variants: PerfVariant[] = [];
    for (const look of request.looks) {
        const blurs = look === 'solid' || look === 'solid-keep' ? [false] : [...new Set(request.seamBlur)];
        const windows = look === 'partial' ? [...new Set(request.windows)] : [0];
        for (const seamBlur of blurs) for (const count of windows) variants.push({ look, windows: count, seamBlur });
    }
    return variants;
};

/** 请求 → 按顺序跑的任务。重复之间轮换档位顺序（与 latticePerformance / bravaisVeil 台架同一做法）。 */
export const buildPerfJobs = (request: PerfDefaults): PerfJob[] => {
    const variants = expandVariants(request);
    const jobs: PerfJob[] = [];
    for (let repeat = 0; repeat < request.repeats; repeat += 1) {
        for (const items of request.items) {
            for (const scenario of request.scenarios) {
                for (let index = 0; index < variants.length; index += 1) {
                    const variant = variants[(index + repeat) % variants.length]!;
                    jobs.push({
                        items,
                        ...variant,
                        scenario,
                        visualizer: request.visualizer,
                        quality: request.quality,
                        showText: request.showText,
                        fpsCap: request.fpsCap,
                        seconds: request.seconds,
                        warmupMs: request.warmupMs,
                        settleMs: request.settleMs,
                        repeat: repeat + 1,
                    });
                }
            }
        }
    }
    return jobs;
};

/** 结果表里同一组（各次重复取中位数）的键。 */
export const perfGroupKey = (job: PerfJob) => (
    `${job.items}|${job.scenario}|${job.look}|${job.windows}|${job.seamBlur ? 1 : 0}`
);

/** 档位的人读名：partial·3、clear+blur。 */
export const describeLook = (job: Pick<PerfJob, 'look' | 'windows' | 'seamBlur'>) => (
    `${job.look}${job.look === 'partial' ? `·${job.windows}` : ''}${job.seamBlur ? '+blur' : ''}`
);
