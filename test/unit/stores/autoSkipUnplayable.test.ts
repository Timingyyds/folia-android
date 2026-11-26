import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/stores/autoSkipUnplayable.test.ts
// 「无法播放时自动跳过」：默认关，开关写进自己的 key，下次启动读回；它不进同步快照，
// 但作为音频设置整体编辑的一部分出现在 selectAudioSettingsSnapshot 里。

let values: Map<string, string>;

const loadStore = async () => {
    vi.resetModules();
    return import('@/stores/useAudioSettingsStore');
};

beforeEach(() => {
    values = new Map();
    const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, String(value)); },
        removeItem: (key: string) => { values.delete(key); },
    };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { localStorage: storage });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
});

describe('auto-skip unplayable setting', () => {
    it('is off when nothing has been stored', async () => {
        const { useAudioSettingsStore } = await loadStore();
        expect(useAudioSettingsStore.getState().autoSkipUnplayable).toBe(false);
    });

    it('persists the switch under its own key and reads it back on the next start', async () => {
        const { AUTO_SKIP_UNPLAYABLE_KEY, useAudioSettingsStore } = await loadStore();
        expect(AUTO_SKIP_UNPLAYABLE_KEY).toBe('folia_auto_skip_unplayable');

        useAudioSettingsStore.getState().handleToggleAutoSkipUnplayable(true);
        expect(useAudioSettingsStore.getState().autoSkipUnplayable).toBe(true);
        expect(values.get(AUTO_SKIP_UNPLAYABLE_KEY)).toBe('true');

        const restarted = await loadStore();
        expect(restarted.useAudioSettingsStore.getState().autoSkipUnplayable).toBe(true);

        restarted.useAudioSettingsStore.getState().handleToggleAutoSkipUnplayable(false);
        expect(values.get(AUTO_SKIP_UNPLAYABLE_KEY)).toBe('false');
        expect(restarted.useAudioSettingsStore.getState().autoSkipUnplayable).toBe(false);
    });

    it('leaves the other audio switches alone', async () => {
        const { useAudioSettingsStore } = await loadStore();
        const before = useAudioSettingsStore.getState();
        before.handleToggleAutoSkipUnplayable(true);
        const after = useAudioSettingsStore.getState();
        expect(after.playbackFadeEnabled).toBe(before.playbackFadeEnabled);
        expect(after.autoPlayOnLaunch).toBe(before.autoPlayOnLaunch);
    });

    it('is part of the audio settings snapshot with its handler', async () => {
        const { selectAudioSettingsSnapshot, useAudioSettingsStore } = await loadStore();
        const snapshot = selectAudioSettingsSnapshot(useAudioSettingsStore.getState());
        expect(snapshot.autoSkipUnplayable).toBe(false);
        expect(snapshot.handleToggleAutoSkipUnplayable).toBe(useAudioSettingsStore.getState().handleToggleAutoSkipUnplayable);
    });
});
