import React from 'react';
import { DEFAULT_CLADDAGH_TUNING } from '../../../types';
import { defineVisualizer } from '../definition';

const VisualizerCladdagh = React.lazy(() => import('./VisualizerCladdagh'));
const CladdaghSettingsPanel = React.lazy(async () => ({
    default: (await import('../settingsPanels')).CladdaghSettingsPanel,
}));

// src/ui/visualizer/claddagh/entry.tsx

export default defineVisualizer({
    mode: 'claddagh',
    order: 80,
    labelKey: 'ui.visualizerCladdagh',
    labelFallback: 'Claddagh',
    previewSeed: 'claddagh',
    previewStartOffset: 0,
    tuningKind: 'claddagh',
    render: props => <VisualizerCladdagh {...props} />,
    renderSettingsPanel: props => (
        <React.Suspense fallback={null}><CladdaghSettingsPanel {...props} /></React.Suspense>
    ),
    resetSettings: ({ resetCladdaghTuning, setDraftCladdaghTuning }) => {
        setDraftCladdaghTuning?.(DEFAULT_CLADDAGH_TUNING);
        resetCladdaghTuning?.();
    },
});
