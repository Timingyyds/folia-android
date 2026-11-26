import md5 from 'blueimp-md5';
import { OnlineProviderError } from '../../../types/onlineMusic';

// src/services/onlineMusic/kugou/kugouPublic.ts
// 酷狗的公开端点（不需要登录、不需要签名、不需要自建后端）。Android 上没有 KuGouMusicApi 那个后端，
// 扩展层那条签名网关的路又时好时坏，这里两条都是酷狗自己的公开接口：
//
//   搜索：mobilecdn.kugou.com/api/v3/search/song —— 老的 complexsearch 现在要签名，匿名一律回
//         20006 err signature，条目数为 0，界面上就是"搜不出来"。
//   取链接：trackercdn.kugou.com/i/v2/ —— key 是 md5(hash + 'kgcloudv2')，免费曲目直接给地址
//         （128k / hq / sq 都有），会员曲目回 status: 2。
//
// 会员曲目仍然要账号权益，这里救不了；它至少让"搜得到、免费的能放"成立，并且把
// "要会员"这个原因如实带回去。

const KUGOU_PUBLIC_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36';
const KUGOU_PUBLIC_REFERER = 'https://www.kugou.com/';
const KUGOU_TRACKER_KEY_SALT = 'kgcloudv2';

/**
 * 这两个公开端点只有 http（https 的 mobilecdn 直接不响应），而 WebView 页面是 https://localhost：
 * 页面里的 fetch 打 http 属于「可拦截混合内容」，Chromium 一律拦掉 —— 安卓上匿名搜索与免费曲目取链接
 * 因此从来没成功过，最后只剩下「登录或版权」那句话。原生桥（OkHttp）不受混合内容限制，安卓上走它。
 */
const requestPublicJson = async (target: URL): Promise<any> => {
    const url = target.toString();
    const headers = {
        'User-Agent': KUGOU_PUBLIC_UA,
        Referer: KUGOU_PUBLIC_REFERER,
        Accept: 'application/json, text/plain, */*',
    };
    try {
        const { bridgeRequest, isNativeBridgeAvailable } = await import('../../../audioNative/core');
        if (isNativeBridgeAvailable()) {
            const response = await bridgeRequest({ url, method: 'GET', headers, omitCookies: true, timeoutMs: 15_000 });
            if (response.status < 200 || response.status >= 300) {
                throw new OnlineProviderError('network', `KuGou public request failed: ${response.status}`, 'kugou');
            }
            try {
                return JSON.parse(response.body ?? '');
            } catch (error) {
                throw new OnlineProviderError('invalid-response', 'KuGou public request returned an unreadable body', 'kugou', error);
            }
        }
    } catch (error) {
        if (error instanceof OnlineProviderError) throw error;
        // 原生桥不可用（桌面 / 纯网页）：落到 fetch，同源或已放行混合内容的构建仍能工作。
    }
    const response = await fetch(url, { method: 'GET', credentials: 'omit', headers });
    if (!response.ok) {
        throw new OnlineProviderError('network', `KuGou public request failed: ${response.status}`, 'kugou');
    }
    return await response.json();
};

export type KugouPublicSearchAnswer = {
    status?: number;
    errcode?: number;
    error?: string;
    data?: { total?: number; info?: unknown[] };
};

export type KugouPublicPlayAnswer = {
    url: string;
    status: number;
    bitRate?: number;
    extName?: string;
};

/** 匿名搜索。返回酷狗原始回答（`data.info` 就是条目数组，normalizeKugouSearchSongs 认这个形状）。 */
export const searchKugouPublic = async (
    keyword: string,
    page: number,
    pagesize: number,
): Promise<KugouPublicSearchAnswer> => {
    const target = new URL('http://mobilecdn.kugou.com/api/v3/search/song');
    target.searchParams.set('format', 'json');
    target.searchParams.set('keyword', keyword);
    target.searchParams.set('page', String(page));
    target.searchParams.set('pagesize', String(pagesize));
    target.searchParams.set('showtype', '1');
    return await requestPublicJson(target) as KugouPublicSearchAnswer;
};

/**
 * 公开取链接。`br`：'128'（默认）/ 'hq'（320）/ 'sq'（无损）。
 * 会员曲目回 status 2、没有地址 —— 这不是我们的错，调用方据此说"需要会员"。
 */
export const resolveKugouPublicPlayUrl = async (
    hash: string,
    br: '128' | 'hq' | 'sq',
): Promise<KugouPublicPlayAnswer> => {
    const normalizedHash = String(hash || '').trim().toLowerCase();
    if (!normalizedHash) return { url: '', status: 0 };
    const target = new URL('http://trackercdn.kugou.com/i/v2/');
    target.searchParams.set('key', md5(`${normalizedHash}${KUGOU_TRACKER_KEY_SALT}`));
    target.searchParams.set('hash', normalizedHash);
    target.searchParams.set('br', br);
    target.searchParams.set('appid', '1005');
    target.searchParams.set('pid', '2');
    target.searchParams.set('cmd', '25');
    target.searchParams.set('behavior', 'play');
    const body = await requestPublicJson(target) as {
        status?: number;
        url?: string | string[];
        bitRate?: number;
        extName?: string;
        error?: string;
    };
    const rawUrl = Array.isArray(body.url) ? body.url[0] : body.url;
    const candidate = typeof rawUrl === 'string' && /^https?:\/\//i.test(rawUrl) ? rawUrl.split(',')[0]!.trim() : '';
    // 酷狗给的地址是 http，而页面在 https://localhost 下：媒体虽属「可放行的混合内容」，
    // 但 CDN 本身支持 https，直接换过去就不必指望这条放行规则。
    const url = candidate.replace(/^http:/i, 'https:');
    return {
        url,
        status: Number(body.status) || 0,
        ...(Number.isFinite(body.bitRate) ? { bitRate: Number(body.bitRate) } : {}),
        ...(typeof body.extName === 'string' ? { extName: body.extName } : {}),
    };
};
