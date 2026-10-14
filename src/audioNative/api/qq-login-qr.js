/**
 * QQ Music QR login — port of sansenjian/qq-music-api
 * Docs: https://sansenjian.github.io/qq-music-api/api/user.html
 *
 * Flow:
 *  1. GET  ptqrshow  → qrsig + qr image + ptqrtoken(=hash33(qrsig))
 *  2. GET  ptqrlogin → wait / scanned / success(+checkSigUrl)
 *  3. GET  checkSigUrl (manual) → p_skey
 *  4. POST graph.qq.com/oauth2.0/authorize → Location?code=
 *  5. POST u.y.qq.com musicu QQLogin → qm_keyst session cookies
 *
 * Extension fetch cannot send Cookie headers; we inject them via
 * declarativeNetRequest for the duration of each privileged request.
 */

import { UA } from './weapi.js';
import {
  clearCookieCache,
  removeBrowserCookies,
  removeBrowserCookiesForHosts,
  setBrowserCookies,
} from './cookies.js';
import { noteQrLoginStep, resetQrLoginTrace } from './qrLoginTrace.js';
import { readRawSetCookies } from './setCookieHeaders.js';

const QQ_PT_APPID = '716027609';
const QQ_PT_DAID = '383';
const QQ_PT_AID = '100497308';
const QQ_PT_U1 = 'https://graph.qq.com/oauth2.0/login_jump';
const QQ_AUTHORIZE_REDIRECT =
  'https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/';

// 换票过程中的临时失败不该让前端停止轮询：扫码会话还在，下一次轮询往往就能走通。
// 回 801（waiting）让 UI 继续转，同时把真实原因留在诊断字段里。
const retryableCheckFailure = (message, error, extra = {}) => ({
  isOk: false,
  code: 801,
  refresh: false,
  message,
  error,
  provider: 'qq',
  status: 'wait',
  retryable: true,
  ...extra,
});

// 扫过码之后换票失败，最多容忍几次：这个阶段上游已经确认过登录，一次网络抖动不该把会话丢掉。
// 但连续失败必须转成终态错误 —— 只回 801 会让界面永远停在「等待扫码」，
// 手机早就提示登录成功、应用却毫无反应，正是这么来的。
const TICKET_EXCHANGE_MAX_FAILURES = 3;
const TICKET_EXCHANGE_TRACKED_SESSIONS = 32;
const ticketExchangeFailures = new Map();

function countTicketExchangeFailure(qrsig) {
  const key = String(qrsig || '').slice(0, 64);
  const attempts = (ticketExchangeFailures.get(key) || 0) + 1;
  ticketExchangeFailures.delete(key);
  ticketExchangeFailures.set(key, attempts);
  while (ticketExchangeFailures.size > TICKET_EXCHANGE_TRACKED_SESSIONS) {
    ticketExchangeFailures.delete(ticketExchangeFailures.keys().next().value);
  }
  return attempts;
}

function clearTicketExchangeFailures(qrsig) {
  ticketExchangeFailures.delete(String(qrsig || '').slice(0, 64));
}

/**
 * 换票阶段的失败。前几次仍按「等待」返回让前端继续轮询，连续失败到上限就交出终态错误，
 * 前端据此弹出可操作的失败界面（附带阶段与原因），而不是一直转圈。
 */
function ticketExchangeFailure(qrsig, message, error, extra = {}) {
  const attempts = countTicketExchangeFailure(qrsig);
  const detail = {
    ...extra,
    failureStage: 'qq-ticket-exchange',
    failureReason: extra.failureReason || message,
    ticketExchangeAttempts: attempts,
  };
  if (attempts <= TICKET_EXCHANGE_MAX_FAILURES) {
    noteQrLoginStep('qr:exchange:retry', { attempts, message });
    return { ...retryableCheckFailure(message, error, detail), status: 'wait' };
  }
  noteQrLoginStep('qr:exchange:failed', { attempts, message });
  return {
    isOk: false,
    code: 0,
    refresh: false,
    message,
    error,
    provider: 'qq',
    status: 'error',
    retryable: false,
    ...detail,
  };
}

const DNR_COOKIE_RULE_ID = 917027609;
let dnrCookieSerial = 0;

// 微信扫码通道写下的通道标记。QQ 登录前必须先清掉，否则会被误判成微信通道。
const WECHAT_COOKIE_HOSTS = ['https://y.qq.com/', 'https://qq.com/', 'https://graph.qq.com/'];
export const WECHAT_CHANNEL_COOKIE_NAMES = [
  'login_type',
  'wxuin',
  'wxopenid',
  'wxskey',
  'wxrefresh_token',
  'str_musicid',
  'tmeLoginType',
];

// 平台账号凭据。两条扫码通道共用同一个 cookie 罐（都写在 .qq.com 上），所以「先微信、退出、再 QQ」
// 时上一条会话的 uin / qm_keyst / qqmusic_key 还在罐里：换票过程会把它们当成自己的凭据捡回来，
// 拼出一个「看起来登录了、其实用不了」的混合会话。开新会话前必须把整套凭据一起清掉。
export const QQ_PLATFORM_CREDENTIAL_COOKIE_NAMES = [
  'uin',
  'p_uin',
  'qqmusic_uin',
  'qm_keyst',
  'qqmusic_key',
  'music_key',
  'p_skey',
  'skey',
  'psrf_qqaccess_token',
  'psrf_qqrefresh_token',
  'psrf_qqunionid',
  'euin',
  ...WECHAT_CHANNEL_COOKIE_NAMES,
];

/** 这些名字只能由本次登录流程产生，绝不能从上一条会话的残留里捡回来。 */
const SESSION_CREDENTIAL_NAMES = new Set(
  QQ_PLATFORM_CREDENTIAL_COOKIE_NAMES.map(name => String(name).toLowerCase()),
);

// 跨通道会互相打架的账号 / 通道 cookie：从 jar 读回来时一律跳过，只认本次流程产出的值。
// 不跳过就会出现「先微信、退出、再 QQ」时的混合会话：uin 是微信的、p_skey 是 QQ 的。
const CROSS_CHANNEL_COOKIE_NAMES = new Set([
  'uin',
  'p_uin',
  'qqmusic_uin',
  'qm_keyst',
  'qqmusic_key',
  'music_key',
  ...WECHAT_CHANNEL_COOKIE_NAMES,
].map(name => String(name).toLowerCase()));

// 收尾步骤的硬上限：宿主不回包时不能让登录停在「手机上已确认、应用没反应」。
// 清理走一次批量删除（几十条一次过桥），2.5 秒足够；纯逐条删除的旧宿主会超时放弃，
// 但那只影响卫生，不影响账号解析（会话本身仍压过罐里的残留）。
const COOKIE_HYGIENE_TIMEOUT_MS = 2500;
const COOKIE_WRITE_TIMEOUT_MS = 5000;

/** 给一段收尾工作加上截止时间；无论成功、失败还是超时都会结算成 fallback。 */
function settleWithin(promise, ms, fallback, label) {
  let timer = null;
  const work = Promise.resolve(promise).catch((err) => {
    noteQrLoginStep(`${label}:failed`, { message: err?.message || String(err) });
    return fallback;
  });
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      noteQrLoginStep(`${label}:timeout`, { ms });
      resolve(fallback);
    }, ms);
  });
  // 计时器必须清掉：早结算的一段工作如果留着这个 timer，会在几百毫秒后往追踪里写一条
  // 假的 `:timeout` —— 报告上看不出区别，但会把排查方向带偏。
  return Promise.race([work, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * 清掉上一条通道留下的平台凭据。扫码开始前、登出时、写新会话前都要走一遍。
 * 这只是会话切换的卫生工作：读不到结果也照常放行，绝不阻塞登录。
 */
export async function clearQQPlatformSessionCookies() {
  const cleanup = removeBrowserCookiesForHosts(WECHAT_COOKIE_HOSTS, QQ_PLATFORM_CREDENTIAL_COOKIE_NAMES);
  await settleWithin(cleanup, COOKIE_HYGIENE_TIMEOUT_MS, undefined, 'qr:clean-platform-cookies');
}

export function hash33(qrsig) {
  let e = 0;
  const t = String(qrsig || '');
  for (let n = 0, o = t.length; n < o; n += 1) e += (e << 5) + t.charCodeAt(n);
  return 2147483647 & e;
}

function getGtk(pSkey) {
  const str = String(pSkey || '');
  let hash = 5381;
  for (let i = 0, len = str.length; i < len; i += 1) {
    hash += (hash << 5) + str.charCodeAt(i);
  }
  return hash & 2147483647;
}

function getGuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  }).toUpperCase();
}

function parseSetCookieRaw(setCookieHeader) {
  if (!setCookieHeader) return [];
  if (Array.isArray(setCookieHeader)) {
    return setCookieHeader
      .map((part) => String(part || '').split(';')[0].trim())
      .filter((pair) => pair.includes('=') && pair.split('=')[1]);
  }
  const cookies = [];
  const parts = String(setCookieHeader).split(/,(?=\s*[a-zA-Z_][\w-]*=)/);
  for (const part of parts) {
    const cookiePair = part.split(';')[0].trim();
    if (cookiePair && cookiePair.includes('=') && cookiePair.split('=')[1]) cookies.push(cookiePair);
  }
  return cookies;
}

function collectSetCookies(resp) {
  const list = [];
  // 安卓桥把 Set-Cookie 镜像到 x-folia-set-cookie（见 setCookieHeaders.js），
  // 只认 getSetCookie() 的话在安卓上永远是空的。
  readRawSetCookies(resp).forEach((raw) => {
    list.push(...parseSetCookieRaw(raw));
  });
  return list;
}

function cookiePairsToHeader(pairs) {
  return (pairs || []).filter(Boolean).join('; ');
}

function cookiePairsToObject(pairs) {
  const obj = {};
  (pairs || []).forEach((pair) => {
    const eq = String(pair).indexOf('=');
    if (eq <= 0) return;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (key && value) obj[key] = value;
  });
  return obj;
}

// The browser extension injects cookies with declarativeNetRequest. The Android
// bridge stubs that API out, so there the header has to be handed to fetch
// directly. Reading the jar per URL also picks up whatever the origin stored
// during the previous hop.
async function readJarCookiePairs(url) {
  try {
    const items = await chrome.cookies.getAll({ url });
    return (items || [])
      .filter((item) => item && item.name && item.value)
      .map((item) => `${item.name}=${item.value}`);
  } catch (_) {
    return [];
  }
}

// chrome.cookies.get 是按域名查找，能读到跳转响应写入、但当前 URL 取不到的 cookie。
async function readJarCookieValue(url, name) {
  try {
    const item = await chrome.cookies.get({ url, name });
    return item && item.value ? item.value : '';
  } catch (_) {
    return '';
  }
}

function mergeCookieHeader(...headers) {
  const merged = new Map();
  for (const header of headers) {
    for (const pair of String(header || '').split(';')) {
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name && value) merged.set(name, value);
    }
  }
  return Array.from(merged, ([name, value]) => `${name}=${value}`).join('; ');
}

const cookiePairName = (pair) => {
  const eq = String(pair).indexOf('=');
  return eq <= 0 ? '' : String(pair).slice(0, eq).trim().toLowerCase();
};

/** 上一条通道留下的账号 cookie 不能带进本次请求。 */
const isCrossChannelCookiePair = (pair) => CROSS_CHANNEL_COOKIE_NAMES.has(cookiePairName(pair));

/** 会话凭据只能由本次流程产生：读 jar 时全部跳过。 */
const isSessionCredentialPair = (pair) => SESSION_CREDENTIAL_NAMES.has(cookiePairName(pair));

async function buildRequestCookieHeader(url, pairs) {
  const jarPairs = (await readJarCookiePairs(url)).filter(pair => !isCrossChannelCookiePair(pair));
  // 本次流程产出的 cookie 放最后：同名时以它为准，别让 jar 里的旧值把新值顶掉。
  return mergeCookieHeader(
    cookiePairsToHeader(jarPairs),
    cookiePairsToHeader(pairs),
  );
}

function mergeCookiePairs(map, pairs) {
  for (const pair of pairs || []) {
    const eq = String(pair).indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    if (name) map.set(name, pair.trim());
  }
  return map;
}

/** 把 jar 读回来的 cookie 并进本次会话，但跳过所有会话凭据。 */
function mergeJarCookiePairs(map, pairs) {
  return mergeCookiePairs(map, (pairs || []).filter(pair => !isSessionCredentialPair(pair)));
}

export function buildLoginSession(cookie) {
  const cookieList = String(cookie || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
  const cookieObject = cookiePairsToObject(cookieList);
  const loginUin = cookieObject.uin || cookieObject.p_uin || '';
  return {
    loginUin,
    uin: loginUin,
    cookie: cookieList.join('; '),
    cookieList,
    cookieObject,
  };
}

async function withInjectedCookie(cookieHeader, urlFilters, run) {
  const cookie = String(cookieHeader || '').trim();
  const filters = (urlFilters || []).filter(Boolean);
  if (!cookie || !filters.length || !chrome.declarativeNetRequest?.updateSessionRules) {
    return run();
  }
  dnrCookieSerial = (dnrCookieSerial + 1) % 1000;
  const baseId = DNR_COOKIE_RULE_ID + dnrCookieSerial * 10;
  const ruleIds = filters.map((_, i) => baseId + i);
  const addRules = filters.map((urlFilter, i) => ({
    id: ruleIds[i],
    priority: 100,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'cookie', operation: 'set', value: cookie }],
    },
    condition: {
      urlFilter,
      resourceTypes: ['xmlhttprequest', 'other'],
    },
  }));
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: ruleIds,
      addRules,
    });
  } catch (err) {
    console.warn('[Mineradio Bridge] QQ cookie DNR inject failed', err);
    return run();
  }
  try {
    return await run();
  } finally {
    try {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ruleIds, addRules: [] });
    } catch (_) {}
  }
}

export async function fetchWithTimeout(input, init = {}, timeout = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function writeSessionCookies(session) {
  const raw = (session && session.cookie) || '';
  if (!raw) return;
  // QQ 通道登录：先清掉上一条微信通道留下的通道标记。它们留在同一个 cookie jar 里时，
  // qqCookieUin 会优先读 wxuin、comm 会带上 tmeLoginType=1，QQ 凭证就被按微信解析而拒收。
  await clearQQPlatformSessionCookies();
  noteQrLoginStep('qr:session:write:start', { cookieCount: raw.split(';').filter(Boolean).length });
  // 写 jar 失败不该吞掉刚拿到的会话：调用方还会把同一串 cookie 交给 saveProviderCookie 持久化，
  // getQQCookie() 会把存储里那份合并回来。超时同样只记一条诊断，不阻塞「已确认」的返回。
  const written = await settleWithin(
    (async () => {
      await setBrowserCookies('https://y.qq.com/', raw);
      await setBrowserCookies('https://qq.com/', raw);
      await setBrowserCookies('https://graph.qq.com/', raw);
      clearCookieCache();
      return true;
    })(),
    COOKIE_WRITE_TIMEOUT_MS,
    false,
    'qr:session:write',
  );
  noteQrLoginStep(written ? 'qr:session:write:ok' : 'qr:session:write:skipped');
}

/** GET /user/getQQLoginQr equivalent */
export async function qqGetLoginQr() {
  resetQrLoginTrace();
  noteQrLoginStep('qr:create:start');
  // 开始一次 QQ 扫码就把微信通道的残留清掉：它会让后续的 login_status / 歌单请求被按微信解析。
  await clearQQPlatformSessionCookies().catch(() => undefined);
  const u = new URL('https://ssl.ptlogin2.qq.com/ptqrshow');
  u.searchParams.set('appid', QQ_PT_APPID);
  u.searchParams.set('e', '2');
  u.searchParams.set('l', 'M');
  u.searchParams.set('s', '3');
  u.searchParams.set('d', '72');
  u.searchParams.set('v', '4');
  u.searchParams.set('t', String(Math.random()));
  u.searchParams.set('daid', QQ_PT_DAID);
  u.searchParams.set('pt_3rd_aid', QQ_PT_AID);
  u.searchParams.set('u1', QQ_PT_U1);

  // 先把上一次扫码留下的 qrsig 删掉再要新码：它就是「新二维码第一次轮询就失效」的来源 ——
  // Set-Cookie 不可见时只能从罐里回捞 qrsig，捞到旧值的话服务端当然不认这个码。
  await removeBrowserCookies('https://ssl.ptlogin2.qq.com/', ['qrsig']).catch(() => undefined);
  await removeBrowserCookies('https://qq.com/', ['qrsig']).catch(() => undefined);

  const response = await fetchWithTimeout(u.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      'User-Agent': UA,
      Referer: 'https://xui.ptlogin2.qq.com/',
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    },
  });
  if (!response.ok) {
    noteQrLoginStep('qr:create:http', { status: response.status });
    throw new Error('Failed to fetch QQ login QR');
  }

  const pairs = collectSetCookies(response);
  let qrsig = '';
  for (const pair of pairs) {
    if (pair.startsWith('qrsig=')) {
      qrsig = pair.slice('qrsig='.length);
      break;
    }
  }
  if (!qrsig) {
    // Fallback: cookie jar (credentials:include may have stored it)
    try {
      const item = await chrome.cookies.get({ url: 'https://ssl.ptlogin2.qq.com/', name: 'qrsig' });
      if (item && item.value) qrsig = item.value;
    } catch (_) {}
  }
  if (!qrsig) throw new Error('Failed to get qrsig from response');
  noteQrLoginStep('qr:create:ok', { status: response.status, setCookieCount: pairs.length });

  // Keep qrsig in Chrome jar for credentials:include fallback
  try {
    await chrome.cookies.set({
      url: 'https://ssl.ptlogin2.qq.com/',
      name: 'qrsig',
      value: qrsig,
      path: '/',
      secure: true,
    });
  } catch (_) {}

  const buf = await response.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  const img = `data:image/png;base64,${btoa(binary)}`;
  const ptqrtoken = String(hash33(qrsig));

  return {
    // sansenjian shape
    img,
    qrsig,
    ptqrtoken,
    // Bridge-compatible aliases
    provider: 'qq',
    qrimg: img,
  };
}

/** POST /user/checkQQLoginQr equivalent */
export async function qqCheckLoginQr(params = {}) {
  const qrsig = String(params.qrsig || '').trim();
  let ptqrtoken = String(params.ptqrtoken || '').trim();
  if (!qrsig) {
    return { isOk: false, code: 65, refresh: true, message: '参数错误：缺少 qrsig', provider: 'qq' };
  }
  if (!ptqrtoken) ptqrtoken = String(hash33(qrsig));

  const cookieMap = new Map();
  cookieMap.set('qrsig', `qrsig=${qrsig}`);

  const pollUrl = new URL('https://ssl.ptlogin2.qq.com/ptqrlogin');
  pollUrl.searchParams.set('u1', QQ_PT_U1);
  pollUrl.searchParams.set('ptqrtoken', ptqrtoken);
  pollUrl.searchParams.set('ptredirect', '0');
  pollUrl.searchParams.set('h', '1');
  pollUrl.searchParams.set('t', '1');
  pollUrl.searchParams.set('g', '1');
  pollUrl.searchParams.set('from_ui', '1');
  pollUrl.searchParams.set('ptlang', '2052');
  pollUrl.searchParams.set('action', `0-0-${Date.now()}`);
  pollUrl.searchParams.set('js_ver', '23111510');
  pollUrl.searchParams.set('js_type', '1');
  pollUrl.searchParams.set('login_sig', '');
  pollUrl.searchParams.set('pt_uistyle', '40');
  pollUrl.searchParams.set('aid', QQ_PT_APPID);
  pollUrl.searchParams.set('daid', QQ_PT_DAID);
  pollUrl.searchParams.set('pt_3rd_aid', QQ_PT_AID);

  const runPoll = async () => {
    const cookieHeader = await buildRequestCookieHeader(pollUrl.toString(), Array.from(cookieMap.values()));
    const res = await withInjectedCookie(cookieHeader, ['||ssl.ptlogin2.qq.com'], () =>
      fetchWithTimeout(pollUrl.toString(), {
        method: 'GET',
        credentials: 'include',
        headers: {
          'User-Agent': UA,
          Referer: 'https://xui.ptlogin2.qq.com/',
          Accept: '*/*',
          Cookie: cookieHeader,
        },
      }),
    );
    return { res, body: (await res.text()) || '' };
  };

  let response;
  let data = '';
  try {
    ({ res: response, body: data } = await runPoll());
    // Tencent answers an unidentified poll with an empty 403. Retrying once with
    // a freshly read cookie jar recovers when the first write had not landed.
    if (response.status === 403 || (response.status >= 400 && !String(data).trim())) {
      noteQrLoginStep('qr:poll:forbidden-retry', { status: response.status });
      await writeSessionCookies({ cookie: cookiePairsToHeader(Array.from(cookieMap.values())) });
      const retry = await runPoll();
      response = retry.res;
      data = retry.body;
    }
  } catch (err) {
    noteQrLoginStep('qr:poll:exception', { name: err?.name || 'Error', message: err?.message || String(err) });
    if (err && err.name === 'AbortError') {
      return { isOk: false, code: 0, message: '登录检查超时', error: '登录检查超时', provider: 'qq' };
    }
    return {
      isOk: false,
      code: 0,
      message: (err && err.message) || '登录检查失败',
      error: (err && err.message) || '登录检查失败',
      provider: 'qq',
    };
  }

  const pollSetCookies = collectSetCookies(response);
  mergeCookiePairs(cookieMap, pollSetCookies);

  const refresh = /已失效|已过期/.test(data) && !/未失效/.test(data);
  const scanned = /二维码认证中|扫描成功|已扫描/.test(data);
  const waiting = /二维码未失效|等待扫码|未失效/.test(data);
  const success = /登录成功|登陆成功/.test(data);
  const responseHead = String(data).replace(/\s+/g, ' ').trim().slice(0, 80);
  noteQrLoginStep('qr:poll', {
    status: response.status,
    scanned,
    success,
    refresh,
    waiting,
    body: responseHead,
    setCookieCount: pollSetCookies.length,
  });

  if (!success) {
    if (refresh) {
      return { isOk: false, code: 65, refresh: true, message: '二维码已失效', provider: 'qq', status: 'expired' };
    }
    if (scanned) {
      return { isOk: false, code: 67, refresh: false, message: '已扫码，请在手机确认', provider: 'qq', status: 'scanned' };
    }
    return {
      isOk: false,
      code: waiting ? 66 : 66,
      refresh: false,
      message: waiting ? '请用手机 QQ 扫码' : '未扫描二维码',
      provider: 'qq',
      status: 'wait',
      raw: data.slice(0, 160),
    };
  }

  // Extract the check_sig URL. qq-music-api matches the quoted form; the bare
  // form is accepted as a fallback because the response markup does vary.
  const quotedUrlMatch = data.match(/(?:'((?:https?|ftp):\/\/[^\s/$.?#].[^\s]*)')/g);
  const bareUrlMatch = data.match(/https?:\/\/(?:ptlogin2|ssl\.ptlogin2)\.qq\.com\/[^\s'"]+/);
  const rawCheckSigUrl = quotedUrlMatch && quotedUrlMatch[0]
    ? quotedUrlMatch[0].replace(/'/g, '')
    : (bareUrlMatch && bareUrlMatch[0]) || '';
  if (!rawCheckSigUrl) {
    noteQrLoginStep('qr:check-sig:missing-url', { body: responseHead });
    return ticketExchangeFailure(qrsig, '登录检查失败：未拿到 checkSigUrl', '提取不到 checkSigUrl');
  }
  const checkSigUrl = rawCheckSigUrl.replace(/[;,'"]+$/, '');
  // check_sig 的查询串里带着本次真正登录的 uin。它是这次扫码的账号，可以放心当兜底；
  // 上一条通道留在 jar 里的 uin 则一律不许进会话（否则拼出的是别人的账号）。
  const checkSigUin = (() => {
    try {
      return (new URL(checkSigUrl).searchParams.get('uin') || '').replace(/\D/g, '');
    } catch {
      return '';
    }
  })();

  let checkSigRes;
  let checkSigFinalUrl = checkSigUrl;
  try {
    const checkSigCookieHeader = await buildRequestCookieHeader(checkSigUrl, Array.from(cookieMap.values()));
    checkSigRes = await withInjectedCookie(
      checkSigCookieHeader,
      ['||ptlogin2.qq.com', '||qq.com'],
      () =>
        fetchWithTimeout(
          checkSigUrl,
          {
            method: 'GET',
            redirect: 'manual',
            credentials: 'include',
            headers: {
              'User-Agent': UA,
              Referer: 'https://xui.ptlogin2.qq.com/',
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              Cookie: checkSigCookieHeader,
            },
          },
          12000,
        ),
    );
    // check_sig 通常回 302，p_skey 写在跳转目标上。手动跟一层，
    // 否则既读不到 Set-Cookie，也拿不到最终的登录态。
    if (checkSigRes.status >= 300 && checkSigRes.status < 400) {
      const redirectTarget = checkSigRes.headers.get('Location') || checkSigRes.headers.get('location') || '';
      if (redirectTarget) {
        const resolvedTarget = new URL(redirectTarget, checkSigUrl).toString();
        noteQrLoginStep('qr:check-sig:redirect', {
          toHost: (() => {
            try {
              return new URL(resolvedTarget).host;
            } catch {
              return '';
            }
          })(),
        });
        // 302 那一跳的 Set-Cookie 必须在这里就收下：p_skey 通常写在它身上，而跟随后的响应
        // 往往不再带 —— 只靠原生 cookie 罐回读，跨域或罐没存上时就会「缺少 p_skey」，
        // 于是扫码成功却一直停在等待（手机早已提示登录成功）。
        mergeCookiePairs(cookieMap, collectSetCookies(checkSigRes));
        try {
          const followCookieHeader = await buildRequestCookieHeader(
            resolvedTarget,
            Array.from(cookieMap.values()),
          );
          const followed = await fetchWithTimeout(
            resolvedTarget,
            {
              method: 'GET',
              credentials: 'include',
              headers: {
                'User-Agent': UA,
                Referer: checkSigUrl,
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                Cookie: followCookieHeader,
              },
            },
            12000,
          );
          mergeCookiePairs(cookieMap, collectSetCookies(followed));
          checkSigRes = followed;
          checkSigFinalUrl = resolvedTarget;
        } catch (_) {}
      }
    }
  } catch (err) {
    noteQrLoginStep('qr:check-sig:exception', { message: err?.message || String(err) });
    return ticketExchangeFailure(
      qrsig,
      (err && err.message) || '登录检查失败',
      'check_sig 请求失败',
    );
  }

  const checkSigCookies = collectSetCookies(checkSigRes);
  mergeCookiePairs(cookieMap, checkSigCookies);
  // The jar may hold cookies the response headers do not expose (the native
  // bridge hides Set-Cookie from JS), so read it back for the final URL too.
  const checkSigJarPairs = await readJarCookiePairs(checkSigFinalUrl);
  mergeJarCookiePairs(cookieMap, checkSigJarPairs);
  noteQrLoginStep('qr:check-sig', {
    status: checkSigRes.status,
    setCookieCount: checkSigCookies.length,
    jarCookieCount: checkSigJarPairs.length,
  });
  const checkSigCookieHeader = cookiePairsToHeader(checkSigCookies);
  const jarPSkey = await readJarCookieValue(checkSigFinalUrl, 'p_skey');
  const pSkeyMatch = checkSigCookieHeader.match(/p_skey=([^;]+)/)
    || cookiePairsToHeader(Array.from(cookieMap.values())).match(/p_skey=([^;]+)/)
    || (jarPSkey ? [null, jarPSkey] : null);
  if (!pSkeyMatch || !pSkeyMatch[1]) {
    noteQrLoginStep('qr:check-sig:no-p-skey', { cookieCount: checkSigCookies.length });
    return ticketExchangeFailure(qrsig, '登录检查失败：缺少 p_skey', '提取不到 p_skey');
  }
  const pSkey = pSkeyMatch[1];
  const gtk = getGtk(pSkey);

  // FormData would be serialized as a multipart blob and the native bridge
  // forwards it as base64, so the server saw no parameters at all (error
  // 100001 with an empty client_id). graph.qq.com accepts ordinary
  // form-urlencoded bodies, which the bridge passes through as text.
  const form = new URLSearchParams();
  form.append('response_type', 'code');
  form.append('client_id', QQ_PT_AID);
  form.append('redirect_uri', QQ_AUTHORIZE_REDIRECT);
  form.append('scope', 'get_user_info,get_app_friends');
  form.append('state', 'state');
  form.append('switch', '');
  form.append('from_ptlogin', '1');
  form.append('src', '1');
  form.append('update_auth', '1');
  form.append('openapi', '1010_1030');
  form.append('g_tk', String(gtk));
  form.append('auth_time', String(Date.now()));
  form.append('ui', getGuid());

  let authorizeRes;
  try {
    const authorizeCookieHeader = await buildRequestCookieHeader(
      'https://graph.qq.com/oauth2.0/authorize',
      Array.from(cookieMap.values()),
    );
    authorizeRes = await withInjectedCookie(
      authorizeCookieHeader,
      ['||graph.qq.com'],
      () =>
        fetchWithTimeout(
          'https://graph.qq.com/oauth2.0/authorize',
          {
            method: 'POST',
            redirect: 'manual',
            credentials: 'include',
            headers: {
              'User-Agent': UA,
              Referer: 'https://graph.qq.com/',
              Origin: 'https://graph.qq.com',
              Cookie: authorizeCookieHeader,
            },
            body: form,
          },
          12000,
        ),
    );
  } catch (err) {
    noteQrLoginStep('qr:authorize:exception', { message: err?.message || String(err) });
    return ticketExchangeFailure(
      qrsig,
      (err && err.message) || '授权请求失败',
      '授权响应异常',
    );
  }
  mergeCookiePairs(cookieMap, collectSetCookies(authorizeRes));
  let location = authorizeRes.headers.get('Location') || authorizeRes.headers.get('location') || '';
  noteQrLoginStep('qr:authorize:first', {
    status: authorizeRes.status,
    location: String(location).slice(0, 200),
  });

  // 授权码可能在后续几次跳转里，Location 本身不带 code 时要继续追。
  let authorizeRedirectHops = 0;
  while (
    authorizeRes.status >= 300
    && authorizeRes.status < 400
    && location
    && !/[?&]code=/.test(String(location))
    && authorizeRedirectHops < 4
  ) {
    authorizeRedirectHops += 1;
    let nextUrl;
    try {
      nextUrl = new URL(String(location), 'https://graph.qq.com/').toString();
    } catch (_) {
      break;
    }
    noteQrLoginStep('qr:authorize:hop', {
      hop: authorizeRedirectHops,
      toHost: new URL(nextUrl).host,
      location: String(location).slice(0, 160),
    });
    try {
      const hopCookieHeader = await buildRequestCookieHeader(nextUrl, Array.from(cookieMap.values()));
      const hopRes = await fetchWithTimeout(
        nextUrl,
        {
          method: 'GET',
          redirect: 'manual',
          credentials: 'include',
          headers: {
            'User-Agent': UA,
            Referer: 'https://graph.qq.com/',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            Cookie: hopCookieHeader,
          },
        },
        12000,
      );
      mergeCookiePairs(cookieMap, collectSetCookies(hopRes));
      const mergedHopJar = await readJarCookiePairs(nextUrl);
      mergeJarCookiePairs(cookieMap, mergedHopJar);
      authorizeRes = hopRes;
      location = hopRes.headers.get('Location') || hopRes.headers.get('location') || '';
      noteQrLoginStep('qr:authorize:hop:result', {
        hop: authorizeRedirectHops,
        status: hopRes.status,
        hasLocation: Boolean(location),
        locationHost: (() => {
          try {
            return location ? new URL(String(location), nextUrl).host : '';
          } catch {
            return '';
          }
        })(),
        hasCode: /[?&]code=/.test(String(location)),
      });
      // 有些跳转把 code 放在响应体内，而不是 Location 上。
      if (!/[?&]code=/.test(String(location))) {
        try {
          const hopBody = await hopRes.clone().text();
          const bodyCode = hopBody.match(/[?&]code=([^&"'\s]+)/);
          if (bodyCode && bodyCode[1]) {
            location = `x?code=${bodyCode[1]}`;
            noteQrLoginStep('qr:authorize:code-in-body', { hop: authorizeRedirectHops });
          }
        } catch (_) {}
      }
    } catch (err) {
      noteQrLoginStep('qr:authorize:hop:exception', { hop: authorizeRedirectHops, message: err?.message || String(err) });
      break;
    }
  }

  let authorizeBodyHead = '';
  const authorizeOk = authorizeRes.status >= 300 && authorizeRes.status < 400 && Boolean(location);
  if (!authorizeOk) {
    try {
      authorizeBodyHead = String(await authorizeRes.clone().text()).replace(/\s+/g, ' ').trim().slice(0, 160);
    } catch (_) {}
  }
  noteQrLoginStep('qr:authorize', {
    status: authorizeRes.status,
    hasLocation: Boolean(location),
    hops: authorizeRedirectHops,
    locationHost: (() => {
      try {
        return new URL(String(location)).host;
      } catch {
        return '';
      }
    })(),
    hasCode: /[?&]code=/.test(String(location)),
    body: authorizeBodyHead || undefined,
  });
  if (authorizeBodyHead) {
    noteQrLoginStep('qr:authorize:body', { body: authorizeBodyHead });
  }
  if (!authorizeOk) {
    return ticketExchangeFailure(
      qrsig,
      '授权响应异常，未返回跳转地址',
      '授权响应异常，未返回跳转地址',
      { authorizeStatus: authorizeRes.status },
    );
  }
  const codeMatch = String(location).match(/[?&]code=([^&]+)/);
  if (!codeMatch || !codeMatch[1]) {
    return ticketExchangeFailure(
      qrsig,
      '授权跳转缺少 code',
      '授权跳转缺少 code',
      { location: String(location).slice(0, 200) },
    );
  }
  const code = decodeURIComponent(codeMatch[1]);

  const fcgBody = JSON.stringify({
    comm: { g_tk: gtk, platform: 'yqq', ct: 24, cv: 0 },
    req: {
      module: 'QQConnectLogin.LoginServer',
      method: 'QQLogin',
      param: { code },
    },
  });

  let loginRes;
  try {
    const musicuCookieHeader = await buildRequestCookieHeader(
      'https://u.y.qq.com/cgi-bin/musicu.fcg',
      Array.from(cookieMap.values()),
    );
    loginRes = await withInjectedCookie(
      musicuCookieHeader,
      ['||u.y.qq.com', '||y.qq.com'],
      () =>
        fetchWithTimeout(
          'https://u.y.qq.com/cgi-bin/musicu.fcg',
          {
            method: 'POST',
            credentials: 'include',
            headers: {
              'User-Agent': UA,
              Referer: 'https://y.qq.com/',
              'Content-Type': 'application/x-www-form-urlencoded',
              Origin: 'https://y.qq.com',
              Cookie: musicuCookieHeader,
            },
            body: fcgBody,
          },
          12000,
        ),
    );
  } catch (err) {
    noteQrLoginStep('qr:musicu:exception', { message: err?.message || String(err) });
    return ticketExchangeFailure(
      qrsig,
      (err && err.message) || 'QQLogin 失败',
      'QQLogin 失败',
    );
  }
  mergeCookiePairs(cookieMap, collectSetCookies(loginRes));
  noteQrLoginStep('qr:musicu', { status: loginRes.status, setCookieCount: collectSetCookies(loginRes).length });

  // Promote musicid/musickey from JSON body when Set-Cookie is sparse
  try {
    const json = await loginRes.clone().json();
    const dataNode = json && json.req && json.req.data;
    if (dataNode && typeof dataNode === 'object') {
      if (dataNode.musickey) cookieMap.set('qm_keyst', `qm_keyst=${dataNode.musickey}`);
      if (dataNode.qqmusic_key) cookieMap.set('qqmusic_key', `qqmusic_key=${dataNode.qqmusic_key}`);
      // musicid 不等于 QQ 号：部分账号两者并不相同，拿它覆盖 uin 会把后续所有请求
      // （登录状态、歌单、喜欢、播放地址）带到另一个空账号上。这里只补缺失的 uin。
      const musicId = String(dataNode.musicid || dataNode.uin || '').replace(/\D/g, '');
      if (musicId && !cookieMap.has('uin') && !cookieMap.has('p_uin')) cookieMap.set('uin', `uin=o${musicId}`);
      if (musicId && !cookieMap.has('str_musicid')) cookieMap.set('str_musicid', `str_musicid=${musicId}`);
    }
  } catch (_) {}

  // 明确标记这是 QQ 通道的会话：罐里万一还留着微信通道的 login_type=2 / wxuin，
  // qqCookieUin 会走微信分支读 wxuin，把别人的账号当成这次扫码的结果。
  cookieMap.delete('tmeLoginType');
  cookieMap.set('login_type', 'login_type=1');

  // 会话的账号 id 必须是「你扫的那个 QQ 号」——check_sig 的 uin 参数就是它。
  // musicid 或响应 Set-Cookie 里的 id 在部分账号上与之不同，必须以它为准，否则
  // 登录状态、歌单、喜欢、播放地址全部会落到另一个（空的）账号上。
  if (checkSigUin) {
    const musicIdTail = String(cookieMap.get('uin') || cookieMap.get('p_uin') || '').replace(/\D/g, '').slice(-4);
    cookieMap.set('uin', `uin=o${checkSigUin}`);
    if (!cookieMap.has('qqmusic_uin')) cookieMap.set('qqmusic_uin', `qqmusic_uin=o${checkSigUin}`);
    noteQrLoginStep('qr:session:uin-from-check-sig', {
      uinTail: checkSigUin.slice(-4),
      ...(musicIdTail && musicIdTail !== checkSigUin.slice(-4) ? { replacedTail: musicIdTail } : {}),
    });
  }

  const session = buildLoginSession(cookiePairsToHeader(Array.from(cookieMap.values())));
  noteQrLoginStep('qr:session', {
    hasMusicKey: Boolean(session.cookieObject.qm_keyst || session.cookieObject.qqmusic_key),
    hasUin: Boolean(session.cookieObject.uin || session.cookieObject.p_uin),
    cookieCount: session.cookieList.length,
  });
  if (!session.cookieObject.qm_keyst && !session.cookieObject.qqmusic_key) {
    return ticketExchangeFailure(
      qrsig,
      '登录成功但未拿到 qm_keyst',
      '登录成功但未拿到 qm_keyst',
      { session },
    );
  }

  await writeSessionCookies(session);
  clearTicketExchangeFailures(qrsig);
  noteQrLoginStep('qr:done:ok');

  return {
    // sansenjian shape
    isOk: true,
    message: '登录成功',
    session,
    // Bridge-compatible shape (UI / status)
    provider: 'qq',
    code: 0,
    status: 'ok',
    loggedIn: true,
    hasCookie: true,
    userId: String(session.uin || '').replace(/\D/g, ''),
    uin: String(session.uin || '').replace(/\D/g, ''),
    nickname: session.cookieObject.nick || session.cookieObject.nickname || `QQ ${String(session.uin || '').replace(/\D/g, '')}`,
  };
}
