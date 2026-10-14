import CryptoJS from '../vendor/crypto-es.mjs';
import { parseCookieString, getNeteaseMusicU } from './cookies.js';
import { readRawSetCookies } from './setCookieHeaders.js';

const EAPI_KEY = 'e82ckenh8dichen8';
const EAPI_BASE = 'https://interface.music.163.com';
export const EAPI_UA = 'NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)';

const EAPI_COOKIE_KEYS = [
  'MUSIC_U',
  'MUSIC_A',
  '__csrf',
  'NMTID',
  'WNMCID',
  'WEVNSM',
  '_ntes_nuid',
  '_ntes_nnid',
  'MUSIC_R_U',
  'deviceId',
  'sDeviceId',
  'WM_TID',
  'WM_NI',
  'WM_NIKE',
];

function eapiEncrypt(url, object) {
  const text = typeof object === 'object' ? JSON.stringify(object) : String(object || '');
  const message = `nobody${url}use${text}md5forencrypt`;
  const digest = CryptoJS.MD5(message).toString();
  const payload = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  const encrypted = CryptoJS.AES.encrypt(
    CryptoJS.enc.Utf8.parse(payload),
    CryptoJS.enc.Utf8.parse(EAPI_KEY),
    { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 },
  );
  return { params: encrypted.ciphertext.toString().toUpperCase() };
}

function safeDecodeCookieValue(value) {
  const raw = String(value || '');
  try {
    return decodeURIComponent(raw);
  } catch (_) {
    return raw;
  }
}

function encodeCookiePair(key, value) {
  return `${encodeURIComponent(key)}=${encodeURIComponent(safeDecodeCookieValue(value))}`;
}

/**
 * eapi 需要一组「跨请求稳定」的客户端标识：deviceId、NMTID、_ntes_nuid、WNMCID。
 *
 * deviceId 每次随机换会被风控判成「设备环境异常」（8821）；NMTID 更是官方客户端 cookie 的
 * 一部分（上游注释：服务端会给不带 NMTID 的 eapi 请求下发一个，之后要求带上）。这些值都存本机，
 * 只在缺失时生成一次。
 */
const EAPI_STATE_KEYS = {
  deviceId: 'neteaseDeviceId',
  nmtid: 'neteaseNmtid',
  nuid: 'neteaseNuid',
  wnmcid: 'neteaseWnmcid',
};

const randomChars = (length, alphabet) => {
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return out;
};

async function readEapiState() {
  const keys = Object.values(EAPI_STATE_KEYS);
  let stored = {};
  try {
    stored = (await chrome.storage.local.get(keys)) || {};
  } catch (_) {
    stored = {};
  }
  const next = {};
  const deviceId = String(stored[EAPI_STATE_KEYS.deviceId] || '').trim();
  next.deviceId = deviceId || randomChars(16, 'abcdefghijklmnopqrstuvwxyz0123456789');
  const nuid = String(stored[EAPI_STATE_KEYS.nuid] || '').trim();
  next.nuid = nuid || randomChars(32, '0123456789abcdef');
  next.nmtid = String(stored[EAPI_STATE_KEYS.nmtid] || '').trim();
  const wnmcid = String(stored[EAPI_STATE_KEYS.wnmcid] || '').trim();
  next.wnmcid = wnmcid || `${randomChars(6, 'abcdefghijklmnopqrstuvwxyz')}.${Date.now()}.01.0`;
  const patch = {};
  if (!deviceId) patch[EAPI_STATE_KEYS.deviceId] = next.deviceId;
  if (!nuid) patch[EAPI_STATE_KEYS.nuid] = next.nuid;
  if (!wnmcid) patch[EAPI_STATE_KEYS.wnmcid] = next.wnmcid;
  if (Object.keys(patch).length > 0) {
    try { await chrome.storage.local.set(patch); } catch (_) {}
  }
  return next;
}

/** 服务端在第一个不带 NMTID 的 eapi 响应里下发 NMTID，后续请求要带上它。 */
async function rememberEapiNmtid(setCookies) {
  if (!Array.isArray(setCookies) || setCookies.length === 0) return;
  for (const entry of setCookies) {
    const match = String(entry || '').match(/(?:^|;\s*)NMTID=([^;]+)/);
    if (!match) continue;
    const value = String(match[1] || '').trim();
    if (!value) continue;
    try { await chrome.storage.local.set({ [EAPI_STATE_KEYS.nmtid]: value }); } catch (_) {}
    return;
  }
}

/**
 * 官方客户端的 eapi body 里带一个 header 块（deviceId / appver / requestId …）。
 * 之前只把设备信息塞进 Cookie、body 里没有 header，服务端会按「非官方客户端」判风控，
 * 登录接口直接回 8821「环境异常」。这里按官方客户端的字段补上。
 */
async function buildEapiHeader(parsed) {
  const state = await readEapiState();
  const header = {
    osver: parsed.osver || '16.2',
    deviceId: parsed.deviceId || state.deviceId,
    appver: parsed.appver || '9.0.90',
    versioncode: parsed.versioncode || '140',
    mobilename: parsed.mobilename || '',
    buildver: parsed.buildver || String(Date.now()).slice(0, 10),
    resolution: parsed.resolution || '1920x1080',
    __csrf: parsed.__csrf || '',
    // 官方 iPhone 客户端的 os 就是 'iPhone OS'，写成 'ios' 与 UA 对不上。
    os: parsed.os || 'iPhone OS',
    channel: parsed.channel || 'distribution',
    requestId: `${Date.now()}_${String(Math.floor(Math.random() * 1000)).padStart(4, '0')}`,
  };
  // 官方客户端 cookie 里的这几个值缺一个都像「非官方客户端」，缺失时随机生成并固定下来。
  header._ntes_nuid = parsed._ntes_nuid || state.nuid;
  header._ntes_nnid = parsed._ntes_nnid || `${header._ntes_nuid},${Date.now()}`;
  header.WNMCID = parsed.WNMCID || state.wnmcid;
  header.WEVNSM = parsed.WEVNSM || '1.0.0';
  header.__remember_me = 'true';
  header.ntes_kaola_ad = '1';
  const nmtid = parsed.NMTID || state.nmtid;
  if (nmtid) header.NMTID = nmtid;
  if (parsed.MUSIC_U) header.MUSIC_U = parsed.MUSIC_U;
  if (parsed.MUSIC_A) header.MUSIC_A = parsed.MUSIC_A;
  // 其余会话 cookie（MUSIC_R_U、sDeviceId…）原样带上，官方客户端也会回传。
  EAPI_COOKIE_KEYS.forEach((key) => {
    if (parsed[key] && header[key] === undefined) header[key] = parsed[key];
  });
  return header;
}

async function resolveEapiCookieMap(cookieHeader) {
  const parsed = parseCookieString(cookieHeader);
  if (!parsed.MUSIC_U) {
    const musicU = await getNeteaseMusicU();
    if (musicU) parsed.MUSIC_U = musicU;
  }
  return parsed;
}

function formatEapiCookieHeader(header) {
  return Object.entries(header)
    .filter(([, value]) => value != null && String(value) !== '')
    .map(([key, value]) => encodeCookiePair(key, value))
    .join('; ');
}

export async function buildEapiCookieHeader(cookieHeader) {
  return formatEapiCookieHeader(await buildEapiHeader(await resolveEapiCookieMap(cookieHeader)));
}

export async function eapiRequest(path, data, cookieHeader) {
  const uri = path.startsWith('/api/') ? path : `/api/${path.replace(/^\//, '')}`;
  const apiPath = uri.slice(5);
  const parsedCookies = await resolveEapiCookieMap(cookieHeader);
  const header = await buildEapiHeader(parsedCookies);
  const requestBody = Object.assign({}, data || {}, { header });
  const encrypted = eapiEncrypt(uri, requestBody);
  const resp = await fetch(`${EAPI_BASE}/eapi/${apiPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': EAPI_UA,
      Cookie: formatEapiCookieHeader(header),
    },
    body: new URLSearchParams(encrypted).toString(),
    credentials: 'include',
  });
  let body = {};
  try {
    body = await resp.json();
  } catch (_) {
    body = {};
  }
  // 安卓桥把 Set-Cookie 镜像到 x-folia-set-cookie，只看 getSetCookie() 的话这里永远是空的。
  const setCookies = readRawSetCookies(resp);
  // 服务端在第一个不带 NMTID 的 eapi 响应里下发它，后续请求必须带上。
  await rememberEapiNmtid(setCookies);
  return { status: resp.status, body, setCookies };
}
