import type { PerfRequest } from './perfConfig';
import type { aggregateResults, PerfResult } from './perfStats';

// dev/probes/bravais-perf/probeApi.ts
// window.__bravaisPerfProbe 的类型：探针（BravaisPerfProbe）实现它，组件用例与 test/manual/bravais-perf-probe.mjs 调它。
// 单独放一个只有类型的文件，用例 import 它不会把 React / stage 拉进 Node 侧。

export type BravaisPerfProbeApi = {
    /** 封面生成好了，可以 run。 */
    ready: () => boolean;
    /** 按请求（缺省用 URL 参数）跑一串任务，返回到目前为止的全部结果。正在跑时直接返回已有结果。 */
    run: (request?: PerfRequest) => Promise<PerfResult[]>;
    results: () => PerfResult[];
    /** 各组（条目数 × 场景 × 档位）取中位数的结果表。 */
    rows: () => ReturnType<typeof aggregateResults>;
    /** 同一张表的 Markdown。 */
    table: () => string;
    busy: () => boolean;
    status: () => { busy: boolean; done: number; total: number; label: string };
};

declare global {
    interface Window {
        __bravaisPerfProbe?: BravaisPerfProbeApi;
    }
}
