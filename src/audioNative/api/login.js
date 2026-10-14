import {
  getLoginInfo as getNeteaseLoginInfo,
  handleLoginQrCheck as handleNeteaseQrCheck,
  handleLoginQrCreate as handleNeteaseQrCreate,
  handleLoginQrKey as handleNeteaseQrKey,
} from './netease.js';
import { getNeteaseCookie } from './cookies.js';
import {
  getQQLoginStatus,
  handleQQLoginQrCheck,
  handleQQLoginQrCreate,
} from './qq.js';
import {
  ensureKGCookie,
  getKGLoginStatus,
  handleKGLoginQrCheck,
  handleKGLoginQrCreate,
  handleKGLoginQrKey,
} from './kugou.js';

const PROVIDERS = new Set(['netease', 'qq', 'kugou']);

function encodeKey(value) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value || {}))));
}

function decodeKey(value) {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(String(value || '')))));
  } catch (_) {
    return {};
  }
}

function normalizeProvider(provider) {
  const normalized = String(provider || '').trim().toLowerCase();
  if (!PROVIDERS.has(normalized)) throw new Error(`Unknown provider: ${provider}`);
  return normalized;
}

async function getNeteaseStatus() {
  const info = await getNeteaseLoginInfo(await getNeteaseCookie());
  return {
    provider: 'netease',
    loggedIn: !!info?.loggedIn,
    userId: info?.userId || '',
    nickname: info?.nickname || '',
    avatar: info?.avatar || '',
    vipLabel: info?.vipLabel || '',
  };
}

async function getQqStatus() {
  const info = await getQQLoginStatus();
  return {
    provider: 'qq',
    loggedIn: !!info?.loggedIn,
    userId: info?.uin || info?.userId || '',
    nickname: info?.nickname || '',
    avatar: info?.avatar || info?.avatarUrl || '',
    vipLabel: info?.vipLabel || '',
  };
}

async function getKugouStatus() {
  const info = await getKGLoginStatus(await ensureKGCookie());
  return {
    provider: 'kugou',
    loggedIn: !!info?.loggedIn,
    userId: info?.userId || info?.userid || '',
    nickname: info?.nickname || '',
    avatar: info?.avatar || info?.avatarUrl || '',
    vipLabel: info?.vipLabel || '',
  };
}

export async function getLoginOverview() {
  const [netease, qq, kugou] = await Promise.all([
    getNeteaseStatus().catch(() => ({ provider: 'netease', loggedIn: false })),
    getQqStatus().catch(() => ({ provider: 'qq', loggedIn: false })),
    getKugouStatus().catch(() => ({ provider: 'kugou', loggedIn: false })),
  ]);
  return { netease, qq, kugou };
}

export async function startProviderLogin(rawProvider) {
  const provider = normalizeProvider(rawProvider);

  if (provider === 'netease') {
    const key = await handleNeteaseQrKey();
    const qr = await handleNeteaseQrCreate(key.key);
    return {
      provider,
      key: encodeKey({ key: key.key }),
      qrimg: qr.qrimg || qr.img || '',
      message: '请使用网易云音乐 App 扫码',
    };
  }

  if (provider === 'qq') {
    const qr = await handleQQLoginQrCreate();
    return {
      provider,
      key: encodeKey({ qrsig: qr.qrsig, ptqrtoken: qr.ptqrtoken }),
      qrimg: qr.qrimg || qr.img || '',
      message: '请使用手机 QQ 扫码',
    };
  }

  const key = await handleKGLoginQrKey();
  const qr = await handleKGLoginQrCreate(key.key || key.unikey);
  return {
    provider,
    key: encodeKey({ key: key.key || key.unikey }),
    qrimg: qr.qrimg || qr.data?.qrimg || '',
    message: '请使用酷狗音乐 App 扫码',
  };
}

export async function pollProviderLogin(rawProvider, encodedKey) {
  const provider = normalizeProvider(rawProvider);
  const key = decodeKey(encodedKey);

  if (provider === 'netease') {
    const result = await handleNeteaseQrCheck(key.key);
    const code = Number(result?.code);
    if (code === 803) {
      return { state: 'confirmed', message: result.message || '登录成功', user: await getNeteaseStatus() };
    }
    if (code === 800) return { state: 'expired', message: result.message || '二维码已过期' };
    if (code === 802) return { state: 'scanned', message: result.message || '已扫码，请在手机上确认' };
    if (code === 801) return { state: 'waiting', message: result.message || '等待扫码' };
    return { state: 'error', message: result?.message || result?.error || '登录检查失败' };
  }

  if (provider === 'qq') {
    const result = await handleQQLoginQrCheck(key.qrsig, key.ptqrtoken);
    if (result?.isOk || result?.loggedIn) {
      return { state: 'confirmed', message: result.message || '登录成功', user: await getQqStatus() };
    }
    if (result?.refresh) return { state: 'expired', message: result.message || '二维码已过期' };
    if (result?.status === 'scanned' || Number(result?.code) === 67) {
      return { state: 'scanned', message: result.message || '已扫码，请在手机上确认' };
    }
    return { state: 'waiting', message: result?.message || '等待扫码' };
  }

  const result = await handleKGLoginQrCheck(key.key);
  const status = Number(result?.status ?? result?.code);
  if (status === 4 || result?.loggedIn) {
    return { state: 'confirmed', message: result.message || '登录成功', user: await getKugouStatus() };
  }
  if (status === 0) return { state: 'expired', message: result.message || '二维码已过期' };
  if (status === 2 || status === 3) return { state: 'scanned', message: result.message || '已扫码，请在手机上确认' };
  if (status === 1) return { state: 'waiting', message: result.message || '等待扫码' };
  return { state: 'error', message: result?.message || '登录检查失败' };
}
