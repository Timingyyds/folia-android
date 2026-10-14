import { PlayerState } from '../types';
import { usePlaybackStore } from '../state/usePlaybackStore';
import { useVisualizerSettingsStore } from '../state/useVisualizerSettingsStore';

// src/svc/playbackHeartbeat.ts
// Native-side breadcrumb for abrupt process deaths. One tiny bridge call every 10 seconds while
// the app is alive is far below the cost of a frame and never touches the audio path.

const HEARTBEAT_INTERVAL_MS = 10_000;

type HeartbeatPlugin = {
    recordPlaybackHeartbeat?: (payload: Record<string, unknown>) => Promise<unknown>;
};

const getPlugin = (): HeartbeatPlugin | null => {
    if (typeof window === 'undefined') return null;
    const plugin = (window as unknown as {
        Capacitor?: { Plugins?: { FoliaNative?: HeartbeatPlugin } };
    }).Capacitor?.Plugins?.FoliaNative;
    return plugin && typeof plugin.recordPlaybackHeartbeat === 'function' ? plugin : null;
};

export const installPlaybackHeartbeat = (): (() => void) => {
    const plugin = getPlugin();
    if (!plugin) return () => undefined;

    const send = () => {
        const playback = usePlaybackStore.getState();
        const settings = useVisualizerSettingsStore.getState();
        void plugin.recordPlaybackHeartbeat?.({
            visualizer: settings.visualizerMode,
            background: settings.visualizerBackgroundMode ?? '(default)',
            playing: playback.playerState === PlayerState.PLAYING,
            visibility: typeof document === 'undefined' ? 'unknown' : document.visibilityState,
        }).catch(() => undefined);
    };

    send();
    const timer = window.setInterval(send, HEARTBEAT_INTERVAL_MS);
    const onVisibilityChange = () => send();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
        window.clearInterval(timer);
        document.removeEventListener('visibilitychange', onVisibilityChange);
    };
};
