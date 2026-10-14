// src/svc/androidKeepScreenOn.ts
//
// 「屏幕常亮」开关的服务层。
//
// 安卓侧走原生窗口标志（`WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON`）：系统级、切页不丢，
// 也不受浏览器策略限制。拿不到原生插件时退回网页的 Screen Wake Lock API（页面隐藏时浏览器会
// 自动释放，所以可见时要重新申请）。两种运行时都不会因为失败而抛出——开关本身仍然可用。

export const KEEP_SCREEN_ON_STORAGE_KEY = 'folia_android_keep_screen_on';

type WakeLockSentinelLike = {
    released?: boolean;
    release?: () => Promise<void>;
    addEventListener?: (type: string, listener: () => void) => void;
};

type WakeLockRequest = (type: 'screen') => Promise<WakeLockSentinelLike>;

type KeepScreenOnPlugin = {
    setKeepScreenOn?: (options: { enabled: boolean }) => Promise<unknown>;
};

export const readStoredKeepScreenOn = (): boolean => {
    if (typeof window === 'undefined') return false;
    try {
        return localStorage.getItem(KEEP_SCREEN_ON_STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
};

export const writeStoredKeepScreenOn = (enabled: boolean): void => {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(KEEP_SCREEN_ON_STORAGE_KEY, enabled ? 'true' : 'false');
    } catch {
        // 存不下来也不能让开关当场失效。
    }
};

const getNativePlugin = (): KeepScreenOnPlugin | null => {
    if (typeof window === 'undefined') return null;
    return (window as unknown as {
        Capacitor?: { Plugins?: { FoliaNative?: KeepScreenOnPlugin } };
    }).Capacitor?.Plugins?.FoliaNative ?? null;
};

const getWakeLockRequest = (): WakeLockRequest | null => {
    if (typeof navigator === 'undefined') return null;
    const wakeLock = (navigator as Navigator & { wakeLock?: { request?: WakeLockRequest } }).wakeLock;
    return typeof wakeLock?.request === 'function' ? wakeLock.request.bind(wakeLock) : null;
};

let wakeLock: WakeLockSentinelLike | null = null;
let wakeLockListenersBound = false;

const bindWakeLockRecovery = (): void => {
    if (wakeLockListenersBound || typeof document === 'undefined') return;
    wakeLockListenersBound = true;
    // 页面重新可见时补申请：浏览器在隐藏页面时会自动释放 wake lock。
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        if (!readStoredKeepScreenOn() || wakeLock) return;
        void acquireWakeLock();
    });
};

const acquireWakeLock = async (): Promise<void> => {
    if (wakeLock) return;
    const request = getWakeLockRequest();
    if (!request) return;
    try {
        const sentinel = await request('screen');
        wakeLock = sentinel;
        sentinel.addEventListener?.('release', () => {
            if (wakeLock === sentinel) wakeLock = null;
        });
        bindWakeLockRecovery();
    } catch {
        wakeLock = null;
    }
};

const releaseWakeLock = async (): Promise<void> => {
    const current = wakeLock;
    wakeLock = null;
    if (!current) return;
    try {
        await current.release?.();
    } catch {
        // 已经释放过就忽略。
    }
};

/** 应用开关：安卓用窗口标志，其它运行时用 Wake Lock API。 */
export const applyKeepScreenOn = (enabled: boolean): void => {
    if (typeof window === 'undefined') return;
    const plugin = getNativePlugin();
    if (typeof plugin?.setKeepScreenOn === 'function') {
        // 原生能兜住就别再叠加网页 wake lock，免得两个机制各管一半。
        void releaseWakeLock();
        void plugin.setKeepScreenOn({ enabled }).catch(() => undefined);
        return;
    }
    if (enabled) void acquireWakeLock();
    else void releaseWakeLock();
};

/** 启动时套用保存的设置（与 installAndroidPhoneFitPreference 同一模式）。 */
export const installKeepScreenOnPreference = (): void => {
    applyKeepScreenOn(readStoredKeepScreenOn());
};

/** 测试用：清掉当前持有的 wake lock 与监听状态。 */
export const resetKeepScreenOnRuntime = (): void => {
    wakeLock = null;
    wakeLockListenersBound = false;
};
