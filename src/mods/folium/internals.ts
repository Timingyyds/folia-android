import React from 'react';
import * as ReactDOMClient from 'react-dom/client';
import { usePlaybackStore } from '@/state/usePlaybackStore';
import { useAppViewStore } from '@/state/useAppViewStore';
import { useVisualizerSettingsStore } from '@/state/useVisualizerSettingsStore';
import { useThemeSettingsStore } from '@/state/useThemeSettingsStore';
import { useLyricSettingsStore } from '@/state/useLyricSettingsStore';
import { omni } from '@/svc/onlineMusic/omni';
import { VISUALIZER_REGISTRY } from '@/ui/visualizer/registry';

// src/mods/folium/internals.ts
// `folium.internals`: raw host objects for mods that accept being pinned to host
// versions (manifest "folia"). No compatibility promise of any kind — any Folia
// release may rename, reshape or remove anything here. Loaded lazily and only
// in the main window, so the export bundle never pulls the app's stores.
//
// When several mods reach for the same thing here, that is the signal to add a
// stable registry, event or service for it in the next folium minor.

export const createFoliumInternals = (): Record<string, unknown> => ({
    React,
    ReactDOMClient,
    stores: Object.freeze({
        playback: usePlaybackStore,
        appView: useAppViewStore,
        visualizerSettings: useVisualizerSettingsStore,
        themeSettings: useThemeSettingsStore,
        lyricSettings: useLyricSettingsStore,
    }),
    omni,
    visualizerRegistry: VISUALIZER_REGISTRY,
});
