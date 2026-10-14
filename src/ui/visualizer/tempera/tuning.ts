import { defineVisualizerTuning } from '../tuningRegistry';

// src/ui/visualizer/tempera/tuning.ts
// Injects Tempera's strongly typed tuning at the renderer boundary.
export default defineVisualizerTuning({
    mode: 'tempera',
    settingsKey: 'temperaTuning',
    settingsSetterKey: 'handleSetTemperaTuning',
    apply: (props, tuning) => ({ ...props, temperaTuning: tuning }),
});
