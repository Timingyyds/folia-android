import { useEffect, useRef } from 'react';
import { compareVersions, fetchRemoteVersion } from '../utils/system/appVersionCheck';
import { offerRemoteVersion } from '../stores/useAppUpdatePromptStore';

// src/hooks/useSiteUpdateCheck.ts
// 问站点：有没有比本机新的版本。有了就交给 useAppUpdatePromptStore，
// 由它按「跳过到第二天」的规则决定要不要提。
//
// **每次打开 App 都会问一次**（页面一挂载就跑一次），而且**从后台回到前台也会再问**
// ——站点上换了版本，用户下次进来就该看到提示，不做按天限流的滞后。
// 代价很小：只读 `version.json`（151 字节），不是那个 1.45 MB 的网页。
// 两次之间只有 30 秒的进程内窗口（在 fetchRemoteVersion 里），挡重复挂载的连打。
//
// 不等首屏：请求挂在后台跑，界面照常渲染。用 ref 记住「这次已经发出去了」，不经过 state。
// 读不到、没网、本机不比站点旧，都静默结束，不打扰用户。

/** 让出一帧再发请求：首屏的渲染与图片解码先走，这一个请求不必插在前面。 */
const DEFER_MS = 300;

export const useSiteUpdateCheck = (): void => {
    const inFlightRef = useRef(false);

    useEffect(() => {
        const run = () => {
            const appVersion = typeof __APP_VERSION__ === 'undefined' ? null : __APP_VERSION__;
            if (!appVersion || inFlightRef.current) return;
            inFlightRef.current = true;
            console.log(`[SiteUpdate] 开始检查，本机版本 ${appVersion}`);
            void fetchRemoteVersion().then((remote) => {
                if (!remote) {
                    console.log('[SiteUpdate] 这次没读到站点版本，不提示');
                    return;
                }
                const diff = compareVersions(String(appVersion), remote.version);
                console.log(`[SiteUpdate] 本机 ${appVersion} vs 站点 ${remote.version}，比较结果 ${diff}`);
                // 站点上一个不比本机新的版本不该提，等于也不提。
                if (diff >= 0) {
                    console.log('[SiteUpdate] 本机不比站点旧，不提示');
                    return;
                }
                offerRemoteVersion(remote);
            }).catch((error) => {
                // 兜底：这一步不该抛，抛了也要留下痕迹。
                console.log(`[SiteUpdate] 检查出错：${error instanceof Error ? error.message : String(error)}`);
            }).finally(() => {
                inFlightRef.current = false;
            });
        };

        const timer = window.setTimeout(run, DEFER_MS);
        // 从后台回到前台：站点可能刚更新过，再看一眼（30 秒窗口会挡掉频繁切换）。
        const onVisibility = () => {
            if (document.visibilityState === 'visible') run();
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.clearTimeout(timer);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, []);
};
