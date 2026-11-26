// src/utils/system/appVersion.ts
// 本机版本号：安卓上以安装包的 versionName 为准，其他地方用构建时注入的 package.json 版本。
//
// 为什么不能直接用 __APP_VERSION__：那是打包网页时从 package.json 读出来的，
// 和 android/app/build.gradle 的 versionName 是两处独立的数字。只要忘了同步，
// 更新检查就会拿旧的本地版本去比站点版本，装到最新也会一直提示「有新版本」。

type AppVersionPlugin = {
    appVersion?: () => Promise<{ versionName?: string; versionCode?: number }>;
};

const nativePlugin = (): AppVersionPlugin | null => {
    if (typeof window === 'undefined') return null;
    return (window as unknown as {
        Capacitor?: { Plugins?: { FoliaNative?: AppVersionPlugin } };
    }).Capacitor?.Plugins?.FoliaNative ?? null;
};

/** 构建时注入的版本，作为非安卓环境（网页/桌面）和旧安装包的退路。 */
export const bundledAppVersion = (): string | null => (
    typeof __APP_VERSION__ === 'undefined' ? null : String(__APP_VERSION__)
);

/** 本机版本号：先问安装包，拿不到再退回构建时版本。 */
export const resolveAppVersion = async (): Promise<string | null> => {
    try {
        const info = await nativePlugin()?.appVersion?.();
        if (info?.versionName && info.versionName.trim()) return info.versionName.trim();
    } catch {
        // 旧安装包没有这个方法，或不在安卓上：下面退回构建时版本。
    }
    return bundledAppVersion();
};
