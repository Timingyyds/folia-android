import { omni } from '../../../svc/onlineMusic/omni';
import { useNeteaseApiStatusStore } from '../../../state/useNeteaseApiStatusStore';
import { useOnlineProviderAccountStore } from '../../../state/useOnlineProviderAccountStore';
import { formatBuildProvenance } from '../../../lib/buildProvenance';
import type {
    LibraryAccountAuthPort,
    LibraryAccountClock,
    LibraryAccountControllerDeps,
    LibraryAccountLogger,
    LibraryAccountStorePort,
    LibraryLoginDiagnosticsEnvironment,
    LibraryNeteaseBackendPort,
    LibraryProviderAccountPort,
    LibraryProviderSwitchCleanupPort,
} from '../contracts/account';

// src/library/core/svc/providerAccountDeps.ts
// 在线账户 controller 的默认装配：扫码 auth 直接用 omni 的同名方法；provider 列表与当前平台读
// useOnlineProviderAccountStore + omni（mod 源增删经 omni.subscribeProviders）；网易后端健康读
// useNeteaseApiStatusStore；时钟用 window 定时器；诊断环境读 __APP_VERSION__ 与 navigator。
// 刷新、登出与切换清理属于宿主（App 的 per-provider hook 与播放状态），由调用方以函数形状传入。
// 单测给 createProviderAccountController 注入假端口，不经过这里。

/** 扫码 auth：签名与 omni 一致，直接把 omni 交出去（方法经 auth.xxx() 调用，this 仍是 omni）。 */
export const omniAccountAuthPort: LibraryAccountAuthPort = omni;

/** provider 列表 × 账户 store；订阅同时听账户 store 与 provider 注册表。 */
export const accountStorePort: LibraryAccountStorePort = {
    listProviders: () => omni.getProviderSummaries(),
    getProviderLabel: providerId => omni.getProviderLabel(providerId),
    getStoredActiveProviderId: () => useOnlineProviderAccountStore.getState().activeProviderId,
    setActiveProviderId: providerId => useOnlineProviderAccountStore.getState().setActiveProviderId(providerId),
    invalidateActiveRequests: () => omni.invalidateActiveRequests(),
    subscribe: listener => {
        const unsubscribeStore = useOnlineProviderAccountStore.subscribe(() => listener());
        const unsubscribeRegistry = omni.subscribeProviders(listener);
        return () => {
            unsubscribeStore();
            unsubscribeRegistry();
        };
    },
};

/** 网易本地后端：useNeteaseApiStatusStore 拍平成 controller 要的健康值（web 构建 supported=false）。 */
export const neteaseBackendPort: LibraryNeteaseBackendPort = {
    getHealth: () => {
        const state = useNeteaseApiStatusStore.getState();
        return {
            supported: state.supported,
            status: state.status?.status ?? null,
            error: state.status?.error ?? null,
            restarting: state.restarting,
        };
    },
    subscribe: listener => useNeteaseApiStatusStore.subscribe(() => listener()),
    restart: () => useNeteaseApiStatusStore.getState().restart(),
};

/** window 定时器（调用时才读 window，模块加载不依赖浏览器环境）。 */
export const windowAccountClock: LibraryAccountClock = {
    now: () => Date.now(),
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: handle => window.clearTimeout(handle as number),
};

// 网页版的站点 origin；桌面版页面是 file:// 等本地协议，返回 null。
const resolveWebOrigin = (): string | null => {
    if (typeof window === 'undefined' || window.electron) return null;
    const { protocol, origin } = window.location;
    return protocol === 'http:' || protocol === 'https:' ? origin : null;
};

/** 诊断报告的环境信息（与旧 useOnlineProviderQrLogin 的取法相同）。 */
export const resolveLoginDiagnosticsEnvironment = (): LibraryLoginDiagnosticsEnvironment => ({
    appVersion: typeof __APP_VERSION__ === 'undefined' ? null : __APP_VERSION__,
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    build: formatBuildProvenance(),
    origin: resolveWebOrigin(),
});


/** 宿主提供的端口：per-provider 刷新与登出、确认切换后的播放清理（可以用 ref 指向每次渲染的最新实现）。 */
export type ProviderAccountHostPorts = {
    providerAccounts: LibraryProviderAccountPort;
    switchCleanup: LibraryProviderSwitchCleanupPort;
    log?: LibraryAccountLogger;
};

/** 组装 controller 的全部依赖：宿主端口 + 上面的默认端口。 */
export const createProviderAccountDeps = (host: ProviderAccountHostPorts): LibraryAccountControllerDeps => ({
    auth: omniAccountAuthPort,
    accounts: accountStorePort,
    providerAccounts: host.providerAccounts,
    switchCleanup: host.switchCleanup,
    neteaseBackend: neteaseBackendPort,
    clock: windowAccountClock,
    diagnostics: resolveLoginDiagnosticsEnvironment(),
    log: host.log,
});
