import React, { Suspense } from 'react';
import type { ProbeDefinition } from './definition';

// dev/probes/bravaisPerf.probe.tsx
// bravais 性能探针的登记（B12a）。主体在 bravais-perf/ 里，按需加载：探针 registry 是 eager glob，这里若静态 import
// BravaisStage，bravais.css / wall.css 会进入每一个探针页面（包括别的组件用例的截图）。
// 用法、URL 参数与换机实测步骤见 dev/probes/bravais-perf/README.md。

const BravaisPerfProbe = React.lazy(() => import('./bravais-perf/BravaisPerfProbe'));

const BravaisPerfProbeEntry: React.FC = () => (
    <Suspense fallback={null}>
        <BravaisPerfProbe />
    </Suspense>
);

const definition: ProbeDefinition = {
    id: 'bravaisPerf',
    title: 'Bravais · 性能探针（真实 stage）',
    description: '真实 BravaisStage + 合成首页 / 集合层，底下可挂绘光 visualizer；条目数 × 透光三档 × 每块窗数 × 场景（静止 / 大范围拖动 / 小范围拖动 / 整面翻牌 / 连续放大 / 换页签）'
        + '自动跑并导出 JSON。参数：items= looks= windows= scenarios= blur= repeats= seconds= vis= quality= text= fps= autorun=1（见 bravais-perf/README.md）',
    Component: BravaisPerfProbeEntry,
};

export default definition;
