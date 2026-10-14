import React from 'react';
import { DEFAULT_MONET_TUNING } from '../../../types';
import { defineVisualizer } from '../definition';

const VisualizerMonet = React.lazy(() => import('./VisualizerMonet'));
const MonetSettingsPanel = React.lazy(async () => ({
    default: (await import('./MonetSettingsPanel')).MonetSettingsPanel,
}));

// src/ui/visualizer/monet/entry.tsx
// Registers the Monet poster visualizer and its mode-owned settings panel.
export default defineVisualizer({
    mode: 'monet',
    order: 90,
    labelKey: 'ui.visualizerMonet',
    labelFallback: 'Monet',
    previewSeed: 'monet',
    previewStartOffset: 0,
    tuningKind: 'monet',
    render: props => {
        const monetTuning = props.monetTuning ?? DEFAULT_MONET_TUNING;
        const lyricsFontScale = props.lyricsFontScale ?? 1;
        return (
            <VisualizerMonet
                {...props}
                monetTuning={{
                    ...monetTuning,
                    fontScale: monetTuning.fontScale * lyricsFontScale,
                }}
            />
        );
    },
    renderSettingsPanel: props => (
        <React.Suspense fallback={null}><MonetSettingsPanel {...props} /></React.Suspense>
    ),
    resetSettings: ({ resetMonetTuning }) => {
        resetMonetTuning?.();
    },
});
