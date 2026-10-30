// src/audioNative/qq.ts
// QQ 音乐"扩展协议"：在 WebView 内复刻 qq-music-api（yakult-green-tea, AGPL）的服务端逻辑。
// 扫码登录走手机 QQ 纯 HTTP 通道（ptlogin 五步，无需 WebSocket / MQTT）；
// musicu POST（u.y.qq.com）Android 协议面不需要动态签名。
// 会话 token 是自包含的 base64url 凭证封包（与 serverless 的 sealed 模式同语义）。
// 全部请求经 FoliaBridge（OkHttp + CookieManager）发出，登录即浏览器级体验。

import { bridgeRequest, extensionUnsupported, simpleResponse } from './core';
import type { SimpleResponse } from './core';
import { parseCookieString, randomHex } from './crypto';
import { readProviderSessionValue, removeProviderSessionValue, writeProviderSessionValue } from './sessionStore';

const MUSICU = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const PT_AID = '716027609';
const PT_DAIID = '383';
const PT_3RD_AID = '100497308';
const PT_U1 = 'https://graph.qq.com/oauth2.0/login_jump';
const CLIENT_ID = PT_3RD_AID;
const QQ_UA = 'QQMusic 14090008(android 10)';
const WEB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

interface QqCredential {
  musicid: string;
  musickey: string;
  loginType: number;
  nick?: string;
  logo?: string;
  refresh_key?: string;
  expiresAt?: number;
}

type Params = Record<string, string>;

// ---------------------------------------------------------------------------
// 会话封包

export const sealSession = (credential: QqCredential): string => {
  const json = JSON.stringify(credential);
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const unsealSession = (token: string): QqCredential | null => {
  try {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(b64)))) as QqCredential;
  } catch {
    return null;
  }
};

const extractSessionToken = (cookieParam?: string): string => {
  if (!cookieParam) return '';
  const map = parseCookieString(cookieParam);
  return map.get('qqmusic_session') ?? readProviderSessionValue('qq', 'cookie')?.replace(/^.*qqmusic_session=/, '').replace(/;.*$/, '') ?? '';
};

const credentialFromRequest = (cookieParam?: string): QqCredential | null => unsealSession(extractSessionToken(cookieParam));

// ---------------------------------------------------------------------------
// 基础请求

const hash33 = (text: string, initial: number): number => {
  let result = initial;
  for (let i = 0; i < text.length; i += 1) {
    result += (result << 5) + text.charCodeAt(i);
    result &= 0x7fffffff;
  }
  return result;
};

// WebView 页面是 https://localhost，http 图片会被当混合内容拦截 —— 所有封面强制 https
const httpsImg = (u: unknown): string => {
  const v = typeof u === 'string' ? u : '';
  return v.startsWith('http://') ? v.replace(/^http:\/\//, 'https://') : v;
};

const answer = (body: unknown, status = 200): SimpleResponse => simpleResponse(status, body);

interface MusicuResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any;
  status: number;
}

const postMusicu = async (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any,
  credential: QqCredential | null,
  commOverride: Record<string, unknown> = {},
): Promise<MusicuResponse> => {
  const comm: Record<string, unknown> = credential
    ? {
        ct: 11, cv: 14090008, v: 14090008, chid: '10003505', tmeAppID: 'qqmusic',
        OpenUDID: randomHex(16).toLowerCase(), udid: randomHex(16).toLowerCase(),
        os_ver: '10', phonetype: 'MI 6', devicelevel: '29', newdevicelevel: '29',
        qq: credential.musicid, authst: credential.musickey, tmeLoginType: credential.loginType,
        ...commOverride,
      }
    : { ct: 24, cv: 0, uin: 0, format: 'json', ...commOverride };
  const body = JSON.stringify({ comm, req_0: req });
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': credential ? QQ_UA : WEB_UA,
    Referer: 'https://y.qq.com/',
  };
  if (credential) {
    headers.Cookie = `uin=${credential.musicid}; qqmusic_uin=${credential.musicid}; qm_keyst=${credential.musickey}; qqmusic_key=${credential.musickey}`;
  }
  const response = await bridgeRequest({ url: MUSICU, method: 'POST', headers, body, timeoutMs: 25_000 });
  let raw: any;
  try {
    raw = JSON.parse(response.body ?? '{}');
  } catch {
    return { raw: null, status: 502 };
  }
  return { raw, status: response.status };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reqData = (musicu: MusicuResponse): any => musicu.raw?.req_0?.data;

// ---------------------------------------------------------------------------
// ptlogin 扫码（纯 HTTP）

const QR_STORE_PREFIX = 'qq_qrsig_';
// 扫码成功后换票失败最多容忍几次：这个阶段上游已确认登录，一次网络抖动不该把会话丢掉
const TICKET_EXCHANGE_MAX_FAILURES = 3;
// 换票异步状态机：轮询立即返回（不阻塞登录请求时限），换票在后台完成后由下次轮询取走结果
type ExchangeState = { status: 'pending' | 'done' | 'failed'; cookie?: string; reason?: string; failures: number };
const exchangeStates = new Map<string, ExchangeState>();
// 扫码成功后换票失败最多容忍几次：这个阶段上游已确认登录，一次网络抖动不该把会话丢掉
const qrImageStore = new Map<string, string>();

const ptqrshow = async (unikey: string): Promise<void> => {
  const params = new URLSearchParams({
    appid: PT_AID, e: '2', l: 'M', s: '3', d: '72', v: '4',
    t: String(Math.random()), daid: PT_DAIID, pt_3rd_aid: PT_3RD_AID, u1: PT_U1,
  });
  const response = await bridgeRequest({
    url: `https://xui.ptlogin2.qq.com/ssl/ptqrshow?${params}`,
    method: 'GET',
    headers: { 'User-Agent': WEB_UA, Referer: 'https://xui.ptlogin2.qq.com/' },
    binary: true,
    timeoutMs: 15_000,
  });
  const setCookies = (response as { setCookies?: string[] }).setCookies ?? [];
  let qrsig = '';
  for (const entry of setCookies) {
    const match = /qrsig=([^;]+)/.exec(entry);
    if (match) qrsig = match[1]!;
  }
  if (!qrsig) throw new Error('ptqrshow did not return qrsig');
  const b64 = response.bodyBase64 ?? btoa(unescape(encodeURIComponent(response.body ?? '')));
  const dataUrl = `data:image/png;base64,${b64}`;
  qrImageStore.set(unikey, dataUrl);
  writeProviderSessionValue('qq', `qrimg_${unikey}`, dataUrl);
  writeProviderSessionValue('qq', `${QR_STORE_PREFIX}${unikey}`, qrsig);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ptqrloginPoll = async (qrsig: string): Promise<{ code: number; url?: string; message?: string }> => {
  // 参数与域名照 whycfawa qqCheckLoginQr：必须打 ssl.ptlogin2.qq.com，缺参数会被判「已拒绝」
  const params = new URLSearchParams({
    u1: PT_U1, ptqrtoken: String(hash33(qrsig, 0)), ptredirect: '0', h: '1', t: '1', g: '1',
    from_ui: '1', ptlang: '2052', action: `0-0-${Date.now()}`, js_ver: '23111510', js_type: '1',
    login_sig: '', pt_uistyle: '40', aid: PT_AID, daid: PT_DAIID, pt_3rd_aid: PT_3RD_AID,
  });
  const response = await bridgeRequest({
    url: `https://ssl.ptlogin2.qq.com/ptqrlogin?${params}`,
    method: 'GET',
    headers: { 'User-Agent': WEB_UA, Referer: 'https://xui.ptlogin2.qq.com/', Cookie: `qrsig=${qrsig}` },
    timeoutMs: 15_000,
  });
  const text = response.body ?? '';
  const match = /ptuiCB\('(\d+)','[^']*','([^']*)','[^']*','([^']*)'/.exec(text);
  if (!match) return { code: -1, message: `ptqrlogin unreadable: ${text.slice(0, 120)}` };
  return { code: Number(match[1]), url: match[2] || undefined, message: match[3] };
};

const followRedirects = async (url: string, headers: Record<string, string>): Promise<{ finalUrl: string; headersList: Record<string, string>[] }> => {
  const headersList: Record<string, string>[] = [];
  let current = url;
  for (let hop = 0; hop < 6; hop += 1) {
    const response = await bridgeRequest({
      url: current, method: 'GET', headers: { 'User-Agent': WEB_UA, ...headers }, timeoutMs: 15_000,
    });
    headersList.push(response.headers ?? {});
    const location = response.headers?.Location ?? response.headers?.location;
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    return { finalUrl: current, headersList };
  }
  return { finalUrl: current, headersList };
};

/**
 * 换凭证（照 whycfawa/folia-android qq-login-qr.js 复刻）：
 * ① check_sig 手动跟跳（302 的 Set-Cookie 上有 p_skey，必须当场收下）
 * ② authorize POST（g_tk = hash33(p_skey, 5381)，manual 重定向追 code，code 也可能藏在响应体里）
 * ③ musicu QQConnectLogin.QQLogin 换 qm_keyst 会话
 */
const mergeSetCookies = (jar: Map<string, string>, setCookies: string[]): void => {
  for (const entry of setCookies) {
    const pair = entry.split(';')[0] ?? '';
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
};

const cookieHeaderFromJar = (jar: Map<string, string>): string => (
  Array.from(jar.entries()).filter(([, v]) => v !== '').map(([k, v]) => `${k}=${v}`).join('; ')
);

export const exchangeCredential = async (checkSigUrl: string): Promise<QqCredential> => {
  const jar = new Map<string, string>();
  const mobileHeaders = { 'User-Agent': WEB_UA };

  // ① check_sig + 手动跟一跳
  let current = checkSigUrl;
  let pSkey = '';
  for (let hop = 0; hop < 3; hop += 1) {
    const res = await bridgeRequest({
      url: current, method: 'GET', followRedirects: false,
      headers: { ...mobileHeaders, Referer: 'https://xui.ptlogin2.qq.com/', Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', Cookie: cookieHeaderFromJar(jar) },
      timeoutMs: 15_000,
    });
    mergeSetCookies(jar, (res as { setCookies?: string[] }).setCookies ?? []);
    const candidate = jar.get('p_skey');
    if (candidate) pSkey = candidate;
    const location = res.headers?.Location ?? res.headers?.location;
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    break;
  }
  if (!pSkey) pSkey = jar.get('p_skey') ?? '';
  if (!pSkey) throw new Error('登录检查失败：缺少 p_skey');

  // ② authorize：manual 重定向追 code（code 也可能在响应体里）
  const gtk = hash33(pSkey, 5381);
  const authorizeParams = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: 'https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/',
    scope: 'get_user_info,get_app_friends',
    state: 'state',
    switch: '',
    from_ptlogin: '1',
    src: '1',
    update_auth: '1',
    openapi: '1010_1030',
    g_tk: String(gtk),
    auth_time: String(Date.now()),
    ui: `${randomHex(8)}-${randomHex(4)}-4${randomHex(3)}-a${randomHex(3)}-${randomHex(12)}`,
  });
  let authorizeUrl = `https://graph.qq.com/oauth2.0/authorize?${authorizeParams}`;
  let code = '';
  let authorizeBody = '';
  for (let hop = 0; hop < 5; hop += 1) {
    const res = await bridgeRequest({
      url: authorizeUrl, method: hop === 0 ? 'POST' : 'GET', followRedirects: false,
      headers: {
        ...mobileHeaders,
        ...(hop === 0 ? { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://graph.qq.com/', Origin: 'https://graph.qq.com' } : { Referer: 'https://graph.qq.com/', Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }),
        Cookie: cookieHeaderFromJar(jar),
      },
      body: hop === 0 ? authorizeParams.toString() : undefined,
      timeoutMs: 15_000,
    });
    mergeSetCookies(jar, (res as { setCookies?: string[] }).setCookies ?? []);
    authorizeBody = res.body ?? '';
    const location = res.headers?.Location ?? res.headers?.location ?? '';
    const codeMatch = /[?&]code=([^&"'\s]+)/.exec(String(location)) || /[?&]code=([^&"'\s]+)/.exec(authorizeBody);
    if (codeMatch?.[1]) { code = codeMatch[1]; break; }
    if (res.status >= 300 && res.status < 400 && location) {
      authorizeUrl = new URL(location, 'https://graph.qq.com/').toString();
      continue;
    }
    break;
  }
  if (!code) throw new Error(`authorize 未拿到 code: ${authorizeBody.replace(/\s+/g, ' ').slice(0, 120)}`);

  // ③ musicu 换凭证
  const musicu = await postMusicu({
    module: 'QQConnectLogin.LoginServer', method: 'QQLogin', param: { code },
  }, null, { g_tk: 5381, platform: 'yqq' });
  const data = reqData(musicu);
  if (!data?.musickey || !data?.musicid) throw new Error(`凭证交换失败: ${JSON.stringify(data).slice(0, 120)}`);
  return {
    musicid: String(data.musicid),
    musickey: String(data.musickey),
    loginType: Number(data.loginType ?? 2),
    nick: data.nick,
    logo: data.logo,
    refresh_key: data.refresh_key,
    expiresAt: data.expiresAt,
  };
};

// ---------------------------------------------------------------------------
// 端点处理

/**
 * QQ 红心写入的回包判定（照 src/audioNative/reference/qq.js 的 qqLikeWriteResult）：
 * `code` 1000 是登录失效，非 0/200 的码与 `v_failedSongId` 都是这次没写进去。
 */
const qqLikeWriteAccepted = (raw: any): { ok: boolean; loginRequired: boolean; code: number } => {
  const block = raw?.req_0 || {};
  const data = block.data || {};
  const code = Number(block.code ?? data.code ?? raw?.code ?? 0);
  if (code === 1000) return { ok: false, loginRequired: true, code };
  if (code && code !== 0 && code !== 200) return { ok: false, loginRequired: false, code };
  const business = Number(data.ret ?? data.resultCode ?? data.errCode ?? 0);
  if (typeof data.result === 'number' && data.result !== 0 && data.result !== 200) {
    return { ok: false, loginRequired: false, code: data.result };
  }
  if (business && business !== 0 && business !== 200 && typeof data.result !== 'object') {
    return { ok: false, loginRequired: false, code: business };
  }
  const failed = data.v_failedSongId || data.v_failSongId || data.vFailedSongId || data.failedSongIds;
  if (Array.isArray(failed) && failed.length) return { ok: false, loginRequired: false, code: business || -1 };
  return { ok: true, loginRequired: false, code: code || 200 };
};

// 一次 musicu 写入：字段形状与参考层的 qqPlaylistDetailWrite / qqSongFavWrite 相同。
const qqMusicuWrite = async (
  module: string,
  method: string,
  param: Record<string, unknown>,
  credential: QqCredential,
) => {
  const response = await postMusicu({ module, method, param }, credential);
  return qqLikeWriteAccepted(response.raw);
};

export const handleQqEndpoint = async (
  operation: string,
  path: string,
  params: Params,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, unknown> | undefined,
  cookieParam: string | undefined,
): Promise<SimpleResponse> => {
  const credential = credentialFromRequest(cookieParam);
  const PATH_ALIAS: Record<string, string> = {
    '/getSongListDetail': '/song_list_detail',
    '/getSongInfo': '/song_info',
    '/getMusicPlay': '/music_play',
    '/getAlbumInfo': '/album_info',
    '/getSingerAlbum': '/artist_albums',
    '/getSingerHotsong': '/artist_songs',
  };
  let route = PATH_ALIAS[path] ?? path;
  // 上游把标识放路径段：/getMusicPlay/<songmid>、/getSongListDetail/<disstid>
  for (const [prefix, target] of Object.entries(PATH_ALIAS)) {
    if (path.startsWith(`${prefix}/`)) {
      route = target;
      const tail = path.slice(prefix.length + 1).split('/')[0];
      if (tail && !params.songmid && !params.disstid) {
        const numeric = /^\d+$/.test(tail);
        if (target === '/music_play') params.songmid = tail;
        else if (numeric) params.disstid = tail;
        else params.songmid = tail;
      }
      break;
    }
  }
  try {
    switch (route) {
      case '/login/channels': {
        // 宣告 qqmusic 通用通道：一码三用（QQ/微信/QQ音乐 App），前端跳过方式选择器
        return simpleResponse(200, { code: 200, data: { channels: ['qqmusic'] } });
      }
      case '/login/qr/key': {
        const unikey = randomHex(16);
        await ptqrshow(unikey);
        return answer({ code: 200, data: { unikey, channel: params.channel ?? 'qq' } });
      }
      case '/login/qr/create': {
        const key = params.key ?? '';
        const image = qrImageStore.get(key) ?? readProviderSessionValue('qq', `qrimg_${key}`);
        if (!image) return answer({ code: 404, message: 'QR session expired' }, 404);
        return answer({ code: 200, data: { qrimg: image } });
      }
      case '/login/qr/check': {
        const key = params.key ?? '';
        const qrsig = readProviderSessionValue('qq', `${QR_STORE_PREFIX}${key}`);
        if (!qrsig) return answer({ code: 800, message: 'QR session expired' });
        const poll = await ptqrloginPoll(qrsig);
        if (poll.code === 66) return answer({ code: 801, message: 'waiting' });
        if (poll.code === 67) return answer({ code: 802, message: 'scanned' });
        if (poll.code === 65) return answer({ code: 800, message: 'expired' });
        if (poll.code === 0 && poll.url) {
          // 扫码已确认：启动后台换票，本轮立即返回 802（已扫码），不让轮询请求阻塞超时
          const existing = exchangeStates.get(key);
          if (!existing || existing.status === 'failed') {
            const state: ExchangeState = { status: 'pending', failures: existing?.failures ?? 0 };
            exchangeStates.set(key, state);
            void exchangeCredential(poll.url)
              .then((credential) => {
                state.status = 'done';
                state.cookie = `qqmusic_session=${sealSession(credential)}`;
              })
              .catch((exchangeError: unknown) => {
                state.failures += 1;
                state.reason = exchangeError instanceof Error ? exchangeError.message : String(exchangeError);
                if (state.failures >= TICKET_EXCHANGE_MAX_FAILURES) {
                  state.status = 'failed';
                } else {
                  state.status = 'pending';
                }
              });
          }
          const state = exchangeStates.get(key)!;
          if (state.status === 'done') {
            const cookie = state.cookie!;
            exchangeStates.delete(key);
            return answer({ code: 803, message: 'confirmed', cookie });
          }
          if (state.status === 'failed') {
            const reason = state.reason ?? '换票失败';
            exchangeStates.delete(key);
            return answer({ code: 800, message: `换票失败: ${reason}` });
          }
          // 还在换票中：回 802 让前端继续轮询（手机端早已登录成功）
          return answer({ code: 802, message: '已扫码，确认中', retryable: true });
        }
        return answer({ code: 800, message: poll.message ?? `poll code ${poll.code}` });
      }
      case '/login/qr/cancel':
        return answer({ code: 200 });
      case '/login/status': {
        console.log('[QQ-status] cookieParam', String(cookieParam ?? '').slice(0, 30), 'hasCredential', !!credential);
        if (!credential) return answer({ code: 200, data: {} });
        // 凭据自带资料兜底（GetLoginUserInfo 的账号字段在嵌套 info 里）
        const base: Record<string, unknown> = {
          musicid: credential.musicid,
          str_musicid: credential.musicid,
          nickname: credential.nickname || credential.musicid,
          nick: credential.nickname || credential.musicid,
          ...(credential.logo ? { avatarUrl: credential.logo } : {}),
        };
        try {
          const musicu = await postMusicu({ module: 'music.UserInfo.userInfoServer', method: 'GetLoginUserInfo', param: {} }, credential);
          const data = (reqData(musicu) ?? {}) as Record<string, any>;
          const info = (data.info ?? data) as Record<string, unknown>;
          const nick = (info.nick ?? info.nickname ?? '') as string;
          const logo = (info.logo ?? info.headpic ?? info.avatarUrl ?? '') as string;
          return answer({ code: 200, data: { profile: { ...base, ...info, ...(nick ? { nickname: nick, nick } : {}), ...(logo ? { avatarUrl: logo, avatar: logo } : {}) } } });
        } catch (statusError) {
          console.log('[QQ-status] fallback to credential', String(statusError).slice(0, 80));
          return answer({ code: 200, data: { profile: base } });
        }
      }
      case '/logout':
        return answer({ code: 200 });
      case '/user/detail': {
        if (!credential) return answer({ code: 401, message: 'login required' }, 401);
        const musicu = await postMusicu({ module: 'music.UserInfo.userInfoServer', method: 'GetLoginUserInfo', param: {} }, credential);
        const data = reqData(musicu);
        return answer({ code: 200, profile: data?.profile ?? data ?? {} });
      }
      case '/user/playlist': {
        if (!credential) return answer({ code: 401, message: 'login required' }, 401);
        const musicu = await postMusicu({ module: 'music.musicasset.PlaylistBaseRead', method: 'GetPlaylistByUin', param: { uin: credential.musicid } }, credential);
        const raw: any = reqData(musicu) ?? {};
        const list: any[] = Array.isArray(raw?.v_playlist) ? raw.v_playlist : (Array.isArray(raw?.playlist) ? raw.playlist : []);
        // provider 归一化吃 QQ 原生字段（dirName/bigpicUrl/songNum/dirId/tid/dirShow/uin），原样透传，仅封面升 https
        const mapped = list.map((item: any) => ({
          ...item,
          bigpicUrl: httpsImg(item.bigpicUrl),
          picUrl: httpsImg(item.picUrl),
        }));
        return answer({ code: 200, playlist: mapped, total: mapped.length, more: false });
      }
      case '/user/playlist/tracks': {
        const rawId = Number(params.disstid ?? 0) || Number(params.dirid ?? 0) || Number(params.tid ?? 201);
        // 小于 10000 是自建目录号（我喜欢=201）；大数是歌单 disstid
        const isDir = rawId > 0 && rawId < 10000;
        const musicu = await postMusicu({
          module: 'music.srfDissInfo.DissInfo',
          method: 'CgiGetDiss',
          param: { disstid: isDir ? 0 : rawId, dirid: isDir ? rawId : 0, tag: true, song_begin: Number(params.offset ?? 0), song_num: Number(params.limit ?? 100), userinfo: true, orderlist: true },
        }, credential);
        const data = (reqData(musicu) ?? {}) as any;
        const ownedSongs: any[] = Array.isArray(data?.songlist) ? data.songlist : [];
        return answer({ code: 0, songs: ownedSongs, total: Number(data?.total_song_num ?? ownedSongs.length), more: false });
      }
      case '/user/playlist/tracks': {
        if (!credential) return answer({ code: 401, message: 'login required' }, 401);
        const dirid = Number(params.dirid ?? params.tid ?? 0);
        const musicu = await postMusicu({
          module: 'music.srfDissInfo.DissInfo',
          method: 'CgiGetDiss',
          param: { disstid: Number(params.disstid ?? 0), dirid, tag: true, song_begin: Number(params.offset ?? 0), song_num: Number(params.limit ?? 100), userinfo: true, orderlist: true, enc_host_uin: String((credential as any).encryptUin ?? '') },
        }, credential);
        const data = (reqData(musicu) ?? {}) as any;
        const cdlist = Array.isArray(data?.cdlist) ? data.cdlist : [];
        return answer({ code: 0, response: { cdlist } });
      }
      case '/user/liked-songs': {
        if (!credential) return answer({ code: 401, message: 'login required' }, 401);
        const musicu = await postMusicu({
          module: 'music.srfDissInfo.DissInfo', method: 'CgiGetDiss',
          param: { dirid: 201, tag: true, song_begin: Number(params.offset ?? '0'), song_num: Number(params.limit ?? '100'), userinfo: true, orderlist: true },
        }, credential);
        const data = (reqData(musicu) ?? {}) as any;
        const likedSongs: any[] = Array.isArray(data?.songlist) ? data.songlist : [];
        return answer({ code: 0, songs: likedSongs, total: Number(data?.total_song_num ?? likedSongs.length), more: false });
      }
      case '/user/playlist-detail': {
        if (!credential) return answer({ code: 401, message: 'login required' }, 401);
        const musicu = await postMusicu({
          module: 'music.srfDissInfo.DissInfo', method: 'CgiGetDiss',
          param: { disstid: Number(params.tid ?? params.dirid ?? '0'), song_begin: Number(params.offset ?? '0'), song_num: Number(params.limit ?? '100') },
        }, credential);
        return answer({ code: 200, ...(reqData(musicu) ?? {}) });
      }
      case '/user/playlist-detail': {
        return answer({ code: 200, play_cnt: 0 });
      }
      case '/user/playlist-detail': {
        return answer({ code: 200, play_cnt: 0 });
      }
      case '/radio/list': {
        const musicu = await postMusicu({ module: 'pf.radiosvr', method: 'GetRadiolist', param: { uin: credential?.musicid ?? 0 } }, credential);
        const data = (reqData(musicu) ?? {}) as any;
        const raw = Array.isArray(data?.radio_list) ? data.radio_list : [];
        const groups = raw.map((g: any) => ({
          id: String(g?.id ?? g?.groupId ?? ''),
          title: String(g?.title ?? g?.groupName ?? ''),
          radios: (Array.isArray(g?.list) ? g.list : []).map((r: any) => ({
            id: Number(r?.id ?? 0),
            title: String(r?.title ?? ''),
            picurl: String(r?.pic_url ?? r?.picUrl ?? ''),
            listenNum: Number(r?.listenNum ?? 0),
          })),
        }));
        return answer({ code: 200, groups });
      }
      case '/radio/tracks': {
        const radioId = Number(params.id ?? 99);
        if (radioId === 99) {
          const guess = await postMusicu({ module: 'music.radioProxy.MbTrackRadioSvr', method: 'get_radio_track', param: { id: 99, firstplay: 1, num: 15 } }, credential);
          const gdata = (reqData(guess) ?? {}) as any;
          return answer({ code: 200, songs: Array.isArray(gdata?.tracks) ? gdata.tracks : [] });
        }
        const musicu = await postMusicu({ module: 'pf.radiosvr', method: 'GetRadiosonglist', param: { id: radioId, firstplay: 0, num: 9 } }, credential);
        const data = (reqData(musicu) ?? {}) as any;
        const songs = Array.isArray(data?.track_list) ? data.track_list : (Array.isArray(data?.songlist) ? data.songlist : []);
        return answer({ code: 200, songs });
      }
      case '/recommend/radar': {
        const musicu = await postMusicu({ module: 'music.radioProxy.MbTrackRadioSvr', method: 'get_radio_track', param: { id: 99, firstplay: 1, num: 15 } }, credential);
        const data = (reqData(musicu) ?? {}) as any;
        const tracks = Array.isArray(data?.tracks) ? data.tracks : (Array.isArray(data?.songlist) ? data.songlist : []);
        return answer({ code: 200, songs: tracks });
      }
      case '/recommend/new-albums':
        return answer({ code: 200, data: { albums: [] } });
      case '/recommend/toplist': {
        const topid = Number(params.id ?? params.topid ?? 0);
        if (!topid) return answer({ code: 200, songs: [], total: 0, more: false });
        const period = typeof params.period === 'string' && params.period ? params.period : '';
        const musicu = await postMusicu({
          module: 'musicToplist.ToplistInfoServer',
          method: 'GetDetail',
          param: { topid, offset: Number(params.offset ?? 0), num: Number(params.limit ?? 100), period },
        }, credential);
        const data = (reqData(musicu) ?? {}) as any;
        const songs = Array.isArray(data?.songInfoList) ? data.songInfoList : (Array.isArray(data?.songlist) ? data.songlist : []);
        const total = Number(data?.totalNum ?? data?.total_song_num ?? songs.length);
        return answer({ code: 200, songs, total, more: songs.length >= Number(params.limit ?? 100) });
      }
      case '/recommend/categories':
        return answer({ code: 200, data: { categories: [] } });
      case '/recommend/category-playlists':
        return answer({ code: 200, data: { playlists: [] } });
      case '/song/similar':
        return answer({ code: 200, data: { songs: [] } });
      case '/radio/list': {
        const musicu = await postMusicu({ module: 'pf.radiosvr', method: 'GetRadiolist', param: { uin: credential?.musicid ?? 0 } }, credential);
        const data = (reqData(musicu) ?? {}) as any;
        const raw = Array.isArray(data?.radio_list) ? data.radio_list : [];
        const groups = raw.map((g: any) => ({
          id: String(g?.id ?? g?.groupId ?? ''),
          title: String(g?.title ?? g?.groupName ?? ''),
          radios: (Array.isArray(g?.list) ? g.list : []).map((r: any) => ({
            id: Number(r?.id ?? 0),
            title: String(r?.title ?? ''),
            picurl: String(r?.pic_url ?? r?.picUrl ?? ''),
            listenNum: Number(r?.listenNum ?? 0),
          })),
        }));
        return answer({ code: 200, groups });
      }
      case '/radio/tracks': {
        const radioId = Number(params.id ?? 99);
        if (radioId === 99) {
          const guess = await postMusicu({ module: 'music.radioProxy.MbTrackRadioSvr', method: 'get_radio_track', param: { id: 99, firstplay: 1, num: 15 } }, credential);
          const gdata = (reqData(guess) ?? {}) as any;
          return answer({ code: 200, songs: Array.isArray(gdata?.tracks) ? gdata.tracks : [] });
        }
        const musicu = await postMusicu({ module: 'pf.radiosvr', method: 'GetRadiosonglist', param: { id: radioId, firstplay: 0, num: 9 } }, credential);
        const data = (reqData(musicu) ?? {}) as any;
        const songs = Array.isArray(data?.track_list) ? data.track_list : (Array.isArray(data?.songlist) ? data.songlist : []);
        return answer({ code: 200, songs });
      }
      case '/recommend/radar': {
        const musicu = await postMusicu({ module: 'music.radioProxy.MbTrackRadioSvr', method: 'get_radio_track', param: { id: 99, firstplay: 1, num: 15 } }, credential);
        const data = (reqData(musicu) ?? {}) as any;
        const tracks = Array.isArray(data?.tracks) ? data.tracks : (Array.isArray(data?.songlist) ? data.songlist : []);
        return answer({ code: 200, songs: tracks });
      }
      case '/recommend/new-albums':
        return answer({ code: 200, data: { albums: [] } });
      case '/recommend/toplist': {
        const topid = Number(params.id ?? params.topid ?? 0);
        if (!topid) return answer({ code: 200, songs: [], total: 0, more: false });
        const period = typeof params.period === 'string' && params.period ? params.period : '';
        const musicu = await postMusicu({
          module: 'musicToplist.ToplistInfoServer',
          method: 'GetDetail',
          param: { topid, offset: Number(params.offset ?? 0), num: Number(params.limit ?? 100), period },
        }, credential);
        const data = (reqData(musicu) ?? {}) as any;
        const songs = Array.isArray(data?.songInfoList) ? data.songInfoList : (Array.isArray(data?.songlist) ? data.songlist : []);
        const total = Number(data?.totalNum ?? data?.total_song_num ?? songs.length);
        return answer({ code: 200, songs, total, more: songs.length >= Number(params.limit ?? 100) });
      }
      case '/recommend/categories':
        return answer({ code: 200, data: { categories: [] } });
      case '/recommend/category-playlists':
        return answer({ code: 200, data: { playlists: [] } });
      case '/song/similar':
        return answer({ code: 200, data: { songs: [] } });
      case '/search': {
        // provider 传的是 type='song'。上游的 search_type 只认数字：0 会被 2001 拒，7 才是「歌曲」。
        const rawType = String(params.type ?? '').toLowerCase();
        const searchType = rawType === '' || rawType === 'song'
          ? 7
          : (Number.isFinite(Number(rawType)) ? Number(rawType) : 7);
        const pageSize = Number(params.limit ?? '20');
        const musicu = await postMusicu({
          module: 'music.search.SearchCgiService', method: 'DoSearchForQQMusicLite',
          param: {
            search_id: String(Date.now()) + String(Math.floor(Math.random() * 1000)),
            remoteplace: 'search.android.keyboard',
            query: params.keyword ?? params.query ?? '',
            search_type: searchType,
            num_per_page: pageSize,
            page_num: Number(params.page ?? '1'),
            highlight: 0, nqc_flag: 0, page_id: 1, grp: 1,
          },
          // tmeAppID 用 'qqmusic'，不要用 'qqmusiclight'：上游把这个轻量客户端身份软封了，
          // 搜歌一律回 2001 且 item_song 为空（2026-10-25 实测同一请求换 'qqmusic' 稳定回 20 条）。
        }, credential, { ct: 11, cv: '1003006', v: '1003006', tmeAppID: 'qqmusic', nettype: 'NETWORK_WIFI', udid: '0', uid: '0' });
        const data = (reqData(musicu) ?? {}) as any;
        const body = (data?.body ?? {}) as any;
        // 条目原样交出去：normalizeQqSong 要 file.media_mid —— 播放链接的 filename 由它拼，
        // 只剩 mid 的瘦条目会让 media_mid ≠ songmid 的那些歌（占多数）拿不到播放链接。
        const items: any[] = Array.isArray(body.item_song)
          ? body.item_song
          : Array.isArray(body.song?.list) ? body.song.list : [];
        const total = Number(body.total ?? data?.meta?.sum ?? items.length);
        return answer({
          code: 200,
          items,
          ...(Number.isFinite(total) && total >= 0 ? { total } : {}),
          more: items.length >= pageSize,
        });
      }
      case '/song_info': {
        // 契约与后端 qq-music-api 的 /getSongInfo 一致：provider 读 response.songinfo.data.track_info
        const songmid = String(params.songmid ?? params.id ?? '');
        const musicu = await postMusicu({
          module: 'music.pf_song_detail_svr', method: 'get_song_detail_yqq',
          param: { song_type: 0, song_mid: songmid },
        }, credential);
        const data = (reqData(musicu) ?? {}) as any;
        return answer({ code: 0, response: { songinfo: { data } } });
      }
      case '/song_list_detail': {
        const disstid = Number(params.disstid ?? 0);
        // 小于 10000 的 id 是自建目录号（我喜欢=201）；否则按歌单 disstid 读
        const isDir = disstid > 0 && disstid < 10000;
        const musicu = await postMusicu({
          module: 'music.srfDissInfo.DissInfo',
          method: 'CgiGetDiss',
          param: isDir
            ? { dirid: disstid, disstid: 0, tag: true, song_begin: 0, song_num: 200, userinfo: true, orderlist: true }
            : { disstid, tag: true, song_begin: 0, song_num: 200, userinfo: true, orderlist: true },
        }, credential);
        const data = (reqData(musicu) ?? {}) as any;
        const songlist = Array.isArray(data?.songlist) ? data.songlist : [];
        const cdlist = [{
          ...(data?.dirinfo ?? {}),
          dissname: String(data?.dirinfo?.title ?? data?.dirinfo?.dissname ?? ''),
          songlist,
          total_song_num: Number(data?.total_song_num ?? songlist.length),
          songnum: Number(data?.total_song_num ?? songlist.length),
        }];
        return answer({ code: 0, response: { cdlist } });
      }
      case '/album_info': {
        // 官方实现（getAlbumInfo）：GET fcg_v8_album_info_cp.fcg
        const albummid = String(params.albummid ?? '');
        const response = await bridgeRequest({
          url: `https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg?albummid=${encodeURIComponent(albummid)}&format=json&outCharset=utf-8`,
          method: 'GET',
          headers: { Referer: 'https://y.qq.com/' },
          timeoutMs: 20_000,
        });
        let parsed: any = null;
        try { parsed = JSON.parse(response.body ?? '{}'); } catch { parsed = null; }
        return answer({ code: 200, response: parsed });
      }
      case '/artist_albums': {
        // 官方实现（getSingerAlbum）：GET musicu.fcg，AlbumListServer，begin 直传页码
        const singermid = String(params.singermid ?? '');
        const num = Number(params.limit ?? 50);
        const begin = Number(params.page ?? 0);
        const dataParam = JSON.stringify({
          comm: { ct: 24, cv: 0 },
          singer: {
            method: 'GetAlbumList',
            param: { sort: 5, singermid, begin, num },
            module: 'music.musichallAlbum.AlbumListServer',
          },
        });
        const response = await bridgeRequest({
          url: `https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&singermid=${encodeURIComponent(singermid)}&data=${encodeURIComponent(dataParam)}`,
          method: 'GET',
          headers: { Referer: 'https://y.qq.com/' },
          timeoutMs: 20_000,
        });
        let parsed: any = null;
        try { parsed = JSON.parse(response.body ?? '{}'); } catch { parsed = null; }
        return answer({ code: 200, response: parsed });
      }
      case '/artist_songs': {
        // 官方实现（getSingerHotsong）：GET musicu.fcg，data 参数装模块调用（web_singer_info_svr）
        const singermid = String(params.singermid ?? '');
        const num = Number(params.limit ?? 30);
        const page = Number(params.page ?? 1);
        const dataParam = JSON.stringify({
          comm: { ct: 24, cv: 0 },
          singer: {
            method: 'get_singer_detail_info',
            param: { sort: 5, singermid, sin: (page - 1) * num, num },
            module: 'music.web_singer_info_svr',
          },
        });
        const response = await bridgeRequest({
          url: `https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&singermid=${encodeURIComponent(singermid)}&data=${encodeURIComponent(dataParam)}`,
          method: 'GET',
          headers: { Referer: 'https://y.qq.com/' },
          timeoutMs: 20_000,
        });
        let parsed: any = null;
        try { parsed = JSON.parse(response.body ?? '{}'); } catch { parsed = null; }
        return answer({ code: 200, response: parsed });
      }
      case '/music_play': {
        const songmid = String(params.songmid ?? params.id ?? '').trim();
        if (!songmid) return answer({ code: 400, data: { message: 'no songmid' } }, 400);
        let mediaId = String(params.mediaId ?? '').trim();
        if (!mediaId) {
          // 没带 media_mid（旧搜索结果、恢复的队列、分享来的条目）：先向单曲详情要一次。
          // vkey 的 filename 只能拿 media_mid 拼，用 songmid 顶替时上游对大多数歌一律不给链接。
          try {
            const detail = await postMusicu({
              module: 'music.pf_song_detail_svr', method: 'get_song_detail_yqq',
              param: { song_type: 0, song_mid: songmid },
            }, credential);
            const track = (reqData(detail) as any)?.track_info;
            mediaId = String(track?.file?.media_mid ?? '').trim();
          } catch {
            mediaId = '';
          }
        }
        if (!mediaId) mediaId = songmid;
        const quality = String(params.quality ?? '128');
        const preview = String(params.preview ?? '') === '1' || String(params.preview ?? '') === 'true';
        const prefix = preview ? 'RS02' : quality === 'flac' ? 'F000' : Number(quality) >= 320 ? 'M800' : 'M500';
        const ext = !preview && quality === 'flac' ? 'flac' : 'mp3';
        const filename = `${prefix}${mediaId}.${ext}`;
        const musicu = await postMusicu({
          module: 'music.vkey.GetVkey',
          method: 'UrlGetVkey',
          param: {
            filename: [filename],
            guid: randomHex(32),
            songmid: [songmid],
            songtype: [0],
            uin: String(credential?.musicid ?? '0'),
            loginflag: 1,
            platform: '20',
          },
        }, credential, { ct: 24, cv: 0, format: 'json' });
        const midurlinfo = (reqData(musicu) as any)?.midurlinfo ?? [];
        const info = midurlinfo[0] ?? {};
        const purl = String(info.purl ?? '');
        const hasHost = /^[a-z][a-z0-9.-]*\.[a-z]{2,}\//i.test(purl);
        const rawUrl = !purl ? '' : purl.startsWith('http') ? purl : hasHost ? `http://${purl}` : `http://isure.stream.qqmusic.qq.com/${purl}`;
        // WebView 是 https 页面，http 音频会被混合内容拦截 —— 音频也强制 https
        const url = httpsImg(rawUrl);
        // 与桌面版一致：成功 url+error:false；无权限 url:""+error+restriction（result/subcode 透传）
        const entry: Record<string, unknown> = { url, songmid };
        if (url) { entry.error = false; if (preview) entry.preview = true; }
        else {
          entry.error = '暂无播放链接';
          entry.restriction = { key: 'url_unavailable', evidence: 'observed-response', codes: { result: info.result ?? 0, subcode: info.subcode ?? 0 } };
        }
        return answer({ code: 200, data: { playUrl: { [songmid]: entry } } });
      }
      case '/recommend/toplists': {
        const musicu = await postMusicu({ module: 'musicToplist.ToplistInfoServer', method: 'GetAll', param: {} }, null);
        const data = (reqData(musicu) ?? {}) as any;
        const groups = (Array.isArray(data?.group) ? data.group : []).map((g: any) => ({
          id: String(g?.groupName ?? g?.id ?? ''),
          title: String(g?.groupName ?? ''),
          toplists: (Array.isArray(g?.toplist) ? g.toplist : []).map((t: any) => ({
            id: Number(t?.topId ?? 0),
            title: String(t?.title ?? ''),
            cover: httpsImg(t?.frontPicUrl ?? t?.headPicUrl ?? t?.picUrl ?? ''),
            total: Number(t?.totalNum ?? 0),
            listenNum: Number(t?.listenNum ?? 0),
            period: String(t?.period ?? ''),
            intro: String(t?.intro ?? ''),
          })),
        }));
        return answer({ code: 200, groups });
      }
      case '/recommend/playlists': {
        const size = Math.min(60, Number(params.limit ?? '35')) || 35;
        const musicu = await postMusicu({
          module: 'music.playlist.PlaylistSquare', method: 'GetRecommendFeed',
          param: { From: 0, Size: size },
        }, credential);
        const data = (reqData(musicu) ?? {}) as any;
        // GetRecommendFeed 的条目可能在 data.list.v_item[].basic / data.v_item / data.playlists
        let rawList: any[] = [];
        // 实测形状：data.List[].Playlist.basic（tid/title/picurl/song_cnt/play_cnt/creator/desc）
        const feedList = data?.List ?? data?.list ?? [];
        if (Array.isArray(feedList) && feedList.length) {
          rawList = feedList.map((x: any) => x?.Playlist?.basic ?? x?.Playlist ?? x?.basic ?? x);
        } else if (Array.isArray(data?.playlists)) rawList = data.playlists;
        else if (Array.isArray(data?.v_playlist)) rawList = data.v_playlist;
        const hasMore = data?.HasMore === true || data?.hasMore === true;
        // basic 的封面字段名不固定：先按常见键找，找不到就在值里搜图片域名
        const coverOf = (b: any): string => {
          const pickUrl = (v: any): string => {
            if (typeof v === 'string') return v;
            if (v && typeof v === 'object') return String(v.big_url ?? v.medium_url ?? v.small_url ?? v.url ?? v.picurl ?? v.imgurl ?? '');
            return '';
          };
          for (const k of ['imgurl', 'picurl', 'pic', 'logo', 'cover', 'header', 'pic_url']) {
            const u = pickUrl(b?.[k]);
            if (u) return u;
          }
          for (const v of Object.values(b ?? {})) {
            const u = pickUrl(v);
            if (u && (u.includes('gtimg') || u.includes('music-file.y.qq.com') || u.includes('qpic.y.qq.com'))) return u;
          }
          return '';
        };
        const playlists = rawList.map((b: any) => ({
          tid: String(b?.tid ?? b?.disstid ?? b?.dissid ?? ''),
          title: String(b?.dissname ?? b?.title ?? b?.diss_name ?? ''),
          desc: String(b?.desc ?? ''),
          picurl: httpsImg(coverOf(b)),
          songnum: String(b?.song_cnt ?? b?.songnum ?? '0'),
          play_cnt: String(b?.play_cnt ?? '0'),
          creator: b?.creator ?? { uin: '', encrypt_uin: '' },
        })).filter((p: any) => p.tid && p.title);
        return answer({ code: 200, playlists, more: hasMore });
      }
      case '/recommend/new-songs': {
        const area = Number(params.area ?? params.type ?? 1) || 1;
        const musicu = await postMusicu({ module: 'newsong.NewSongServer', method: 'get_new_song_info', param: { type: area } }, null);
        const data = (reqData(musicu) ?? {}) as any;
        const songs = Array.isArray(data?.songlist) ? data.songlist : [];
        const areas = (Array.isArray(data?.lanlist) ? data.lanlist : []).map((a: any) => ({ id: Number(a?.type ?? 0), name: String(a?.lan ?? '') }));
        return answer({ code: 200, songs, areas, area });
      }
      case '/login/refresh':
        return answer({ code: 200, data: {} });
      case '/user/vip':
        return answer({ code: 200, data: { vipType: 0, vipLevel: 0 } });
      case '/user/cloud':
        return answer({ code: 200, data: [] });
      case '/user/albums':
        return answer({ code: 200, data: [] });
      case '/user/guess-you-like': {
        const musicu = await postMusicu({ module: 'music.radioProxy.MbTrackRadioSvr', method: 'get_radio_track', param: { id: 99, firstplay: 1, num: 15 } }, credential);
        const data = (reqData(musicu) ?? {}) as any;
        const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
        return answer({ code: 200, songs: tracks });
      }
      case '/user/daily-songs': {
        const musicu = await postMusicu({ module: 'music.radioProxy.MbTrackRadioSvr', method: 'get_radio_track', param: { id: 99, firstplay: 1, num: 30 } }, credential);
        const data = (reqData(musicu) ?? {}) as any;
        const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
        return answer({ code: 200, songs: tracks, data: tracks, total: tracks.length, more: false });
      }
      case '/user/song/like': {
        // 红心/取消红心：QQ 自己的「我喜欢」是 dirId 201，先走 PlaylistDetailWrite，再退到
        // SongFavWrite（与参考层同一顺序）。旧后端没有这条路由时，这里是唯一能写的地方。
        if (!credential) return answer({ error: 'LOGIN_REQUIRED', liked: false }, 401);
        const song = (payload?.song ?? {}) as { id?: unknown; mid?: unknown };
        const liked = payload?.liked !== false;
        const songId = Number(song.id ?? 0);
        if (!Number.isFinite(songId) || songId <= 0) {
          return answer({ liked: !liked, error: 'QQ song has no numeric id for a like write' });
        }
        const methods = liked ? 'AddSonglist' : 'DelSonglist';
        for (const songType of [0, 13]) {
          const result = await qqMusicuWrite(
            'music.musicasset.PlaylistDetailWrite',
            methods,
            { dirId: 201, v_songInfo: [{ songId, songType }] },
            credential,
          );
          if (result.loginRequired) return answer({ error: 'LOGIN_REQUIRED', liked: !liked }, 401);
          if (result.ok) return answer({ liked, code: result.code, via: 'PlaylistDetailWrite' });
        }
        const uin = Number(credential.musicid) || credential.musicid;
        for (const songType of [0, 13]) {
          const result = await qqMusicuWrite(
            'music.musicasset.SongFavWrite',
            liked ? 'AddSong' : 'DelSong',
            { uin, v_uin: uin, dirId: 201, ids: [songId], songTypes: [songType] },
            credential,
          );
          if (result.loginRequired) return answer({ error: 'LOGIN_REQUIRED', liked: !liked }, 401);
          if (result.ok) return answer({ liked, code: result.code, via: 'SongFavWrite' });
        }
        return answer({ liked: !liked, error: 'QQ like write was refused' });
      }
      case '/user/subscription-status':
      case '/user/album/subscribe':
      case '/user/playlist/tracks':
      case '/user/playlist/subscribe':
      case '/user/playlist/create':
      case '/recommend/new-albums':
      case '/recommend/toplist':
      case '/recommend/categories':
      case '/recommend/category-playlists':
      case '/recommend/radar':
      case '/radio/list':
      case '/radio/tracks':
      case '/song/similar':
        return extensionUnsupported(`QQMusicApi has no ${operation} route in the Android extension layer`);
      default:
        return extensionUnsupported(`QQMusicApi has no ${operation} route in the Android extension layer`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return answer({ code: 502, message, kind: 'network' }, 502);
  }
};

export const clearQqExtensionSession = (): void => {
  // 登出由 providerStorage 层清理；这里同步清掉进行中的二维码状态
  qrImageStore.clear();
};

void removeProviderSessionValue;
