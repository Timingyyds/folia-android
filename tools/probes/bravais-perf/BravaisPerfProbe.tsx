import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BRAVAIS_LAYOUT_STORAGE_PREFIX } from '../../../src/library/suites/bravais/entry';
import { useBravaisUiStore } from '../../../src/library/suites/bravais/bravaisUiStore';
import { useLibraryWallLookStore } from '../../../src/stores/useLibraryWallLookStore';
import { restoreGlobalVisualizerFrameRateLimiter, setGlobalVisualizerFrameRate } from '../../../src/utils/frameRateLimiter';
import type { VisualizerMode } from '../../../src/types';
import { buildPerfJobs, describeLook, readPerfDefaults, type PerfJob, type PerfLook, type PerfRequest, type PerfScenario, PERF_LOOKS, PERF_SCENARIOS } from './perfConfig';
import { loadPerfCovers } from './perfLayers';
import { runPerfJob } from './perfRun';
import { aggregateResults, formatPerfTable, type PerfResult } from './perfStats';
import PerfStageHost, { type PerfDriver, type PerfStageCounters } from './PerfStageHost';
import PerfVisualizer from './PerfVisualizer';
import './probeApi';
import './probe.css';

// dev/probes/bravais-perf/BravaisPerfProbe.tsx
// bravais 性能探针的主体（?probe=bravaisPerf）：底下可选一个真实 visualizer，上面挂真实的 BravaisStage，按任务矩阵
// （条目数 × 场景 × 透光档 × 每块窗数 × 缝 blur × 重复）一轮一轮地跑：每轮重新挂 stage（首屏）→ 预热 → 运动 → 停稳。
// 空闲时显示一份可拖动、可点的预览。用法、URL 参数与换机实测步骤见同目录 README.md。
//
// 自动化入口 window.__bravaisPerfProbe（类型在 probeApi.ts）：ready()，run(request?) → Promise<PerfResult[]>，results()，rows()，table()，
// busy()，status()。

type ActiveJob = { job: PerfJob; index: number };

const DEFAULTS = readPerfDefaults(window.location.search);
const AUTORUN = new URLSearchParams(window.location.search).get('autorun') === '1';
/** 两轮之间留白：上一轮的 stage 卸载、实色档卸掉的 visualizer 重新挂上，都不算进下一轮的首屏。 */
const GAP_MS = 400;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** 每轮从同一个起点开始：清掉布局记忆（相机、缝锚点、起点）与面板。 */
const resetBravaisSession = () => {
    try {
        for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
            const key = sessionStorage.key(index);
            if (key?.startsWith(BRAVAIS_LAYOUT_STORAGE_PREFIX)) sessionStorage.removeItem(key);
        }
    } catch {
        // sessionStorage 不可用：本来也没有记忆。
    }
    useBravaisUiStore.setState({ panelFor: null });
};

/** 透光偏好直接写 store 的内存值（不经 setLook，不写 localStorage，不影响同源的真实应用）。 */
const applyWallLook = (job: Pick<PerfJob, 'look' | 'windows'>) => {
    const look = job.look === 'solid-keep' ? 'solid' : job.look;
    useLibraryWallLookStore.setState(current => ({ look, windowsPerBlock: job.windows > 0 ? job.windows : current.windowsPerBlock }));
};

const makePreviewJob = (items: number, look: PerfLook, windows: number, scenario: PerfScenario): PerfJob => ({
    ...buildPerfJobs({ ...DEFAULTS, items: [items], looks: [look], windows: [windows], scenarios: [scenario], seamBlur: [false], repeats: 1 })[0]!,
});

const download = (results: readonly PerfResult[]) => {
    const payload = {
        meta: { userAgent: navigator.userAgent, viewport: `${innerWidth}×${innerHeight}@${devicePixelRatio}`, date: new Date().toISOString(), defaults: DEFAULTS },
        rows: aggregateResults(results),
        results,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `bravais-perf-${Date.now()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const fmt = (value: number, digits = 1) => value.toFixed(digits);

const BravaisPerfProbe: React.FC = () => {
    const [covers, setCovers] = useState<string[] | null>(null);
    const [active, setActive] = useState<ActiveJob | null>(null);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const [status, setStatus] = useState({ done: 0, total: 0, label: 'idle' });
    const statusRef = useRef(status);
    statusRef.current = status;
    const [results, setResults] = useState<PerfResult[]>([]);
    const resultsRef = useRef<PerfResult[]>([]);
    const [occluded, setOccluded] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const counters = useRef<PerfStageCounters>({ commits: 0, commitMs: 0 }).current;
    const driverRef = useRef<PerfDriver | null>(null);
    const pendingMountRef = useRef<((driver: PerfDriver) => void) | null>(null);
    const [preview, setPreview] = useState({ items: DEFAULTS.items[0]!, look: 'partial' as PerfLook, windows: 3, scenario: 'idle' as PerfScenario });

    useEffect(() => { void loadPerfCovers().then(setCovers); }, []);

    const onDriver = useCallback((driver: PerfDriver | null) => {
        driverRef.current = driver;
        if (driver && pendingMountRef.current) {
            const resolve = pendingMountRef.current;
            pendingMountRef.current = null;
            resolve(driver);
        }
    }, []);

    const run = useCallback(async (request: PerfRequest = {}) => {
        if (!covers || busyRef.current) return resultsRef.current;
        const jobs = buildPerfJobs({ ...DEFAULTS, ...request });
        const controller = new AbortController();
        abortRef.current = controller;
        busyRef.current = true;
        setBusy(true);
        const original = useLibraryWallLookStore.getState();
        const saved = { look: original.look, windowsPerBlock: original.windowsPerBlock };
        try {
            for (const [index, job] of jobs.entries()) {
                setActive(null);
                await sleep(GAP_MS);
                if (controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
                resetBravaisSession();
                applyWallLook(job);
                setGlobalVisualizerFrameRate(job.fpsCap);
                const label = `${job.items} / ${job.scenario} / ${describeLook(job)} / #${job.repeat}`;
                const result = await runPerfJob(job, {
                    mount: () => new Promise<PerfDriver>((resolve) => {
                        pendingMountRef.current = resolve;
                        setActive({ job, index });
                    }),
                    counters,
                    signal: controller.signal,
                    onPhase: phase => setStatus({ done: index, total: jobs.length, label: `${label} · ${phase}` }),
                });
                resultsRef.current = [...resultsRef.current, result];
                setResults(resultsRef.current);
            }
            setStatus({ done: jobs.length, total: jobs.length, label: 'done' });
        } catch (error) {
            setStatus(current => ({ ...current, label: (error as Error).name === 'AbortError' ? 'stopped' : String(error) }));
        } finally {
            pendingMountRef.current = null;
            setActive(null);
            useLibraryWallLookStore.setState(saved);
            restoreGlobalVisualizerFrameRateLimiter();
            busyRef.current = false;
            setBusy(false);
        }
        return resultsRef.current;
    }, [counters, covers]);

    useEffect(() => {
        window.__bravaisPerfProbe = {
            ready: () => covers !== null,
            run,
            results: () => resultsRef.current,
            rows: () => aggregateResults(resultsRef.current),
            table: () => formatPerfTable(aggregateResults(resultsRef.current)),
            busy: () => busyRef.current,
            status: () => ({ busy: busyRef.current, ...statusRef.current }),
        };
        return () => { delete window.__bravaisPerfProbe; };
    }, [covers, run]);

    const autorunStarted = useRef(false);
    useEffect(() => {
        if (!AUTORUN || !covers || autorunStarted.current) return;
        autorunStarted.current = true;
        void run();
    }, [covers, run]);

    // 切到后台时 rAF 停摆，读数没有意义：停掉，已完成的结果保留。
    useEffect(() => {
        const onHidden = () => { if (document.hidden) abortRef.current?.abort(); };
        document.addEventListener('visibilitychange', onHidden);
        return () => document.removeEventListener('visibilitychange', onHidden);
    }, []);

    // 空闲预览：按面板上的选择挂一份（可以拖动、点磁贴）。
    const previewJob = useMemo(() => makePreviewJob(preview.items, preview.look, preview.windows, preview.scenario), [preview]);
    useEffect(() => { if (!busy) applyWallLook(previewJob); }, [busy, previewJob]);
    const shown: ActiveJob | null = busy ? active : { job: previewJob, index: -1 };

    // 宿主的遮挡通道：stage 报遮挡（实色档）时卸载 visualizer；stage 卸载时复位（与 App 的 useLibraryPlayerOcclusionStore 同语义）。
    const onOcclusion = useCallback((occludes: boolean) => setOccluded(occludes), []);
    useEffect(() => { if (!shown) setOccluded(false); }, [shown]);
    const job = shown?.job ?? previewJob;
    // 只有 solid 照真实应用卸载；solid-keep 同样报遮挡，但对照组故意不卸。
    const showVisualizer = job.visualizer !== 'none' && (job.look !== 'solid' || !occluded);
    const rows = useMemo(() => aggregateResults(results), [results]);

    return (
        <div className="bperf-root">
            {showVisualizer && <PerfVisualizer mode={job.visualizer as VisualizerMode} quality={job.quality} showText={job.showText} />}
            {covers && shown && (
                <PerfStageHost
                    key={`${shown.index}:${shown.job.items}:${shown.job.scenario}`}
                    job={shown.job}
                    covers={covers}
                    counters={counters}
                    onOcclusion={onOcclusion}
                    onDriver={onDriver}
                />
            )}
            <div className={`bperf-panel${busy ? ' is-collapsed' : ''}`}>
                {busy ? (
                    <output data-testid="bperf-status">{status.done + 1}/{status.total} {status.label}</output>
                ) : (
                    <>
                        <h1>bravais 性能探针</h1>
                        <p>真实 BravaisStage + 合成层描述；visualizer：{DEFAULTS.visualizer}（{DEFAULTS.quality}，showText {String(DEFAULTS.showText)}）；帧率限制 {String(DEFAULTS.fpsCap)}。每轮：挂载 → 预热 {DEFAULTS.warmupMs}ms → 运动 {DEFAULTS.seconds}s → 停稳 {DEFAULTS.settleMs}ms。保持页面前台、只开这一个探针页面。</p>
                        <fieldset disabled={!covers}>
                            <span>预览</span>
                            <select value={preview.items} onChange={event => setPreview(current => ({ ...current, items: Number(event.target.value) }))}>
                                {[...new Set([...DEFAULTS.items, 500, 5000])].map(value => <option key={value} value={value}>{value} 首</option>)}
                            </select>
                            <select value={preview.look} onChange={event => setPreview(current => ({ ...current, look: event.target.value as PerfLook }))}>
                                {PERF_LOOKS.map(value => <option key={value} value={value}>{value}</option>)}
                            </select>
                            <select value={preview.windows} disabled={preview.look !== 'partial'} onChange={event => setPreview(current => ({ ...current, windows: Number(event.target.value) }))}>
                                {[1, 2, 3, 4, 5, 6].map(value => <option key={value} value={value}>每块 {value} 窗</option>)}
                            </select>
                            <select value={preview.scenario} onChange={event => setPreview(current => ({ ...current, scenario: event.target.value as PerfScenario }))}>
                                {PERF_SCENARIOS.map(value => <option key={value} value={value}>{value === 'tab' ? '首页层' : `集合层（${value}）`}</option>)}
                            </select>
                            <button type="button" onClick={() => void run()}>运行 URL 参数的矩阵（{buildPerfJobs(DEFAULTS).length} 轮）</button>
                        </fieldset>
                        <fieldset>
                            <button type="button" disabled={!results.length} onClick={() => download(resultsRef.current)}>导出 JSON</button>
                            <button type="button" disabled={!results.length} onClick={() => void navigator.clipboard?.writeText(formatPerfTable(rows))}>复制 Markdown 表</button>
                            <button type="button" disabled={!results.length} onClick={() => { resultsRef.current = []; setResults([]); }}>清空</button>
                            <output data-testid="bperf-status">{status.label}</output>
                        </fieldset>
                        {rows.length > 0 && (
                            <table>
                                <thead>
                                    <tr><th>条目</th><th>场景</th><th>档位</th><th>fps</th><th>p95</th><th>p99</th><th>&gt;33</th><th>LoAF</th><th>底板重画</th><th>磁贴渲染</th><th>动画峰值</th><th>首块 ms</th><th>堆 MB</th><th>vis</th></tr>
                                </thead>
                                <tbody>
                                    {rows.map(row => (
                                        <tr key={row.key}>
                                            <td>{row.items}</td><td>{row.scenario}</td><td>{row.look}</td><td>{fmt(row.fps)}</td><td>{fmt(row.p95)}</td><td>{fmt(row.p99)}</td>
                                            <td>{fmt(row.over33, 0)}</td><td>{fmt(row.loaf, 0)}</td><td>{fmt(row.plateRedraws, 0)}</td><td>{fmt(row.tileRenders, 0)}</td>
                                            <td>{fmt(row.peakAnimated, 0)}</td><td>{fmt(row.firstTileMs, 0)}</td><td>{row.heapMB === null ? '—' : fmt(row.heapMB, 0)}</td><td>{row.visualizer}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default BravaisPerfProbe;
