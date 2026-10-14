import React from 'react';
import { defineVisualizer } from '../definition';

const VisualizerCappella = React.lazy(() => import('./VisualizerCappella'));
const CappellaSettingsPanel = React.lazy(async () => ({
    default: (await import('../settingsPanels')).CappellaSettingsPanel,
}));

// src/ui/visualizer/cappella/entry.tsx
// Registers the Cappella chat visualizer mode.
export default defineVisualizer({
    mode: 'cappella',
    order: 110,
    labelKey: 'ui.visualizerCappella',
    labelFallback: 'Cappella',
    previewSeed: 'cappella',
    previewStartOffset: 0,
    tuningKind: 'cappella',
    render: props => <VisualizerCappella {...props} />,
    renderSettingsPanel: props => (
        <React.Suspense fallback={null}><CappellaSettingsPanel {...props} /></React.Suspense>
    ),
    resetSettings: props => {
        props.resetCappellaTuning?.();
    },
});
