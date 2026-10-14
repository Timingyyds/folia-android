import React from 'react';
import { defineVisualizer } from '../definition';

const VisualizerPartita = React.lazy(() => import('./VisualizerPartita'));
const PartitaSettingsPanel = React.lazy(async () => ({
    default: (await import('../settingsPanels')).PartitaSettingsPanel,
}));

// src/ui/visualizer/partita/entry.tsx
// Registers Partita and its preview tuning panel.
export default defineVisualizer({
    mode: 'partita',
    order: 50,
    labelKey: 'ui.visualizerPartita',
    labelFallback: '云阶',
    previewSeed: 'partita',
    previewStartOffset: 0,
    tuningKind: 'partita',
    usesWordSegmentation: true,
    render: props => <VisualizerPartita {...props} />,
    renderSettingsPanel: props => (
        <React.Suspense fallback={null}><PartitaSettingsPanel {...props} /></React.Suspense>
    ),
    resetSettings: ({ resetPartitaTuning }) => {
        resetPartitaTuning?.();
    },
});
