import React from 'react';
import '../../src/i18n/config';
import PonderHost from '../../src/components/ponder/PonderHost';
import { usePonderStore } from '../../src/stores/usePonderStore';
import type { Theme } from '../../src/types';
import type { ProbeDefinition } from './definition';

// dev/probes/ponderBravaisSeam.probe.tsx
// bravais 信息条那一篇（bravais-seam）的六章，各一颗按钮直接开到那一章。
// 不并进 ponderPageSurfaces 的那张大表：墙那一篇（bravais-wall）是分头写的，各有各的探针，合并时不抢同一处。

const PROBE_THEME = { accentColor: '#f43f5e' } as Theme;

const SCENES = ['levels', 'collection', 'home-navigation', 'home-dock', 'filter', 'tools'] as const;

const ProbeBody: React.FC = () => (
    <div className="min-h-screen bg-zinc-950 p-6 text-zinc-100">
        <div className="flex flex-wrap gap-2">
            {SCENES.map((scene, index) => (
                <button
                    key={scene}
                    type="button"
                    data-probe-open={`bravais-seam-${scene}`}
                    onClick={() => usePonderStore.getState().openPonder('bravais-seam', index)}
                    className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs"
                >
                    {scene}
                </button>
            ))}
        </div>
        <PonderHost theme={PROBE_THEME} isDaylight={false} />
    </div>
);

const probe: ProbeDefinition = {
    id: 'ponderBravaisSeam',
    title: 'Ponder · bravais info strip',
    description: 'The six chapters of the bravais-seam tutorial: widths, collection strip, home strip, dock, filter vs search, wall tools',
    Component: ProbeBody,
};

export default probe;
