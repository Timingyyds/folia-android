import { weapiRequest, UA } from './weapi.js';
import { eapiRequest } from './eapi.js';
import { getNeteaseCookie, hasNeteaseLogin, parseCookieString, saveProviderCookie, setBrowserCookies, getNeteaseMusicU } from './cookies.js';
import { handleQQSongComments } from './qq.js';
import { noteQrLoginStep, resetQrLoginTrace } from './qrLoginTrace.js';
import { buildQrDataUrl } from './qrImage.js';

const HOME_FEATURED_REVIEW_FALLBACKS = [
  { provider: 'netease', source: 'netease', type: 'song', id: 190137, name: '七月上', artist: 'Jam' },
  { provider: 'netease', source: 'netease', type: 'song', id: 518066957, name: '说散就散', artist: 'JC' },
  { provider: 'netease', source: 'netease', type: 'song', id: 1330348068, name: '起风了', artist: '买辣椒也用券' },
];
const featuredReviewsCache = { at: 0, key: '', data: null };
const FEATURED_REVIEWS_TTL_MS = 5 * 60 * 1000;
const FEATURED_REVIEW_SONG_LIMIT = 3;
const FEATURED_REVIEW_FETCH_LIMIT = 8;
const FEATURED_REVIEW_PICK_PER_SONG = 2;

function mapArtists(list) {
  return (list || [])
    .map((a) => ({ id: a.id, name: a.name || '' }))
    .filter((a) => a.name);
}

export function mapSongRecord(s) {
  s = s || {};
  const artists = mapArtists(s.ar || s.artists);
  const album = s.al || s.album || {};
  return {
    provider: 'netease',
    source: 'netease',
    type: 'song',
    id: s.id,
    name: s.name,
    artist: artists.map((a) => a.name).join(' / '),
    artists,
    artistId: artists[0] && artists[0].id,
    album: album.name || '',
    cover: album.picUrl || album.coverUrl || '',
    duration: s.dt || s.duration || 0,
    fee: s.fee,
  };
}

function mapDiscoverPlaylist(pl, tag) {
  pl = pl || {};
  const creator = pl.creator || pl.user || {};
  const id = pl.id || pl.resourceId || pl.creativeId;
  return {
    provider: 'netease',
    source: 'netease',
    type: 'playlist',
    id,
    name: pl.name || pl.title || '',
    cover: pl.picUrl || pl.coverImgUrl || pl.coverUrl || (pl.uiElement && pl.uiElement.image && pl.uiElement.image.imageUrl) || '',
    trackCount: pl.trackCount || pl.songCount || pl.programCount || 0,
    playCount: pl.playCount || pl.playcount || 0,
    creator: creator.nickname || creator.name || '',
    tag: tag || pl.alg || '',
  };
}

function mapPodcastRadio(r) {
  r = r || {};
  const dj = r.dj || r.djSimple || r.djUser || r.creator || {};
  const id = r.id || r.rid || r.radioId;
  return {
    id,
    rid: id,
    name: r.name || r.radioName || r.djName || '',
    cover: r.picUrl || r.picURL || r.coverUrl || r.coverImgUrl || r.avatarUrl || '',
    desc: r.desc || r.description || r.rcmdText || '',
    djName: dj.nickname || r.djName || r.nickname || '',
    category: r.category || r.categoryName || '',
    programCount: r.programCount || r.programNum || r.programCnt || 0,
    subCount: r.subCount || r.subedCount || r.subscriberCount || 0,
  };
}

function mapPodcastProgram(p, fallbackRadio) {
  p = p || {};
  const mainSong = p.mainSong || p.song || p.mainTrack || {};
  const radio = p.radio || fallbackRadio || {};
  const mappedRadio = mapPodcastRadio(radio);
  const artists = mapArtists(mainSong.ar || mainSong.artists || []);
  const album = mainSong.al || mainSong.album || {};
  const dj = p.dj || radio.dj || {};
  const playableId = mainSong.id || p.mainSongId || p.mainTrackId || p.songId;
  return {
    type: 'podcast',
    source: 'podcast',
    id: playableId,
    programId: p.id || p.programId,
    radioId: mappedRadio.id,
    name: p.name || mainSong.name || '',
    artist: mappedRadio.name || dj.nickname || artists.map((a) => a.name).join(' / ') || mappedRadio.djName || '',
    artists,
    artistId: artists[0] && artists[0].id,
    album: mappedRadio.name || album.name || 'Podcast',
    cover: p.coverUrl || p.cover || p.blurCoverUrl || mappedRadio.cover || album.picUrl || '',
    duration: p.duration || mainSong.dt || mainSong.duration || 0,
    fee: mainSong.fee,
    djName: mappedRadio.djName || dj.nickname || '',
    radioName: mappedRadio.name || '',
    desc: p.description || p.desc || '',
    createTime: p.createTime || 0,
    serialNum: p.serialNum || p.serial || 0,
  };
}

function firstArrayFrom(obj, keys) {
  obj = obj || {};
  for (const key of keys) {
    const value = obj[key];
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.list)) return value.list;
    if (value && Array.isArray(value.data)) return value.data;
    if (value && Array.isArray(value.resources)) return value.resources;
  }
  return [];
}

function mapPodcastVoice(v) {
  v = v || {};
  const raw = v.resource || v.voice || v.data || v.program || v;
  const mainSong = raw.mainSong || raw.song || raw.track || {};
  const radio = raw.radio || raw.djRadio || raw.voiceList || raw.podcast || {};
  const playableId = raw.trackId || raw.songId || raw.mainSongId || mainSong.id || raw.id;
  return {
    type: 'podcast',
    source: 'podcast',
    sourceType: 'podcast-voice',
    id: playableId,
    programId: raw.programId || raw.voiceId || raw.id,
    radioId: radio.id || radio.radioId || radio.voiceListId || raw.radioId || raw.voiceListId,
    name: raw.name || raw.songName || raw.title || mainSong.name || '',
    artist: radio.name || radio.radioName || radio.voiceListName || raw.podcastName || raw.djName || 'Voice',
    album: radio.name || radio.radioName || raw.podcastName || 'Podcast',
    cover: raw.coverUrl || raw.cover || raw.picUrl || raw.coverImgUrl || radio.picUrl || radio.coverUrl || '',
    duration: raw.duration || raw.durationMs || mainSong.dt || mainSong.duration || 0,
    djName: raw.djName || (radio.dj && radio.dj.nickname) || '',
    radioName: radio.name || radio.radioName || raw.podcastName || '',
    desc: raw.desc || raw.description || '',
  };
}

function mapPodcastCollectionRadio(r, key) {
  const radio = mapPodcastRadio(r);
  return {
    ...radio,
    type: 'podcast-radio',
    sourceType: 'podcast-radio',
    collectionKey: key || '',
    radioId: radio.id,
    name: radio.name,
    artist: radio.djName || radio.category || 'Podcast',
    album: radio.category || 'Podcast',
  };
}

function podcastCollectionMeta(key, items) {
  const meta = {
    collect: { key: 'collect', title: '收藏播客', sub: '你收藏的播客', itemType: 'radio' },
    created: { key: 'created', title: '创建播客', sub: '你创建的播客', itemType: 'radio' },
    liked: { key: 'liked', title: '喜欢的声音', sub: '收藏或最近喜欢的声音', itemType: 'voice' },
  }[key] || { key, title: key, sub: '', itemType: 'radio' };
  const first = (items || [])[0] || {};
  return {
    ...meta,
    count: (items || []).length,
    cover: first.cover || first.picUrl || first.coverUrl || '',
  };
}

function firstPositiveNumberFrom(objects, keys) {
  for (const obj of objects) {
    if (!obj || typeof obj !== 'object') continue;
    for (const key of keys) {
      const value = Number(obj[key]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return 0;
}

function collectStringValues(value, out, depth) {
  if (depth > 4 || value == null) return out;
  if (typeof value === 'string') {
    if (value) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStringValues(item, out, depth + 1));
    return out;
  }
  if (typeof value === 'object') {
    Object.keys(value).forEach((key) => collectStringValues(value[key], out, depth + 1));
  }
  return out;
}

function collectVipStringValues(value, out, depth) {
  if (depth > 4 || value == null) return out;
  if (Array.isArray(value)) {
    value.forEach((item) => collectVipStringValues(item, out, depth + 1));
    return out;
  }
  if (typeof value !== 'object') return out;
  Object.keys(value).forEach((key) => {
    const child = value[key];
    if (/vip|svip|member|associator|privilege|right|level|package|label|title|type|redplus/i.test(key)) {
      collectStringValues(child, out, depth + 1);
    } else if (child && typeof child === 'object') {
      collectVipStringValues(child, out, depth + 1);
    }
  });
  return out;
}

function normalizeNeteaseVip(profile, account, extra) {
  profile = profile || {};
  account = account || {};
  extra = extra || {};
  const vipInfo = profile.vipInfo || profile.vipinfo || account.vipInfo || account.vipinfo || extra.vipInfo || extra.vipinfo || {};
  const objects = [account, profile, vipInfo, extra];
  const vipType = firstPositiveNumberFrom(objects, [
    'vipType', 'vip_type', 'viptype', 'musicVipType', 'music_vip_type',
    'musicVipLevel', 'music_vip_level', 'redVipLevel', 'red_vip_level',
    'blackVipLevel', 'black_vip_level', 'luxuryVipLevel', 'luxury_vip_level',
    'svipType', 'svip_type',
  ]);
  const text = collectVipStringValues({ account, profile, vipInfo, extra }, [], 0).join(' ').toLowerCase();
  const redplus = extra.redplus || vipInfo.redplus || profile.redplus || account.redplus || {};
  const redplusExpire = Number(redplus.expireTime || redplus.expire_time || 0);
  const redplusActive = (Number.isFinite(redplusExpire) && redplusExpire > Date.now())
    || !!(redplus.vipLevel || redplus.status || redplus.isSign);
  const svipFlag = objects.some((obj) => obj && (
    obj.isSvip === true || obj.is_svip === true || obj.svip === true
    || Number(obj.isSvip || obj.is_svip || obj.svip || obj.svipType || obj.svip_type || 0) > 0
  )) || /svip|supervip|super_vip|黑胶svip|超级会员|redplus/.test(text) || redplusActive;
  const vipFlag = objects.some((obj) => obj && (
    obj.isVip === true || obj.is_vip === true || obj.vip === true
    || Number(obj.isVip || obj.is_vip || obj.vip || obj.vipFlag || obj.vipflag || 0) > 0
  )) || /vip|黑胶|会员/.test(text);
  const isSvip = svipFlag || vipType === 11 || redplusActive;
  const isVip = isSvip || vipFlag || vipType >= 10 || vipType > 0;
  const vipLevel = isSvip ? 'svip' : (isVip ? 'vip' : 'none');
  let vipLabel = '无VIP';
  if (isSvip) vipLabel = '黑胶SVIP';
  else if (vipType === 10) vipLabel = '黑胶VIP';
  else if (isVip) vipLabel = 'VIP';
  return { vipType, vipLevel, isVip, isSvip, vipLabel };
}

function normalizeLoginInfo(profile, account, body) {
  profile = profile || {};
  account = account || {};
  body = body || {};
  const userId = profile.userId || profile.user_id || profile.id
    || account.userId || account.user_id || account.id
    || (body.account && (body.account.id || body.account.userId));
  if (!(userId || userId === 0)) return { loggedIn: false, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP' };
  return {
    loggedIn: true,
    userId,
    nickname: profile.nickname || profile.userName || account.userName || '网易云用户',
    avatar: profile.avatarUrl || profile.avatar || account.avatarUrl || '',
    ...normalizeNeteaseVip(profile, account, body),
  };
}

const NETEASE_QUALITY = [
  { level: 'jymaster', br: 999000, label: '超清母带', svip: true },
  { level: 'hires', br: 1999000, label: '高清臻音', svip: true },
  { level: 'lossless', br: 999000, label: '无损', svip: false },
  { level: 'exhigh', br: 320000, label: '极高', svip: false },
  { level: 'standard', br: 128000, label: '标准', svip: false },
];

function normalizeQualityPreference(value) {
  value = String(value || '').toLowerCase();
  if (value === 'jymaster' || value === 'master' || value === 'svip') return 'jymaster';
  if (value === 'hires' || value === 'hi-res' || value === 'highres' || value === 'highest') return 'hires';
  if (value === 'lossless' || value === 'flac' || value === 'sq') return 'lossless';
  if (value === 'exhigh' || value === 'high' || value === '320k' || value === 'hq') return 'exhigh';
  if (value === 'standard' || value === 'normal' || value === 'std') return 'standard';
  return 'hires';
}

function qualityCandidates(pref) {
  const order = ['jymaster', 'hires', 'lossless', 'exhigh', 'standard'];
  const idx = order.indexOf(normalizeQualityPreference(pref));
  const start = idx >= 0 ? idx : 1;
  return NETEASE_QUALITY.filter((q) => order.indexOf(q.level) >= start);
}

function hasNeteaseSvip(info) {
  return !!(info && info.isSvip);
}

function extractAccountPayload(body) {
  body = body || {};
  let root = body;
  if (body.data && typeof body.data === 'object') {
    if (body.data.profile || body.data.account) root = body.data;
    else if (body.data.userId || body.data.id || body.data.nickname) {
      root = { profile: body.data, account: body.data };
    }
  }
  const profile = root.profile || body.profile || (body.data && body.data.profile) || root.account || body.account || {};
  const account = root.account || body.account || (body.data && body.data.account) || profile;
  return { profile, account, root };
}

function pickUserIdFromPayload(body) {
  const extracted = extractAccountPayload(body);
  const info = normalizeLoginInfo(extracted.profile, extracted.account, extracted.root);
  return info.loggedIn ? info.userId : '';
}

async function api(path, data, cookie) {
  const cookies = parseCookieString(cookie);
  const payload = Object.assign({}, data, { csrf_token: cookies.__csrf || '' });
  const result = await eapiRequest(path, payload, cookie);
  const body = result.body || {};
  const code = Number(body.code);
  if (code && code !== 200 && code !== 0 && !body.result && !body.playlist && !body.playlists && !body.songs && !body.profile && !body.account && !body.unikey && !body.data && !body.comments && !body.hotComments && !body.recommend && !body.dailySongs) {
    throw new Error(body.msg || body.message || `Netease API ${path} failed (${code})`);
  }
  return body;
}

async function weapiApi(path, data, cookie) {
  const cookies = parseCookieString(cookie);
  const payload = Object.assign({}, data, { csrf_token: cookies.__csrf || '' });
  const body = await weapiRequest(path, payload, cookie);
  const code = Number(body.code);
  if (code && code !== 200 && code !== 0 && !body.data && !body.result) {
    throw new Error(body.msg || body.message || `Netease WeAPI ${path} failed (${code})`);
  }
  return body;
}

function extractDailyRecommendSongs(body) {
  body = body || {};
  const data = body.data;
  const candidates = [
    data && data.dailySongs,
    data && data.recommend,
    body.recommend,
    body.dailySongs,
    body.songs,
    Array.isArray(data) ? data : null,
    Array.isArray(body.result) ? body.result : null,
  ];
  for (const list of candidates) {
    if (Array.isArray(list) && list.length) return list;
  }
  return [];
}

async function fetchDailyRecommendSongs(cookie) {
  const paths = [
    '/api/v3/discovery/recommend/songs',
    '/api/recommend/songs',
    '/api/discovery/recommend/songs',
  ];
  for (const path of paths) {
    try {
      const body = await api(path, {}, cookie);
      const raw = extractDailyRecommendSongs(body);
      if (raw.length) return raw;
    } catch (_) {}
  }
  return [];
}

async function backfillSongCovers(songs, cookie) {
  const list = (songs || []).map(mapSongRecord).filter((s) => s.id && s.name);
  const missing = list.filter((s) => !s.cover).map((s) => s.id);
  if (!missing.length) return list;
  try {
    const dd = await api('/api/v3/song/detail', { c: JSON.stringify(missing.map((id) => ({ id }))) }, cookie);
    const idToPic = {};
    ((dd.songs) || []).forEach((s) => {
      const pic = (s.al && s.al.picUrl) || (s.album && s.album.picUrl) || '';
      if (pic) idToPic[s.id] = pic;
    });
    return list.map((s) => (s.cover ? s : { ...s, cover: idToPic[s.id] || '' }));
  } catch (_) {
    return list;
  }
}

function hasNeteaseMusicU(cookieHeader) {
  return !!(parseCookieString(cookieHeader).MUSIC_U);
}

function playbackRestriction(provider, category, message, action, extra) {
  return {
    provider,
    category,
    message,
    action: action || '',
    ...(extra || {}),
  };
}

function classifyNeteasePlaybackRestriction(lastData, loginInfo) {
  const loggedIn = !!(loginInfo && loginInfo.loggedIn);
  const fee = Number(lastData && lastData.fee);
  const code = Number(lastData && lastData.code);
  const freeTrial = lastData && lastData.freeTrialInfo;
  if (!loggedIn) {
    return playbackRestriction('netease', 'login_required', '网易云需要登录后尝试获取完整播放地址', 'login', { code, fee });
  }
  if (freeTrial) {
    return playbackRestriction('netease', 'trial_only', '网易云仅返回试听片段，完整播放需要会员或购买', 'upgrade', { code, fee });
  }
  if (fee === 1) {
    return playbackRestriction('netease', 'vip_required', '网易云歌曲需要 VIP 权限，当前无法获取完整播放地址', 'upgrade', { code, fee });
  }
  if (fee === 4 || fee === 8) {
    return playbackRestriction('netease', 'paid_required', '网易云歌曲需要单曲、专辑购买或更高权限', 'purchase', { code, fee });
  }
  if (code === 404 || code === 403) {
    return playbackRestriction('netease', 'copyright_unavailable', '网易云版权暂不可播，换源或稍后重试会更稳', 'switch_source', { code, fee });
  }
  return playbackRestriction('netease', 'url_unavailable', '网易云没有返回可播放地址，可能是版权、会员或地区限制', loggedIn ? 'switch_source' : 'login', { code, fee });
}

async function ensureNeteaseCookieHeader(cookie) {
  let header = String(cookie || '');
  if (!parseCookieString(header).MUSIC_U) {
    const musicU = await getNeteaseMusicU();
    if (musicU) header = header ? `${header}; MUSIC_U=${musicU}` : `MUSIC_U=${musicU}`;
  }
  return header;
}

async function enrichLoginInfoWithVip(info, cookie) {
  if (!info || !info.loggedIn) return info;
  try {
    const vipBody = await api('/api/music-vip-membership/front/vip/info', { userId: info.userId || '' }, cookie);
    const data = vipBody.data || vipBody;
    const vip = normalizeNeteaseVip({}, {}, { ...data, vipInfo: data });
    const userId = info.userId || data.userId || data.uid || data.accountId || '';
    return {
      ...info,
      ...vip,
      userId,
      pendingProfile: info.pendingProfile && !(info.nickname && info.nickname !== '网易云用户'),
    };
  } catch (_) {}
  return info;
}

export async function getLoginInfo(cookie) {
  cookie = await ensureNeteaseCookieHeader(cookie);
  if (!hasNeteaseLogin(cookie) && !(await getNeteaseMusicU())) {
    return { loggedIn: false, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP' };
  }
  const endpoints = ['/api/w/nuser/account/get', '/api/nuser/account/get'];
  for (const path of endpoints) {
    try {
      const acc = await api(path, {}, cookie);
      const extracted = extractAccountPayload(acc);
      const info = normalizeLoginInfo(extracted.profile, extracted.account, extracted.root);
      if (info.loggedIn) return enrichLoginInfoWithVip({ ...info, hasCookie: true }, cookie);
    } catch (_) {}
  }
  if (hasNeteaseLogin(cookie) || (await getNeteaseMusicU())) {
    const fallback = {
      loggedIn: true,
      pendingProfile: true,
      nickname: '网易云用户',
      avatar: '',
      userId: '',
      vipType: 0,
      vipLevel: 'none',
      isVip: false,
      isSvip: false,
      vipLabel: '无VIP',
      hasCookie: true,
    };
    return enrichLoginInfoWithVip(fallback, cookie);
  }
  return { loggedIn: false, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP' };
}

export async function handleSearch(keywords, limit, cookie, offset) {
  const kw = String(keywords || '').trim();
  if (!kw) return [];
  const lim = Math.max(4, Math.min(50, Number(limit) || 20));
  const off = Math.max(0, Number(offset) || 0);
  let songs = [];
  const searchPaths = [
    ['/api/cloudsearch/pc', { s: kw, type: 1, limit: lim, offset: off, total: true }],
    ['/api/search/pc', { s: kw, type: 1, limit: lim, offset: off }],
    ['/api/search/get', { s: kw, type: 1, limit: lim, offset: off }],
    ['/api/v1/search/song', { s: kw, limit: lim, offset: off }],
  ];
  try {
    songs = await Promise.any(searchPaths.map(async ([path, data]) => {
      const body = await api(path, data, cookie);
      const list = (body.result && body.result.songs) || body.songs || [];
      if (!list.length) throw new Error('empty');
      return list;
    }));
  } catch (_) {
    for (const [path, data] of searchPaths) {
      try {
        const body = await api(path, data, cookie);
        songs = (body.result && body.result.songs) || body.songs || [];
        if (songs.length) break;
      } catch (_) {}
    }
  }
  let mapped = songs.map(mapSongRecord);
  const missing = mapped.filter((s) => !s.cover).map((s) => s.id).slice(0, 6);
  if (missing.length) {
    try {
      const dd = await api('/api/v3/song/detail', { c: JSON.stringify(missing.map((id) => ({ id }))) }, cookie);
      const idToPic = {};
      ((dd.songs) || []).forEach((s) => {
        const pic = (s.al && s.al.picUrl) || (s.album && s.album.picUrl) || '';
        if (pic) idToPic[s.id] = pic;
      });
      mapped = mapped.map((s) => (s.cover ? s : { ...s, cover: idToPic[s.id] || '' }));
    } catch (_) {}
  }
  return mapped;
}

export async function handleSongUrl(id, cookie, qualityPreference) {
  cookie = await ensureNeteaseCookieHeader(cookie);
  const loginInfo = await getLoginInfo(cookie);
  const svipReady = hasNeteaseSvip(loginInfo);
  const vipReady = !!(loginInfo.isVip || loginInfo.isSvip);
  const qualities = qualityCandidates(qualityPreference).filter((q) => !q.svip || svipReady);
  let trialFallback = null;
  let lastData = null;
  let lastError = null;
  const songId = String(id || '').trim();
  if (!songId) {
    return { url: null, trial: false, playable: false, requestedQuality: normalizeQualityPreference(qualityPreference), reason: 'missing_id' };
  }
  for (const q of qualities) {
    try {
      let d = null;
      try {
        const v1 = await api('/api/song/enhance/player/url/v1', { ids: `[${songId}]`, level: q.level, encodeType: 'flac' }, cookie);
        d = v1.data && v1.data[0];
      } catch (err) {
        lastError = err;
        const legacy = await api('/api/song/enhance/player/url', { ids: `[${songId}]`, br: q.br }, cookie);
        d = legacy.data && legacy.data[0];
      }
      if (d) lastData = d;
      const url = d && d.url;
      const freeTrial = d && d.freeTrialInfo;
      if (url && !freeTrial) {
        return {
          url,
          trial: false,
          playable: true,
          level: q.level,
          quality: q.label,
          format: d.type || 'mp3',
          br: d.br,
          requestedQuality: normalizeQualityPreference(qualityPreference),
          loggedIn: loginInfo.loggedIn,
          vipType: loginInfo.vipType || 0,
          vipLevel: loginInfo.vipLevel || 'none',
          isVip: !!loginInfo.isVip,
          isSvip: !!loginInfo.isSvip,
          vipLabel: loginInfo.vipLabel || '无VIP',
        };
      }
      if (url && freeTrial && !trialFallback) {
        trialFallback = {
          url,
          trial: true,
          playable: true,
          level: q.level,
          quality: q.label,
          format: d.type || 'mp3',
          br: d.br,
          requestedQuality: normalizeQualityPreference(qualityPreference),
          restriction: classifyNeteasePlaybackRestriction(d, loginInfo),
          loggedIn: loginInfo.loggedIn,
          vipType: loginInfo.vipType || 0,
          vipLevel: loginInfo.vipLevel || 'none',
          isVip: !!loginInfo.isVip,
          isSvip: !!loginInfo.isSvip,
          vipLabel: loginInfo.vipLabel || '无VIP',
        };
      }
    } catch (err) {
      lastError = err;
    }
  }
  if (trialFallback) return trialFallback;
  const restriction = classifyNeteasePlaybackRestriction(lastData, loginInfo);
  return {
    url: null,
    trial: false,
    playable: false,
    reason: restriction.category,
    message: restriction.message,
    restriction,
    lastCode: lastData && lastData.code,
    fee: lastData && lastData.fee,
    error: lastError && lastError.message,
    requestedQuality: normalizeQualityPreference(qualityPreference),
    loggedIn: loginInfo.loggedIn,
    vipType: loginInfo.vipType || 0,
    vipLevel: loginInfo.vipLevel || 'none',
    isVip: !!loginInfo.isVip,
    isSvip: !!loginInfo.isSvip,
    vipLabel: loginInfo.vipLabel || '无VIP',
    hasCookie: hasNeteaseMusicU(cookie),
    vipReady,
  };
}

export async function handleLyric(id, cookie) {
  let body = {};
  try {
    body = await api('/api/song/lyric/v1', { id, cp: false, tv: 0, lv: 0, rv: 0, kv: 0, yv: 0, ytv: 0, yrv: 0 }, cookie);
  } catch (_) {
    body = await api('/api/song/lyric', { id, lv: -1, tv: -1 }, cookie);
  }
  return {
    lyric: (body.lrc && body.lrc.lyric) || '',
    tlyric: (body.tlyric && body.tlyric.lyric) || '',
    yrc: (body.yrc && body.yrc.lyric) || '',
    source: 'extension',
  };
}

export async function handleDiscoverHome(cookie) {
  const info = await getLoginInfo(cookie);
  if (!info.loggedIn) {
    return { loggedIn: false, user: null, dailySongs: [], playlists: [], podcasts: [], mode: 'starter', updatedAt: Date.now() };
  }
  const tasks = await Promise.allSettled([
    api('/api/personalized/playlist', { limit: 8 }, cookie),
    api('/api/dj/hot', { limit: 6, offset: 0 }, cookie),
    api('/api/recommend/resource', {}, cookie),
    fetchDailyRecommendSongs(cookie),
  ]);
  const personalizedBody = tasks[0].status === 'fulfilled' ? tasks[0].value : {};
  const publicPlaylists = (personalizedBody.result || personalizedBody.data || [])
    .map((pl) => mapDiscoverPlaylist(pl, '推荐歌单'))
    .filter((pl) => pl.id && pl.name)
    .slice(0, 8);
  const podcastBody = tasks[1].status === 'fulfilled' ? tasks[1].value : {};
  const podcastRaw = podcastBody.djRadios || podcastBody.djradios || podcastBody.radios || podcastBody.data || [];
  const podcasts = (Array.isArray(podcastRaw) ? podcastRaw : [])
    .map(mapPodcastRadio)
    .filter((p) => p.id)
    .slice(0, 6);
  let privatePlaylists = [];
  if (tasks[2].status === 'fulfilled') {
    const raw = tasks[2].value.recommend || tasks[2].value.data || [];
    privatePlaylists = (Array.isArray(raw) ? raw : [])
      .map((pl) => mapDiscoverPlaylist(pl, '私人推荐'))
      .filter((pl) => pl.id && pl.name)
      .slice(0, 6);
  }
  let dailySongs = [];
  if (tasks[3].status === 'fulfilled') {
    const raw = Array.isArray(tasks[3].value) ? tasks[3].value : extractDailyRecommendSongs(tasks[3].value);
    dailySongs = await backfillSongCovers(raw, cookie);
    dailySongs = dailySongs.slice(0, 12);
  }
  return {
    loggedIn: true,
    user: { userId: info.userId, nickname: info.nickname || '', avatar: info.avatar || '' },
    dailySongs,
    playlists: privatePlaylists.concat(publicPlaylists).slice(0, 10),
    podcasts,
    updatedAt: Date.now(),
  };
}

async function resolveNeteaseUserId(cookie, info) {
  if (info && info.userId) return info;
  const endpoints = [
    '/api/w/nuser/account/get',
    '/api/nuser/account/get',
    '/api/user/account',
  ];
  for (const path of endpoints) {
    try {
      const acc = await api(path, {}, cookie);
      const extracted = extractAccountPayload(acc);
      const merged = normalizeLoginInfo(extracted.profile, extracted.account, extracted.root);
      if (merged.userId) return { ...info, ...merged };
    } catch (_) {}
  }
  try {
    const vipBody = await api('/api/music-vip-membership/front/vip/info', {}, cookie);
    const data = vipBody.data || vipBody;
    const userId = data.userId || data.uid || data.accountId || pickUserIdFromPayload(vipBody);
    if (userId) return { ...info, userId };
  } catch (_) {}
  return info || { loggedIn: false };
}

function extractPlaylistList(body) {
  body = body || {};
  const list = body.playlist || body.playlists
    || (body.data && (body.data.playlist || body.data.playlists))
    || [];
  return Array.isArray(list) ? list : [];
}

export async function handleUserPlaylists(cookie, limit) {
  let info = await getLoginInfo(cookie);
  if (!info.loggedIn) return { loggedIn: false, playlists: [] };
  info = await resolveNeteaseUserId(cookie, info);
  if (!info.userId) return { loggedIn: true, pendingProfile: true, playlists: [], userId: '', nickname: info.nickname || '网易云用户' };
  const body = await api('/api/user/playlist', { uid: info.userId, limit: limit || 60, offset: 0 }, cookie);
  const list = extractPlaylistList(body).map((pl) => ({
    id: pl.id,
    name: pl.name,
    cover: pl.coverImgUrl || '',
    trackCount: pl.trackCount || 0,
    playCount: pl.playCount || 0,
    creator: (pl.creator && pl.creator.nickname) || '',
    subscribed: !!pl.subscribed,
    specialType: pl.specialType || 0,
  }));
  return { loggedIn: true, userId: info.userId, nickname: info.nickname || '', avatar: info.avatar || '', playlists: list };
}

export async function handlePlaylistTracks(id, cookie) {
  cookie = await ensureNeteaseCookieHeader(cookie);
  let body = {};
  let rawTracks = [];
  let pl = {};
  try {
    body = await api('/api/v6/playlist/detail', { id, n: 1000, s: 8 }, cookie);
    pl = body.playlist || (body.data && body.data.playlist) || {};
    rawTracks = pl.tracks || body.tracks || (body.data && body.data.tracks) || [];
  } catch (_) {}
  if (!rawTracks.length) {
    try {
      const all = await api('/api/v3/playlist/detail', { id, n: 1000, s: 8 }, cookie);
      pl = all.playlist || (all.data && all.data.playlist) || pl;
      rawTracks = pl.tracks || all.tracks || (all.data && all.data.tracks) || rawTracks;
    } catch (_) {}
  }
  const tracks = (Array.isArray(rawTracks) ? rawTracks : []).map(mapSongRecord).filter((s) => s.id);
  const meta = {
    id: pl.id || id,
    name: pl.name || '',
    cover: pl.coverImgUrl || pl.cover || '',
    trackCount: pl.trackCount || tracks.length,
  };
  return {
    ...meta,
    playlist: meta,
    tracks,
    songs: tracks,
  };
}

export async function handleSongLikeCheck(ids, cookie) {
  cookie = await ensureNeteaseCookieHeader(cookie);
  let info = await getLoginInfo(cookie);
  const liked = {};
  if (!info.loggedIn) return { error: 'LOGIN_REQUIRED', loggedIn: false, liked, ids };
  info = await resolveNeteaseUserId(cookie, info);
  const numericIds = ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
  let likedSet = new Set();
  if (numericIds.length) {
    try {
      const body = await weapiApi('/api/song/like/check', { ids: JSON.stringify(numericIds) }, cookie);
      const data = body.data || body;
      numericIds.forEach((id) => {
        if (data[id] || data[String(id)] || data[Number(id)]) likedSet.add(String(id));
      });
    } catch (_) {}
  }
  if (!likedSet.size && info.userId) {
    try {
      const body = await weapiApi('/api/song/like/get', { uid: info.userId }, cookie);
      const list = body.ids || (body.data && body.data.ids) || [];
      likedSet = new Set(list.map(String));
    } catch (_) {}
  }
  ids.forEach((id) => {
    liked[id] = likedSet.has(String(id));
  });
  return { loggedIn: true, ids, liked, userId: info.userId };
}

export async function handleSongLike(id, like, cookie) {
  cookie = await ensureNeteaseCookieHeader(cookie);
  const info = await getLoginInfo(cookie);
  if (!info.loggedIn) return { error: 'LOGIN_REQUIRED', loggedIn: false };
  const trackId = Number(id);
  if (!Number.isFinite(trackId) || trackId <= 0) return { error: 'INVALID_ID', loggedIn: true, id: String(id || '') };
  try {
    const body = await weapiApi('/api/radio/like', {
      alg: 'itembased',
      trackId,
      like: like !== false,
      time: '3',
    }, cookie);
    const code = Number(body.code);
    if (code && code !== 200) {
      return {
        error: body.msg || body.message || 'LIKE_FAILED',
        loggedIn: true,
        id: String(id),
        liked: false,
        code,
        body,
      };
    }
    return { loggedIn: true, id: String(id), liked: like !== false, code: code || 200, body };
  } catch (err) {
    return { error: err.message || 'LIKE_FAILED', loggedIn: true, id: String(id), liked: false };
  }
}

export async function handleArtistDetail(id, limit, cookie) {
  id = String(id || '').trim();
  limit = Math.max(10, Math.min(80, Number(limit) || 30));
  if (!id) return { error: 'Missing artist id', artist: null, songs: [] };
  let detailBody = {};
  try {
    detailBody = await api('/api/artist/head/info/get', { id }, cookie);
  } catch (_) {}
  let rawSongs = [];
  try {
    const list = await api('/api/v1/artist/songs', { id, order: 'hot', limit, offset: 0 }, cookie);
    rawSongs = list.songs || (list.data && list.data.songs) || [];
  } catch (_) {}
  if (!rawSongs.length) {
    try {
      const top = await api('/api/artist/top/song', { id }, cookie);
      rawSongs = top.songs || (top.data && top.data.songs) || [];
    } catch (_) {}
  }
  const dataBlock = detailBody.data || detailBody;
  const artist = detailBody.artist || dataBlock.artist || dataBlock || {};
  return {
    artist: {
      id: artist.id || artist.artistId || id,
      name: artist.name || artist.artistName || '',
      avatar: artist.img1v1Url || artist.picUrl || artist.avatar || artist.cover || '',
      briefDesc: artist.briefDesc || artist.desc || '',
    },
    songs: rawSongs.map(mapSongRecord).filter((s) => s.id),
  };
}

function mapCommentRecords(raw, offset) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((c) => ({
      id: c.commentId || c.commentIdStr || c.id,
      content: c.content || '',
      likedCount: c.likedCount || c.liked || 0,
      time: c.time || 0,
      user: c.user ? { id: c.user.userId, nickname: c.user.nickname || '', avatar: c.user.avatarUrl || '' } : null,
    }))
    .filter((c) => c.content);
}

function parseCommentResponseBody(body, offset) {
  body = body || {};
  const data = body.data;
  const root = data && typeof data === 'object' && (data.comments || data.hotComments) ? data : body;
  const nested = root.data && typeof root.data === 'object' ? root.data : null;
  const hotComments = root.hotComments || (nested && nested.hotComments) || body.hotComments || [];
  const comments = root.comments || (nested && nested.comments) || body.comments || [];
  const raw = offset === 0 && Array.isArray(hotComments) && hotComments.length ? hotComments : comments;
  return {
    total: root.total || body.total || comments.length,
    comments: mapCommentRecords(raw, offset),
    hot: !!(offset === 0 && hotComments.length),
  };
}

export async function handleSongComments(id, limit, offset, cookie) {
  const songId = String(id || '').trim();
  if (!songId) return { error: 'Missing song id', comments: [] };
  limit = limit || 20;
  offset = offset || 0;
  const attempts = [
    async () => {
      const body = await api(`/api/v1/resource/comments/R_SO_4_${songId}`, { limit, offset, beforeTime: 0 }, cookie);
      return parseCommentResponseBody(body, offset);
    },
    async () => {
      const body = await api(`/api/v1/resource/hotcomments/R_SO_4_${songId}`, { limit, offset: 0 }, cookie);
      const parsed = parseCommentResponseBody(body, 0);
      return { ...parsed, hot: true };
    },
    async () => {
      const body = await weapiApi('/api/comment/hot', { id: songId, type: 0, limit, offset }, cookie);
      const hot = (body.hotComments || (body.data && body.data.hotComments) || []);
      const comments = mapCommentRecords(hot.length ? hot : (body.comments || []), offset);
      return { total: body.total || comments.length, comments, hot: !!hot.length };
    },
  ];
  let lastError = '';
  for (const attempt of attempts) {
    try {
      const parsed = await attempt();
      if (parsed.comments && parsed.comments.length) {
        return { id: songId, total: parsed.total, comments: parsed.comments, hot: !!parsed.hot };
      }
    } catch (err) {
      lastError = err.message || String(err);
    }
  }
  return { error: lastError || 'No comments', id: songId, comments: [] };
}

export async function handlePodcastHot(limit, cookie) {
  const body = await api('/api/dj/hot', { limit: limit || 18, offset: 0 }, cookie);
  const raw = body.djRadios || body.djradios || body.radios || body.data || [];
  const podcasts = (Array.isArray(raw) ? raw : []).map(mapPodcastRadio).filter((p) => p.id);
  return { podcasts, more: !!body.hasMore };
}

export async function handlePodcastSearch(keywords, limit, cookie) {
  const body = await api('/api/cloudsearch/pc', { s: keywords, type: 1009, limit: limit || 18, offset: 0, total: true }, cookie);
  const result = body.result || {};
  const raw = result.djRadios || result.djradios || result.radios || [];
  const podcasts = raw.map(mapPodcastRadio).filter((p) => p.id);
  return { podcasts, total: result.djRadiosCount || result.djradiosCount || podcasts.length };
}

export async function handlePodcastDetail(id, cookie) {
  const body = await api('/api/dj/detail', { rid: id }, cookie);
  const radio = mapPodcastRadio(body.data || body.djRadio || body.radio || body);
  return { podcast: radio };
}

export async function handlePodcastPrograms(id, limit, cookie) {
  const body = await api('/api/dj/program', { rid: id, limit: limit || 36, offset: 0, asc: false }, cookie);
  const raw = body.programs || (body.data && (body.data.list || body.data.programs)) || [];
  const radio = raw[0] && raw[0].radio ? mapPodcastRadio(raw[0].radio) : { id, rid: id };
  const programs = (Array.isArray(raw) ? raw : [])
    .map((p) => mapPodcastProgram(p, radio))
    .filter((p) => p.id && p.name);
  return { radio, programs, more: !!body.more, total: body.count || programs.length };
}

async function fetchMyPodcastItems(key, info, limit, offset, cookie) {
  limit = Math.max(8, Math.min(60, Number(limit) || 30));
  offset = Math.max(0, Number(offset) || 0);
  if (key === 'collect') {
    const body = await api('/api/dj/sublist', { limit, offset }, cookie);
    const raw = firstArrayFrom(body, ['djRadios', 'djradios', 'radios', 'data']);
    return { itemType: 'radio', items: raw.map((x) => mapPodcastCollectionRadio(x, key)).filter((x) => x.id) };
  }
  if (key === 'created') {
    const body = await api('/api/user/audio', { uid: info.userId }, cookie);
    const raw = firstArrayFrom(body, ['data', 'djRadios', 'djradios', 'radios']);
    return { itemType: 'radio', items: raw.map((x) => mapPodcastCollectionRadio(x, key)).filter((x) => x.id) };
  }
  if (key === 'liked') {
    let raw = [];
    try {
      const body = await api('/api/sati/resource/sub/list', {}, cookie);
      raw = firstArrayFrom(body, ['data', 'resources', 'list']);
    } catch (_) {}
    if (!raw.length) {
      try {
        const body = await api('/api/play-record/voice/list', { limit }, cookie);
        raw = firstArrayFrom(body, ['data', 'list', 'resources']);
      } catch (_) {}
    }
    return { itemType: 'voice', items: raw.map(mapPodcastVoice).filter((x) => x.id && x.name) };
  }
  return { itemType: 'radio', items: [] };
}

export async function handlePodcastMy(cookie) {
  const info = await getLoginInfo(cookie);
  if (!info.loggedIn || !info.userId) {
    const empty = ['collect', 'created', 'liked'].map((k) => podcastCollectionMeta(k, []));
    return { loggedIn: false, collections: empty };
  }
  const keys = ['collect', 'created', 'liked'];
  const collections = await Promise.all(
    keys.map(async (key) => {
      try {
        const data = await fetchMyPodcastItems(key, info, 12, 0, cookie);
        return podcastCollectionMeta(key, data.items || []);
      } catch (_) {
        return podcastCollectionMeta(key, []);
      }
    }),
  );
  return { loggedIn: true, collections };
}

export async function handlePodcastMyItems(key, limit, offset, cookie) {
  const info = await getLoginInfo(cookie);
  if (!info.loggedIn || !info.userId) return { loggedIn: false, items: [] };
  const data = await fetchMyPodcastItems(key || 'collect', info, limit, offset, cookie);
  return {
    loggedIn: true,
    key: key || 'collect',
    ...podcastCollectionMeta(key || 'collect', data.items || []),
    itemType: data.itemType,
    items: data.items || [],
  };
}

export async function handlePlaylistCreate(name, privacy, cookie) {
  const info = await getLoginInfo(cookie);
  if (!info.loggedIn) return { error: 'LOGIN_REQUIRED', loggedIn: false };
  const body = await api('/api/playlist/create', { name, privacy: privacy || 0 }, cookie);
  const created = body.playlist || body.data || {};
  return { loggedIn: true, playlist: created, body };
}

export async function handlePlaylistAddSong(pid, id, cookie) {
  const info = await getLoginInfo(cookie);
  if (!info.loggedIn) return { error: 'LOGIN_REQUIRED', loggedIn: false };
  let finalBody = null;
  let finalCode = 0;
  let success = false;
  try {
    finalBody = await api('/api/playlist/tracks', { op: 'add', pid, tracks: String(id) }, cookie);
    finalCode = Number(finalBody.code || 200);
    success = finalCode === 200 && !finalBody.error;
  } catch (err) {
    finalBody = { error: err.message };
  }
  if (!success) {
    try {
      finalBody = await api('/api/playlist/tracks/add', { pid, tracks: String(id) }, cookie);
      finalCode = Number(finalBody.code || 200);
      success = finalCode === 200 && !finalBody.error;
    } catch (err) {
      finalBody = { error: err.message };
    }
  }
  if (!success) {
    return { loggedIn: true, pid, id, success: false, code: finalCode, error: finalBody && (finalBody.message || finalBody.error) || 'PLAYLIST_ADD_FAILED', body: finalBody };
  }
  return { loggedIn: true, pid, id, success: true, code: finalCode, body: finalBody };
}

function buildLoginQrUrl(key) {
  return `https://music.163.com/login?codekey=${encodeURIComponent(key)}`;
}

function cookieHeaderFromSetCookieList(list) {
  const map = new Map();
  (list || []).forEach((raw) => {
    const part = String(raw || '').split(';')[0];
    const eq = part.indexOf('=');
    if (eq <= 0) return;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name && value) map.set(name, value);
  });
  return Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * QR unikey/check must use EAPI (weapi often returns empty body in extension SW).
 * Do NOT route 800-803 through api() — it treats those codes as fatal errors.
 */
async function neteaseQrEapi(path, data) {
  const raw = await eapiRequest(path, data || {}, '');
  return {
    body: raw.body || {},
    setCookies: raw.setCookies || [],
    status: raw.status,
  };
}

/**
 * eapiRequest has no timeout of its own, so a slow upstream parks the QR modal on "loading" with a
 * report that only shows `start`. Bound the two QR calls here so the wait always ends in either a
 * key or a message the user can act on.
 */
const NETEASE_QR_TIMEOUT_MS = 10000;

const withNeteaseQrTimeout = (promise, label, timeoutMs = NETEASE_QR_TIMEOUT_MS) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    reject(new Error(`${label}超时（${Math.round(timeoutMs / 1000)} 秒）`));
  }, timeoutMs);
  promise.then(
    (value) => { clearTimeout(timer); resolve(value); },
    (error) => { clearTimeout(timer); reject(error); },
  );
});

export async function handleLoginQrKey() {
  // A new session always starts here, so this is also where the per-session step trace resets.
  resetQrLoginTrace();
  noteQrLoginStep('ne:qr:key:start');
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const startedAt = Date.now();
    let body = {};
    try {
      // type:3 is the eapi / App QR key type (verified working)
      ({ body } = await withNeteaseQrTimeout(
        neteaseQrEapi('/api/login/qrcode/unikey', { type: 3 }),
        '获取二维码 key',
      ));
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err || '获取二维码 key 失败'));
      noteQrLoginStep('ne:qr:key:error', { attempt, message: lastError.message });
      continue;
    }
    const key = body.unikey || body.uniKey || (body.data && (body.data.unikey || body.data.uniKey)) || '';
    if (key) {
      noteQrLoginStep('ne:qr:key:ok', { attempt, ms: Date.now() - startedAt });
      return { key, unikey: key, code: Number(body.code) || 200 };
    }
    // 空 key 多半是风控 / 上游抖了一下：再要一次，第二次仍然空才报出来。
    const hint = body.message || body.msg || (body.code != null ? `code=${body.code}` : 'empty body');
    lastError = new Error(`获取二维码 key 失败（${hint}）`);
    noteQrLoginStep('ne:qr:key:empty', { attempt, code: Number(body.code) || 0, hint });
  }
  noteQrLoginStep('ne:qr:key:failed', { message: lastError ? lastError.message : '获取二维码 key 失败' });
  throw lastError || new Error('获取二维码 key 失败');
}

export async function handleLoginQrCreate(key) {
  if (!key) throw new Error('缺少二维码 key');
  const url = buildLoginQrUrl(key);
  noteQrLoginStep('ne:qr:create:start');
  let img = '';
  try {
    img = buildQrDataUrl(url);
    noteQrLoginStep('ne:qr:create:ok', { local: true });
  } catch (err) {
    // 本地编码不花网络，只有在内容超出版本 40 容量时才会失败；真到那一步才退回第三方出图。
    noteQrLoginStep('ne:qr:create:fallback', { message: err && err.message ? err.message : String(err) });
    img = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=0&data=${encodeURIComponent(url)}`;
  }
  return { img, qrimg: img, url };
}

export async function handleLoginQrCheck(key) {
  key = String(key || '').trim();
  if (!key) return { code: 800, message: '缺少二维码 key', loggedIn: false };
  let body = {};
  let setCookies = [];
  try {
    const raw = await neteaseQrEapi('/api/login/qrcode/client/login', { key, type: 3 });
    body = raw.body || {};
    setCookies = raw.setCookies || [];
  } catch (err) {
    noteQrLoginStep('ne:qr:check:error', { message: err && err.message ? err.message : String(err) });
    return {
      code: 801,
      error: err && err.message ? err.message : '扫码状态查询失败',
      message: err && err.message ? err.message : '扫码状态查询失败',
      loggedIn: false,
    };
  }
  const code = Number(body.code || 0);
  // 801 是「还没扫」，一轮轮地写会把追踪刷满；其余状态（已扫、过期、确认、风控）都要留下。
  if (code !== 801) {
    noteQrLoginStep('ne:qr:check', {
      code,
      hasCookie: Boolean(body.cookie),
      setCookieCount: setCookies.length,
    });
  }
  const profile = body.profile || (body.data && body.data.profile) || {};
  let cookieText = '';
  if (Array.isArray(body.cookie)) cookieText = body.cookie.filter(Boolean).join('; ');
  else cookieText = String(body.cookie || (body.data && body.data.cookie) || '').trim();
  if (!cookieText && setCookies.length) cookieText = cookieHeaderFromSetCookieList(setCookies);

  if (code === 803) {
    if (cookieText) {
      await setBrowserCookies('https://music.163.com/', cookieText);
      await saveProviderCookie('netease', cookieText);
      try {
        const obj = parseCookieString(cookieText);
        if (obj.MUSIC_U) {
          await chrome.cookies.set({
            url: 'https://music.163.com/',
            name: 'MUSIC_U',
            value: obj.MUSIC_U,
            path: '/',
            secure: true,
            httpOnly: true,
          }).catch(() => null);
        }
      } catch (_) {}
    }
    const cookie = await getNeteaseCookie();
    let info = await getLoginInfo(cookie);
    if (!info.loggedIn && cookieText) {
      info = {
        loggedIn: true,
        pendingProfile: true,
        nickname: profile.nickname || body.nickname || '网易云用户',
        avatar: profile.avatarUrl || body.avatarUrl || '',
        hasCookie: true,
      };
    }
    return Object.assign({}, info, {
      code: 803,
      message: body.message || '授权登录成功',
      nickname: profile.nickname || body.nickname || info.nickname || '网易云用户',
      avatar: profile.avatarUrl || body.avatarUrl || info.avatar || '',
      loggedIn: !!(info.loggedIn || cookieText),
      hasCookie: !!(info.loggedIn || cookieText || hasNeteaseLogin(cookie)),
    });
  }

  return {
    code,
    message: body.message || ({
      800: '二维码已过期',
      801: '等待扫码',
      802: '已扫码，待确认',
    }[code] || ''),
    nickname: profile.nickname || body.nickname || '',
    avatar: profile.avatarUrl || body.avatarUrl || '',
    loggedIn: false,
    hasCookie: false,
  };
}

export async function proxyFetch(url, opts) {
  opts = opts || {};
  const resp = await fetch(url, {
    method: opts.method || 'GET',
    headers: {
      'User-Agent': UA,
      Referer: opts.referer || 'https://music.163.com/',
      ...(opts.headers || {}),
      ...(opts.range ? { Range: opts.range } : {}),
    },
  });
  const buffer = await resp.arrayBuffer();
  const contentType = resp.headers.get('content-type') || 'application/octet-stream';
  // 206 Partial Content is success for audio range requests.
  if (!resp.ok) {
    return {
      __binary: true,
      error: `proxy fetch failed: ${resp.status}`,
      status: resp.status,
      contentType,
      buffer: buffer && buffer.byteLength ? buffer : new ArrayBuffer(0),
      acceptRanges: resp.headers.get('accept-ranges') || '',
      contentRange: resp.headers.get('content-range') || '',
    };
  }
  return {
    __binary: true,
    status: resp.status,
    contentType,
    buffer,
    acceptRanges: resp.headers.get('accept-ranges') || '',
    contentRange: resp.headers.get('content-range') || '',
  };
}

function cloneFeaturedSongSeed(song) {
  song = song || {};
  const provider = song.provider || song.source || 'netease';
  return {
    provider,
    source: provider,
    type: song.type || (provider === 'qq' ? 'qq' : 'song'),
    id: song.id || song.qqId || '',
    qqId: song.qqId || '',
    mid: song.mid || song.songmid || '',
    songmid: song.mid || song.songmid || '',
    mediaMid: song.mediaMid || song.media_mid || '',
    name: song.name || '',
    artist: song.artist || '',
    cover: song.cover || '',
  };
}

function pushFeaturedReview(out, comment, song) {
  const content = String(comment && comment.content || '').trim();
  if (!content || content.length < 4) return;
  const playSong = cloneFeaturedSongSeed(song);
  out.push({
    id: comment.id || content.slice(0, 24),
    content,
    likedCount: Number(comment.likedCount || 0) || 0,
    time: Number(comment.time || 0) || 0,
    user: comment.user || {},
    song: playSong,
    songId: String(playSong.id || playSong.mid || playSong.qqId || ''),
  });
}

async function enrichFeaturedSongSeeds(seeds, cookie) {
  seeds = (seeds || []).map(cloneFeaturedSongSeed);
  const missingCoverIds = [...new Set(
    seeds
      .filter((s) => s.provider !== 'qq' && s.id && !s.cover)
      .map((s) => Number(s.id))
      .filter((id) => Number.isFinite(id) && id > 0),
  )].slice(0, 6);
  if (!missingCoverIds.length) return seeds;
  try {
    const body = await api('/api/v3/song/detail', { c: JSON.stringify(missingCoverIds.map((id) => ({ id }))) }, cookie);
    const byId = new Map();
    ((body.songs) || []).forEach((raw) => {
      if (raw && raw.id) byId.set(String(raw.id), cloneFeaturedSongSeed(mapSongRecord(raw)));
    });
    return seeds.map((seed) => {
      const hit = byId.get(String(seed.id));
      if (!hit) return seed;
      return Object.assign({}, seed, hit, { name: hit.name || seed.name, artist: hit.artist || seed.artist });
    });
  } catch (_) {
    return seeds;
  }
}

async function resolveFeaturedReviewSeeds(seedSongs, cookie) {
  let songSeeds = (Array.isArray(seedSongs) ? seedSongs : [])
    .map(cloneFeaturedSongSeed)
    .filter((song) => song.id || song.mid);
  if (!songSeeds.length && hasNeteaseLogin(cookie)) {
    try {
      const raw = await fetchDailyRecommendSongs(cookie);
      songSeeds = raw.slice(0, FEATURED_REVIEW_SONG_LIMIT + 1).map(mapSongRecord).map(cloneFeaturedSongSeed).filter((s) => s.id);
    } catch (_) {}
  }
  if (!songSeeds.length) songSeeds = HOME_FEATURED_REVIEW_FALLBACKS.map(cloneFeaturedSongSeed);
  return enrichFeaturedSongSeeds(songSeeds, cookie);
}

async function enrichFeaturedSongSeed(song, cookie) {
  const seeds = await enrichFeaturedSongSeeds([song], cookie);
  return seeds[0] || cloneFeaturedSongSeed(song);
}

async function collectFeaturedReviewsForSeeds(songSeeds, neteaseCookie, qqCookie) {
  const reviews = [];
  await Promise.all((songSeeds || []).slice(0, FEATURED_REVIEW_SONG_LIMIT).map(async (enriched) => {
    try {
      if (enriched.provider === 'qq') {
        const res = await handleQQSongComments(
          enriched.qqId || enriched.id,
          enriched.mid || enriched.songmid,
          FEATURED_REVIEW_FETCH_LIMIT,
          0,
          qqCookie,
        );
        (res.comments || []).slice(0, FEATURED_REVIEW_PICK_PER_SONG).forEach((c) => pushFeaturedReview(reviews, c, enriched));
        return;
      }
      const id = String(enriched.id || '').trim();
      if (!id) return;
      const res = await handleSongComments(id, FEATURED_REVIEW_FETCH_LIMIT, 0, neteaseCookie);
      (res.comments || []).slice(0, FEATURED_REVIEW_PICK_PER_SONG).forEach((c) => pushFeaturedReview(reviews, c, enriched));
    } catch (_) {}
  }));
  reviews.sort((a, b) => (b.likedCount || 0) - (a.likedCount || 0));
  const picked = [];
  const seen = new Set();
  reviews.forEach((item) => {
    const key = String(item.id || item.content.slice(0, 32));
    if (seen.has(key)) return;
    seen.add(key);
    picked.push(item);
  });
  return picked.slice(0, 6);
}

function writeFeaturedReviewsCache(cacheKey, result) {
  featuredReviewsCache.at = Date.now();
  featuredReviewsCache.key = cacheKey;
  featuredReviewsCache.data = result;
}

export async function handleHomeFeaturedReviews(neteaseCookie, qqCookie, seedSongs) {
  const seedKey = JSON.stringify((Array.isArray(seedSongs) ? seedSongs : []).slice(0, 4).map((s) => s && (s.id || s.mid || s.name)));
  const cacheKey = `${seedKey}|${hasNeteaseLogin(neteaseCookie) ? '1' : '0'}`;
  const now = Date.now();
  if (featuredReviewsCache.key === cacheKey && featuredReviewsCache.data && now - featuredReviewsCache.at < FEATURED_REVIEWS_TTL_MS) {
    const cached = featuredReviewsCache.data;
    if (cached.reviews && cached.reviews.length) return { ...cached, cached: true };
  }
  let songSeeds = await resolveFeaturedReviewSeeds(seedSongs, neteaseCookie);
  let picked = await collectFeaturedReviewsForSeeds(songSeeds, neteaseCookie, qqCookie);
  if (!picked.length) {
    const fallbackSeeds = await enrichFeaturedSongSeeds(HOME_FEATURED_REVIEW_FALLBACKS.map(cloneFeaturedSongSeed), neteaseCookie);
    picked = await collectFeaturedReviewsForSeeds(fallbackSeeds, neteaseCookie, qqCookie);
  }
  const result = {
    reviews: picked,
    loggedIn: hasNeteaseLogin(neteaseCookie),
    updatedAt: now,
  };
  if (picked.length) writeFeaturedReviewsCache(cacheKey, result);
  return result;
}

export { getNeteaseCookie, hasNeteaseLogin };
