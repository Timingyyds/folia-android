import { create } from 'zustand';

// src/state/useImmersiveChromeStore.ts
// 全沉浸模式下播放界面控件的即时状态：true = 已收起。
//
// 这是运行时状态，不持久化：全沉浸本身是持久化偏好（useAndroidLayoutSettingsStore），
// 这里只表达“此刻控件是收起还是被触摸唤回”。分开的理由和 useAppChromeStore 拆分的理由一样，
// 偏好和“正在做什么”是两个问题。

type ImmersiveChromeState = {
    immersiveChromeHidden: boolean;
    setImmersiveChromeHidden: (hidden: boolean) => void;
};

export const useImmersiveChromeStore = create<ImmersiveChromeState>((set) => ({
    // 默认收起：打开全沉浸并进入播放界面时先干净地收起来。
    immersiveChromeHidden: true,
    setImmersiveChromeHidden: (hidden) => set({ immersiveChromeHidden: hidden }),
}));
