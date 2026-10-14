import { eapiRequest } from './eapi.js';
import { weapiRequest } from './weapi.js';
import { noteLibraryStep, describePayload } from './libraryTrace.js';
import {
  getNeteaseCookie,
  hasNeteaseLogin,
  parseCookieString,
  qqCookieUin,
} from './cookies.js';
import {
  getLoginInfo,
  handleLoginQrCheck,
  handleLoginQrCreate,
  handleLoginQrKey,
  handleSongLike,
  handleSongLikeCheck,
  handleSongUrl,
  handleLyric,
} from './netease.js';
import {
  getQQCookie,
  getQQLoginStatus,
  handleQQLoginQrCreate,
  handleQQLoginQrCheck,
  handleQQSearch,
  handleQQSongUrl,
  handleQQLyric,
  handleQQUserPlaylists,
  handleQQPlaylistTracks,
  qqSongDetail,
  qqMusicRequest,
  qqGetJSON,
  buildQQAuthComm,
  qqSongDetailsBatch,
} from './qq.js';
import {
  qqWechatGetLoginQr,
  qqWechatCheckLoginQr,
  qqWechatCancelLoginQr,
} from './qq-wechat-login.js';
import { clearQQPlatformSessionCookies } from './qq-login-qr.js';
import {
  claimKGYouthDayVip,
  ensureKGCookie,
  getKGYouthUnionVip,
  getKGLoginStatus,
  getKGUserVipDetail,
  handleKGArtistDetail,
  handleKGLoginQrCheck,
  handleKGLoginQrCreate,
  handleKGLoginQrKey,
  handleKGLyric,
  handleKGPlaylistTracks,
  handleKGSearch,
  handleKGSongUrl,
  handleKGUserPlaylists,
  searchKGLyricCandidates,
  downloadKGLyricByCandidate,
  kgPostAndroidSigned,
  upgradeKGYouthDayVip,
} from './kugou.js';
import { handleBodianRequest } from './bodian.js';

function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value) !== '') return value;
  }
  return '';
}

function numberValue(...values) {
  const value = Number(firstValue(...values));
  return Number.isFinite(value) ? value : 0;
}

function parseInput(input) {
  const url = new URL(String(input?.path || input?.operation || '/'), 'https://folia.local');
  Object.entries(input?.query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  });
  let body = input?.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (_) {
      body = {};
    }
  }
  if (!body || typeof body !== 'object') body = {};
  return { url, body, method: String(input?.method || 'GET').toUpperCase() };
}

async function eapiJson(path, data, cookie) {
  const result = await eapiRequest(path, data || {}, cookie || '');
  const body = result?.body || {};
  if (result?.status >= 500) {
    throw new Error(body.message || body.msg || `Netease EAPI ${path} failed (${result.status})`);
  }
  return body;
}

async function weapiJson(path, data, cookie) {
  return await weapiRequest(path, data || {}, cookie || '');
}

function profileFromLoginInfo(info) {
  if (!info?.loggedIn) return null;
  return {
    userId: info.userId || '',
    nickname: info.nickname || 'Netease User',
    avatarUrl: info.avatar || '',
    backgroundUrl: '',
    vipType: info.vipType || 0,
    vipLevel: info.vipLevel || 'none',
  };
}

async function requireLoginInfo(cookie) {
  return await getLoginInfo(cookie);
}

function jsonBody(body) {
  return body && typeof body === 'object' ? body : {};
}

function encodeBridgeKey(value) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value || {}))));
}

function decodeBridgeKey(value) {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(String(value || '')))));
  } catch (_) {
    return {};
  }
}

/** 扫码通道归一：只有 wechat 走微信 Web OAuth，其余（含缺省）都按 qq 处理。 */
function qqChannelOf(value) {
  return String(value || '').toLowerCase() === 'wechat' ? 'wechat' : 'qq';
}

/** 只回报主机名：头像 URL 里带着用户 hash，整条写进报告没有必要。 */
function describeUrlHost(value) {
  try {
    return new URL(String(value)).host || 'empty';
  } catch (_) {
    return 'unparseable';
  }
}

function qqProfile(status) {
  if (!status?.loggedIn) return null;
  return {
    uin: status.uin || status.userId || '',
    str_musicid: status.uin || status.userId || '',
    musicid: status.uin || status.userId || '',
    nickname: status.nickname || status.name || '',
    nick: status.nickname || status.name || '',
    logo: status.avatar || status.avatarUrl || '',
    avatarUrl: status.avatar || status.avatarUrl || '',
    vipType: status.vipType || 0,
  };
}

function qqPlaylistRow(item) {
  return {
    tid: item?.id,
    dirId: Number(item?.dirid || item?.dirId || 0) || undefined,
    dirName: item?.name || '',
    name: item?.name || '',
    songNum: Number(item?.trackCount || 0),
    songnum: Number(item?.trackCount || 0),
    bigpicUrl: item?.cover || '',
    picUrl: item?.cover || '',
    dirShow: 1,
    subscribed: !!item?.subscribed,
  };
}

function kgCollectionRow(item) {
  const data = item?.providerData || {};
  return {
    listid: data.listId || item?.id,
    list_id: data.listId || item?.id,
    global_collection_id: data.globalCollectionId || item?.id,
    specialid: data.specialId,
    name: item?.name || '',
    listname: item?.name || '',
    song_count: item?.trackCount,
    count: item?.trackCount,
    img: item?.coverUrl || '',
    cover: item?.coverUrl || '',
    type: item?.type === 'album' ? 1 : 0,
    source: item?.type === 'album' ? 2 : 1,
    is_pri: item?.isOwned ? 0 : 1,
    create_userid: data.creatorUserId,
    list_create_userid: data.creatorUserId,
    list_create_listid: data.creatorListId,
    list_create_gid: data.creatorGid,
  };
}

function mergeOperationParams(input, url) {
  return {
    ...Object.fromEntries(url.searchParams.entries()),
    ...(input?.params || {}),
    ...(input?.body && typeof input.body === 'object' ? input.body : {}),
  };
}

function pathSegments(url) {
  return String(url.pathname || '')
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
}

function qqGtk(cookieHeader) {
  const cookie = parseCookieString(cookieHeader);
  const key = cookie.qm_keyst || cookie.qqmusic_key || cookie.skey || cookie.p_skey || '';
  if (!key) return 5381;
  let hash = 5381;
  for (let index = 0; index < key.length; index += 1) {
    hash += (hash << 5) + key.charCodeAt(index);
    hash &= 0x7fffffff;
  }
  return hash & 0x7fffffff;
}

async function handleLoginStatus(cookie) {
  const info = await requireLoginInfo(cookie);
  return {
    code: 200,
    data: {
      code: 200,
      account: info.loggedIn ? { id: info.userId || null } : null,
      profile: profileFromLoginInfo(info),
    },
  };
}

async function handleUserAccount(cookie) {
  const info = await requireLoginInfo(cookie);
  return {
    code: 200,
    account: info.loggedIn ? {
      id: info.userId || null,
      userName: info.nickname || '',
      type: 1,
      status: 0,
    } : null,
    profile: profileFromLoginInfo(info),
  };
}

async function handleSearch(url, cookie) {
  const keywords = String(firstValue(url.searchParams.get('keywords'), url.searchParams.get('s'))).trim();
  if (!keywords) return { code: 200, result: { songs: [], songCount: 0 } };
  const limit = Math.max(1, Math.min(100, numberValue(url.searchParams.get('limit'), 30)));
  const offset = Math.max(0, numberValue(url.searchParams.get('offset'), 0));
  const body = await eapiJson('/api/cloudsearch/pc', {
    s: keywords,
    type: 1,
    limit,
    offset,
    total: true,
  }, cookie);
  if (Array.isArray(body?.result?.songs) && body.result.songs.length > 0) return body;
  const fallback = await eapiJson('/api/search/pc', {
    s: keywords,
    type: 1,
    limit,
    offset,
  }, cookie);
  if (Array.isArray(fallback?.result?.songs) && fallback.result.songs.length > 0) return fallback;

  const response = await fetch('https://music.163.com/api/search/get/web', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: 'https://music.163.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: new URLSearchParams({
      s: keywords,
      type: '1',
      limit: String(limit),
      offset: String(offset),
      total: 'true',
    }).toString(),
  });
  if (!response.ok) return { code: response.status, result: { songs: [], songCount: 0 } };
  const publicBody = await response.json();
  return publicBody?.result ? publicBody : { code: 200, result: { songs: [], songCount: 0 } };
}

async function handleSongDetail(url, cookie) {
  const ids = String(firstValue(url.searchParams.get('ids'), url.searchParams.get('id')))
    .split(',')
    .map((id) => Number(id.trim()))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) return { code: 200, songs: [], privileges: [] };
  const detail = await eapiJson('/api/v3/song/detail', {
    c: JSON.stringify(ids.map((id) => ({ id }))),
  }, cookie);
  return {
    ...detail,
    code: Number(detail.code) || 200,
    songs: Array.isArray(detail.songs) ? detail.songs : [],
    privileges: Array.isArray(detail.privileges) ? detail.privileges : [],
  };
}

async function handleSongUrlV1(url, cookie) {
  const ids = String(firstValue(url.searchParams.get('id'), url.searchParams.get('ids')))
    .split(',')
    .map((id) => Number(id.trim()))
    .filter((id) => Number.isFinite(id) && id > 0);
  const level = String(firstValue(url.searchParams.get('level'), 'exhigh'));
  if (!ids.length) return { code: 200, data: [] };
  const data = await Promise.all(ids.map(async (id) => {
    const result = await handleSongUrl(id, cookie, level);
    const format = String(result?.format || (/^(lossless|hires|jymaster)$/.test(String(result?.level || level)) ? 'flac' : 'mp3'));
    return {
      id,
      url: result?.url || null,
      br: result?.br || 0,
      size: 0,
      md5: null,
      code: result?.url ? 200 : 404,
      expi: 1200,
      type: format,
      gain: 0,
      peak: 0,
      fee: 0,
      uf: null,
      payed: 0,
      flag: 0,
      canExtend: false,
      freeTrialInfo: result?.trial ? { start: 0, end: 0 } : null,
      level: result?.level || level,
      encodeType: format,
      channelLayout: null,
      freeTrialPrivilege: result?.restriction ? { resConsumable: false, userConsumable: false } : null,
      freeTimeTrialPrivilege: null,
      urlSource: 0,
      rightSource: 0,
      podcastCid: null,
      effectTypes: null,
      time: 0,
    };
  }));
  return { code: 200, data };
}

async function handleLyricNew(url, cookie) {
  const id = firstValue(url.searchParams.get('id'), url.searchParams.get('ids'));
  if (!id) return { code: 200, lrc: { lyric: '' }, tlyric: { lyric: '' }, yrc: { lyric: '' } };
  let body = {};
  try {
    body = await eapiJson('/api/song/lyric/v1', {
      id,
      cp: false,
      tv: 0,
      lv: 0,
      rv: 0,
      kv: 0,
      yv: 0,
      ytv: 0,
      yrv: 0,
    }, cookie);
  } catch (_) {
    const fallback = await handleLyric(id, cookie);
    body = {
      lrc: { lyric: fallback?.lyric || '' },
      tlyric: { lyric: fallback?.tlyric || '' },
      yrc: { lyric: fallback?.yrc || '' },
    };
  }
  return {
    ...body,
    code: Number(body.code) || 200,
    lrc: body.lrc || { lyric: '' },
    tlyric: body.tlyric || { lyric: '' },
    yrc: body.yrc || { lyric: '' },
  };
}

async function handleUserPlaylists(url, cookie) {
  const info = await requireLoginInfo(cookie);
  const uid = numberValue(url.searchParams.get('uid'), info.userId);
  if (!info.loggedIn || !uid) return { code: 200, playlist: [], more: false };
  const body = await eapiJson('/api/user/playlist', {
    uid,
    limit: numberValue(url.searchParams.get('limit'), 50),
    offset: numberValue(url.searchParams.get('offset'), 0),
  }, cookie);
  return {
    ...body,
    code: Number(body.code) || 200,
    playlist: Array.isArray(body.playlist) ? body.playlist : [],
  };
}

async function handlePlaylistDetail(url, cookie) {
  const id = firstValue(url.searchParams.get('id'), url.searchParams.get('pid'));
  if (!id) return { code: 200, playlist: null };
  const body = await eapiJson('/api/v6/playlist/detail', { id, n: 1000, s: 8 }, cookie);
  return { ...body, code: Number(body.code) || 200 };
}

async function handlePlaylistTrackAll(url, cookie) {
  const detail = await handlePlaylistDetail(url, cookie);
  const playlist = detail?.playlist || {};
  return {
    code: Number(detail.code) || 200,
    songs: Array.isArray(playlist.tracks) ? playlist.tracks : [],
    privileges: Array.isArray(playlist.privileges) ? playlist.privileges : [],
    playlist,
  };
}

async function handleArtistDetail(url, cookie) {
  const id = firstValue(url.searchParams.get('id'), url.searchParams.get('artistId'));
  if (!id) return { code: 200, data: null };
  const body = await eapiJson('/api/artist/head/info/get', { id }, cookie);
  return { ...body, code: Number(body.code) || 200 };
}

async function handleArtistTopSongs(url, cookie) {
  const id = firstValue(url.searchParams.get('id'), url.searchParams.get('artistId'));
  if (!id) return { code: 200, songs: [], privileges: [] };
  const body = await eapiJson('/api/artist/top/song', { id }, cookie);
  return {
    ...body,
    code: Number(body.code) || 200,
    songs: Array.isArray(body.songs) ? body.songs : [],
    privileges: Array.isArray(body.privileges) ? body.privileges : [],
  };
}

async function handleArtistSongs(url, cookie) {
  const id = firstValue(url.searchParams.get('id'), url.searchParams.get('artistId'));
  if (!id) return { code: 200, songs: [], privileges: [] };
  const body = await eapiJson('/api/v1/artist/songs', {
    id,
    order: String(firstValue(url.searchParams.get('order'), 'hot')),
    limit: numberValue(url.searchParams.get('limit'), 50),
    offset: numberValue(url.searchParams.get('offset'), 0),
  }, cookie);
  return {
    ...body,
    code: Number(body.code) || 200,
    songs: Array.isArray(body.songs) ? body.songs : [],
    privileges: Array.isArray(body.privileges) ? body.privileges : [],
  };
}

async function handleArtistAlbums(url, cookie) {
  const id = firstValue(url.searchParams.get('id'), url.searchParams.get('artistId'));
  if (!id) return { code: 200, hotAlbums: [], more: false };
  const body = await weapiJson(`/api/artist/albums/${id}`, {
    limit: numberValue(url.searchParams.get('limit'), 30),
    offset: numberValue(url.searchParams.get('offset'), 0),
    total: true,
  }, cookie);
  return {
    ...body,
    code: Number(body.code) || 200,
    hotAlbums: Array.isArray(body.hotAlbums) ? body.hotAlbums : [],
    more: !!body.more,
  };
}

async function handleAlbum(url, cookie) {
  const id = firstValue(url.searchParams.get('id'), url.searchParams.get('albumId'));
  if (!id) return { code: 200, album: null, songs: [] };
  const body = await weapiJson(`/api/v1/album/${id}`, {}, cookie);
  return {
    ...body,
    code: Number(body.code) || 200,
    songs: Array.isArray(body.songs) ? body.songs : [],
    privileges: Array.isArray(body.privileges) ? body.privileges : [],
  };
}

async function handleLikedList(url, cookie) {
  const info = await requireLoginInfo(cookie);
  if (!info.loggedIn || !info.userId) return { code: 200, ids: [] };
  const body = await weapiJson('/api/song/like/get', { uid: info.userId }, cookie);
  const ids = body?.ids || body?.data?.ids || [];
  return { ...body, code: Number(body.code) || 200, ids: Array.isArray(ids) ? ids : [] };
}

async function handleLike(url, body, cookie) {
  const id = firstValue(url.searchParams.get('id'), body.id);
  const like = String(firstValue(url.searchParams.get('like'), body.like, 'true')) !== 'false';
  return await handleSongLike(id, like, cookie);
}

async function handleLikeCheck(url, cookie) {
  const ids = String(firstValue(url.searchParams.get('ids'), url.searchParams.get('id')))
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return await handleSongLikeCheck(ids, cookie);
}

async function handleDailyRecommend(url, cookie) {
  const afresh = String(firstValue(url.searchParams.get('afresh'), 'false')) === 'true';
  const paths = afresh
    ? ['/api/v3/discovery/recommend/songs', '/api/recommend/songs']
    : ['/api/v3/discovery/recommend/songs'];
  let lastError = null;
  for (const path of paths) {
    try {
      return await eapiJson(path, {}, cookie);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Daily recommendation request failed');
}

async function handleHistoryRecommend(url, cookie) {
  const date = url.searchParams.get('date');
  const path = date ? '/api/history/recommend/songs/detail' : '/api/history/recommend/songs';
  return await eapiJson(path, date ? { date } : {}, cookie);
}

async function handlePersonalFm(url, cookie) {
  const mode = url.searchParams.get('mode');
  if (!mode || mode === 'DEFAULT') {
    return await eapiJson('/api/v1/radio/get', {}, cookie);
  }
  const body = { mode };
  const submode = url.searchParams.get('submode');
  if (submode) body.submode = submode;
  try {
    const result = await eapiJson('/api/personal/fm/mode', body, cookie);
    if (Array.isArray(result?.data) && result.data.length) return result;
  } catch (_) {}
  return await eapiJson('/api/v1/radio/get', {}, cookie);
}

async function handlePlaylistTracks(url, body, cookie) {
  const op = String(firstValue(url.searchParams.get('op'), body.op, 'add'));
  const pid = firstValue(url.searchParams.get('pid'), body.pid);
  const tracks = firstValue(url.searchParams.get('tracks'), body.tracks);
  return await eapiJson('/api/playlist/tracks', { op, pid, tracks }, cookie);
}

async function handleSubscribe(url, body, cookie, path) {
  const id = firstValue(url.searchParams.get('id'), body.id);
  const t = numberValue(url.searchParams.get('t'), body.t, 1);
  return await eapiJson(path, { id, t }, cookie);
}

async function handleFoliaQqRequest(input, url) {
  const operation = String(input.operation || url.pathname);
  const params = mergeOperationParams(input, url);
  const segments = pathSegments(url);
  const cookie = await getQQCookie();
  const cookieObject = parseCookieString(cookie || '');
  noteLibraryStep('qq', 'request', {
    operation,
    hasUin: Boolean(qqCookieUin(cookie || '')),
    hasMusicKey: Boolean(
      cookieObject.qm_keyst || cookieObject.qqmusic_key || cookieObject.music_key,
    ),
    cookieCount: String(cookie || '').split(';').filter(Boolean).length,
  });
  try {
    const result = await routeFoliaQqRequest(operation, params, segments, url, cookie);
    noteLibraryStep('qq', 'result', {
      operation,
      code: result && typeof result === 'object' ? result.code : undefined,
      songs: Array.isArray(result?.songs) ? result.songs.length : undefined,
      playlist: Array.isArray(result?.playlist) ? result.playlist.length : undefined,
      albums: Array.isArray(result?.albums) ? result.albums.length : undefined,
      total: result && typeof result === 'object' ? result.total : undefined,
      keys: describePayload(result && typeof result === 'object' ? result : null),
    });
    return result;
  } catch (error) {
    noteLibraryStep('qq', 'error', {
      operation,
      name: error && error.name ? error.name : 'Error',
      message: error && error.message ? error.message : String(error),
    });
    throw error;
  }
}

async function routeFoliaQqRequest(operation, params, segments, url, cookie) {

  if (operation === 'login_channels') {
    // 本地桥同时支持两条扫码通道：qq（ptlogin + MQTT）与 wechat（微信 OAuth + musicu）。
    return { code: 200, data: { channels: ['qq', 'wechat'] } };
  }
  if (operation === 'login_status') {
    const status = await getQQLoginStatus(cookie);
    const profile = qqProfile(status);
    // 「用户名 / 头像不显示」时，报告里必须能直接看出是登录态没认出来，还是上游资料页没给这两个字段。
    noteLibraryStep('qq', 'login-status:profile', {
      loggedIn: Boolean(status?.loggedIn),
      uinTail: status?.uin ? `…${String(status.uin).slice(-4)}` : 'missing',
      nickname: profile?.nickname ? `present(len=${String(profile.nickname).length})` : 'missing',
      avatar: profile?.logo ? describeUrlHost(profile.logo) : 'missing',
      source: status?.profileSource || 'unknown',
      profileUnavailable: Boolean(status?.profileUnavailable),
      missing: status?.missing
        ? Object.entries(status.missing).filter(([, absent]) => absent).map(([key]) => key).join(',') || 'none'
        : undefined,
    });
    return {
      code: 200,
      data: {
        profile,
        account: status?.loggedIn ? { id: status.uin || status.userId || null } : null,
      },
    };
  }
  if (operation === 'user_detail') {
    const status = await getQQLoginStatus(cookie);
    return { code: 200, profile: qqProfile(status) };
  }
  if (operation === 'logout') {
    // 登出必须连 cookie 罐里的平台凭据一起清掉：只清前端会话的话，
    // 下一条通道登录（微信 → QQ 这种）会把旧凭据当成自己的拼出一个用不了的会话。
    await clearQQPlatformSessionCookies();
    return { code: 200 };
  }
  if (operation === 'login_qr_key') {
    const channel = qqChannelOf(firstValue(params.channel, url.searchParams.get('channel')));
    const qr = channel === 'wechat'
      ? await qqWechatGetLoginQr()
      : await handleQQLoginQrCreate();
    const key = encodeBridgeKey({
      channel,
      qrsig: qr.qrsig,
      ptqrtoken: qr.ptqrtoken,
      qrimg: qr.qrimg || qr.img,
    });
    return { code: 200, data: { code: 200, unikey: key } };
  }
  if (operation === 'login_qr_create') {
    const key = decodeBridgeKey(firstValue(params.key, url.searchParams.get('key')));
    return {
      code: 200,
      data: {
        qrimg: key.qrimg || '',
        qrurl: '',
      },
    };
  }
  if (operation === 'login_qr_check') {
    const key = decodeBridgeKey(firstValue(params.key, url.searchParams.get('key')));
    const result = key.channel === 'wechat'
      ? await qqWechatCheckLoginQr({ qrsig: key.qrsig, ptqrtoken: key.ptqrtoken })
      : await handleQQLoginQrCheck(key.qrsig, key.ptqrtoken);
    if (result?.isOk || result?.loggedIn) {
      return { code: 803, message: result.message || 'Login successful', cookie: '' };
    }
    if (result?.refresh) return { code: 800, message: result.message || 'QR expired' };
    if (result?.status === 'scanned' || Number(result?.code) === 67 || Number(result?.code) === 802) {
      return { code: 802, message: result.message || 'Scanned' };
    }
    // 上游已经确认、换票却连续失败：这是终态错误，不能再当成「等待扫码」吞掉 ——
    // 否则界面会一直转圈，而手机上早就提示登录成功了。
    if (result?.retryable === false && result?.status === 'error') {
      return {
        code: 0,
        message: result.message || '登录失败',
        failureStage: result.failureStage,
        failureReason: result.failureReason,
        ticketExchangeAttempts: result.ticketExchangeAttempts,
      };
    }
    return { code: 801, message: result?.message || 'Waiting for scan' };
  }
  if (operation === 'login_qr_cancel') {
    const key = decodeBridgeKey(firstValue(params.key, url.searchParams.get('key')));
    if (key.channel === 'wechat') qqWechatCancelLoginQr(key.qrsig);
    return { code: 200 };
  }
  if (operation === 'music_play') {
    const songmid = firstValue(params.songmid, segments[segments.length - 1]);
    const result = await handleQQSongUrl(
      songmid,
      firstValue(params.mediaId, params.media_mid),
      firstValue(params.quality, '320'),
      cookie,
    );
    return {
      code: 200,
      data: {
        playUrl: {
          [songmid]: {
            url: result?.url || '',
            error: result?.error || '',
            message: result?.message || '',
          },
        },
        sip: [],
      },
    };
  }
  if (operation === 'song_info') {
    const songmid = firstValue(params.songmid, segments[1], segments[0]);
    const track = await qqSongDetail(songmid, params, cookie);
    return {
      code: 0,
      response: {
        code: 0,
        songinfo: { data: { track_info: track } },
      },
    };
  }
  if (operation === 'song_list_detail') {
    const disstid = firstValue(params.disstid, segments[segments.length - 1]);
    const result = await handleQQPlaylistTracks(disstid, cookie, {
      dirid: params.dirid,
      hostUin: params.hostUin,
    });
    return {
      code: 0,
      response: {
        code: 0,
        cdlist: [{
          disstid,
          dissname: result?.playlist?.name || result?.name || '',
          logo: result?.playlist?.cover || result?.cover || '',
          songlist: result?.songs || [],
          total_song_num: Number(result?.playlist?.trackCount || result?.songs?.length || 0),
        }],
      },
    };
  }
  if (operation === 'user_playlist') {
    try {
      const result = await handleQQUserPlaylists(cookie);
      const playlist = (result?.playlists || []).map(qqPlaylistRow);
      noteLibraryStep('qq', 'playlists', {
        count: playlist.length,
        keys: describePayload(result),
      });
      return { code: 0, playlist, total: playlist.length, more: false };
    } catch (error) {
      noteLibraryStep('qq', 'playlists:error', {
        message: error && error.message ? error.message : String(error),
      });
      throw error;
    }
  }
  if (operation === 'user_liked_songs') {
    const offset = numberValue(params.offset, 0);
    const limit = Math.min(100, Math.max(1, numberValue(params.limit, 100)));
    const uin = qqCookieUin(cookie);
    noteLibraryStep('qq', 'liked:start', { offset, limit, hasUin: Boolean(uin) });

    // DissInfo is the only endpoint that returns complete song records (name,
    // artists, album, duration) in one call, so ask it first. The map-based
    // path below only yields mids and used to leave every row unnamed.
    try {
      const cookieObject = parseCookieString(cookie);
      const encryptedUin = firstValue(
        cookieObject.encryptUin,
        cookieObject.encrypt_uin,
        cookieObject.str_musicid,
        cookieObject.wxuin,
        uin,
      );
      const json = await qqMusicRequest({
        comm: buildQQAuthComm(cookie),
        req_0: {
          module: 'music.srfDissInfo.DissInfo',
          method: 'CgiGetDiss',
          param: {
            disstid: 0,
            dirid: 201,
            tag: true,
            song_begin: offset,
            song_num: limit,
            userinfo: true,
            orderlist: true,
            enc_host_uin: String(encryptedUin || ''),
          },
        },
      }, cookie);
      const block = json?.req_0 || {};
      const data = block.data || {};
      const songs = data.songlist || data.songList || [];
      const total = numberValue(data.total_song_num, data.total, data.song_num, songs.length);
      noteLibraryStep('qq', 'liked:path2', {
        code: Number(block.code) || 0,
        songCount: Array.isArray(songs) ? songs.length : 0,
        total,
        keys: describePayload(data),
      });
      if (Array.isArray(songs) && songs.length) {
        return {
          code: Number(block.code) || 0,
          songs,
          total,
          more: Boolean(data.hasmore) || offset + songs.length < total,
        };
      }
    } catch (error) {
      noteLibraryStep('qq', 'liked:path2:error', {
        message: error && error.message ? error.message : String(error),
      });
    }

    try {
      const fav = await qqGetJSON('https://c.y.qq.com/splcloud/fcgi-bin/fcg_musiclist_getmyfav.fcg', {
        dirid: 201,
        dirinfo: 1,
        g_tk: qqGtk(cookie),
        format: 'json',
        loginUin: uin,
        hostUin: uin,
      }, cookie);
      const midMap = fav?.mapmid || fav?.data?.mapmid || {};
      const idMap = fav?.map || fav?.data?.map || {};
      const allMids = Object.keys(midMap).filter(Boolean);
      noteLibraryStep('qq', 'liked:path1', {
        code: fav?.code,
        midCount: allMids.length,
        keys: describePayload(fav),
      });
      if (allMids.length) {
        const pageMids = allMids.slice(offset, offset + limit);
        const songs = pageMids.map((mid) => ({
          mid,
          songmid: mid,
          id: midMap[mid] || idMap[mid],
        }));
        await qqSongDetailsBatch(songs, cookie);
        return {
          code: 0,
          songs,
          total: allMids.length,
          more: offset + songs.length < allMids.length,
        };
      }
    } catch (error) {
      noteLibraryStep('qq', 'liked:path1:error', {
        message: error && error.message ? error.message : String(error),
      });
    }

    try {
      const json = await qqMusicRequest({
        comm: buildQQAuthComm(cookie),
        req_0: {
          module: 'music.musicasset.PlaylistFavRead',
          method: 'GetSongList',
          param: {
            dirId: 201,
            uin: Number(uin) || uin,
            order: 1,
            begin: offset,
            num: limit,
          },
        },
      }, cookie);
      const block = json?.req_0 || {};
      const data = block.data || {};
      const songs = data.songlist || data.songList || data.list || [];
      noteLibraryStep('qq', 'liked:path3', {
        code: Number(block.code) || 0,
        subcode: block.subcode,
        songCount: Array.isArray(songs) ? songs.length : 0,
        total: numberValue(data.total, data.total_song_num, data.totalSongNum, 0),
        keys: describePayload(data),
      });
      return {
        code: Number(block.code) || 0,
        songs: Array.isArray(songs) ? songs : [],
        total: numberValue(data.total, data.total_song_num, data.totalSongNum, songs.length),
        more: Array.isArray(songs) && songs.length >= limit,
      };
    } catch (error) {
      noteLibraryStep('qq', 'liked:path3:error', {
        message: error && error.message ? error.message : String(error),
      });
      return { code: 0, songs: [], total: 0, more: false };
    }
  }
  if (operation === 'user_playlist_detail') {
    const result = await handleQQPlaylistTracks(firstValue(params.tid, params.id), cookie, {
      dirid: params.dirid,
      hostUin: params.hostUin,
    });
    return {
      code: 0,
      songs: result?.songs || [],
      total: result?.songs?.length || 0,
      more: false,
    };
  }
  if (operation === 'user_albums') {
    const offset = Math.max(0, numberValue(params.offset, 0));
    const limit = Math.min(100, Math.max(1, numberValue(params.limit, 20)));
    const uin = qqCookieUin(cookie);
    const json = await qqGetJSON('https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg', {
      ct: 20,
      cid: 205360956,
      userid: uin,
      reqtype: 2,
      sin: offset,
      ein: offset + limit - 1,
      format: 'json',
    }, cookie);
    const data = json?.data || json || {};
    const albums = data.albumlist || data.cdlist || data.list || data.albums || [];
    const total = numberValue(data.totalalbum, data.total_album, data.total, data.album_total, albums.length);
    return {
      code: Number(json?.code) || 0,
      albums: Array.isArray(albums) ? albums : [],
      total,
      more: offset + (Array.isArray(albums) ? albums.length : 0) < total,
    };
  }
  if (operation === 'album_info') {
    const albummid = firstValue(params.albummid, segments[segments.length - 1]);
    const json = await qqGetJSON(
      'https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg',
      { albummid, format: 'json', outCharset: 'utf-8' },
      cookie,
    );
    return { code: 0, response: { code: Number(json?.code) || 0, data: json?.data || {} } };
  }
  if (operation === 'artist_songs') {
    const singermid = firstValue(params.singermid, segments[segments.length - 1]);
    const limit = numberValue(params.limit, 30);
    const page = numberValue(params.page, 1);
    const json = await qqMusicRequest({
      comm: { ct: 24, cv: 0 },
      singer: {
        module: 'music.web_singer_info_svr',
        method: 'get_singer_detail_info',
        param: { sort: 5, singermid, sin: Math.max(0, (page - 1) * limit), num: limit },
      },
    }, cookie);
    return { code: 0, response: { singer: json?.singer || { code: 0, data: {} } } };
  }
  if (operation === 'artist_albums') {
    const singermid = firstValue(params.singermid, segments[segments.length - 1]);
    const limit = numberValue(params.limit, 30);
    const page = numberValue(params.page, 0);
    const json = await qqMusicRequest({
      comm: { ct: 24, cv: 0 },
      singer: {
        module: 'music.musichallAlbum.AlbumListServer',
        method: 'GetAlbumList',
        param: { sort: 5, singermid, begin: page, num: limit },
      },
    }, cookie);
    return { code: 0, response: { singer: json?.singer || { code: 0, data: {} } } };
  }

  return {
    __foliaBridgeError: 'UNSUPPORTED',
    provider: 'qq',
    operation,
    message: `Folia QQ bridge does not implement ${operation}`,
  };
}

async function handleFoliaKugouRequest(input, url) {
  const operation = String(input.operation || url.pathname);
  const params = mergeOperationParams(input, url);
  const cookie = await ensureKGCookie();

  if (operation === 'register_dev') {
    return { status: 1, error_code: 0, data: { dfid: params.dfid || '' } };
  }
  if (operation === 'login_qr_key') return await handleKGLoginQrKey();
  if (operation === 'login_qr_create') {
    return await handleKGLoginQrCreate(firstValue(params.key, params.qrcode));
  }
  if (operation === 'login_qr_check') {
    return await handleKGLoginQrCheck(firstValue(params.key, params.qrcode));
  }
  if (operation === 'logout') {
    return { status: 1, error_code: 0, code: 200 };
  }
  if (operation === 'user_detail') {
    const info = await getKGLoginStatus(cookie);
    return {
      status: 1,
      error_code: 0,
      data: {
        user_info: {
          userid: info?.userId || info?.userid || '',
          nickname: info?.nickname || '',
          pic: info?.avatar || info?.avatarUrl || '',
          vip_type: info?.vipType || 0,
        },
      },
    };
  }
  if (operation === 'user_vip_detail') {
    return await getKGUserVipDetail(cookie);
  }
  if (operation === 'search') {
    const limit = numberValue(params.pagesize, params.limit, 16);
    const page = numberValue(params.page, 1);
    const songs = await handleKGSearch(
      firstValue(params.keywords, params.keyword),
      limit,
      cookie,
      page,
    );
    return { status: 1, error_code: 0, data: { lists: songs, total: songs.length } };
  }
  if (operation === 'audio' || operation === 'krm_audio') {
    const hash = String(firstValue(params.hash, params.id)).toLowerCase();
    const info = await handleKGSongUrl(hash, params.album_id, params.album_audio_id, 'standard', cookie, {});
    return {
      status: 1,
      error_code: 0,
      data: {
        hash,
        FileHash: hash,
        url: info?.url || '',
        play_url: info?.url || '',
      },
    };
  }
  if (operation === 'song_url' || operation === 'user_cloud_url') {
    const result = await handleKGSongUrl(
      firstValue(params.hash, params.id),
      params.album_id,
      params.album_audio_id,
      params.quality,
      cookie,
      {
        hash320: params.hash320 || params.hash_320,
        hashSq: params.hashSq || params.hash_sq || params.sqhash,
      },
    );
    return {
      status: 1,
      error_code: result?.url ? 0 : 20027,
      data: {
        play_url: result?.url || '',
        url: result?.url || '',
        level: result?.level || 'standard',
        volume: 0,
      },
      ...result,
    };
  }
  if (operation === 'search_lyric') {
    const candidates = await searchKGLyricCandidates(
      firstValue(params.hash, params.id),
      params.album_audio_id,
      numberValue(params.duration, 0),
      params.keyword || params.keywords || '',
    );
    return { status: 1, error_code: 0, candidates };
  }
  if (operation === 'lyric') {
    const content = await downloadKGLyricByCandidate({
      id: firstValue(params.id, params.lyric_id),
      accesskey: params.accesskey,
    });
    return { status: 1, error_code: 0, decodeContent: content, content };
  }
  if (operation === 'song_climax') {
    return { status: 1, error_code: 0, data: [] };
  }
  if (operation === 'user_playlist') {
    const result = await handleKGUserPlaylists(cookie, numberValue(params.pagesize, 100));
    const lists = (result?.playlists || []).map(kgCollectionRow);
    return {
      status: 1,
      error_code: 0,
      data: { lists, total: lists.length, count: lists.length },
    };
  }
  if (operation === 'playlist_track_all') {
    const result = await handleKGPlaylistTracks(
      firstValue(params.id, params.global_collection_id),
      cookie,
      params.globalCollectionId,
    );
    const songs = result?.songs || result?.tracks || [];
    return {
      status: 1,
      error_code: 0,
      data: { songs, info: songs, total: songs.length, count: songs.length },
    };
  }
  if (operation === 'playlist_detail') {
    const result = await handleKGPlaylistTracks(firstValue(params.ids, params.id), cookie);
    const playlist = result?.playlist || {};
    const row = {
      listid: playlist.id,
      list_id: playlist.id,
      global_collection_id: playlist.id,
      name: playlist.name,
      listname: playlist.name,
      song_count: playlist.trackCount,
      count: playlist.trackCount,
      img: playlist.cover,
      cover: playlist.cover,
    };
    return { status: 1, error_code: 0, data: { info: [row], list: [row], ...row } };
  }
  if (operation === 'album_detail') {
    const id = firstValue(params.id, params.album_id);
    const body = await kgPostAndroidSigned(
      'https://openapi.kugou.com',
      '/kmr/v2/albums',
      cookie,
      {
        data: [{ album_id: String(id) }],
        is_buy: numberValue(params.is_buy, 0),
        fields: 'album_id,album_name,publish_date,sizable_cover,intro,language,is_publish,heat,type,quality,authors,exclusive,author_name,trans_param',
      },
      {},
      { 'x-router': 'openapi.kugou.com', 'kg-tid': '255' },
    );
    return body || { status: 0, error_code: 20017, data: { info: [], list: [] } };
  }
  if (operation === 'album_songs') {
    const id = firstValue(params.id, params.album_id);
    const body = await kgPostAndroidSigned(
      'https://openapi.kugou.com',
      '/v1/album_audio/lite',
      cookie,
      {
        album_id: String(id),
        is_buy: firstValue(params.is_buy, ''),
        page: numberValue(params.page, 1),
        pagesize: numberValue(params.pagesize, 30),
      },
      {},
      { 'x-router': 'openapi.kugou.com', 'kg-tid': '255' },
    );
    return body || { status: 0, error_code: 20017, data: { info: [], list: [], songs: [], total: 0 } };
  }
  if (operation === 'artist_albums') {
    const id = firstValue(params.id, params.author_id);
    const body = await kgPostAndroidSigned(
      'https://openapi.kugou.com',
      '/kmr/v1/author/albums',
      cookie,
      {
        author_id: String(id),
        pagesize: numberValue(params.pagesize, 30),
        page: numberValue(params.page, 1),
        sort: 1,
        category: 1,
        area_code: 'all',
      },
      {},
      { 'x-router': 'openapi.kugou.com', 'kg-tid': '36' },
    );
    return body || { status: 0, error_code: 20017, data: { info: [], list: [], total: 0 } };
  }
  if (operation === 'artist_detail' || operation === 'artist_audios') {
    const result = await handleKGArtistDetail(
      firstValue(params.id, params.singerid),
      params.name,
      numberValue(params.pagesize, params.limit, 36),
    );
    if (operation === 'artist_detail') {
      return { status: 1, error_code: 0, data: result?.artist || {} };
    }
    const items = result?.songs || [];
    return {
      status: 1,
      error_code: 0,
      data: { info: items, list: items, songs: items, total: items.length },
    };
  }
  if (operation === 'everyday_recommend') {
    // 每日推荐：POST /everyday_song_recommend（android 签名 + x-router everydayrec.service.kugou.com），
    // 与 KuGouMusicApi 的 module/everyday_recommend.js 一致。以前这里是「成功 + 空数组」的占位实现，
    // 界面拿到的是「成功但一首都没有」，所以每日推荐永远是空的 —— 不是没登录，也不是网络问题。
    const body = await kgPostAndroidSigned(
      'https://gateway.kugou.com',
      '/everyday_song_recommend',
      cookie,
      { platform: 'ios' },
      {},
      { 'x-router': 'everydayrec.service.kugou.com' },
    );
    const data = (body && body.data) || body || {};
    const songs = Array.isArray(data.song_list) ? data.song_list
      : Array.isArray(data.songs) ? data.songs
      : Array.isArray(data.info) ? data.info
      : [];
    return {
      status: 1,
      error_code: 0,
      data: { ...data, info: songs, songs, total: data.total || songs.length },
    };
  }
  if (operation === 'personal_fm' || operation === 'top_card_youth') {
    // 仍未实现（见本文件顶部说明）：私人 FM 与青年卡还没有对应实现，先保持空。
    return { status: 1, error_code: 0, data: { info: [], songs: [], lists: [], total: 0 } };
  }
  if (operation === 'everyday_history') {
    return { status: 1, error_code: 0, data: { info: [], list: [], total: 0 } };
  }
  if (operation === 'user_cloud') {
    return { status: 1, error_code: 0, data: { info: [], songs: [], total: 0 } };
  }
  if (operation === 'youth_union_vip') return await getKGYouthUnionVip(cookie);
  if (operation === 'youth_day_vip') return await claimKGYouthDayVip(cookie, params.receive_day);
  if (operation === 'youth_day_vip_upgrade') {
    return await upgradeKGYouthDayVip(cookie, firstValue(params.userid, params.kugouid));
  }

  return {
    __foliaBridgeError: 'UNSUPPORTED',
    provider: 'kugou',
    operation,
    message: `Folia KuGou bridge does not implement ${operation}`,
  };
}

export async function handleFoliaApiRequest(input) {
  const { url, body, method } = parseInput(input);
  if (input?.provider === 'bodian') {
    return await handleBodianRequest(String(input.operation || ''), input.params || body || {});
  }
  if (input?.provider === 'qq') {
    return await handleFoliaQqRequest(input, url);
  }
  if (input?.provider === 'kugou') {
    return await handleFoliaKugouRequest(input, url);
  }
  if (input?.provider === 'qq_raw') {
    if (input.operation !== 'musicu') {
      return { __foliaBridgeError: 'UNSUPPORTED', message: `Unknown QQ raw operation: ${input.operation}` };
    }
    return await qqMusicRequest(body, await getQQCookie());
  }
  const cookie = await getNeteaseCookie();
  const path = url.pathname;
  const params = url.searchParams;

  if (path === '/register/anonimous') {
    return { code: 200, cookie: '', anonymous: true };
  }
  if (path === '/login/status') return await handleLoginStatus(cookie);
  if (path === '/user/account') return await handleUserAccount(cookie);
  if (path === '/logout') return { code: 200 };
  if (path === '/login/qr/key') {
    const result = await handleLoginQrKey();
    return { code: 200, data: { code: 200, unikey: result.key } };
  }
  if (path === '/login/qr/create') {
    const key = firstValue(params.get('key'), body.key);
    const result = await handleLoginQrCreate(key);
    return { code: 200, data: { qrimg: result.qrimg || result.img, qrurl: result.url } };
  }
  if (path === '/login/qr/check') {
    const key = firstValue(params.get('key'), body.key);
    return await handleLoginQrCheck(key);
  }
  if (path === '/cloudsearch' || path === '/search') return await handleSearch(url, cookie);
  if (path === '/song/detail') return await handleSongDetail(url, cookie);
  if (path === '/song/url/v1' || path === '/song/url') return await handleSongUrlV1(url, cookie);
  if (path === '/lyric/new' || path === '/lyric') return await handleLyricNew(url, cookie);
  if (path === '/song/chorus') {
    const id = firstValue(params.get('id'), body.id);
    return await eapiJson('/api/song/chorus', { id }, cookie);
  }
  if (path === '/user/playlist') return await handleUserPlaylists(url, cookie);
  if (path === '/playlist/detail') return await handlePlaylistDetail(url, cookie);
  if (path === '/playlist/track/all') return await handlePlaylistTrackAll(url, cookie);
  if (path === '/playlist/tracks') return await handlePlaylistTracks(url, body, cookie);
  if (path === '/playlist/subscribe') return await handleSubscribe(url, body, cookie, '/api/playlist/subscribe');
  if (path === '/playlist/detail/dynamic') {
    const id = firstValue(params.get('id'), body.id);
    return await eapiJson('/api/playlist/detail/dynamic', { id }, cookie);
  }
  if (path === '/album') return await handleAlbum(url, cookie);
  if (path === '/album/sub') return await handleSubscribe(url, body, cookie, '/api/album/sub');
  if (path === '/album/sublist') {
    return await weapiJson('/api/album/sublist', {
      limit: numberValue(params.get('limit'), 25),
      offset: numberValue(params.get('offset'), 0),
    }, cookie);
  }
  if (path === '/album/detail/dynamic') {
    const id = firstValue(params.get('id'), body.id);
    return await eapiJson('/api/album/detail/dynamic', { id }, cookie);
  }
  if (path === '/artist/detail') return await handleArtistDetail(url, cookie);
  if (path === '/artist/top/song') return await handleArtistTopSongs(url, cookie);
  if (path === '/artist/songs') return await handleArtistSongs(url, cookie);
  if (path === '/artist/album') return await handleArtistAlbums(url, cookie);
  if (path === '/likelist') return await handleLikedList(url, cookie);
  if (path === '/like') return await handleLike(url, body, cookie);
  if (path === '/like/check') return await handleLikeCheck(url, cookie);
  if (path === '/recommend/songs') return await handleDailyRecommend(url, cookie);
  if (path === '/recommend/songs/dislike') {
    const id = firstValue(params.get('id'), body.id);
    return await eapiJson('/api/recommend/songs/dislike', { id }, cookie);
  }
  if (path === '/history/recommend/songs' || path === '/history/recommend/songs/detail') {
    return await handleHistoryRecommend(url, cookie);
  }
  if (path === '/personal_fm' || path === '/personal/fm/mode') return await handlePersonalFm(url, cookie);
  if (path === '/personalized') {
    return await eapiJson('/api/personalized/playlist', {
      limit: numberValue(params.get('limit'), 35),
    }, cookie);
  }
  if (path === '/fm_trash') {
    const id = firstValue(params.get('id'), body.id);
    return await eapiJson('/api/radio/trash', { id }, cookie);
  }
  if (path === '/scrobble/v1') return { code: 200 };
  if (path === '/user/cloud') return { code: 200, data: [], songs: [] };
  if (path === '/user/cloud/detail') return { code: 200, data: [], songs: [] };
  if (path === '/cloud/lyric/get') return { code: 200, lyric: '', lrc: { lyric: '' } };
  if (path === '/song/copyright/rcmd') return { code: 200, data: null };

  return {
    __foliaBridgeError: 'ROUTE_NOT_IMPLEMENTED',
    path,
    method,
    message: `Folia bridge does not implement ${method} ${path}`,
  };
}

export async function getFoliaBridgeStatus() {
  const cookie = await getNeteaseCookie();
  const info = await getLoginInfo(cookie);
  return {
    netease: {
      loggedIn: !!info?.loggedIn,
      nickname: info?.nickname || '',
      avatar: info?.avatar || '',
      hasCookie: hasNeteaseLogin(cookie),
    },
  };
}

export async function diagnoseQqLikedSongs() {
  const cookie = await getQQCookie();
  const cookieObject = parseCookieString(cookie);
  const uin = qqCookieUin(cookie);
  const report = {
    hasUin: Boolean(uin),
    hasMusicKey: Boolean(cookieObject.qm_keyst || cookieObject.qqmusic_key || cookieObject.music_key),
    steps: [],
  };

  try {
    const fav = await qqGetJSON('https://c.y.qq.com/splcloud/fcgi-bin/fcg_musiclist_getmyfav.fcg', {
      dirid: 201,
      dirinfo: 1,
      g_tk: qqGtk(cookie),
      format: 'json',
      loginUin: uin,
      hostUin: uin,
    }, cookie);
    const midMap = fav?.mapmid || fav?.data?.mapmid || {};
    const idMap = fav?.map || fav?.data?.map || {};
    report.steps.push({
      name: 'getmyfav',
      code: fav?.code,
      subcode: fav?.subcode,
      topKeys: Object.keys(fav || {}).slice(0, 30),
      midCount: Object.keys(midMap || {}).length,
      idCount: Object.keys(idMap || {}).length,
      sampleMids: Object.keys(midMap || {}).slice(0, 3),
    });
  } catch (error) {
    report.steps.push({ name: 'getmyfav', error: error?.message || String(error) });
  }

  try {
    const encryptedUin = firstValue(
      cookieObject.encryptUin,
      cookieObject.encrypt_uin,
      cookieObject.str_musicid,
      cookieObject.wxuin,
      uin,
    );
    const json = await qqMusicRequest({
      comm: buildQQAuthComm(cookie),
      req_0: {
        module: 'music.srfDissInfo.DissInfo',
        method: 'CgiGetDiss',
        param: {
          disstid: 0,
          dirid: 201,
          tag: true,
          song_begin: 0,
          song_num: 5,
          userinfo: true,
          orderlist: true,
          enc_host_uin: String(encryptedUin || ''),
        },
      },
    }, cookie);
    const block = json?.req_0 || {};
    const data = block.data || {};
    const songs = data.songlist || data.songList || [];
    report.steps.push({
      name: 'cgiGetDiss',
      code: block.code,
      subcode: block.subcode,
      dataKeys: Object.keys(data).slice(0, 30),
      songlistCount: Array.isArray(songs) ? songs.length : 0,
      total: numberValue(data.total_song_num, data.total, data.song_num, 0),
      sampleSongKeys: Array.isArray(songs) && songs[0] ? Object.keys(songs[0]).slice(0, 20) : [],
    });
  } catch (error) {
    report.steps.push({ name: 'cgiGetDiss', error: error?.message || String(error) });
  }

  try {
    const json = await qqMusicRequest({
      comm: buildQQAuthComm(cookie),
      req_0: {
        module: 'music.musicasset.PlaylistFavRead',
        method: 'GetSongList',
        param: {
          dirId: 201,
          uin: Number(uin) || uin,
          order: 1,
          begin: 0,
          num: 5,
        },
      },
    }, cookie);
    const block = json?.req_0 || {};
    const data = block.data || {};
    const songs = data.songlist || data.songList || data.list || [];
    report.steps.push({
      name: 'playlistFavRead',
      code: block.code,
      subcode: block.subcode,
      dataKeys: Object.keys(data).slice(0, 30),
      songlistCount: Array.isArray(songs) ? songs.length : 0,
      total: numberValue(data.total, data.total_song_num, data.totalSongNum, 0),
      sampleSongKeys: Array.isArray(songs) && songs[0] ? Object.keys(songs[0]).slice(0, 20) : [],
    });
  } catch (error) {
    report.steps.push({ name: 'playlistFavRead', error: error?.message || String(error) });
  }

  try {
    const json = await qqGetJSON('https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg', {
      ct: 20,
      cid: 205360956,
      userid: uin,
      reqtype: 2,
      sin: 0,
      ein: 4,
      format: 'json',
    }, cookie);
    const data = json?.data || json || {};
    const albums = data.albumlist || data.cdlist || data.list || data.albums || [];
    const firstAlbum = Array.isArray(albums) ? albums[0] : null;
    report.steps.push({
      name: 'favoriteAlbums',
      code: json?.code,
      subcode: json?.subcode,
      dataKeys: Object.keys(data).slice(0, 30),
      albumCount: Array.isArray(albums) ? albums.length : 0,
      total: numberValue(data.totalalbum, data.total_album, data.total, data.album_total, 0),
      sampleAlbumKeys: Array.isArray(albums) && albums[0] ? Object.keys(albums[0]).slice(0, 20) : [],
    });
    const firstAlbumMid = firstValue(
      firstAlbum?.albumMID,
      firstAlbum?.albummid,
      firstAlbum?.albumMid,
      firstAlbum?.mid,
    );
    if (firstAlbumMid) {
      const detail = await qqGetJSON(
        'https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg',
        { albummid: firstAlbumMid, format: 'json', outCharset: 'utf-8' },
        cookie,
      );
      const detailData = detail?.data || {};
      report.steps.push({
        name: 'favoriteAlbumDetail',
        code: detail?.code,
        albumMid: firstAlbumMid,
        albumName: detailData.name,
        dataKeys: Object.keys(detailData).slice(0, 30),
        trackCount: Array.isArray(detailData.list) ? detailData.list.length : 0,
      });
    }
  } catch (error) {
    report.steps.push({ name: 'favoriteAlbums', error: error?.message || String(error) });
  }

  return report;
}
