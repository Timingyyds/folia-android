import { OnlineProviderError } from '../../../types/onlineMusic';
import { readProviderSessionValue, removeProviderSessionValue, writeProviderSessionValue } from '../providerStorage';
import { withLoginRequestLimit } from '../login/loginRequestLimit';
import { withOnlineRequestLimit } from '../failure/onlineRequestLimit';

// src/services/onlineMusic/qq/qqTransport.ts

export const QQ_OPERATIONS = [
    'login_qr_key', 'login_qr_create', 'login_qr_check', 'login_qr_cancel', 'login_status', 'logout',
    'login_channels', 'login_refresh',
    'user_detail', 'user_playlist', 'user_albums', 'user_liked_songs', 'user_playlist_detail',
    'user_guess_you_like', 'user_daily_songs', 'recommend_playlists',
    'user_personal_fm', 'user_daily_history_dates', 'user_daily_history', 'user_blacklist_add',
    'user_listening_rank', 'user_guess_you_like_modes', 'user_guess_you_like_tracks',
    'recommend_feed',
    'user_recommendation_preferences', 'user_recommendation_preferences_update',
    'user_playlist_tracks', 'user_playlist_subscribe', 'user_subscription_status',
    'user_song_like', 'user_album_subscribe',
    'user_vip', 'user_cloud', 'user_playlist_create',
    'recommend_new_songs', 'recommend_new_albums', 'recommend_toplists', 'recommend_toplist',
    'recommend_categories', 'recommend_category_playlists', 'recommend_radar',
    'radio_list', 'radio_tracks', 'song_similar',
    'music_play', 'song_list_detail', 'song_info',
    'album_info', 'artist_albums', 'artist_songs',
    'search',
] as const;

export type QqOperation = typeof QQ_OPERATIONS[number];
export type QqParams = Record<string, string | number | boolean | undefined>;

// 写入路由只收 POST + JSON 正文；GET 会回 405。
const POST_OPERATIONS: ReadonlySet<QqOperation> = new Set<QqOperation>([
    'login_refresh',
    'user_playlist_tracks', 'user_playlist_subscribe', 'user_song_like', 'user_album_subscribe',
    'user_playlist_create', 'user_blacklist_add', 'user_recommendation_preferences_update',
]);

const ENDPOINTS: Record<QqOperation, string> = {
    login_qr_key: '/login/qr/key',
    login_qr_create: '/login/qr/create',
    login_qr_check: '/login/qr/check',
    login_qr_cancel: '/login/qr/cancel',
    login_status: '/login/status',
    logout: '/logout',
    // 只有 3.0.0 之后的后端有这条路由，旧后端回 404，调用方要把它当成「没有声明」而不是错误。
    login_channels: '/login/channels',
    // 3.3.2 起的主动续期：Serverless 在快到期时换新 token。旧后端照例 404 → `unsupported`（qqSessionRefresh.ts）。
    login_refresh: '/login/refresh',
    user_detail: '/user/detail',
    user_playlist: '/user/playlist',
    user_albums: '/user/albums',
    user_liked_songs: '/user/liked-songs',
    // 带凭据地读登录用户自己的歌单。匿名的 `song_list_detail` 读不了不公开的歌单，这条可以。
    // 与 `login_channels` 同样的处境：旧后端没有这条路由，回 404，调用方要当成「没有声明」。
    user_playlist_detail: '/user/playlist-detail',
    // 以下是 3.2.0 / 3.3.0 新增的路由：推荐三条要登录（推荐歌单可匿名），写入两条只对本人的歌单生效。
    // 旧后端一律 404，transport 照例报成 `unsupported`，由调用方决定回落还是报错。
    user_guess_you_like: '/user/guess-you-like',
    user_daily_songs: '/user/daily-songs',
    // 3.3.6 的私人 FM（`page` 1–100，后端不记批次位置）。旧后端回 404，调用方回落到猜你喜欢。
    user_personal_fm: '/user/personal-fm',
    // 3.3.6 的每日 30 首历史：日期列表与某一天的歌，只读本人。旧后端回 404。
    user_daily_history_dates: '/user/daily-songs/history/dates',
    user_daily_history: '/user/daily-songs/history',
    // 3.3.6 的歌曲不喜欢：只送 `songs` 时默认开放；写一次、读首屏确认，结果不明不重送。
    user_blacklist_add: '/user/blacklist/add',
    // 3.3.6 的本人听歌排行（range=week|year）。旧后端回 404，没有排行条目。
    user_listening_rank: '/user/listening-rank',
    // 3.3.6 的猜你喜欢听歌模式目录与按模式（pool）取一批，只读，不写账号的模式设置。旧后端 404。
    user_guess_you_like_modes: '/user/guess-you-like/modes',
    user_guess_you_like_tracks: '/user/guess-you-like/tracks',
    // 3.3.6 的客户端首页 feed 第 1 页（只有歌曲与歌单）。旧后端回 404，探索页就不出这几栏。
    recommend_feed: '/recommend/feed',
    // 3.3.6 的账号音乐偏好（私人 FM 和每日 30 首共用一份）：读，和只改指定项的写入（写一次、读回核对，不重送）。
    user_recommendation_preferences: '/user/recommendation-preferences',
    user_recommendation_preferences_update: '/user/recommendation-preferences/update',
    recommend_playlists: '/recommend/playlists',
    user_playlist_tracks: '/user/playlist/tracks',
    user_playlist_subscribe: '/user/playlist/subscribe',
    user_subscription_status: '/user/subscription-status',
    // 3.3.1 的红心与收藏专辑：写一次、读回确认后才回成功，结果不明回 502。
    user_song_like: '/user/song/like',
    user_album_subscribe: '/user/album/subscribe',
    // 3.3.3：会员等级、音乐云盘、建自己的歌单，都要登录。
    user_vip: '/user/vip',
    user_cloud: '/user/cloud',
    user_playlist_create: '/user/playlist/create',
    // 3.3.3 探索页用的路由。新歌、新碟、排行榜、歌单分类读的是公开内容，刷歌模式没登录也能读；
    // 电台和相似歌曲要登录。没有数据回 422，旧后端没有这些路由回 404。
    recommend_new_songs: '/recommend/new-songs',
    recommend_new_albums: '/recommend/new-albums',
    recommend_toplists: '/recommend/toplists',
    recommend_toplist: '/recommend/toplist',
    recommend_categories: '/recommend/categories',
    recommend_category_playlists: '/recommend/category-playlists',
    recommend_radar: '/recommend/radar',
    radio_list: '/radio/list',
    radio_tracks: '/radio/tracks',
    song_similar: '/song/similar',
    music_play: '/getMusicPlay',
    song_list_detail: '/getSongListDetail',
    song_info: '/getSongInfo',
    // 曲库端点用领域语汇命名，与 provider 的 getAlbum* / getArtist* 一一对应，不沿用上游的 singer_* 路径名。
    // 上游这三条路由虽然声明了路径参数，但 controller 只读 ctx.query，所以一律走 query string。
    album_info: '/getAlbumInfo',
    artist_albums: '/getSingerAlbum',
    artist_songs: '/getSingerHotsong',
    // 3.3.1 的关键字搜索：有会话就带会话搜。匿名搜歌常被上游以 2001 拒绝（#473），带会话的不受这个限额影响。
    // 拒绝回 502 `search.rejected`；旧后端没有这条路由，照例 404 → `unsupported`。
    search: '/search',
};

// The requests a sign-in waits for. They get the sign-in's time limit.
const LOGIN_REQUESTS: ReadonlySet<QqOperation> = new Set(['login_qr_key', 'login_qr_create', 'login_qr_check']);
// The requests for a song's address and a collection's tracks. They get the limit below; no other
// request has a limit.
const ONLINE_REQUESTS: ReadonlySet<QqOperation> = new Set([
    'music_play', 'song_list_detail', 'user_playlist_detail', 'user_liked_songs', 'album_info',
    'user_cloud', 'recommend_toplist', 'radio_tracks',
]);
// Their limit, above the backend's own slowest answer. A signed-in play link is at worst four steps in a
// row (qq-music-api, services/auth/qrLogin.js): GetVkey, a 5 s CDN probe, GetCdnDispatch and a second
// 5 s probe, each call to QQ limited to 25 s (services/auth/httpClient.js): 60 s in all.
export const QQ_ONLINE_REQUEST_LIMIT_MS = 70_000;

// qq-music-api translates the native QR states into the Netease codes; 803 is the only one carrying a session.
const QR_CONFIRMED_CODE = 803;

const getWebApiBase = (): string => {
    const viteValue = typeof import.meta !== 'undefined' && import.meta.env?.MODE !== 'test'
        ? String((import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_QQ_API_BASE || '')
        : '';
    const processValue = typeof process !== 'undefined'
        ? String(process.env?.VITE_QQ_API_BASE || '')
        : '';
    const value = viteValue || processValue;
    return value.trim().replace(/\/$/, '');
};

// Electron embeds qq-music-api and starts it on a free port, so the base is only known at runtime.
const getElectronQqPortReader = (): (() => Promise<number | null>) | null => {
    if (typeof window === 'undefined') return null;
    const reader = window.electron?.getQqPort;
    return typeof reader === 'function' ? () => reader() : null;
};

// What a request fails with where the desktop app's embedded backend has no port: the sentence
// starts with it, and goes on with the status the main process gives (`describeEmbeddedStatus`).
// The sign-in dialog tells this failure apart by it (qqLoginFailure.ts).
export const QQ_API_NOT_RUNNING = 'Embedded QQMusicApi is not running';

// What a request fails with where the web build has no backend address configured.
export const QQ_API_BASE_MISSING = 'VITE_QQ_API_BASE is not configured';

let electronApiBase: string | null = null;

export const resetQqTransportRuntimeCache = (): void => {
    electronApiBase = null;
};

// 内嵌后端没在监听时，把主进程报的状态与故障原因带进错误：时间线里直接能看到它为什么没起来。
const describeEmbeddedStatus = async (): Promise<string> => {
    try {
        const status = await window.electron?.getQqApiStatus?.();
        return status ? ` (status ${status.status}${status.error ? `: ${status.error}` : ''})` : '';
    } catch {
        return '';
    }
};

const resolveApiBase = async (): Promise<string> => {
    const readPort = getElectronQqPortReader();
    if (readPort) {
        if (electronApiBase) return electronApiBase;
        const port = await readPort();
        if (!port) {
            throw new OnlineProviderError('unavailable', `${QQ_API_NOT_RUNNING}${await describeEmbeddedStatus()}`, 'qq');
        }
        electronApiBase = `http://127.0.0.1:${port}`;
        return electronApiBase;
    }

    const base = getWebApiBase();
    if (!base) {
        // 网页版没配后端地址：这里用不了 QQ 音乐，再试也一样（qqFailure.ts 说它是「没有配置」）。
        throw new OnlineProviderError('unavailable', QQ_API_BASE_MISSING, 'qq');
    }
    return base;
};

// The stored value is the backend's opaque `qqmusic_session=<token>` string, never a QQ credential.
const getWebSessionCookie = (): string => readProviderSessionValue('qq', 'cookie') || '';

const SESSION_COOKIE_NAME = 'qqmusic_session';
const SESSION_HEADER_NAME = 'X-QQ-Session';

// 后端两个入口的语义不同，不能互换：header 收的是裸 token，`?cookie=` 收的是整串 cookie。
const tokenFromCookieString = (cookie: string): string => {
    for (const entry of cookie.split(';')) {
        const separator = entry.indexOf('=');
        if (separator <= 0) continue;
        if (entry.slice(0, separator).trim() === SESSION_COOKIE_NAME) return entry.slice(separator + 1).trim();
    }
    return '';
};

// 同源部署（`/api/qq`、`/qq`）改走 header：sealed token 是密文本身，query 是它唯一会被 CDN 与
// edge access log 完整记下来的地方 —— 那是 sealed 相对不透明 token 唯一真正新增的泄漏面。
// 外部 URL 与 Electron 维持 `?cookie=`：跨源发自定义头会触发 preflight，而后端是
// `Access-Control-Allow-Origin: *`，按规范不允许搭配 credentials。
const isSameOriginBase = (base: string): boolean => base.startsWith('/');

export const hasQqSession = (): boolean => Boolean(getWebSessionCookie());

// 安卓端没有主进程的安全存储（会话存在 CookieManager 里），能拿到会话就等于可用。
export const hasUsableQqSession = (): boolean => hasQqSession();

// 停用的会话是「主进程这次启动没读出加密登录仓库」时才有的；安卓端没有这条线，恒为 false。
export const isQqSessionParked = async (): Promise<boolean> => false;

export const clearQqSession = (): void => removeProviderSessionValue('qq', 'cookie');

// 后端的退避时长（qq-music-api 在 429 的响应体里给 retryAfterMs，同时带 Retry-After 头，单位是秒）。
// 只收非负安全整数，读不出就不给，调用方按普通失败处理。
const readRetryAfterMs = (body: unknown, response: Response): number | undefined => {
    const fromBody = body && typeof body === 'object' ? (body as { retryAfterMs?: unknown }).retryAfterMs : undefined;
    if (typeof fromBody === 'number' && Number.isSafeInteger(fromBody) && fromBody >= 0) return fromBody;
    const raw = response.headers?.get?.('Retry-After')?.trim();
    if (!raw || !/^\d+$/.test(raw)) return undefined;
    const seconds = Number(raw);
    return Number.isSafeInteger(seconds * 1000) ? seconds * 1000 : undefined;
};

const readJsonBody = async (response: Response): Promise<any> => {
    try {
        return await response.json();
    } catch {
        return undefined;
    }
};

// 后端失败正文的原文：多数路由写在 `message`，播放等路由的 500 只给 `{ error }`（observability.js），两处都认。
// 3.2.0 起的新路由另带固定的 `errorKey`（如 `playlist.already-applied`）与可选的上游数字码，`message` 只是通用英文，
// 所以把这两样一起写进原文，诊断里才看得出是哪一类失败。
export const readBackendMessage = (failure: any): string => {
    let text = '';
    for (const candidate of [failure?.message, failure?.error]) {
        if (typeof candidate === 'string' && candidate.trim()) {
            text = candidate.trim();
            break;
        }
    }
    const errorKey = typeof failure?.errorKey === 'string' ? failure.errorKey.trim() : '';
    const upstreamCode = Number.isSafeInteger(failure?.upstreamCode) ? ` upstream ${failure.upstreamCode}` : '';
    if (!errorKey) return text;
    return `${errorKey}${upstreamCode}${text ? `: ${text}` : ''}`;
};

// qq-music-api 的 QqProtocolError 模板（dist/src/services/auth/qrLogin.js 的 callMusicu）：musicu 已经应答（HTTP 2xx），
// 只是带了非零的全局码或 req_0 码，后端的 handleControllerError 一律把它包成 500 `{ error }`。
const QQ_PROTOCOL_REFUSAL = /\bfailed \(HTTP 2\d\d, global=(-?\d+), code=(-?\d+|unknown)\)/;

// 从 500 正文里认出「上游有应答、只是业务拒绝」，返回上游码：req_0 的码优先，缺失时退回全局码，
// 两者都没有（应答里没有 req_0）记作 'missing'。认不出就返回 undefined，按普通 5xx 处理。
export const readUpstreamRefusalCode = (backendText: string): number | string | undefined => {
    const match = QQ_PROTOCOL_REFUSAL.exec(backendText);
    if (!match) return undefined;
    const [, globalCode, requestCode] = match;
    if (requestCode !== 'unknown' && Number(requestCode) !== 0) return Number(requestCode);
    if (Number(globalCode) !== 0) return Number(globalCode);
    return 'missing';
};

// 曲库三条路由被上游拒收时仍然回 HTTP 200，状态码藏在响应体里，而且层级还不一样：
// `/getAlbumInfo` 直接是 `response.code`（参数类型错时是 1101 `para error!`），
// 两条歌手路由的 `response.code` 恒为 0，真正的状态在 `response.singer.code`（400 / 104400）。
// 不看这两层就会把「被拒收」当成「这个专辑没有曲目」，UI 只剩一片空白，线上很难定位。
// 登录与播放路由用的是另一套码值（如 `login_status` 回 200），故不纳入此检查。
const CATALOG_STATUS_NODES: Partial<Record<QqOperation, string[][]>> = {
    album_info: [['response']],
    // 歌单详情的上游是匿名 CGI：歌单不存在、不公开或参数不被接受时它照样回 HTTP 200，
    // 差别只在这个 `code` 上。不登记的话拒绝会一路变成空歌单，UI 只剩「暂无内容」。
    song_list_detail: [['response']],
    artist_songs: [['response'], ['response', 'singer']],
    artist_albums: [['response'], ['response', 'singer']],
};

const readNode = (body: any, path: string[]): any => (
    path.reduce((node, key) => (node === null || node === undefined ? node : node[key]), body)
);

const assertUpstreamAccepted = (operation: QqOperation, body: any): void => {
    for (const path of CATALOG_STATUS_NODES[operation] ?? []) {
        const node = readNode(body, path);
        const code = Number(node?.code);
        if (!Number.isFinite(code) || code === 0) continue;

        const subcode = Number(node?.subcode);
        const message = typeof node?.message === 'string' ? node.message.trim() : '';
        throw new OnlineProviderError(
            'invalid-response',
            `QQMusicApi ${operation} was rejected upstream at ${path.join('.')} (code ${code}`
            + `${Number.isFinite(subcode) && subcode !== code ? `, subcode ${subcode}` : ''})`
            + `${message ? `: ${message}` : ''}`,
            'qq',
            node,
        );
    }
};

const persistConfirmedSession = (operation: QqOperation, body: any): void => {
    if (operation !== 'login_qr_check' || Number(body?.code) !== QR_CONFIRMED_CODE) return;
    const cookie = body?.cookie;
    if (typeof cookie === 'string' && cookie) writeProviderSessionValue('qq', 'cookie', cookie);
};

/** 网页版配置的远端 API 地址（自检与诊断报告用）；桌面版走内嵌后端，返回 null。 */
export const getQqRemoteApiBase = (): string | null => (getElectronQqPortReader() ? null : getWebApiBase() || null);

export const getQqTransportAvailability = () => {
    if (getElectronQqPortReader()) return { configured: true } as const;
    return getWebApiBase()
        ? { configured: true } as const
        : { configured: false, reason: 'not-configured' as const };
};

const endpointFor = (operation: QqOperation, params: QqParams): { path: string; query: QqParams } => {
    const query = { ...params };
    const takeRequiredPathParam = (name: string): string => {
        const value = query[name];
        delete query[name];
        const pathValue = value === undefined ? '' : String(value).trim();
        if (!pathValue) {
            throw new OnlineProviderError(
                'invalid-response',
                `QQMusicApi ${operation} requires ${name}`,
                'qq',
            );
        }
        return encodeURIComponent(pathValue);
    };

    if (operation === 'music_play') {
        return { path: `${ENDPOINTS[operation]}/${takeRequiredPathParam('songmid')}`, query };
    }
    if (operation === 'song_list_detail') {
        return { path: `${ENDPOINTS[operation]}/${takeRequiredPathParam('disstid')}`, query };
    }
    if (operation === 'song_info') {
        const songmid = takeRequiredPathParam('songmid');
        const songid = query.songid;
        delete query.songid;
        return {
            path: `${ENDPOINTS[operation]}/${songmid}${songid === undefined ? '' : `/${encodeURIComponent(String(songid))}`}`,
            query,
        };
    }
    return { path: ENDPOINTS[operation], query };
};

// The session a request carried is dropped; one that was stored since stays.
const dropSessionSent = (sent: string): void => {
    if (getWebSessionCookie() === sent) clearQqSession();
};

// Routes one provider request through the embedded Electron server or the configured Web base URL.
// It carries the session as the page keeps it when the request is made, before the first wait.
// 写入路由（POST_OPERATIONS）的参数放在 JSON 正文 `payload` 里；会话照旧走 header 或 `?cookie=`，后端两条路由都认。
export const requestQq = async <T = unknown>(
    operation: QqOperation,
    params: QqParams = {},
    payload?: Record<string, unknown>,
): Promise<T> => {
    const isPost = POST_OPERATIONS.has(operation);
    if (isPost !== (payload !== undefined)) {
        throw new OnlineProviderError(
            'invalid-response',
            `QQMusicApi ${operation} ${isPost ? 'requires' : 'does not take'} a request body`,
            'qq',
        );
    }
    const cookie = getWebSessionCookie();
    const base = await resolveApiBase();

    const endpoint = endpointFor(operation, params);

    // Android 扩展协议：WebView 内经原生桥直接调 QQ 上游，无独立后端
    if (base === 'extension') {
        const { extensionQqRequest } = await import('../../../audioNative');
        const send = async (signal?: AbortSignal) => {
            void signal;
            try {
                const result = await extensionQqRequest(operation, endpoint, payload, cookie);
                return { response: { ok: result.status >= 200 && result.status < 300, status: result.status, headers: { get: () => null } }, body: result.body };
            } catch (error) {
                console.warn('[QQ-ext]', operation, 'failed:', error instanceof Error ? error.message : String(error));
                throw error;
            }
        };
        const { response, body } = await (LOGIN_REQUESTS.has(operation) ? withLoginRequestLimit(send)
            : ONLINE_REQUESTS.has(operation) ? withOnlineRequestLimit(send, QQ_ONLINE_REQUEST_LIMIT_MS) : send());
        if (!response.ok) {
            if (response.status === 401) {
                dropSessionSent(cookie);
                throw new OnlineProviderError('auth-required', 'QQMusicApi login required', 'qq', body, response.status);
            }
            if (response.status === 404) {
                throw new OnlineProviderError(
                    'unsupported',
                    `QQMusicApi has no ${operation} route`,
                    'qq',
                    body,
                    response.status,
                );
            }
            throw new OnlineProviderError('network', `QQMusicApi request failed: ${response.status}`, 'qq', body, response.status);
        }
        if (body === undefined) {
            throw new OnlineProviderError('invalid-response', `QQMusicApi returned an unreadable ${operation} body`, 'qq');
        }
        assertUpstreamAccepted(operation, body);
        persistConfirmedSession(operation, body);
        return body as T;
    }

    const query = new URLSearchParams();
    Object.entries(endpoint.query).forEach(([key, value]) => {
        if (value !== undefined) query.set(key, String(value));
    });
    const headers: Record<string, string> = {};
    if (cookie) {
        if (isSameOriginBase(base)) {
            const token = tokenFromCookieString(cookie);
            // 同源请求不允许把未知格式的 session 放回 URL；清掉无效值，交给后端按未登录处理。
            if (token) headers[SESSION_HEADER_NAME] = token;
            else dropSessionSent(cookie);
        } else {
            query.set('cookie', cookie);
        }
    }
    query.set('timestamp', String(Date.now()));

    // Same-origin serverless calls must retain deployment-protection cookies; external qq-music-api instances
    // answer with `Access-Control-Allow-Origin: *`, so those requests still omit browser credentials.
    const credentials: RequestCredentials = isSameOriginBase(base) ? 'same-origin' : 'omit';
    const init: RequestInit = isPost
        ? { method: 'POST', credentials, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
        : { credentials, headers };
    // The answer and its body, read together: the time limit covers both.
    const send = async (signal?: AbortSignal) => {
        const answer = await fetch(`${base}${endpoint.path}?${query}`, { ...init, ...(signal ? { signal } : {}) });
        return { response: answer, body: await readJsonBody(answer) };
    };
    const { response, body } = await (LOGIN_REQUESTS.has(operation) ? withLoginRequestLimit(send)
        : ONLINE_REQUESTS.has(operation) ? withOnlineRequestLimit(send, QQ_ONLINE_REQUEST_LIMIT_MS) : send());
    if (!response.ok) {
        // A missing, expired, rejected, or non-persisted backend session is surfaced uniformly as 401.
        if (response.status === 401) {
            dropSessionSent(cookie);
            throw new OnlineProviderError('auth-required', 'QQMusicApi login required', 'qq', body, response.status);
        }
        // 旧后端缺路由会回 404；旧版 Serverless 则回带固定文案的 501。其他 501 仍是配置错误。
        const missingServerlessRoute = response.status === 501 && typeof body?.message === 'string' && (
            body.message.endsWith(' is not implemented by the serverless runtime.')
            || body.message.endsWith(' is not implemented by the serverless runtime. See /login/channels for what this deployment serves.')
        );
        if (response.status === 404 || missingServerlessRoute) {
            throw new OnlineProviderError(
                'unsupported',
                `QQMusicApi has no ${operation} route`,
                'qq',
                body,
                response.status,
            );
        }
        // The status is in the sentence, the backend's answer in the cause (qqFailure.ts reads both), and the wait a
        // 429 asks for on the error.
        throw new OnlineProviderError('network', `QQMusicApi request failed: ${response.status}`, 'qq', body, response.status, readRetryAfterMs(body, response));
    }

    if (body === undefined) {
        throw new OnlineProviderError('invalid-response', `QQMusicApi returned an unreadable ${operation} body`, 'qq');
    }
    assertUpstreamAccepted(operation, body);
    persistConfirmedSession(operation, body);
    return body as T;
};
