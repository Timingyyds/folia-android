import type { ProviderUser } from '../../types/onlineMusic';

// src/svc/onlineMusic/neteaseSessionLoss.ts
//
// 「网易云自己退出登录」的确认逻辑。
//
// 刷新账号时只要一次 `login_status` 没拿到 profile，界面就会把本地会话清掉——EAPI 的偶发抖动、
// 网关返回空 data、请求恰好没带上凭据，都会落进这条分支，用户看到的就是「用着用着被踢下线」。
// 清会话不可逆（要重新扫码），所以这里先隔一小会儿再问一次，只有第二次也确认没登录才允许清。

export const NETEASE_SESSION_LOSS_CONFIRM_DELAY_MS = 600;

export const confirmNeteaseSessionLoss = async (
    readStatus: () => Promise<ProviderUser | null>,
    delayMs: number = NETEASE_SESSION_LOSS_CONFIRM_DELAY_MS,
): Promise<ProviderUser | null> => {
    if (delayMs > 0) {
        await new Promise<void>((resolve) => { setTimeout(resolve, delayMs); });
    }
    // 第二次报错同样按「没有确认」处理：拿不到结论就不该清会话。
    return await readStatus().catch(() => null);
};
