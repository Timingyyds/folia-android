// src/audioNative/kugou.ts
// 酷狗音乐"扩展协议"：在 WebView 内复刻 KuGouMusicApi（MakcRe, AGPL）的服务端逻辑。
// 签名：md5(盐 + 排序参数 + body + 盐)；Android 盐 / Web 盐 / 设备注册盐。
// 全部请求经 FoliaBridge（OkHttp + CookieManager）发出。

import md5 from 'blueimp-md5';
import QRCode from 'qrcode';
import { parseCookieString } from './crypto';
import { bridgeRequest, extensionUnsupported, simpleResponse } from './core';
import type { SimpleResponse } from './core';
import { readProviderSessionValue, writeProviderSessionValue } from './sessionStore';

const SALT_ANDROID = 'OIlwieks28dk2k092lksi2UIkp';
const SALT_WEB = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';
const SALT_KEY = '57ae12eb6890223e355ccfcb74edf70d';
const SALT_CLOUD = 'ebd1ac3134c880bda6a2194537843caa0162e2e7';
const GATEWAY = 'https://gateway.kugou.com';
const UA = 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi';
const KG_RF = 'B9EDA08A64250DEFFBCADDEE00F8F25F';

type Params = Record<string, string>;

// ---------------------------------------------------------------------------
// 设备身份（与桌面版一致的 providerStorage 语义）

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const randomString = (length: number): string => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => ALNUM[b! % ALNUM.length]).join('');
};

const uuidv4 = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b!.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const guidMd5ToMid = (guid: string): string => {
  const hex = md5(guid);
  return BigInt(`0x${hex}`).toString(10);
};

const getOrCreate = (key: string, factory: () => string): string => {
  const existing = readProviderSessionValue('kugou', key);
  if (existing) return existing;
  const value = factory();
  try {
    writeProviderSessionValue('kugou', key, value);
  } catch { /* 存储不可用时每次随机，功能不中断 */ }
  return value;
};

const getDfid = (): string => getOrCreate('kugou_dfid', () => randomString(24));
const getGuid = (): string => getOrCreate('kugou_guid', uuidv4);
const getMid = (): string => getOrCreate('kugou_mid', () => guidMd5ToMid(getGuid()));
const getDev = (): string => getOrCreate('kugou_dev', () => randomString(32).toLowerCase());

const CLIENT_VER = '20489';
const APP_ID = '1005';

interface Session {
  token: string;
  userid: string;
  dfid: string;
  mid: string;
  nickname: string;
  pic: string;
}

const readSession = (cookieParam: string | undefined): Session => {
  const map = parseCookieString(cookieParam);
  const token = map.get('token') ?? readProviderSessionValue('kugou', 'token') ?? '';
  const userid = map.get('userid') ?? readProviderSessionValue('kugou', 'userid') ?? '';
  return {
    token, userid,
    // 设备字段优先取会话 Cookie 里的（参考层登录身份），与 token 绑定一致
    dfid: map.get('dfid') || map.get('KUGOU_API_DFID') || map.get('kg_dfid') || readProviderSessionValue('kugou', 'dfid') || getDfid(),
    mid: map.get('kg_mid') || map.get('KUGOU_API_MID') || getMid(),
    nickname: map.get('NickName') ?? map.get('nickname') ?? '',
    pic: map.get('pic') ?? '',
  };
};

// ---------------------------------------------------------------------------
// 签名

const signAndroid = (params: Record<string, string>, data = ''): string => {
  const source = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('');
  return md5(`${SALT_ANDROID}${source}${data}${SALT_ANDROID}`);
};

const signWeb = (params: Record<string, string>, data = ''): string => {
  const pieces = Object.keys(params).map(key => `${key}=${params[key]}`).sort();
  return md5(`${SALT_WEB}${pieces.join('')}${data}${SALT_WEB}`);
};

const signParamsKey = (data: string): string => md5(`${APP_ID}${SALT_ANDROID}${CLIENT_VER}${data}`);
const signSongKey = (hash: string, mid: string, userid: string): string => md5(`${hash}${SALT_KEY}${APP_ID}${mid}${userid}`);
const signCloudKey = (hash: string): string => md5(`musicclound${hash}20026${SALT_CLOUD}`);

// ---------------------------------------------------------------------------
// 请求

interface KugouAnswer {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  setCookies: string[];
}

import CryptoJS from 'crypto-js';

// ---- 酷狗 lite 换证（web token -> android appToken，照参考 refreshKGLoginByToken）----
const KG_LOGIN_AES_KEY = 'c24f74ca2820225badc01946dba4fdf7';
const KG_LOGIN_AES_IV = 'adc01946dba4fdf7';
const KG_LITE_T2_KEY = 'fd14b35e3f81af3817a20ae7adae7020';
const KG_LITE_T2_IV = '17a20ae7adae7020';
const KG_LITE_T1_KEY = '5e4ef500e9597fe004bd09a46d8add98';
const KG_LITE_T1_IV = '04bd09a46d8add98';
const KG_RSA_MODULUS = BigInt('0xc40a2d0da76511f3bb1cc2bbd3afbd8bea83b4d6b05b6c13eb8920c53f1af7679b32ba0d0edb843240ef1b836efed3ee240734c14c1399fd6594d16af22f52525d14d72e0155c6dcc8638d4f7bb94f3a0b1f4c29f991972f2a160a25eb0a9e724336be7f69bbd319ffab1c6dd8470b021dc434f3faba89f4a2a01b33bdbdd08b');
const KG_RSA_EXP = BigInt(65537);
const KG_RSA_KEY_BYTES = 128;
const KG_LITE_T3 = 'MCwwLDAsMCwwLDAsMCwwLDA=';
const KG_LITE_T2_GUID_SALT = '0f607264fc6318a92b9e13c65db7cd3c';

const kgAesEncryptHex = (data: unknown, key: string, iv: string): string => {
  const text = typeof data === 'object' ? JSON.stringify(data) : String(data ?? '');
  const encrypted = CryptoJS.AES.encrypt(
    CryptoJS.enc.Utf8.parse(text),
    CryptoJS.enc.Utf8.parse(key),
    { iv: CryptoJS.enc.Utf8.parse(iv), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 },
  );
  return CryptoJS.enc.Hex.stringify(encrypted.ciphertext);
};

const kgAesEncryptParams = (data: unknown): { str: string; key: string } => {
  const tempKey = randomString(16);
  const key = md5(tempKey).substring(0, 32);
  const iv = key.substring(16);
  return { str: kgAesEncryptHex(data == null ? {} : data, key, iv), key: tempKey };
};

const kgAesDecryptParams = (hex: string, tempKey: string): any => {
  const key = md5(String(tempKey || '')).substring(0, 32);
  const iv = key.substring(16);
  const cipherParams = CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Hex.parse(String(hex || '')) });
  const decrypted = CryptoJS.AES.decrypt(cipherParams, CryptoJS.enc.Utf8.parse(key), {
    iv: CryptoJS.enc.Utf8.parse(iv), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7,
  });
  const text = decrypted.toString(CryptoJS.enc.Utf8);
  try { return JSON.parse(text); } catch { return text; }
};

const kgRsaEncryptRaw = (data: unknown): string => {
  const text = typeof data === 'object' ? JSON.stringify(data) : String(data ?? '');
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > KG_RSA_KEY_BYTES) throw new Error('KG_RSA_OVERFLOW');
  const padded = new Uint8Array(KG_RSA_KEY_BYTES);
  padded.set(bytes);
  let x = BigInt(0);
  for (let i = 0; i < padded.length; i++) x = (x << BigInt(8)) + BigInt(padded[i]);
  let y = x;
  for (let i = 0; i < 17; i++) { /* 65537 = 2^16+1，17 次平方乘 */ }
  // 快速幂
  let base = x, exp = KG_RSA_EXP, acc = BigInt(1);
  const mod = KG_RSA_MODULUS;
  while (exp > BigInt(0)) {
    if (exp & BigInt(1)) acc = (acc * base) % mod;
    base = (base * base) % mod;
    exp >>= BigInt(1);
  }
  y = acc;
  return y.toString(16).padStart(KG_RSA_KEY_BYTES * 2, '0');
};

let kgAppTokenCache = '';

const refreshKGLiteAppToken = async (session: Session): Promise<string> => {
  try {
    const dateNow = Date.now();
    const clienttime = Math.floor(dateNow / 1000);
    const encryptParams = kgAesEncryptParams({});
    const t2 = kgAesEncryptHex(`${getGuid()}|${KG_LITE_T2_GUID_SALT}||${getDev()}|${dateNow}`, KG_LITE_T2_KEY, KG_LITE_T2_IV);
    const t1 = kgAesEncryptHex(`|${dateNow}`, KG_LITE_T1_KEY, KG_LITE_T1_IV);
    const bodyData = {
      dfid: session.dfid || '-', p3: kgAesEncryptHex({ clienttime, token: session.token }, KG_LOGIN_AES_KEY, KG_LOGIN_AES_IV),
      plat: 1, t1, t2, t3: KG_LITE_T3,
      pk: kgRsaEncryptRaw({ clienttime_ms: dateNow, key: encryptParams.key }),
      params: encryptParams.str, userid: session.userid, clienttime_ms: dateNow, dev: getDev(),
    };
    const answer = await signedCall('https://gateway.kugou.com/v5/login_by_token', {
      clientver: '11440',
    }, session, { method: 'POST', bodyObj: bodyData, xRouter: 'login.user.kugou.com',
      extraHeaders: {
        referer: 'https://www.kugou.com/',
        'user-agent': 'Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36 KGMusic/9.3.0',
        'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
      } });
    const rawBody = JSON.stringify(answer.body ?? {}).slice(0, 160);
    console.log('[KG-auth] login_by_token resp:', rawBody);
    let data: any = (answer.body as any)?.data ?? {};
    if (data.secu_params) {
      const decrypted = kgAesDecryptParams(String(data.secu_params), encryptParams.key);
      if (decrypted && typeof decrypted === 'object') data = { ...data, ...decrypted };
      else if (typeof decrypted === 'string' && decrypted) data = { ...data, token: decrypted };
    }
    const nextToken = String(data.token || data.t || '').trim();
    const vipToken = String(data.vip_token || data.vipToken || '').trim();
    if (!nextToken && !vipToken) return '';
    if (nextToken) { kgAppTokenCache = nextToken; writeProviderSessionValue('kugou', 'app_token', nextToken); }
    if (vipToken) writeProviderSessionValue('kugou', 'vip_token', vipToken);
    return nextToken;
  } catch { return ''; }
};

const getKugouAppToken = async (session: Session): Promise<string> => {
  const cached = readProviderSessionValue('kugou', 'app_token') || kgAppTokenCache;
  return cached || refreshKGLiteAppToken(session);
};

const kugouCall = async (
  url: string,
  query: Record<string, string>,
  options: {
    method?: string;
    bodyObj?: unknown;
    xRouter?: string;
    extraHeaders?: Record<string, string>;
    extraQuery?: Record<string, string>;
  } = {},
): Promise<KugouAnswer> => {
  const search = new URLSearchParams({ ...query, ...(options.extraQuery ?? {}) });
  const target = url.includes('?') ? `${url}&${search}` : `${url}?${search}`;
  const bodyText = options.bodyObj === undefined ? undefined : JSON.stringify(options.bodyObj);
  const headers: Record<string, string> = {
    'User-Agent': UA,
    'kg-rc': '1',
    'kg-thash': '5d816a0',
    'kg-rec': '1',
    'kg-rf': KG_RF,
    ...options.extraHeaders,
  };
  if (options.xRouter) headers['x-router'] = options.xRouter;
  let fetchUrl = target;
  if (bodyText !== undefined) {
    headers['Content-Type'] = 'application/json;charset=UTF-8';
    fetchUrl = target;
  } else {
    delete headers['Content-Type'];
  }
  const answer = await bridgeRequest({
    url: fetchUrl,
    method: bodyText === undefined ? 'GET' : 'POST',
    headers,
    body: bodyText,
    timeoutMs: 30_000,
  });
  let parsed: any;
  try {
    parsed = JSON.parse(answer.body ?? '');
  } catch {
    parsed = { status: 0, error_code: 502, error: `kugou response unreadable: ${(answer.body ?? '').slice(0, 80)}` };
  }
  return { status: answer.status, body: parsed, setCookies: (answer as { setCookies?: string[] }).setCookies ?? [] };
};

/** 带默认参数 + Android 签名的网关调用 */
const signedCall = async (
  url: string,
  params: Params,
  session: Session,
  options: {
    method?: string;
    bodyObj?: unknown;
    xRouter?: string;
    webSalt?: boolean;
    noDefaults?: boolean;
    extraHeaders?: Record<string, string>;
    extraParams?: Record<string, string>;
    signKey?: string;
  } = {},
): Promise<KugouAnswer> => {
  const all: Record<string, string> = options.noDefaults ? {} : {
    dfid: session.dfid,
    mid: session.mid,
    uuid: '-',
    appid: APP_ID,
    clientver: CLIENT_VER,
    clienttime: String(Math.floor(Date.now() / 1000)),
  };
  if (session.token) all.token = session.token;
  if (session.userid) all.userid = session.userid;
  Object.assign(all, params);
  if (options.signKey !== undefined) all.key = options.signKey;
  const bodyText = options.bodyObj === undefined ? '' : JSON.stringify(options.bodyObj);
  all.signature = options.webSalt ? signWeb(all, bodyText) : signAndroid(all, bodyText);
  return kugouCall(url, all, { method: options.method, bodyObj: options.bodyObj, xRouter: options.xRouter, extraHeaders: options.extraHeaders });
};

const ok = (body: unknown): SimpleResponse => simpleResponse(200, body);


// ---------------------------------------------------------------------------
// 端点处理

// 路径别名：transport 用斜杠形式（/user/detail），case 用下划线形式（/user_detail）——统一归一
const UNDERSCORE_CASES = new Set([
  '/album_detail', '/album_songs', '/artist_albums', '/artist_audios', '/artist_detail',
  '/everyday_history', '/everyday_recommend', '/krm_audio', '/personal_fm',
  '/playlist_add', '/playlist_del', '/playlist_detail', '/playlist_track_all',
  '/playlist_tracks_add', '/playlist_tracks_del', '/search_lyric', '/top_card_youth',
  '/user_cloud', '/user_detail', '/user_playlist', '/user_vip_detail',
  '/youth_day_vip', '/youth_day_vip_upgrade', '/youth_union_vip',
]);
const slashAlias = (raw: string): string => {
  if (UNDERSCORE_CASES.has(raw)) return raw;
  const alt = '/' + raw.replace(/^\//, '').replace(/\//g, '_');
  return UNDERSCORE_CASES.has(alt) ? alt : raw;
};

export const handleKugouEndpoint = async (endpoint: string): Promise<SimpleResponse> => {
  const [rawPath, queryString = ''] = endpoint.split('?');
  const path = slashAlias(rawPath);
  const params = Object.fromEntries(new URLSearchParams(queryString)) as Params;
  const session = readSession(params.cookie);
  delete params.cookie;
  delete params.timestamp;

  try {
    switch (path) {
      case '/register/dev': {
        // 真注册设备：向 userservice 换取合法 dfid（随机 dfid 会被 play/getdata 拒绝）
        const deviceid = getGuid();
        let registered = '';
        try {
          const answer = await signedCall('https://userservice.kugou.com/risk/v1/r/register_dev', {
            deviceid, uuid: deviceid, plat: '0', system: 'Android 12', businessid: '1',
          }, session, { webSalt: true });
          const data: any = (answer.body as any)?.data ?? {};
          registered = String(data.dfid ?? '');
          if (registered) writeProviderSessionValue('kugou', 'dfid', registered);
        } catch { /* 注册失败保留旧值 */ }
        return ok({ status: 1, error_code: 0, data: { dfid: registered || getDfid() } });
      }
      case '/login/qr/key': {
        const answer = await signedCall('https://login-user.kugou.com/v2/qrcode', {
          appid: '1001', type: '1', plat: '4', srcappid: '2919',
          qrcode_txt: `https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=1005&`,
        }, session, { webSalt: true });
        return ok(answer.body);
      }
      case '/login/qr/create': {
        const key = params.key ?? params.qrcode ?? '';
        const qrurl = `https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=${encodeURIComponent(key)}`;
        let qrimg = '';
        try {
          qrimg = await QRCode.toDataURL(qrurl, { margin: 1, width: 512 });
        } catch {
          qrimg = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=0&data=${encodeURIComponent(qrurl)}`;
        }
        return ok({ status: 1, error_code: 0, data: { qrimg, base64: qrimg, qrcode: qrurl } });
      }
      case '/login/qr/check': {
        const answer = await signedCall('https://login-user.kugou.com/v2/get_userinfo_qrcode', {
          plat: '4', appid: '1005', srcappid: '2919', qrcode: params.key ?? params.qrcode ?? '', dev: getDev(),
        }, session, { webSalt: true });
        const body = answer.body ?? {};
        const checkData: any = (body as any).data ?? body;
        const checkStatus = Number(checkData?.status ?? body?.status ?? 0);
        // 字段别名与参考实现对齐：token 可能叫 t，userid 可能叫 user_id/KugooID
        const token = String(checkData?.token ?? checkData?.t ?? '').trim();
        const userid = String(checkData?.userid ?? checkData?.user_id ?? checkData?.KugooID ?? '').trim();
        // 登录成功(status=4)：把会话 Cookie 落到 providerStorage，后续请求自动带上。
        // 关键：登录响应的 Set-Cookie 里带 kg_mid/kg_dfid——播放接口按这套设备字段校验 token，必须一并落库
        if (token && userid && (checkStatus === 4 || checkData?.token || checkData?.t)) {
          const parts: Record<string, string> = { userid, KugooID: userid, token, t: token };
          const nick = checkData.nickname || checkData.nick_name || checkData.username;
          if (nick) parts.NickName = String(nick).replace(/<[^>]*>/g, '');
          const pic = checkData.pic || checkData.user_pic || checkData.avatar || checkData.headimg;
          if (pic) parts.pic = String(pic);
          const vipToken = checkData.vip_token || checkData.vipToken;
          if (vipToken) parts.vip_token = String(vipToken);
          const setCookies: string[] = (answer as { setCookies?: string[] }).setCookies ?? [];
          for (const entry of setCookies) {
            const pair = entry.split(';')[0] ?? '';
            const eq = pair.indexOf('=');
            if (eq <= 0) continue;
            const name = pair.slice(0, eq).trim();
            const value = pair.slice(eq + 1).trim();
            if (!value) continue;
            if (/^(kg_mid|kg_dfid|dfid|KuGoo|t|KToken)$/i.test(name)) {
              parts[name] = value;
              if (name.toLowerCase() === 'kg_mid') writeProviderSessionValue('kugou', 'mid', value);
              if (name.toLowerCase() === 'kg_dfid' || name.toLowerCase() === 'dfid') writeProviderSessionValue('kugou', 'dfid', value);
            }
          }
          writeProviderSessionValue('kugou', 'cookie', Object.entries(parts).map(([k, v]) => `${k}=${v}`).join('; '));
          writeProviderSessionValue('kugou', 'token', token);
          writeProviderSessionValue('kugou', 'userid', userid);
        }
        return ok(body);
      }
      case '/logout':
        return ok({ status: 1, error_code: 0, data: {} });
      case '/search': {
        const type = params.type ?? 'song';
        const keyword = params.keyword ?? params.keywords ?? '';
        const base = {
          keyword,
          page: params.page ?? '1',
          pagesize: params.pagesize ?? '30',
          platform: 'AndroidFilter',
          iscorrection: '1',
          privilegefilter: '0',
          area_code: '1',
          dopicfull: '1',
        };
        const answer = type === 'song'
          ? await signedCall(`${GATEWAY}/v2/search/song`, base, session, { xRouter: 'complexsearch.kugou.com' })
          : await signedCall(`${GATEWAY}/v1/search/${encodeURIComponent(type)}`, base, session, { xRouter: 'complexsearch.kugou.com' });
        return ok(answer.body);
      }
      case '/song/url': {
        // 照参考 fetchKGPlayGetData：wwwapi 的 play/getdata 是实际可播通道
        const hash = (params.hash ?? '').toLowerCase();
        if (!hash) return ok({ status: 1, error_code: 0, data: [] });
        const sessionCookie = readProviderSessionValue('kugou', 'cookie')
          || `userid=${session.userid}; KugooID=${session.userid}; token=${session.token}; t=${session.token}`;
        const query: Record<string, string> = {
          r: 'play/getdata', hash, album_id: params.album_id ?? '0', platid: '4', from: 'mkugou',
          mid: session.mid, dfid: session.dfid,
        };
        if (params.album_audio_id && params.album_audio_id !== '0') query.album_audio_id = params.album_audio_id;
        if (session.token) {
          // 播放接口只认 Android appToken（web token 需经 login_by_token 换证）
          const appToken = await getKugouAppToken(session);
          query.appid = APP_ID; query.clientver = CLIENT_VER;
          query.userid = session.userid; query.token = appToken || session.token;
        }
        const answer = await kugouCall('https://wwwapi.kugou.com/yy/index.php', query, {
          extraHeaders: { referer: 'https://www.kugou.com/', cookie: sessionCookie },
        });
        const body = answer.body ?? {};
        const data = body.data ?? {};
        // 页面在 https://localhost 下：酷狗回的播放地址常是 http，CDN 支持 https，统一升级。
        const playUrl = String(data.play_url || data.play_backup_url || data.playUrl || data.url || '').replace(/^http:/i, 'https:');
        return ok({
          status: 1, error_code: 0,
          data: [{
            hash: params.hash ?? hash,
            url: playUrl,
            play_url: playUrl,
            backupUrl: data.play_backup_url || '',
            timeLength: data.timelength ? Math.round(Number(data.timelength) / 1000) : 0,
            privilege: data.privilege ?? 0,
            trans_param: data.trans_param,
            ext: data.ext_name ?? 'mp3',
          }],
        });
      }
      case '/user/cloud/url': {
        const hash = params.hash ?? '';
        const answer = await signedCall(`${GATEWAY}/bsstrackercdngz/v2/query_musicclound_url`, {
          hash,
          album_audio_id: params.album_audio_id ?? '0',
          audio_id: params.audio_id ?? '0',
          pid: '20026',
          bucket: 'musicclound',
          key: signCloudKey(hash),
          ssa_flag: 'is_fromtrack',
          version: '20102',
          ssl: '0',
          kv_id: '2',
        }, session);
        return ok(answer.body);
      }
      case '/audio': {
        const clienttimeMs = String(Date.now());
        const answer = await signedCall('https://kmr.service.kugou.com/v1/audio/audio', {
          appid: APP_ID,
          clientver: CLIENT_VER,
          clienttime: clienttimeMs,
          dfid: session.dfid,
          mid: session.mid,
          key: signParamsKey(clienttimeMs),
        }, session, {
          method: 'POST',
          bodyObj: { data: [{ hash: params.hash ?? '', audio_id: 0 }] },
          xRouter: 'kmr.service.kugou.com',
        });
        return ok(answer.body);
      }
      case '/krm_audio': {
        const answer = await signedCall(`${GATEWAY}/kmr/v2/audio`, {}, session, {
          method: 'POST',
          bodyObj: { data: [{ entity_id: params.album_audio_id ?? params.id ?? '' }], fields: params.fields ?? 'base' },
          xRouter: 'openapi.kugou.com',
          extraHeaders: { 'KG-TID': '238' },
        });
        return ok(answer.body);
      }
      case '/song/climax': {
        const answer = await signedCall('https://expendablekmrcdn.kugou.com/v1/audio_climax/audio', {
          data: JSON.stringify([{ hash: params.hash ?? '' }]),
        }, session);
        return ok(answer.body);
      }
      case '/search_lyric': {
        const answer = await kugouCall('https://lyrics.kugou.com/v1/search', {
          album_audio_id: params.album_audio_id ?? '', appid: APP_ID, clientver: CLIENT_VER,
          duration: params.duration ?? '', hash: params.hash ?? '', keyword: params.keyword ?? '',
          lrctxt: '1', man: 'no',
        });
        return ok(answer.body);
      }
      case '/lyric': {
        const answer = await signedCall('https://lyrics.kugou.com/download', {
          ver: '1', client: 'android', id: params.id ?? '', accesskey: params.accesskey ?? '',
          fmt: params.fmt ?? 'krc', charset: 'utf8',
        }, session);
        return ok(answer.body);
      }
      case '/playlist_track_all': {
        const page = Number(params.page ?? '1');
        const pagesize = Number(params.pagesize ?? '30');
        const answer = await signedCall(`${GATEWAY}/pubsongs/v2/get_other_list_file_nofilt`, {
          global_collection_id: params.id ?? params.global_collection_id ?? '',
          begin_idx: String(Math.max(0, (page - 1) * pagesize)),
          pagesize: String(pagesize),
          plat: '1', type: '1', mode: '1', personal_switch: '1',
          extend_fields: 'abtags,hot_cmt,popularization', area_code: '1',
        }, session);
        return ok(answer.body);
      }
      case '/playlist_detail': {
        const ids = (params.ids ?? params.id ?? '').split(',').filter(Boolean);
        const answer = await signedCall(`${GATEWAY}/v3/get_info_list`, {}, session, {
          method: 'POST',
          bodyObj: { data: ids.map(id => ({ global_collection_id: id })), ...(session.userid ? { userid: session.userid, token: session.token } : {}) },
          xRouter: 'pubsongs.kugou.com',
        });
        return ok(answer.body);
      }
      case '/album_detail': {
        const answer = await signedCall(`${GATEWAY}/kmr/v2/albums`, {}, session, {
          method: 'POST',
          bodyObj: { data: [{ album_id: params.id ?? params.album_id ?? '' }], is_buy: 0, fields: 'album_id,album_name,album_sizable_cover,publish_time,singer_name,singer_id,singerarr,album_audio_id,count,audio_info' },
          xRouter: 'openapi.kugou.com',
          extraHeaders: { 'KG-TID': '255' },
        });
        return ok(answer.body);
      }
      case '/album_songs': {
        const answer = await signedCall(`${GATEWAY}/v1/album_audio/lite`, {}, session, {
          method: 'POST',
          bodyObj: { album_id: params.id ?? params.album_id ?? '', is_buy: 0, page: Number(params.page ?? '1'), pagesize: Number(params.pagesize ?? '30') },
          xRouter: 'openapi.kugou.com',
          extraHeaders: { 'KG-TID': '255' },
        });
        return ok(answer.body);
      }
      case '/artist_detail': {
        const answer = await signedCall(`${GATEWAY}/kmr/v3/author`, {}, session, {
          method: 'POST',
          bodyObj: { author_id: params.id ?? params.author_id ?? '' },
          xRouter: 'openapi.kugou.com',
          extraHeaders: { 'KG-TID': '36' },
        });
        return ok(answer.body);
      }
      case '/artist_albums': {
        const answer = await signedCall(`${GATEWAY}/kmr/v1/author/albums`, {}, session, {
          method: 'POST',
          bodyObj: { author_id: params.id ?? params.author_id ?? '', page: Number(params.page ?? '1'), pagesize: Number(params.pagesize ?? '30'), sort: 3, category: 1, area_code: 'all' },
          xRouter: 'openapi.kugou.com',
          extraHeaders: { 'KG-TID': '36' },
        });
        return ok(answer.body);
      }
      case '/artist_audios': {
        const clienttimeSec = String(Math.floor(Date.now() / 1000));
        const answer = await signedCall('https://openapi.kugou.com/kmr/v1/audio_group/author', {
          appid: APP_ID, clientver: CLIENT_VER, mid: session.mid, clienttime: clienttimeSec,
          key: signParamsKey(clienttimeSec),
        }, session, {
          method: 'POST',
          bodyObj: { author_id: params.id ?? params.author_id ?? '', page: Number(params.page ?? '1'), pagesize: Number(params.pagesize ?? '30'), sort: 1, area_code: 'all' },
          extraHeaders: { 'KG-TID': '220' },
        });
        return ok(answer.body);
      }
      case '/user_detail': {
        // Cookie 优先：资料直接来自扫码确认时保存的会话（与参考实现 getKGLoginStatus 同策略）。
        // userinfo.user.kugou.com 对扩展会话返回 20010，网络富化留待后续。
        if (!session.userid || !session.token) {
          return ok({ status: 0, error_code: 20010, data: null });
        }
        return ok({
          status: 1,
          error_code: 0,
          data: {
            user_info: {
              userid: session.userid,
              KugooID: session.userid,
              nickname: session.nickname || String(session.userid),
              pic: session.pic || '',
            },
          },
        });
      }
      case '/user_vip_detail':
      case '/youth_union_vip':
      case '/youth_day_vip':
      case '/youth_day_vip_upgrade': {
        const answer = await signedCall('https://kugouvip.kugou.com/v1/get_union_vip', { busi_type: 'concept' }, session);
        return ok(answer.body);
      }
      case '/user_playlist': {
        const answer = await signedCall(`${GATEWAY}/v7/get_all_list`, { plat: '1', userid: session.userid, token: session.token }, session, {
          method: 'POST',
          bodyObj: {
            userid: Number(session.userid || '0'),
            token: session.token,
            total_ver: 979,
            type: 2,
            page: Number(params.page ?? '1'),
            pagesize: Number(params.pagesize ?? '100'),
          },
          xRouter: 'cloudlist.service.kugou.com',
        });
        return ok(answer.body);
      }
      case '/everyday_recommend': {
        // 每日推荐的标准协议把服务前缀写在路径里（`everydayrec.service/v3/...`），且不带正文：
        // 旧写法（`/everyday_song_recommend` + x-router、空 JSON 正文）上游只回 20010/200103、没有歌，
        // 页面因此是空的（封面也随第一首歌一起没有）。
        const answer = await signedCall(`${GATEWAY}/everydayrec.service/v3/everyday_song_recommend`, {
          platform: params.platform || 'ios',
        }, session);
        return ok(answer.body);
      }
      case '/everyday_history': {
        const answer = await signedCall(`${GATEWAY}/everydayrec.service/everyday/api/v1/get_history`, {
          mode: params.mode ?? 'list', platform: params.platform || 'ios',
          ...(params.history_name ? { history_name: params.history_name } : {}),
          ...(params.date ? { date: params.date } : {}),
        }, session);
        return ok(answer.body);
      }
      case '/personal_fm': {
        const clienttimeMs = String(Date.now());
        const answer = await signedCall(`${GATEWAY}/v2/personal_recommend`, {}, session, {
          method: 'POST',
          bodyObj: {
            appid: Number(APP_ID), clienttime: clienttimeMs, mid: session.mid, action: 'play',
            song_pool_id: '', m_type: 1, platform: 'ios', area_code: 1, remain_songcnt: 0,
            clientver: Number(CLIENT_VER), is_overplay: 0, mode: '', userid: Number(session.userid || '0'),
            kguid: session.mid, ...(session.token ? { token: session.token } : {}),
          },
          xRouter: 'persnfm.service.kugou.com',
        });
        return ok(answer.body);
      }
      case '/top_card_youth': {
        const answer = await signedCall(`${GATEWAY}/youth/v1/song/single_card_recommend`, {
          card_id: params.card_id ?? '3005', area_code: '1', platform: 'ios', module_id: '1',
          ver: 'v2', pagesize: params.pagesize ?? '30', clientver: '11490',
        }, session, { method: 'POST', bodyObj: { tagid: '', u_info: '', source_mixsong: '' } });
        return ok(answer.body);
      }
      case '/playlist_add': {
        const answer = await signedCall(`${GATEWAY}/cloudlist.service/v5/add_list`, {}, session, {
          method: 'POST',
          bodyObj: {
            userid: Number(session.userid || '0'), token: session.token, total_ver: 0,
            name: params.name ?? '', type: 0, source: 0, is_pri: 0,
            list_create_userid: 0, list_create_listid: 0, list_create_gid: 0, from_shupinmv: 0,
          },
          extraQuery: { last_time: '0', last_area: 'gztx' },
        });
        return ok(answer.body);
      }
      case '/playlist_tracks_add': {
        const entries = (params.data ?? '').split(',').filter(Boolean).map(entry => {
          const [name = '', hash = '', album_id = '', mixsongid = ''] = entry.split('|');
          // 酷狗接口按小写 hash 认歌：provider 内部为了去重一直用大写，送到这里必须转回来，
          // 否则 add_song 会收下一次写入却什么也不加（界面上就是「点了没反应」）。
          return { name, hash: String(hash).toLowerCase(), album_id: Number(album_id || '0'), mixsongid: Number(mixsongid || '0') };
        });
        // album_id / mixsongid 缺一个，上游就认不出这首歌（回 status:0 但什么也没加）：
        // 按 hash 问一次 kmr 的音频信息补齐，和参考层 resolveKGSongMetaForFavorite 同一个来路。
        for (const entry of entries) {
          if (entry.album_id > 0 && entry.mixsongid > 0) continue;
          try {
            const clienttimeMs = String(Date.now());
            const info = await signedCall('https://kmr.service.kugou.com/v1/audio/audio', {
              appid: APP_ID,
              clientver: CLIENT_VER,
              clienttime: clienttimeMs,
              dfid: session.dfid,
              mid: session.mid,
              key: signParamsKey(clienttimeMs),
            }, session, {
              method: 'POST',
              bodyObj: { data: [{ hash: entry.hash, audio_id: 0 }] },
              xRouter: 'kmr.service.kugou.com',
            });
            const detail = (info.body as any)?.data?.[0] ?? {};
            if (!entry.album_id) entry.album_id = Number(detail.album_id || detail.albumid || 0);
            if (!entry.mixsongid) entry.mixsongid = Number(detail.mixsongid || detail.audio_id || detail.album_audio_id || 0);
          } catch (error) {
            console.warn('[Kugou-ext] could not resolve the song ids for add_song', String(error));
          }
        }
        const bodyData = entries.map(entry => ({
          number: 1,
          name: entry.name,
          hash: entry.hash,
          size: 0,
          sort: 0,
          timelen: 0,
          bitrate: 0,
          album_id: entry.album_id,
          mixsongid: entry.mixsongid,
        }));
        // 参数与参考层 handleKGPlaylistAddSong / handleKGSongLike 对齐：
        // ① last_time / last_area 必须进到签名参数里（extraQuery 不参与签名，且会被 signedCall 丢掉）
        // ② 写入类接口要带 Authorization: KugooToken <token>
        // ③ 这条路已经带 /cloudlist.service 前缀，网关按前缀路由；再叠 x-router 会把整条带前缀的
        //    路径转给后端（后端没有该路径）→ 404，所以这里不能加 x-router。
        const answer = await signedCall(`${GATEWAY}/cloudlist.service/v6/add_song`, {
          last_time: String(Math.floor(Date.now() / 1000)),
          last_area: 'gztx',
        }, session, {
          method: 'POST',
          bodyObj: {
            userid: Number(session.userid || '0'), token: session.token, listid: Number(params.listid ?? '0'),
            list_ver: 0, type: 0, slow_upload: 1, scene: 'false;null', data: bodyData,
          },
          extraHeaders: session.token ? { Authorization: `KugooToken ${session.token}` } : {},
        });
        // 上游回 status:0 表示这次没写进去（歌单号、hash 或权限不对），日志里留下面向诊断的一行。
        console.info('[Kugou-ext] add_song answered', JSON.stringify({
            status: (answer.body as any)?.status,
            error_code: (answer.body as any)?.error_code,
            listid: params.listid,
            data: bodyData,
        }).slice(0, 500));
        if (Number((answer.body as any)?.status ?? 1) !== 1) {
          console.warn('[Kugou-ext] add_song refused', JSON.stringify({
            status: (answer.body as any)?.status,
            error_code: (answer.body as any)?.error_code,
            error: (answer.body as any)?.error,
            body: answer.body,
          }).slice(0, 600));
        }
        return ok(answer.body);
      }
      case '/playlist_tracks_del': {
        // provider 送的是 `fileids`（歌单内的行号），早先这里只读 `data`，删歌一直什么也没删。
        const rawIds = params.fileids ?? params.data ?? '';
        const fileids = String(rawIds).split(',').filter(Boolean).map(id => ({ fileid: Number(id) }));
        const answer = await signedCall(`${GATEWAY}/cloudlist.service/v4/delete_songs`, {
          last_time: String(Math.floor(Date.now() / 1000)),
          last_area: 'gztx',
        }, session, {
          method: 'POST',
          bodyObj: {
            listid: Number(params.listid ?? '0'), userid: Number(session.userid || '0'),
            data: fileids, type: 0, token: session.token, list_ver: 0,
          },
          extraHeaders: session.token ? { Authorization: `KugooToken ${session.token}` } : {},
        });
        return ok(answer.body);
      }
      case '/playlist_del':
      case '/user_cloud':
        return extensionUnsupported(`KuGou endpoint ${path} is not available in the Android extension layer`);
      default:
        return extensionUnsupported(`KuGou endpoint ${path} is not available in the Android extension layer`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return simpleResponse(502, { status: 0, error_code: 502, error: message });
  }
};
