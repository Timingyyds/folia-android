import QRCode from 'qrcode';
// src/audioNative/netease.ts
// 网易云音乐"扩展协议"：在 WebView 内复刻 NeteaseCloudMusicApi 的服务端逻辑。
// 加密方案与端点映射来自 NeteaseCloudMusicApi（Goooler fork, AGPL）的公开实现：
//   weapi = 两次 AES-128-CBC + RSA(no-padding)；eapi = AES-128-ECB(hex)；
//   全部网络请求经 FoliaBridge（OkHttp + CookieManager）发出。

import {
  aesCbcEncryptBase64, aesEcbDecryptHex, aesEcbEncryptUpperHex, base64EncodeUtf8,
  md5, parseCookieString, randomBase62, randomHex, rsaEncryptNoPadding,
  serializeCookieMap, toQueryString,
} from './crypto';
import { bridgeRequest, simpleResponse } from './core';
import type { SimpleResponse } from './core';
import { readProviderSessionValue, writeProviderSessionValue } from './sessionStore';
const WEAPI_PRESET_KEY = '0CoJUm6Qyw8W8jud';
const WEAPI_IV = '0102030405060708';
const EAPI_KEY = 'e82ckenh8dichen8';
// NeteaseCloudMusicApi 内置的 weapi RSA 公钥（1024 位，指数 65537）
const WEAPI_RSA_PEM = [
  'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2K',
  'exO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBG',
  'LbCiK45wIDAQAB',
].join('');

const EDGE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36 Edg/116.0.1938.76';
// 官方 iOS 客户端 UA：eapi 通道必须伪装成官方客户端，浏览器 UA 会触发风控
const EAPI_UA = 'NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)';

type CryptoKind = 'weapi' | 'eapi' | 'api';

// ---------------------------------------------------------------------------
// 加密原语

const xorEncode = (text: string, key: string): string => {
  let out = '';
  for (let i = 0; i < text.length; i += 1) out += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  return out;
};

const weapiEncrypt = (object: unknown): { params: string; encSecKey: string } => {
  const text = JSON.stringify(object);
  const secretKey = randomBase62(16);
  const first = aesCbcEncryptBase64(text, WEAPI_PRESET_KEY, WEAPI_IV);
  const params = aesCbcEncryptBase64(first, secretKey, WEAPI_IV);
  // encSecKey = RSA(no-padding) of reversed secretKey 字节
  const reversed = secretKey.split('').reverse().join('');
  const message = new Uint8Array(Array.from(reversed, ch => ch.charCodeAt(0) & 0xff));
  const encSecKey = rsaEncryptNoPadding(message, WEAPI_RSA_PEM).toUpperCase();
  return { params, encSecKey };
};

const eapiEncrypt = (url: string, data: unknown): string => {
  const text = JSON.stringify(data);
  const digest = md5(`nobody${url}use${text}md5forencrypt`);
  const message = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  return aesEcbEncryptUpperHex(message, EAPI_KEY);
};

// ---------------------------------------------------------------------------
// Cookie 组装

interface CookieParts {
  map: Map<string, string>;
}

const buildPlainCookie = (parts: CookieParts, url: string): string => {
  const map = new Map(parts.map);
  if (!map.has('__remember_me')) map.set('__remember_me', 'true');
  if (!map.has('_ntes_nuid')) map.set('_ntes_nuid', randomHex(32));
  if (!map.has('NMTID') && !url.includes('login')) map.set('NMTID', randomHex(16));
  return serializeCookieMap(map);
};

// 设备状态跨请求持久化：deviceId 每次随机换会被风控判成「设备环境异常」(8821)
const EAPI_STATE = {
  deviceId: 'netease_eapi_deviceId',
  nmtid: 'netease_eapi_nmtid',
  nuid: 'netease_eapi_nuid',
  wnmcid: 'netease_eapi_wnmcid',
};

const getOrCreateState = (key: string, factory: () => string): string => {
  const existing = readProviderSessionValue('netease', key);
  if (existing) return existing;
  const value = factory();
  try { writeProviderSessionValue('netease', key, value); } catch { /* ignore */ }
  return value;
};

const randomChars = (length: number, alphabet: string): string => {
  let out = '';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i]! % alphabet.length];
  return out;
};

/** 服务端在第一个不带 NMTID 的 eapi 响应里下发它，后续请求必须带上 */
const rememberEapiNmtid = (setCookies: string[]): void => {
  for (const entry of setCookies) {
    const match = /(?:^|;\s*)NMTID=([^;]+)/.exec(entry);
    if (match && match[1]) {
      try { writeProviderSessionValue('netease', EAPI_STATE.nmtid, match[1].trim()); } catch { /* ignore */ }
      return;
    }
  }
};

const buildEapiHeader = (parts: CookieParts, url: string, overrides: Record<string, string>): Record<string, string> => {
  void url;
  const deviceId = getOrCreateState(EAPI_STATE.deviceId, () => randomChars(16, 'abcdefghijklmnopqrstuvwxyz0123456789'));
  const nuid = getOrCreateState(EAPI_STATE.nuid, () => randomChars(32, '0123456789abcdef'));
  const wnmcid = getOrCreateState(EAPI_STATE.wnmcid, () => `${randomChars(6, 'abcdefghijklmnopqrstuvwxyz')}.${Date.now()}.01.0`);
  const nmtid = readProviderSessionValue('netease', EAPI_STATE.nmtid) || '';
  const map = parts.map;
  const header: Record<string, string> = {
    osver: '16.2',
    deviceId,
    appver: '9.0.90',
    versioncode: '140',
    mobilename: '',
    buildver: String(Date.now()).slice(0, 10),
    resolution: '1920x1080',
    __csrf: map.get('__csrf') ?? '',
    os: 'iPhone OS',
    channel: 'distribution',
    requestId: `${Date.now()}_${String(Math.floor(Math.random() * 1000)).padStart(4, '0')}`,
    _ntes_nuid: map.get('_ntes_nuid') ?? nuid,
    _ntes_nnid: map.get('_ntes_nnid') ?? `${nuid},${Date.now()}`,
    WNMCID: map.get('WNMCID') ?? wnmcid,
    WEVNSM: map.get('WEVNSM') ?? '1.0.0',
    __remember_me: 'true',
    ntes_kaola_ad: '1',
  };
  if (nmtid) header.NMTID = nmtid;
  if (map.has('MUSIC_U')) header.MUSIC_U = map.get('MUSIC_U')!;
  if (map.has('MUSIC_A')) header.MUSIC_A = map.get('MUSIC_A')!;
  return { ...header, ...overrides };
};

// ---------------------------------------------------------------------------
// 单次上游调用

interface NeteaseAnswer {
  body: any;
  setCookies: string[];
}

const neteaseCall = async (
  targetUrl: string,
  data: Record<string, unknown>,
  kind: CryptoKind,
  providedCookie: string | undefined,
  options: {
    eapiPath?: string;
    host?: string;
    osOverrides?: Record<string, string>;
    ua?: string;
    keepPath?: boolean;
  } = {},
): Promise<NeteaseAnswer> => {
  const parts: CookieParts = { map: parseCookieString(providedCookie) };
  let finalUrl = targetUrl.startsWith('http') ? targetUrl : `https://music.163.com${targetUrl}`;
  let body = '';
  const headers: Record<string, string> = {
    'User-Agent': options.ua ?? EDGE_UA,
  };
  if (finalUrl.includes('music.163.com')) headers.Referer = 'https://music.163.com';

  if (kind === 'weapi') {
    const payload: Record<string, unknown> = {
      ...data,
      csrf_token: parts.map.get('_csrf') ?? '',
    };
    const encrypted = weapiEncrypt(payload);
    body = toQueryString({ params: encrypted.params, encSecKey: encrypted.encSecKey });
    if (!options.keepPath) finalUrl = finalUrl.replace(/\w*api/, 'weapi');
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    headers.Cookie = buildPlainCookie(parts, finalUrl);
  } else if (kind === 'eapi') {
    headers['User-Agent'] = EAPI_UA;
    const uri = finalUrl.replace(/^https?:\/\/[^/]+/, '');
    const apiPath = uri.startsWith('/api/') ? uri.slice(5) : uri.replace(/^\//, '');
    const header = buildEapiHeader(parts, finalUrl, options.osOverrides ?? {});
    const payload = { ...data, header };
    const paramsHex = eapiEncrypt(uri, payload);
    finalUrl = `https://interface.music.163.com/eapi/${apiPath}`;
    body = toQueryString({ params: paramsHex });
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    headers.Cookie = Object.entries(header)
      .filter(([, v]) => v != null && String(v) !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('; ');
  } else {
    body = toQueryString(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])));
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    headers.Cookie = buildPlainCookie(parts, finalUrl);
  }

  const answer = await bridgeRequest({ url: finalUrl, method: 'POST', headers, body, timeoutMs: 30_000 });
  const setCookies = (answer as { setCookies?: string[] }).setCookies ?? [];
  const rawBody = answer.body ?? '';
  let parsed: any;
  if (kind === 'eapi') {
    // 部分接口（如登录二维码）直接回明文 JSON；其余回 eapi 密文 hex，需解密
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      try {
        parsed = JSON.parse(aesEcbDecryptHex(rawBody.trim(), EAPI_KEY));
      } catch {
        parsed = { code: 502, message: `eapi response unreadable: ${rawBody.slice(0, 80)}` };
      }
    }
  } else {
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      parsed = { code: 502, message: `netease response unreadable: ${rawBody.slice(0, 80)}` };
    }
  }
  if (parsed && typeof parsed === 'object' && typeof parsed.code === 'string' && /^\d+$/.test(parsed.code)) {
    parsed.code = Number(parsed.code);
  }
  if (kind === 'eapi') rememberEapiNmtid(setCookies);
  return { body: parsed, setCookies };
};

const joinCookies = (setCookies: string[]): string => (
  setCookies.filter(Boolean).map(entry => entry.replace(/Domain=[^;]+;?/gi, '')).join(';').replace(/;+\s*$/, '')
);

// ---------------------------------------------------------------------------
// 端点实现

type Params = Record<string, string>;

const str = (params: Params, key: string, fallback = ''): string => params[key] ?? fallback;
const num = (params: Params, key: string, fallback: number): number => {
  const value = Number(params[key]);
  return Number.isFinite(value) ? value : fallback;
};

// eapi 歌曲接口统一走 interface(.3).music.163.com
const eapiData = async (
  path: string,
  data: Record<string, unknown>,
  cookie: string | undefined,
  osOverrides: Record<string, string> = {},
  host = 'interface.music.163.com',
): Promise<NeteaseAnswer> => neteaseCall(`https://music.163.com${path}`, data, 'eapi', cookie, { eapiPath: path, host, osOverrides });

// 网易云对网页 weapi 通道有 WAF 拦截（返回 200 空体），安卓客户端统一走 eapi 通道（interface.music.163.com）
const weapi = (path: string, data: Record<string, unknown>, cookie: string | undefined, osOverrides?: Record<string, string>): Promise<NeteaseAnswer> => (
  eapiData(path, data, cookie, osOverrides)
);

const plainApi = (path: string, data: Record<string, unknown>, cookie: string | undefined): Promise<NeteaseAnswer> => (
  eapiData(path.split('?')[0]!, data, cookie)
);

const unsupportedAnswer = (endpoint: string): SimpleResponse => (
  extensionUnsupported(`NetEase endpoint ${endpoint} is not available in the Android extension layer`)
);

const withCookieIfAny = (answer: NeteaseAnswer): any => {
  const body = answer.body ?? { code: 502 };
  const bodyCookie = Array.isArray(body.cookie)
    ? body.cookie.filter(Boolean).join('; ')
    : typeof body.cookie === 'string' ? body.cookie.trim() : '';
  const cookieText = bodyCookie || joinCookies(answer.setCookies);
  if (cookieText) body.cookie = cookieText;
  return body;
};

/** playlist/track/all 的两段式组装：先取全部 trackIds，再分页取歌曲详情 */
const playlistTrackAll = async (params: Params, cookie: string | undefined): Promise<NeteaseAnswer> => {
  const id = str(params, 'id');
  const limit = num(params, 'limit', 1000);
  const offset = num(params, 'offset', 0);
  const detail = await plainApi('/api/v6/playlist/detail', { id, n: 100000, s: '8' }, cookie);
  const body = detail.body ?? {};
  const trackIds: { id: number }[] = body?.playlist?.trackIds ?? [];
  const pageIds = trackIds.slice(offset, offset + limit).map(entry => ({ id: entry.id }));
  if (pageIds.length === 0) {
    return { body: { ...body, songs: [], privileges: [] }, setCookies: detail.setCookies };
  }
  const c = JSON.stringify(pageIds);
  const songs = await weapi('/api/v3/song/detail', { c, ids: `[${pageIds.map(entry => entry.id).join(',')}]` }, cookie);
  return {
    body: { ...body, songs: songs.body?.songs ?? [], privileges: songs.body?.privileges ?? [] },
    setCookies: [...detail.setCookies, ...songs.setCookies],
  };
};

export const handleNeteaseEndpoint = async (
  endpoint: string,
  limit?: 'sign-in' | 'online',
): Promise<SimpleResponse> => {
  const [path, queryString = ''] = endpoint.split('?');
  const params = Object.fromEntries(new URLSearchParams(queryString)) as Params;
  const cookie = params.cookie;
  delete params.cookie;
  delete params.timestamp;

  try {
    switch (path) {
      case '/register/anonimous': {
        const deviceId = 'NMUSIC';
        const encoded = base64EncodeUtf8(`${deviceId} ${base64EncodeUtf8(md5(xorEncode(deviceId, '3go8&$833h0k(2)2')))}`);
        const answer = await weapi('/api/register/anonimous', { username: encoded }, cookie, { os: 'android', appver: '8.10.05' });
        return simpleResponse(200, withCookieIfAny(answer));
      }
      case '/logout': {
        const answer = await weapi('/api/logout', {}, cookie);
        return simpleResponse(200, withCookieIfAny(answer));
      }
      case '/login/status': {
        const answer = await weapi('/api/w/nuser/account/get', {}, cookie);
        // transport 读 loginResponse.data.profile：兼容桌面后端的 data 包装结构，平铺字段也保留
        const body = answer.body ?? { code: 502 };
        return simpleResponse(200, { data: body, ...body });
      }
      case '/login/qr/key': {
        const answer = await weapi('/api/login/qrcode/unikey', { type: '3' }, cookie);
        const body = answer.body ?? {};
        return simpleResponse(200, { data: { ...body, unikey: body.unikey }, code: 200, unikey: body.unikey });
      }
      case '/login/qr/create': {
        const key = str(params, 'key');
        const qrurl = `https://music.163.com/login?codekey=${key}`;
        const qrimg = await QRCode.toDataURL(qrurl, { margin: 1, width: 512 });
        return simpleResponse(200, { data: { qrimg, qrurl }, code: 200 });
      }
      case '/login/qr/check': {
        const answer = await weapi('/api/login/qrcode/client/login', { key: str(params, 'key'), type: '3' }, cookie);
        return simpleResponse(200, withCookieIfAny(answer));
      }
      case '/login/cellphone': {
        const data: Record<string, unknown> = {
          phone: str(params, 'phone'),
          countrycode: str(params, 'countrycode', '86'),
          rememberLogin: 'true',
        };
        if (params.captcha) data.captcha = params.captcha;
        else data.password = md5(str(params, 'password'));
        const answer = await weapi('/api/login/cellphone', data, cookie);
        return simpleResponse(200, withCookieIfAny(answer));
      }
      case '/captcha/sent': {
        const answer = await weapi('/api/sms/captcha/sent?ctcode=86', { ctcode: str(params, 'ctcode', '86'), cellphone: str(params, 'cellphone') }, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/captcha/verify': {
        const answer = await weapi('/api/sms/captcha/verify', { ctcode: str(params, 'ctcode', '86'), cellphone: str(params, 'cellphone'), captcha: str(params, 'captcha') }, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/user/account': {
        const answer = await weapi('/api/nuser/account/get', {}, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/user/playlist': {
        const answer = await weapi('/api/user/playlist', {
          uid: str(params, 'uid'),
          limit: num(params, 'limit', 30),
          offset: num(params, 'offset', 0),
          includeVideo: true,
        }, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/user/cloud': {
        const answer = await weapi('/api/v1/cloud/get', {
          limit: num(params, 'limit', 30),
          offset: num(params, 'offset', 0),
        }, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/user/cloud/detail': {
        const songIds = str(params, 'songIds').split(/\s*,\s*/).filter(Boolean).join(',');
        const answer = await weapi('/api/v1/cloud/get/byids', { songIds }, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/song/detail': {
        const ids = str(params, 'ids');
        const c = JSON.stringify(ids.split(',').filter(Boolean).map(id => ({ id: Number(id) })));
        const answer = await weapi('/api/v3/song/detail', { c, ids }, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/song/url/v1':
      case '/song/url': {
        // 兼容两种传参：ids=[1,2]（桌面后端约定）与 id=186016（本项目 transport 实际使用）
        const rawIds = str(params, 'ids', '') || str(params, 'id', '');
        const idList = rawIds.replace(/[\[\]\s]/g, '').split(',').filter(Boolean);
        const ids = `[${idList.join(',')}]`;
        const isV1 = path === '/song/url/v1';
        const data: Record<string, unknown> = isV1
          ? { ids, level: str(params, 'level', 'standard'), encodeType: 'flac' }
          : { ids, br: num(params, 'br', 999000) };
        data.csrf_token = parseCookieString(cookie ?? '').__csrf ?? '';
        if (isV1 && str(params, 'level') === 'sky') data.immerseType = 'c51';
        // 不覆盖 os：UA(iOS 客户端) 与 header.os 必须一致，混用会被风控剥掉播放地址
        const answer = await eapiData(isV1 ? '/api/song/enhance/player/url/v1' : '/api/song/enhance/player/url', data, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/lyric/new': {
        const answer = await eapiData('/api/song/lyric/v1', {
          id: str(params, 'id'),
          cp: 'false',
          tv: '0', lv: '0', rv: '0', kv: '0', yv: '0', ytv: '0', yrv: '0',
        }, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/lyric': {
        const answer = await plainApi('/api/song/lyric', {
          id: str(params, 'id'), tv: '-1', lv: '-1', rv: '-1', kv: '-1',
        }, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/cloudsearch': {
        // provider 调用的是 `/cloudsearch?keywords=…`（NeteaseCloudMusicApi 的参数名），
        // 而 eapi 上游要的是 `s`。只读 `s` 的话关键词永远是空的，上游回 code 400、零首歌
        // （2026-10-25 实测：s='' → 400；s=关键词 → 30 条）。两个名字都收。
        const answer = await eapiData('/api/cloudsearch/pc', {
          s: str(params, 's') || str(params, 'keywords'),
          type: num(params, 'type', 1),
          limit: num(params, 'limit', 30),
          offset: num(params, 'offset', 0),
          total: 'true',
        }, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/search': {
        const type = num(params, 'type', 1);
        if (type === 2000) {
          const answer = await plainApi('/api/search/voice/get', { s: str(params, 's'), type: '2000' }, cookie);
          return simpleResponse(200, answer.body ?? { code: 502 });
        }
        const answer = await weapi('/api/search/get', {
          s: str(params, 's'), type: String(type), limit: num(params, 'limit', 30), offset: num(params, 'offset', 0),
        }, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/album': {
        const answer = await weapi(`/api/v1/album/${encodeURIComponent(str(params, 'id'))}`, {}, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/album/detail/dynamic': {
        const answer = await weapi('/api/album/detail/dynamic', { id: str(params, 'id') }, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/album/new': {
        const answer = await weapi('/api/album/new', {
          limit: num(params, 'limit', 30), offset: num(params, 'offset', 0), total: 'true',
          area: str(params, 'area', 'ALL'),
        }, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/album/sub':
      case '/album/unsub': {
        // 上游此路径保持 /api/ 前缀（不做 weapi 替换），但 body 用 weapi 加密
        const answer = await neteaseCall(`https://music.163.com${path === '/album/sub' ? '/api/album/sub' : '/api/album/unsub'}`, { id: str(params, 'id') }, 'weapi', cookie, { keepPath: true });
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/album/sublist': {
        const answer = await weapi('/api/album/sublist', {
          limit: num(params, 'limit', 25), offset: num(params, 'offset', 0), total: 'true',
        }, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/artist/detail': {
        const answer = await weapi('/api/artist/head/info/get', { id: str(params, 'id') }, cookie, { os: 'ios', appver: '8.20.21' });
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/artist/album': {
        const answer = await weapi(`/api/artist/albums/${encodeURIComponent(str(params, 'id'))}`, {
          limit: num(params, 'limit', 30), offset: num(params, 'offset', 0), total: 'true',
        }, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/artist/songs': {
        const answer = await weapi('/api/v1/artist/songs', {
          id: str(params, 'id'), private_cloud: 'true', work_type: '1',
          order: str(params, 'order', 'hot'), offset: num(params, 'offset', 0), limit: num(params, 'limit', 100),
        }, cookie, { os: 'pc' });
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/artist/top/song': {
        const answer = await weapi('/api/artist/top/song', { id: str(params, 'id') }, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/like': {
        const answer = await weapi('/api/radio/like', {
          alg: 'itembased', trackId: str(params, 'trackId', str(params, 'id')),
          like: str(params, 'like', 'true'), time: '3',
        }, cookie, { os: 'pc', appver: '2.9.7' });
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/likelist': {
        const answer = await weapi('/api/song/like/get', { uid: str(params, 'uid') }, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/fm_trash': {
        const answer = await weapi('/api/radio/trash/add', {
          songId: str(params, 'songId', str(params, 'id')),
          time: str(params, 'time', '25'),
        }, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/personal_fm': {
        const answer = await weapi('/api/v1/radio/get', {}, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/personalized': {
        const answer = await weapi('/api/personalized/playlist', {
          limit: num(params, 'limit', 30), total: 'true', n: '1000',
        }, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/playlist/detail': {
        const answer = await plainApi('/api/v6/playlist/detail', { id: str(params, 'id'), n: '100000', s: '8' }, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/playlist/detail/dynamic': {
        const answer = await plainApi('/api/playlist/detail/dynamic', { id: str(params, 'id'), n: '100000', s: '8' }, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/playlist/track/all': {
        const answer = await playlistTrackAll(params, cookie);
        return simpleResponse(200, withCookieIfAny(answer));
      }
      case '/playlist/subscribe':
      case '/playlist/unsubscribe': {
        const action = path === '/playlist/subscribe' ? 'subscribe' : 'unsubscribe';
        const answer = await weapi(`/api/playlist/${action}`, { id: str(params, 'id') }, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/playlist/tracks': {
        const answer = await weapi('/api/playlist/manipulate/tracks', {
          op: str(params, 'op', 'add'),
          pid: str(params, 'pid'),
          trackIds: str(params, 'trackIds', '[]'),
          imme: str(params, 'imme', 'true'),
        }, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/recommend/resource': {
        const answer = await weapi('/api/v1/discovery/recommend/resource', {}, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/recommend/songs': {
        const answer = await weapi('/api/v3/discovery/recommend/songs', {}, cookie, { os: 'ios' });
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/recommend/songs/dislike': {
        const answer = await weapi('/api/v2/discovery/recommend/dislike', {
          resId: str(params, 'resId', str(params, 'id')), resType: '4', sceneType: '1',
        }, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/history/recommend/songs': {
        const answer = await weapi('/api/discovery/recommend/songs/history/recent', {}, cookie, { os: 'ios' });
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/history/recommend/songs/detail': {
        const answer = await weapi('/api/discovery/recommend/songs/history/detail', { date: str(params, 'date') }, cookie, { os: 'ios' });
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/homepage/block/page': {
        const answer = await weapi('/api/homepage/block/page', {
          refresh: str(params, 'refresh'), cursor: str(params, 'cursor'),
        }, cookie, { os: 'ios', appver: '8.20.21' });
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/simi/song': {
        const answer = await weapi('/api/v1/discovery/simiSong', {
          songid: str(params, 'songid', str(params, 'id')),
          limit: num(params, 'limit', 50), offset: num(params, 'offset', 0),
        }, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/top/playlist': {
        const answer = await weapi('/api/playlist/list', {
          cat: str(params, 'cat', '全部'), order: str(params, 'order', 'hot'),
          limit: num(params, 'limit', 50), offset: num(params, 'offset', 0), total: 'true',
        }, cookie);
        const body = answer.body ?? {};
        // 与上游 module 一致：avatarImgId_str → avatarImgIdStr 字段重命名
        for (const playlist of body?.playlists ?? []) {
          if (playlist && playlist.avatarImgId_str !== undefined) {
            playlist.avatarImgIdStr = playlist.avatarImgId_str;
            delete playlist.avatarImgId_str;
          }
        }
        return simpleResponse(200, body);
      }
      case '/top/song': {
        const answer = await weapi('/api/v1/discovery/new/songs', {
          areaId: num(params, 'type', 0), total: 'true',
        }, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/toplist': {
        const answer = await plainApi('/api/toplist', {}, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/scrobble/v1': {
        const logs = [{
          action: 'play',
          json: {
            id: str(params, 'id'),
            sourceId: str(params, 'sourceId', '0'),
            time: str(params, 'time', '0'),
            type: 'song',
            end: str(params, 'end', 'playend'),
          },
        }];
        const answer = await weapi('/api/feedback/weblog', { logs: JSON.stringify(logs) }, cookie);
        return simpleResponse(200, answer.body ?? { code: 502 });
      }
      case '/personal/fm/mode':
      case '/song/chorus':
      case '/song/copyright/rcmd':
      case '/cloud/lyric/get':
        return unsupportedAnswer(path);
      default:
        return unsupportedAnswer(path);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 网络层失败：传输层以 networkFailure 识别（isNeteaseNetworkFailure）
    return simpleResponse(502, { code: 502, message, networkFailure: true });
  }
};
