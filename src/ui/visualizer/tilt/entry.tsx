import React from 'react';
import { defineVisualizer } from '../definition';

const VisualizerTilt = React.lazy(() => import('./VisualizerTilt'));
const TiltSettingsPanel = React.lazy(async () => ({
    default: (await import('../settingsPanels')).TiltSettingsPanel,
}));

// src/ui/visualizer/tilt/entry.tsx
// Registers Tilt and its preview tuning panel.
export default defineVisualizer({
    mode: 'tilt',
    order: 70,
    labelKey: 'ui.visualizerTilt',
    labelFallback: 'Tilt',
    previewSeed: 'tilt',
    previewStartOffset: 0,
    tuningKind: 'tilt',
    render: props => <VisualizerTilt {...props} />,
    renderSettingsPanel: props => (
        <React.Suspense fallback={null}><TiltSettingsPanel {...props} /></React.Suspense>
    ),
    resetSettings: ({ resetTiltTuning }) => {
        resetTiltTuning?.();
    },
});
