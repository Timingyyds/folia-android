/**
 * QQ 音乐「微信扫码」登录通道（tmeLoginType: 1）。
 *
 * 协议与原版 Folia 用的 @yakult-green-tea/qq-music-api 一致，是社区逆向结论，非官方定义：
 *  1. GET  open.weixin.qq.com/connect/qrconnect → 页面里带 uuid
 *  2. GET  open.weixin.qq.com/connect/qrcode/<uuid> → 二维码图
 *  3. GET  lp.open.weixin.qq.com/connect/l/qrconnect → 长轮询，回 wx_errcode / wx_code
 *  4. POST u.y.qq.com musicu Login（tmeLoginType:1）用 OAuth code 换 musickey
 *
 * 和 QQ 通道（ptlogin + MQTT）完全无关，只是最后一步都落在同一个 musicu 接口。
 */

import { UA } from './weapi.js';
import { clearCookieCache, saveProviderCookie, setBrowserCookies } from './cookies.js';
import { noteQrLoginStep, resetQrLoginTrace } from './qrLoginTrace.js';
import { buildLoginSession, clearQQPlatformSessionCookies, fetchWithTimeout } from './qq-login-qr.js';

const WECHAT_APP_ID = 'wx48db31d50e334801';
const WECHAT_LOGIN_TYPE = 1;
const CONNECT_URL = 'https://open.weixin.qq.com/connect/qrconnect';
const IMAGE_URL_PREFIX = 'https://open.weixin.qq.com/connect/qrcode/';
const POLL_URL = 'https://lp.open.weixin.qq.com/connect/l/qrconnect';
const REDIRECT_URI = 'https://y.qq.com/portal/wx_redirect.html?login_type=2&surl=https://y.qq.com/';
const STYLE_HREF = 'https://y.qq.com/mediastyle/music_v17/src/css/popup_wechat.css#wechat_redirect';
const MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';

const UUID_PATTERN = /uuid=(.+?)"/;
const STATUS_PATTERN = /window\.wx_errcode=(\d+);window\.wx_code='([^']*)'/;

// 上游 wx_errcode 的取值，与参考实现逐个对齐。
const WECHAT_STATUS = {
  waiting: 408,
  scanned: 404,
  confirmed: 405,
  expired: 402,
  refused: 403,
};

/** 二维码会话：key 就是微信的 uuid，只在内存里活到取消/过期。 */
const sessions = new Map();

const sessionKey = (uuid) => `wechat:${uuid}`;

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

const textOf = (value) => (typeof value === 'string' ? value : '');

function imageMimetype(bytes) {
  const head = Array.from(bytes.slice(0, 8))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  if (head.startsWith('89504e470d0a1a0a')) return 'image/png';
  if (head.startsWith('ffd8ff')) return 'image/jpeg';
  return null;
}

async function readBytes(response) {
  return new Uint8Array(await response.arrayBuffer());
}

/** 取微信 OAuth 二维码；返回 uuid 与内联图片。 */
export async function qqWechatGetLoginQr() {
  resetQrLoginTrace();
  noteQrLoginStep('wx:qr:create:start');
  // 换通道前先清掉上一条通道的平台凭据：QQ 扫码留下的 uin / qm_keyst 会在换票时被当成
  // 自己的凭据捡回来，拼出一个用不了的混合会话。
  await clearQQPlatformSessionCookies();
  const url = new URL(CONNECT_URL);
  url.searchParams.set('appid', WECHAT_APP_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'snsapi_login');
  url.searchParams.set('state', 'STATE');
  url.searchParams.set('href', STYLE_HREF);

  const page = await fetchWithTimeout(url.toString(), {
    method: 'GET',
    headers: {
      'User-Agent': UA,
      Referer: 'https://y.qq.com/',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  }, 15000);
  if (!page.ok) {
    noteQrLoginStep('wx:qr:create:http', { status: page.status });
    throw new Error('Failed to fetch WeChat login QR');
  }
  const uuid = UUID_PATTERN.exec(textOf(await page.text()))?.[1] ?? '';
  if (!uuid) {
    noteQrLoginStep('wx:qr:create:no-uuid');
    throw new Error('WeChat qrconnect response missing uuid');
  }

  const imageRes = await fetchWithTimeout(`${IMAGE_URL_PREFIX}${uuid}`, {
    method: 'GET',
    headers: { 'User-Agent': UA, Referer: CONNECT_URL },
  }, 15000);
  if (!imageRes.ok) {
    noteQrLoginStep('wx:qr:image:http', { status: imageRes.status });
    throw new Error('Failed to fetch WeChat QR image');
  }
  const bytes = await readBytes(imageRes);
  const mimetype = imageMimetype(bytes);
  if (!mimetype) {
    noteQrLoginStep('wx:qr:image:invalid');
    throw new Error('WeChat QR response is not a PNG/JPEG image');
  }
  let base64 = '';
  for (let index = 0; index < bytes.length; index += 1) base64 += String.fromCharCode(bytes[index]);
  const qrimg = `data:${mimetype};base64,${btoa(base64)}`;
  sessions.set(sessionKey(uuid), { uuid, qrimg, cancelled: false });
  noteQrLoginStep('wx:qr:create:ok');
  return { qrsig: uuid, ptqrtoken: uuid, qrimg, uuid };
}

/** 用 musicu 的 Login 把微信 OAuth code 换成 QQ 音乐凭证。 */
async function exchangeWechatCredential(code) {
  const body = JSON.stringify({
    comm: {
      ct: 11,
      cv: 14090008,
      v: 14090008,
      tmeAppID: 'qqmusic',
      tmeLoginType: WECHAT_LOGIN_TYPE,
    },
    req: {
      module: 'music.login.LoginServer',
      method: 'Login',
      param: { code, strAppid: WECHAT_APP_ID },
    },
  });
  const response = await fetchWithTimeout(`${MUSICU_URL}?format=json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      Referer: 'https://y.qq.com/',
      'User-Agent': UA,
    },
    body,
  }, 15000);
  const json = await response.json().catch(() => null);
  const data = json && json.req && json.req.data;
  if (!data || typeof data !== 'object') {
    throw new Error('WeChat credential exchange returned no data');
  }
  return data;
}

/** 一次微信长轮询。 */
async function pollWechat(uuid, budgetMs = 1500) {
  const url = new URL(POLL_URL);
  url.searchParams.set('uuid', uuid);
  url.searchParams.set('_', String(Date.now()));
  const response = await fetchWithTimeout(url.toString(), {
    method: 'GET',
    headers: { 'User-Agent': UA, Referer: 'https://open.weixin.qq.com/' },
  }, Math.max(2000, budgetMs + 1000));
  const match = STATUS_PATTERN.exec(textOf(await response.text()));
  if (!match) throw new Error('WeChat poll response missing wx_errcode');
  return { upstreamCode: Number(match[1]), code: match[2] };
}

/** 与 qqCheckLoginQr 同形：把微信状态映射成后端约定的 code/status。 */
export async function qqWechatCheckLoginQr(params = {}) {
  const uuid = String(params.qrsig || params.ptqrtoken || '');
  const qrSession = sessions.get(sessionKey(uuid));
  if (!qrSession) {
    return { isOk: false, code: 800, provider: 'qq', status: 'expired', message: '二维码已过期' };
  }
  if (qrSession.cancelled) {
    return { isOk: false, code: 803, provider: 'qq', status: 'cancelled', message: '已取消' };
  }

  let status;
  try {
    status = await pollWechat(uuid);
  } catch (error) {
    return retryableCheckFailure(error?.message || '微信轮询失败', String(error));
  }

  if (status.upstreamCode === WECHAT_STATUS.waiting) {
    return { isOk: false, code: 801, provider: 'qq', status: 'wait', message: '等待扫码' };
  }
  if (status.upstreamCode === WECHAT_STATUS.scanned) {
    return { isOk: false, code: 802, provider: 'qq', status: 'scanned', message: '已扫码，请在手机上确认' };
  }
  if (status.upstreamCode === WECHAT_STATUS.expired) {
    sessions.delete(sessionKey(uuid));
    return { isOk: false, code: 800, provider: 'qq', status: 'expired', message: '二维码已过期' };
  }
  if (status.upstreamCode === WECHAT_STATUS.refused) {
    sessions.delete(sessionKey(uuid));
    return { isOk: false, code: 803, provider: 'qq', status: 'cancelled', message: '已取消' };
  }
  if (status.upstreamCode !== WECHAT_STATUS.confirmed || !status.code) {
    return retryableCheckFailure('未识别的微信二维码状态', 'unknown-status', { upstreamCode: status.upstreamCode });
  }

  try {
    const credential = await exchangeWechatCredential(status.code);
    const musicKey = String(credential.musickey || '');
    // 🔴 微信凭据的 musicid 是占位的 0，真正的账号 ID 只在 str_musicid 里（见 qqProvider 的同名约定）。
    // 取错字段就会登录成功却落到一个没有歌单的账号上。
    const strMusicId = String(credential.str_musicid ?? '').trim();
    const rawMusicId = String(credential.musicid ?? '').trim();
    const accountId = (strMusicId && strMusicId !== '0' ? strMusicId : '')
      || (rawMusicId && rawMusicId !== '0' ? rawMusicId : '');
    const musicid = accountId.replace(/\D/g, '');
    if (!musicKey || !musicid) throw new Error('微信登录未拿到 musickey/musicid');

    const cookiePairs = [
      'login_type=2',
      // 让 wxuin 与 uin 指向同一个真账号：cookies.js 在 login_type=2 时优先读 wxuin，
      // 其余分支读 uin，两者一致才不会分叉到别的账号。
      `wxuin=${musicid}`,
      `uin=o${musicid}`,
      `qqmusic_uin=o${musicid}`,
      `qm_keyst=${musicKey}`,
      `qqmusic_key=${musicKey}`,
      `tmeLoginType=${WECHAT_LOGIN_TYPE}`,
    ];
    if (accountId) cookiePairs.push(`str_musicid=${accountId}`);
    const sessionData = buildLoginSession(cookiePairs.join('; '));
    // 写新会话前先把上一条通道（可能是 QQ 扫码）的平台凭据清干净：
    // 两者共用 .qq.com 上的同一个 cookie 罐，残留会让会话里混进别人的 uin / musickey。
    await clearQQPlatformSessionCookies();
    await setBrowserCookies('https://y.qq.com/', sessionData.cookie);
    await setBrowserCookies('https://qq.com/', sessionData.cookie);
    await setBrowserCookies('https://graph.qq.com/', sessionData.cookie);
    clearCookieCache();
    // 记住「当前会话是这一串」：getQQCookie 的账号凭据以它为准，否则罐里的旧账号会盖掉新登录。
    await saveProviderCookie('qq', sessionData.cookie);
    sessions.delete(sessionKey(uuid));
    noteQrLoginStep('wx:qr:done:ok');
    return {
      isOk: true,
      message: '登录成功',
      session: sessionData,
      provider: 'qq',
      code: 0,
      status: 'ok',
      loggedIn: true,
      hasCookie: true,
      userId: musicid,
      uin: musicid,
      nickname: String(credential.nick || credential.nickname || `微信用户 ${musicid}`),
    };
  } catch (error) {
    noteQrLoginStep('wx:qr:exchange:failed', { message: error?.message || String(error) });
    return retryableCheckFailure(error?.message || '微信凭证换取失败', String(error));
  }
}

export function qqWechatCancelLoginQr(key) {
  const uuid = String(key || '');
  const session = sessions.get(sessionKey(uuid));
  if (session) session.cancelled = true;
  sessions.delete(sessionKey(uuid));
}

export function resetWechatLoginState() {
  sessions.clear();
}
