import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// src/state/useAntiInterruptStore.ts
//
// 「不被其他应用打断」开关：开启后，其他应用（游戏/视频）请求音频焦点时，
// 本 App 的音乐不会被暂停，而是立即恢复播放。

type AntiInterruptState = {
    keepPlayingWhenInterrupted: boolean;
    setKeepPlayingWhenInterrupted: (value: boolean) => void;
};

export const useAntiInterruptStore = create<AntiInterruptState>()(
    persist(
        (set) => ({
            keepPlayingWhenInterrupted: false,
            setKeepPlayingWhenInterrupted: (value) => set({ keepPlayingWhenInterrupted: value }),
        }),
        { name: 'folia-anti-interrupt' },
    ),
);
