// src/platform/runtime.ts
// Lightweight runtime checks shared by platform-only features.

export const isCapacitorAndroid = (): boolean => {
    if (typeof window === 'undefined') return false;
    const capacitor = (window as unknown as {
        Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean };
    }).Capacitor;
    return capacitor?.getPlatform?.() === 'android' || capacitor?.isNativePlatform?.() === true;
};
