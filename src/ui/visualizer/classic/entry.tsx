import React from 'react';
import { defineVisualizer } from '../definition';

const Visualizer = React.lazy(() => import('./Visualizer'));
const ClassicSettingsPanel = React.lazy(async () => ({
    default: (await import('../settingsPanels')).ClassicSettingsPanel,
}));

// src/ui/visualizer/classic/entry.tsx
// Registers the classic visualizer mode.
export default defineVisualizer({
    mode: 'classic',
    order: 30,
    labelKey: 'ui.visualizerClassic',
    labelFallback: 'Luminous',
    previewSeed: 'classic',
    previewStartOffset: 0,
    tuningKind: 'classic',
    usesWordSegmentation: true,
    render: props => <Visualizer {...props} />,
    renderSettingsPanel: props => (
        <React.Suspense fallback={null}><ClassicSettingsPanel {...props} /></React.Suspense>
    ),
    resetSettings: ({ resetClassicTuning }) => {
        resetClassicTuning?.();
    },
});
