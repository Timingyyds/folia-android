import React from 'react';
import { DEFAULT_FUME_TUNING } from '../../../types';
import { defineVisualizer } from '../definition';

const VisualizerFume = React.lazy(() => import('./VisualizerFume'));
const FumeSettingsPanel = React.lazy(async () => ({
    default: (await import('../settingsPanels')).FumeSettingsPanel,
}));

// src/ui/visualizer/fume/entry.tsx
// Registers Fume and its preview tuning panel.
export default defineVisualizer({
    mode: 'fume',
    order: 60,
    labelKey: 'ui.visualizerFume',
    labelFallback: 'Fume',
    previewSeed: 'fume',
    previewStartOffset: 18.4,
    tuningKind: 'fume',
    render: props => <VisualizerFume {...props} />,
    renderSettingsPanel: props => (
        <React.Suspense fallback={null}><FumeSettingsPanel {...props} /></React.Suspense>
    ),
    resetSettings: ({ resetFumeTuning, setDraftFumeTuning }) => {
        setDraftFumeTuning?.(DEFAULT_FUME_TUNING);
        resetFumeTuning?.();
    },
});
