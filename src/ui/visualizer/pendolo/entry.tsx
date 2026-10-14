import React from 'react';
import { DEFAULT_PENDOLO_TUNING } from '../../../types';
import { defineVisualizer } from '../definition';

const VisualizerPendolo = React.lazy(() => import('./VisualizerPendolo'));
const PendoloSettingsPanel = React.lazy(() => import('./PendoloSettingsPanel'));

// src/ui/visualizer/pendolo/entry.tsx

export default defineVisualizer({
    mode: 'pendolo',
    order: 100,
    labelKey: 'ui.visualizerPendolo',
    labelFallback: 'Pendolo',
    previewSeed: 'pendolo',
    previewStartOffset: 0,
    tuningKind: 'pendolo',
    // The song-scoped seed resets Pendolo's lyric rail state before the next track starts.
    render: props => <VisualizerPendolo key={props.seed} {...props} />,
    renderSettingsPanel: props => (
        <React.Suspense fallback={null}><PendoloSettingsPanel {...props} /></React.Suspense>
    ),
    resetSettings: ({ resetPendoloTuning, setDraftPendoloTuning }) => {
        setDraftPendoloTuning?.(DEFAULT_PENDOLO_TUNING);
        resetPendoloTuning?.();
    },
});
