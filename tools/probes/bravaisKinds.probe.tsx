import React, { Suspense } from 'react';
import type { ProbeDefinition } from './definition';
import type { BravaisKindsProbeProps } from './bravais-kinds/BravaisKindsProbe';

// dev/probes/bravaisKinds.probe.tsx
// bravais 磁贴种类区分（书脊 / 双色调人像，设计稿 §7.7）的探针登记。主体在 bravais-kinds/ 里，按需加载：探针 registry 是
// eager glob，静态 import BravaisStage 会把 bravais 的样式带进每一个探针页面。

const BravaisKindsProbe = React.lazy(() => import('./bravais-kinds/BravaisKindsProbe'));

const BravaisKindsProbeEntry: React.FC<BravaisKindsProbeProps> = props => (
    <Suspense fallback={null}>
        <BravaisKindsProbe {...props} />
    </Suspense>
);

const definition: ProbeDefinition = {
    id: 'bravaisKinds',
    title: 'Bravais · 磁贴种类（书脊 / 双色调人像）',
    description: '真实 BravaisStage + 歌曲 / 专辑 / 歌单 / 歌手 / 特殊卡混排的合成首页墙。参数：theme=midnight|daylight|vivid look=solid|partial|clear '
        + 'lights=on|off tint=on|off edges=on|off seam=paper|white|black|frost|dots|hatch|contour|check clearSeam=on|off lyrics=on|off blur=on|off '
        + 'current=<条目 key>|none mix=mixed|artists（整面墙只有歌手，双色调开销的最坏情况）',
    Component: BravaisKindsProbeEntry as React.ComponentType,
};

export default definition;
