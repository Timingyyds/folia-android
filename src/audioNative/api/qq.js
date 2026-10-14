import {
  getQQCookie,
  parseCookieString,
  qqCookieAvatar,
  qqCookieMusicKey,
  qqCookieNickname,
  qqCookiePlaybackKey,
  qqCookieUin,
  clearCookieCache,
  saveProviderCookie,
} from './cookies.js';
import { UA } from './weapi.js';
import { qqGetLoginQr, qqCheckLoginQr } from './qq-login-qr.js';
import { noteLibraryStep } from './libraryTrace.js';

const noteQQLibraryStep = (step, detail) => noteLibraryStep('qq', step, detail);

/**
 * Bridge wrappers around sansenjian/qq-music-api QR login:
 * GET  /user/getQQLoginQr  → handleQQLoginQrCreate
 * POST /user/checkQQLoginQr → handleQQLoginQrCheck
 * Docs: https://sansenjian.github.io/qq-music-api/api/user.html
 */
export async function handleQQLoginQrCreate() {
  return qqGetLoginQr();
}

export async function handleQQLoginQrCheck(qrsig, ptqrtoken) {
  const result = await qqCheckLoginQr({ qrsig, ptqrtoken });
  if (result?.session?.cookie) {
    await saveProviderCookie('qq', result.session.cookie);
  }
  if (result && result.isOk && result.loggedIn) {
    // Enrich with profile/vip if cookie landed
    try {
      clearCookieCache();
      const cookieHeader = await getQQCookie();
      const status = await getQQLoginStatus(cookieHeader);
      if (status && status.loggedIn) {
        return {
          ...result,
          ...status,
          isOk: true,
          code: 0,
          status: 'ok',
          message: '登录成功',
          loggedIn: true,
          session: result.session,
        };
      }
    } catch (_) {}
  }
  // 换票被判定失败前再确认一次登录态：手机上已经确认、cookie 罐里也有有效会话时，
  // 不该因为一次换票失败把用户挡在门外。
  if (result && result.retryable === false && result.status === 'error') {
    try {
      clearCookieCache();
      const cookieHeader = await getQQCookie();
      const status = await getQQLoginStatus(cookieHeader);
      if (status && status.loggedIn) {
        noteQQLibraryStep('qr:exchange:recovered', { hasUserId: Boolean(status.uin || status.userId) });
        return {
          ...result,
          ...status,
          isOk: true,
          code: 0,
          status: 'ok',
          message: '登录成功',
          loggedIn: true,
          hasCookie: true,
          retryable: true,
        };
      }
    } catch (_) {}
  }
  return result;
}

const QQ_MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const QQ_SMARTBOX_URL = 'https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg';

function normalizeQualityPreference(value) {
  const raw = String(value || '').toLowerCase().trim();
  if (['jymaster', 'master', 'studio', 'svip', 'highest'].includes(raw)) return 'jymaster';
  if (['hires', 'hi-res', 'highres', 'zhenyin', 'spatial'].includes(raw)) return 'hires';
  if (['lossless', 'flac', 'sq'].includes(raw)) return 'lossless';
  if (['exhigh', 'high', '320', '320k', 'hq'].includes(raw)) return 'exhigh';
  if (['standard', 'normal', '128', '128k', 'std'].includes(raw)) return 'standard';
  return 'hires';
}

const QQ_QUALITY_CANDIDATE_TEMPLATES = [
  { prefix: 'RS01', ext: '.flac', level: 'hires', label: 'Hi-Res FLAC' },
  { prefix: 'F000', ext: '.flac', level: 'lossless', label: '无损 FLAC' },
  { prefix: 'M800', ext: '.mp3', level: 'exhigh', label: '320k MP3' },
  { prefix: 'M500', ext: '.mp3', level: 'standard', label: '128k MP3' },
  { prefix: 'C400', ext: '.m4a', level: 'aac', label: 'AAC/M4A' },
];

function qualityCandidatesFrom(target, candidates) {
  target = normalizeQualityPreference(target);
  let start = candidates.findIndex((item) => item.level === target);
  if (start < 0) start = 0;
  return candidates.slice(start);
}

function playbackRestriction(provider, category, message, action, extra) {
  return Object.assign({ provider, category, message, action: action || 'none' }, extra || {});
}

function classifyQQPlaybackRestriction(info, session) {
  const hasSession = typeof session === 'object' ? !!session.hasSession : !!session;
  const hasPlaybackKey = typeof session === 'object' ? !!session.hasPlaybackKey : hasSession;
  const rawMsg = String((info && (info.msg || info.tips || info.errmsg || info.message)) || '').trim();
  const code = Number((info && (info.result || info.code || info.errtype)) || 0);
  const lower = rawMsg.toLowerCase();
  if (!hasSession) {
    return playbackRestriction('qq', 'login_required', 'QQ 音乐需要登录或授权后才能获取播放地址', 'login', { code, rawMessage: rawMsg });
  }
  if (!hasPlaybackKey && code === 104003) {
    return playbackRestriction('qq', 'login_required', 'QQ 音乐当前只拿到了网页登录状态，还缺少播放授权，请重新打开 y.qq.com 完成登录', 'login', { code, rawMessage: rawMsg, missingPlaybackKey: true });
  }
  if (code === 104003) {
    return playbackRestriction('qq', 'copyright_unavailable', 'QQ 音乐没有给当前版本返回播放地址，通常是版权、会员或官方版本限制', 'switch_source', { code, rawMessage: rawMsg });
  }
  if (/vip|会员|付费|购买|数字专辑|专辑|pay/.test(lower + rawMsg)) {
    return playbackRestriction('qq', 'vip_required', 'QQ 音乐歌曲需要会员、购买或数字专辑权限', 'upgrade', { code, rawMessage: rawMsg });
  }
  if (code && code !== 0) {
    return playbackRestriction('qq', 'copyright_unavailable', rawMsg || 'QQ 音乐版权暂不可播或仅官方客户端可播', 'switch_source', { code, rawMessage: rawMsg });
  }
  return playbackRestriction('qq', 'url_unavailable', 'QQ 音乐没有返回播放地址，可能受版权、会员或官方客户端限制', 'switch_source', { code, rawMessage: rawMsg });
}

function parseJSONText(text) {
  const raw = String(text || '').trim();
  return JSON.parse(raw.replace(/^callback\(([\s\S]*)\);?$/, '$1'));
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
}

function decodeQQLyricText(text) {
  let raw = decodeHtmlEntities(String(text || '').trim());
  if (!raw) return '';
  try {
    if (!raw.includes('[') && /^[A-Za-z0-9+/=]+$/.test(raw.replace(/\s+/g, ''))) {
      const bin = atob(raw.replace(/\s+/g, ''));
      const decoded = decodeURIComponent(escape(bin));
      if (decoded && (decoded.includes('[') || /[\u4e00-\u9fa5]/.test(decoded))) raw = decoded;
    }
  } catch (_) {}
  return decodeHtmlEntities(raw).replace(/\r\n/g, '\n').trim();
}

function qqOfficialCoverSize(size) {
  const want = Math.max(1, Number(size) || 300);
  const allowed = [68, 90, 126, 150, 180, 300, 500, 800];
  let best = allowed[0];
  let bestDiff = Math.abs(want - best);
  for (let i = 1; i < allowed.length; i++) {
    const px = allowed[i];
    const diff = Math.abs(want - px);
    if (diff < bestDiff || (diff === bestDiff && px > best)) {
      best = px;
      bestDiff = diff;
    }
  }
  return best;
}

function qqAlbumCover(albumMid, size) {
  if (!albumMid) return '';
  const px = qqOfficialCoverSize(size || 300);
  return `https://y.gtimg.cn/music/photo_new/T002R${px}x${px}M000${albumMid}.jpg?max_age=2592000`;
}

function qqSingerAvatar(singerMid, size) {
  if (!singerMid) return '';
  const px = qqOfficialCoverSize(size || 300);
  return `https://y.gtimg.cn/music/photo_new/T001R${px}x${px}M000${singerMid}.jpg?max_age=2592000`;
}

function qqFeeFromPay(pay) {
  pay = pay || {};
  if (Number(pay.time_free) === 1) return 0;
  // pay_play=1 需付费播放；pay_month=1 需绿钻；pay_down 只影响下载，不代表不能免费播
  if (Number(pay.pay_play) === 1 || Number(pay.pay_month) === 1) return 1;
  return 0;
}

function qqFeeFromTrack(track) {
  track = track || {};
  if (track.pay && typeof track.pay === 'object') return qqFeeFromPay(track.pay);
  const fnote = Number(track.fnote || 0);
  if (fnote === 4009 || fnote === 8012 || fnote === 8013) return 1;
  return 0;
}

export function mergeQQSearchEnrich(item, detail) {
  if (!item || !detail) return item;
  // The liked-songs and playlist paths build bare `{ mid, id }` rows and rely
  // on this merge to receive everything else, so the display fields must be
  // copied too - otherwise every row renders as an empty/unknown song.
  if (!item.name && detail.name) item.name = detail.name;
  if (!item.artist && detail.artist) item.artist = detail.artist;
  if ((!item.artists || !item.artists.length) && Array.isArray(detail.artists) && detail.artists.length) {
    item.artists = detail.artists;
  }
  if (!item.album && detail.album) item.album = detail.album;
  if (!item.duration && detail.duration) item.duration = detail.duration;
  if (!item.interval && detail.interval) item.interval = detail.interval;
  if (!item.songmid && detail.songmid) item.songmid = detail.songmid;
  if (detail.mediaMid) item.mediaMid = detail.mediaMid;
  if (detail.cover && !item.cover) item.cover = detail.cover;
  if (detail.albumMid && !item.albumMid) item.albumMid = detail.albumMid;
  if (detail.artistMid && !item.artistMid) item.artistMid = detail.artistMid;
  if (detail.fee != null) item.fee = detail.fee;
  return item;
}

async function qqSongDetailsBatch(items, cookieHeader) {
  items = (items || []).filter((item) => item && item.mid);
  if (!items.length) return items;
  if (items.length === 1) {
    try {
      mergeQQSearchEnrich(items[0], await qqSongDetail(items[0].mid, items[0], cookieHeader));
    } catch (_) {}
    return items;
  }
  // The upstream detail endpoint starts rejecting the request once the mid list
  // gets long, so ask for them in chunks instead of falling back to one request
  // per song (which made a 150-song playlist take minutes).
  const CHUNK_SIZE = 50;
  const MAX_PARALLEL = 4;
  const chunks = [];
  for (let index = 0; index < items.length; index += CHUNK_SIZE) {
    chunks.push(items.slice(index, index + CHUNK_SIZE));
  }
  for (let index = 0; index < chunks.length; index += MAX_PARALLEL) {
    await Promise.all(
      chunks.slice(index, index + MAX_PARALLEL).map(async (chunk) => {
        try {
          const json = await qqMusicRequest({
            comm: { ct: 24, cv: 0 },
            songinfo: {
              module: 'music.pf_song_detail_svr',
              method: 'get_song_detail_yqq',
              param: { song_mid: chunk.map((item) => item.mid).join(',') },
            },
          }, cookieHeader);
          const data = json && json.songinfo && json.songinfo.data;
          let rawTracks = [];
          if (Array.isArray(data && data.track_info)) rawTracks = data.track_info;
          else if (data && data.track_info) rawTracks = [data.track_info];
          else if (Array.isArray(data)) rawTracks = data;
          const byMid = {};
          rawTracks.forEach((raw) => {
            const track = raw && (raw.track_info || raw.songInfo || raw.songinfo || raw);
            const mapped = mapQQTrack(track, {});
            if (mapped && mapped.mid) byMid[mapped.mid] = mapped;
          });
          chunk.forEach((item) => {
            if (byMid[item.mid]) mergeQQSearchEnrich(item, byMid[item.mid]);
          });
        } catch (_) {}
      }),
    );
  }
  // Only the rows that still lack a title (or a resolvable media id) need the
  // per-song fallback, and even then bounded so one bad chunk cannot stall the
  // whole page.
  const missing = items.filter((item) => !item.name || (!item.mediaMid && item.fee == null));
  noteQQLibraryStep('song-details:batch', {
    requested: items.length,
    named: items.filter((item) => Boolean(item.name)).length,
    chunks: chunks.length,
    fallback: Math.min(missing.length, 30),
  });
  await Promise.all(
    missing.slice(0, 30).map(async (item) => {
      try {
        mergeQQSearchEnrich(item, await qqSongDetail(item.mid, item, cookieHeader));
      } catch (_) {}
    }),
  );
  return items;
}

function mapQQArtists(raw) {
  return (raw || [])
    .map((a) => ({ id: a && a.id, mid: a && a.mid, name: (a && (a.name || a.title)) || '' }))
    .filter((a) => a.name);
}

function mapQQSearchSong(item) {
  item = item || {};
  const album = item.album || {};
  const artists = mapQQArtists(item.singer || []);
  const mid = item.mid || item.songmid || item.id || '';
  const albumMid = album.mid || album.pmid || item.albummid || item.albumMid || '';
  return {
    provider: 'qq',
    source: 'qq',
    type: 'qq',
    id: mid,
    qqId: item.id || item.docid || '',
    mid,
    songmid: mid,
    mediaMid: (item.file && item.file.media_mid) || item.strMediaMid || item.media_mid || '',
    name: item.name || item.title || item.songname || '',
    artist: artists.map((a) => a.name).join(' / ') || item.singer || '',
    artists: artists.length ? artists : (item.singer ? [{ name: item.singer }] : []),
    album: album.name || album.title || item.albumname || '',
    albumMid,
    cover: qqAlbumCover(albumMid, 300) || item.albumimg || '',
    duration: (Number(item.interval) || 0) * 1000,
    fee: qqFeeFromTrack(item),
    playable: false,
  };
}

async function qqDesktopSearch(keywords, limit, page, cookieHeader) {
  const kw = String(keywords || '').trim();
  if (!kw) return [];
  const safeLimit = Math.max(4, Math.min(30, Number(limit) || 12));
  const pageNum = Math.max(1, Number(page) || 1);
  const json = await qqMusicRequest({
    comm: { ct: 24, cv: 0 },
    req_1: {
      module: 'music.search.SearchCgiService',
      method: 'DoSearchForQQMusicDesktop',
      param: {
        remoteplace: 'txt.yqq.song',
        query: kw,
        search_type: 0,
        num_per_page: safeLimit,
        page_num: pageNum,
      },
    },
  }, cookieHeader);
  const block = (json && json.req_1) || (json && json['music.search.SearchCgiService']) || {};
  const data = block.data || {};
  const body = data.body || {};
  const song = body.song || {};
  const list = song.list || song.itemlist || [];
  return (Array.isArray(list) ? list : []).map(mapQQSearchSong).filter((s) => s.name && s.mid);
}

function mapQQSmartSong(item) {
  item = item || {};
  const mid = item.mid || item.songmid || item.id || '';
  const albumMid = item.albummid || item.albumMid || '';
  return {
    provider: 'qq',
    source: 'qq',
    type: 'qq',
    id: mid,
    qqId: item.id || item.docid || '',
    mid,
    songmid: mid,
    albumMid,
    name: item.name || item.songname || item.title || '',
    artist: item.singer || '',
    artists: item.singer ? [{ name: item.singer }] : [],
    album: item.albumname || '',
    cover: item.albumimg || qqAlbumCover(albumMid, 300) || '',
    duration: Number(item.duration || 0) * 1000,
    fee: qqFeeFromTrack(item),
    playable: false,
  };
}

function mapQQTrack(track, fallback) {
  track = track || {};
  fallback = fallback || {};
  const albumObj = track.album && typeof track.album === 'object' ? track.album : {};
  const artists = mapQQArtists(track.singer || track.singerInfo || []);
  let artistText = artists.map((a) => a.name).join(' / ');
  if (!artistText && typeof track.singer === 'string') artistText = track.singer;
  if (!artistText && track.singername) artistText = track.singername;
  const mid = track.mid || track.songmid || track.songMid || fallback.mid || fallback.songmid || '';
  const albumMid = albumObj.mid || albumObj.pmid || track.albummid || track.albumMid || fallback.albumMid || fallback.albummid || '';
  const albumName = albumObj.name || albumObj.title || (typeof track.album === 'string' ? track.album : '') || track.albumname || track.albumName || fallback.album || '';
  const qqId = track.id || track.songid || track.songId || track.songID || fallback.qqId || fallback.id || '';
  const interval = Number(track.interval || track.songInterval || track.duration || fallback.interval || 0) || 0;
  return {
    provider: 'qq',
    source: 'qq',
    type: 'qq',
    id: mid || String(qqId || ''),
    qqId: String(qqId || ''),
    mid,
    songmid: mid,
    mediaMid: (track.file && track.file.media_mid) || track.strMediaMid || track.media_mid || track.mediaMid || fallback.mediaMid || '',
    name: track.name || track.title || track.songname || track.songName || fallback.name || '',
    artist: artistText || fallback.artist || '',
    artists: artists.length ? artists : (artistText ? [{ name: artistText }] : fallback.artists || []),
    artistId: artists[0] && (artists[0].id || artists[0].mid),
    artistMid: artists[0] && artists[0].mid,
    album: albumName,
    albumMid,
    cover: qqAlbumCover(albumMid, 300) || normalizeQQPlaylistCover(
      track.albumimg || track.albumImg || track.albumpic || track.albumPic || track.pic ||
      albumObj.pic || albumObj.picurl || albumObj.cover ||
      fallback.cover || fallback.albumimg || ''
    ),
    duration: interval > 1000 ? interval : interval * 1000 || fallback.duration || 0,
    fee: qqFeeFromTrack(track),
    playable: false,
  };
}

async function qqMusicRequest(payload, cookieHeader) {
  const resp = await fetch(`${QQ_MUSICU_URL}?format=json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      Referer: 'https://y.qq.com/',
      'User-Agent': UA,
      Cookie: cookieHeader || '',
    },
    body: JSON.stringify(payload),
  });
  return resp.json();
}

async function qqGetJSON(url, params, cookieHeader) {
  const u = new URL(url);
  Object.entries(params || {}).forEach(([k, v]) => u.searchParams.set(k, String(v)));
  const resp = await fetch(u.toString(), {
    headers: {
      Referer: 'https://y.qq.com/',
      'User-Agent': UA,
      Cookie: cookieHeader || '',
    },
  });
  return parseJSONText(await resp.text());
}

async function qqSmartboxSearch(keywords, limit) {
  const u = new URL(QQ_SMARTBOX_URL);
  u.searchParams.set('format', 'json');
  u.searchParams.set('key', keywords);
  u.searchParams.set('g_tk', '5381');
  u.searchParams.set('loginUin', '0');
  u.searchParams.set('hostUin', '0');
  u.searchParams.set('inCharset', 'utf8');
  u.searchParams.set('outCharset', 'utf-8');
  u.searchParams.set('notice', '0');
  u.searchParams.set('platform', 'yqq.json');
  u.searchParams.set('needNewCode', '0');
  const resp = await fetch(u.toString(), { headers: { Referer: 'https://y.qq.com/', 'User-Agent': UA } });
  const json = parseJSONText(await resp.text());
  const items = json && json.data && json.data.song && json.data.song.itemlist;
  return (Array.isArray(items) ? items : [])
    .slice(0, Math.max(1, Math.min(limit || 8, 12)))
    .map(mapQQSmartSong);
}

async function qqSongDetail(mid, fallback, cookieHeader) {
  if (!mid) return fallback;
  const json = await qqMusicRequest({
    comm: { ct: 24, cv: 0 },
    songinfo: {
      module: 'music.pf_song_detail_svr',
      method: 'get_song_detail_yqq',
      param: { song_mid: mid },
    },
  }, cookieHeader);
  const data = json && json.songinfo && json.songinfo.data;
  return mapQQTrack(data && data.track_info, fallback);
}

function mapQQComment(raw) {
  raw = raw || {};
  const user = raw.commentnick || raw.nick || raw.user || {};
  const nickname = raw.nick || raw.commentnick || user.nickname || user.name || 'QQ 用户';
  const avatar = raw.headurl || raw.avatarurl || user.avatar || user.headurl || '';
  return {
    id: raw.commentid || raw.commentId || raw.id || '',
    content: decodeHtmlEntities(raw.rootcommentcontent || raw.commentcontent || raw.content || ''),
    likedCount: Number(raw.praisenum || raw.praise_num || raw.likedCount || 0) || 0,
    time: Number(raw.time || raw.pubtime || 0) || 0,
    user: {
      id: raw.uin || user.uin || '',
      nickname,
      avatar,
    },
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

function normalizeQQVipFields(profileBody, vipQueryBody, cookieHeader) {
  const cookieObj = parseCookieString(cookieHeader);
  const data = (profileBody && (profileBody.data || profileBody.profile || profileBody.creator || profileBody.result)) || {};
  const creator = (data.creator || data.user || data.profile || data) || {};
  const vipInfo = data.vipInfo || data.vipinfo || data.vip || creator.vipInfo || creator.vipinfo || {};
  const vipQueryData = (vipQueryBody && (vipQueryBody.req_0 && vipQueryBody.req_0.data)) || vipQueryBody || {};
  const infoMap = vipQueryData.infoMap || vipQueryData.map_userinfo || vipQueryData.mapUserInfo || {};
  const uin = qqCookieUin(cookieHeader);
  const uinKeys = [String(uin), uin ? `0${uin}` : '', ...Object.keys(infoMap || {})];
  let queryInfo = null;
  for (const key of uinKeys) {
    if (key && infoMap && infoMap[key]) {
      queryInfo = infoMap[key];
      break;
    }
  }
  if (!queryInfo && infoMap && typeof infoMap === 'object') {
    const values = Object.values(infoMap);
    queryInfo = values.length ? values[0] : null;
  }
  const objects = [cookieObj, data, creator, vipInfo, queryInfo, vipQueryData].filter(Boolean);
  let vipType = firstPositiveNumberFrom(objects, [
    'vipType', 'vip_type', 'viptype', 'musicVipType', 'music_vip_type',
    'music_vip_level', 'green_vip_level', 'luxury_vip_level', 'iGreenDiamondLevel',
    'iVipLevel', 'iSuperVip', 'iHugeVip', 'uHugeVipMask', 'uVipMask',
  ]);
  const vipFlag = objects.some((obj) => {
    if (!obj) return false;
    const flag = obj.isVip ?? obj.is_vip ?? obj.vipFlag ?? obj.vipflag ?? obj.iVipFlag;
    return flag === true || Number(flag) > 0 || String(flag || '').toLowerCase() === 'true';
  });
  const hugeVip = objects.some((obj) => obj && (
    Number(obj.uHugeVipMask || obj.iHugeVip || obj.huge_vip || obj.iSuperVip || 0) > 0
  ));
  if (!vipType && (vipFlag || hugeVip)) vipType = hugeVip ? 7 : 1;
  const isVip = vipType > 0 || vipFlag || hugeVip;
  const vipLevel = isVip ? 'vip' : 'none';
  return {
    vipType: vipType || (isVip ? 1 : 0),
    vipLevel,
    isVip,
    isSvip: false,
    vipLabel: isVip ? 'QQ VIP' : '无VIP',
  };
}

function normalizeQQProfile(body, cookieHeader) {
  const uin = qqCookieUin(cookieHeader);
  const data = (body && (body.data || body.profile || body.creator || body.result)) || {};
  const creator = (data.creator || data.user || data.profile || data) || {};
  const profileNick = creator.nick || creator.nickname || creator.name || creator.hostname || creator.title || '';
  const profileAvatar = creator.headpic || creator.avatar || creator.avatarUrl || creator.logo || '';
  const cookieNick = qqCookieNickname(cookieHeader, uin);
  const nick = profileNick || cookieNick || '';
  const avatar = profileAvatar || qqCookieAvatar(cookieHeader, uin);
  const vip = normalizeQQVipFields(body, null, cookieHeader);
  return {
    provider: 'qq',
    loggedIn: !!(uin && qqCookieMusicKey(cookieHeader)),
    preview: false,
    userId: uin,
    uin,
    nickname: nick || (uin ? `QQ ${uin}` : 'QQ 音乐'),
    avatar,
    ...vip,
    hasCookie: !!cookieHeader,
    playbackKeyReady: !!qqCookiePlaybackKey(cookieHeader),
    profileSource: profileNick || profileAvatar ? 'qq-profile' : (cookieNick || avatar ? 'cookie' : 'fallback'),
  };
}

async function fetchQQProfileHomepage(uin, cookieHeader) {
  const u = new URL('https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg');
  u.searchParams.set('cid', '205360838');
  u.searchParams.set('userid', uin);
  u.searchParams.set('reqfrom', '1');
  u.searchParams.set('g_tk', '5381');
  u.searchParams.set('loginUin', uin);
  u.searchParams.set('hostUin', '0');
  u.searchParams.set('format', 'json');
  u.searchParams.set('inCharset', 'utf8');
  u.searchParams.set('outCharset', 'utf-8');
  u.searchParams.set('notice', '0');
  u.searchParams.set('platform', 'yqq.json');
  u.searchParams.set('needNewCode', '0');
  return qqGetJSON(u.origin + u.pathname, Object.fromEntries(u.searchParams.entries()), cookieHeader);
}

async function fetchQQVipQuery(uin, cookieHeader) {
  const musicKey = qqCookieMusicKey(cookieHeader);
  const comm = { uin, format: 'json', ct: musicKey ? 19 : 24, cv: 0 };
  if (musicKey) comm.authst = musicKey;
  return qqMusicRequest({
    comm,
    req_0: {
      module: 'userInfo.VipQueryServer',
      method: 'SRFVipQuery_V2',
      param: { uin_list: [String(uin)] },
    },
  }, cookieHeader);
}

export async function warmQQLoginCookies() {
  try {
    await fetch('https://y.qq.com/', {
      method: 'GET',
      credentials: 'include',
      redirect: 'follow',
      headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/' },
    });
  } catch (_) {}
  clearCookieCache();
  return getQQCookie();
}

export async function getQQLoginStatus(cookieHeader) {
  if (!cookieHeader) {
    try { cookieHeader = await warmQQLoginCookies(); } catch (_) { cookieHeader = ''; }
  }
  const uin = qqCookieUin(cookieHeader);
  const musicKey = qqCookieMusicKey(cookieHeader);
  const fallback = normalizeQQProfile(null, cookieHeader);
  if (!uin || !musicKey) {
    return {
      ...fallback,
      loggedIn: false,
      missing: {
        uin: !uin,
        musicKey: !musicKey,
      },
      message: !uin && !musicKey
        ? '未检测到 QQ 音乐登录 Cookie，请先在 y.qq.com 扫码登录'
        : (!musicKey
          ? '已检测到 QQ 账号，但缺少 qm_keyst 播放票据，请在 y.qq.com 重新登录'
          : '缺少 QQ uin'),
    };
  }
  let profileBody = null;
  let vipQueryBody = null;
  try {
    [profileBody, vipQueryBody] = await Promise.all([
      fetchQQProfileHomepage(uin, cookieHeader).catch(() => null),
      fetchQQVipQuery(uin, cookieHeader).catch(() => null),
    ]);
  } catch (_) {}
  const info = normalizeQQProfile(profileBody, cookieHeader);
  const vip = normalizeQQVipFields(profileBody, vipQueryBody, cookieHeader);
  const merged = {
    ...info,
    ...vip,
    vipType: Math.max(Number(info.vipType || 0), Number(vip.vipType || 0)) || (vip.isVip ? 1 : 0),
    isVip: !!(info.isVip || vip.isVip),
    vipLevel: (info.isVip || vip.isVip) ? 'vip' : 'none',
    vipLabel: (info.isVip || vip.isVip) ? 'QQ VIP' : '无VIP',
  };
  if (profileBody && (profileBody.code === 1000 || profileBody.result === 301)) {
    return { ...merged, profileUnavailable: true };
  }
  if (!merged.vipType && !merged.isVip && vipQueryBody) {
    merged.vipSource = 'vip-query';
  } else if (merged.vipType > 0) {
    merged.vipSource = profileBody ? 'qq-profile' : 'cookie';
  }
  return merged;
}

export async function handleQQSearch(keywords, limit, cookieHeader, page) {
  const safeLimit = Math.max(4, Math.min(30, Number(limit) || 12));
  let songs = await qqDesktopSearch(keywords, safeLimit, page || 1, cookieHeader);
  if (!songs.length) {
    const base = await qqSmartboxSearch(keywords, safeLimit);
    await qqSongDetailsBatch(base, cookieHeader);
    songs = base;
  }
  const seen = new Set();
  return songs.filter((song) => {
    const key = song && (song.mid || song.id || `${song.name}|${song.artist}`);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return !!song.name;
  });
}

export async function handleQQSongUrl(mid, mediaMid, qualityPreference, cookieHeader) {
  const songmid = String(mid || '').trim();
  if (!songmid) return { provider: 'qq', url: '', error: 'MISSING_MID', message: 'Missing QQ song mid' };
  const guid = String(10000000 + Math.floor(Math.random() * 90000000));
  const uin = qqCookieUin(cookieHeader) || '0';
  const musicKey = qqCookieMusicKey(cookieHeader);
  const playbackKey = qqCookiePlaybackKey(cookieHeader);
  let fileMediaMid = String(mediaMid || '').trim();
  let detailMeta = null;
  if (!fileMediaMid) {
    try {
      const detail = await qqSongDetail(songmid, {}, cookieHeader);
      detailMeta = detail || null;
      fileMediaMid = String(detail && detail.mediaMid || '').trim();
    } catch (_) {}
  }
  if (!detailMeta) {
    try {
      detailMeta = await qqSongDetail(songmid, {}, cookieHeader);
    } catch (_) {}
  }
  const requestedQuality = normalizeQualityPreference(qualityPreference);
  const mediaIds = [];
  if (fileMediaMid) mediaIds.push(fileMediaMid);
  if (songmid && !mediaIds.includes(songmid)) mediaIds.push(songmid);
  const fileCandidates = mediaIds.flatMap((mediaId) =>
    qualityCandidatesFrom(requestedQuality, QQ_QUALITY_CANDIDATE_TEMPLATES)
      .map((item) => ({ ...item, mediaId, filename: item.prefix + mediaId + item.ext })),
  );
  const filenames = fileCandidates.map((item) => item.filename);
  const param = {
    guid,
    songmid: filenames.length ? filenames.map(() => songmid) : [songmid],
    songtype: filenames.length ? filenames.map(() => 0) : [0],
    uin,
    loginflag: 1,
    platform: '20',
  };
  if (filenames.length) param.filename = filenames;
  const comm = { uin, format: 'json', ct: musicKey ? 19 : 24, cv: 0, platform: 'yqq.json' };
  if (musicKey) comm.authst = musicKey;
  const json = await qqMusicRequest({
    comm,
    req_0: { module: 'vkey.GetVkeyServer', method: 'CgiGetVkey', param },
  }, cookieHeader);
  const data = json && json.req_0 && json.req_0.data;
  const infos = data && Array.isArray(data.midurlinfo) ? data.midurlinfo : [];
  const info = infos.find((item) => item && item.purl) || infos[0];
  const purl = info && info.purl;
  if (purl) {
    const sip = (data.sip && data.sip[0]) || 'https://ws.stream.qqmusic.qq.com/';
    const fileMeta = fileCandidates.find((item) => item.filename === info.filename) || {};
    return {
      provider: 'qq',
      url: sip + purl,
      trial: false,
      playable: true,
      level: fileMeta.level || info.filename || '',
      quality: fileMeta.label || info.filename || '',
      filename: info.filename || '',
      requestedQuality,
      playbackKeyReady: !!(uin && playbackKey),
      loggedIn: !!(uin && musicKey),
      cover: detailMeta && detailMeta.cover || '',
      albumMid: detailMeta && detailMeta.albumMid || '',
      mid: songmid,
    };
  }
  const restriction = classifyQQPlaybackRestriction(info, {
    hasSession: !!(uin && musicKey),
    hasPlaybackKey: !!(uin && playbackKey),
  });
  return {
    provider: 'qq',
    url: '',
    playable: false,
    error: 'QQ_URL_UNAVAILABLE',
    loggedIn: !!(uin && musicKey),
    playbackKeyReady: !!(uin && playbackKey),
    restriction,
    reason: restriction.category,
    message: restriction.message,
    qqCode: info && (info.result || info.code || info.errtype),
    rawMessage: info && (info.msg || info.tips || info.errmsg || ''),
    tried: fileCandidates.map((item) => item.label + ' · ' + item.filename),
    requestedQuality,
  };
}

export async function handleQQArtistDetail(mid, limit, cookieHeader) {
  const singerMid = String(mid || '').trim();
  const num = Math.max(10, Math.min(80, Number(limit) || 36));
  if (!singerMid) return { provider: 'qq', error: 'MISSING_SINGER_MID', artist: null, songs: [] };
  const json = await qqMusicRequest({
    comm: { ct: 24, cv: 0 },
    singer: {
      module: 'music.web_singer_info_svr',
      method: 'get_singer_detail_info',
      param: { sort: 5, singermid: singerMid, sin: 0, num },
    },
  }, cookieHeader);
  const block = json && json.singer;
  if (!block || Number(block.code || 0) !== 0) {
    return {
      provider: 'qq',
      error: (block && (block.message || block.msg || block.code)) || 'QQ_ARTIST_DETAIL_FAILED',
      artist: null,
      songs: [],
    };
  }
  const data = block.data || {};
  const info = data.singer_info || data.singerInfo || {};
  const rawSongs = Array.isArray(data.songlist) ? data.songlist : [];
  const songs = rawSongs
    .map((raw) => mapQQTrack(raw && (raw.track_info || raw.songInfo || raw.songinfo || raw.song) || raw, {}))
    .filter((song) => song && song.name && (song.mid || song.id));
  const artistMid = info.mid || singerMid;
  return {
    provider: 'qq',
    artist: {
      provider: 'qq',
      id: info.id || '',
      mid: artistMid,
      name: info.name || info.title || '',
      avatar: info.pic || info.avatar || qqSingerAvatar(artistMid, 300),
      fans: Number(info.fans || 0) || 0,
      musicSize: Number(data.total_song || data.song_count || 0) || songs.length,
    },
    total: Number(data.total_song || data.song_count || 0) || songs.length,
    songs,
  };
}

export async function handleQQSongComments(id, mid, limit, offset, cookieHeader) {
  let topid = String(id || '').replace(/\D/g, '');
  if (!topid && mid) {
    try {
      const detail = await qqSongDetail(mid, { mid }, cookieHeader);
      topid = String((detail && (detail.qqId || detail.id)) || '').replace(/\D/g, '');
    } catch (_) {}
  }
  if (!topid) return { provider: 'qq', error: 'Missing QQ song id', comments: [] };
  try {
    const page = Math.max(0, Math.floor((offset || 0) / Math.max(1, limit || 20)));
    const uin = qqCookieUin(cookieHeader) || '0';
    const body = await qqGetJSON('https://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg', {
      g_tk: '5381',
      loginUin: uin,
      hostUin: '0',
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: '0',
      platform: 'yqq.json',
      needNewCode: '0',
      cid: '205360772',
      reqtype: '2',
      biztype: '1',
      topid,
      cmd: '8',
      needmusiccrit: '0',
      pagenum: String(page),
      pagesize: String(limit || 20),
    }, cookieHeader);
    const hotList = body && body.hot_comment && body.hot_comment.commentlist;
    const normalList = body && body.comment && body.comment.commentlist;
    const raw = offset === 0 && Array.isArray(hotList) && hotList.length ? hotList : normalList || [];
    const comments = raw.map(mapQQComment).filter((c) => c.content);
    const total = Number(body && body.comment && (body.comment.commenttotal || body.comment.comment_total)) || comments.length;
    return { provider: 'qq', id: topid, total, comments, hot: !!(offset === 0 && Array.isArray(hotList) && hotList.length) };
  } catch (err) {
    return { provider: 'qq', error: err.message || String(err), id: topid, comments: [] };
  }
}

async function resolveQQSongNumericId(id, mid, cookieHeader) {
  let songId = '';
  const rawId = String(id || '').trim();
  if (rawId && !isQQSongMid(rawId)) songId = rawId.replace(/\D/g, '');
  if (!songId && mid) {
    try {
      const detail = await qqSongDetail(mid, { mid }, cookieHeader);
      const fromQqId = String((detail && detail.qqId) || '').replace(/\D/g, '');
      if (fromQqId) {
        songId = fromQqId;
      } else {
        const detailId = String((detail && detail.id) || '').trim();
        if (detailId && !isQQSongMid(detailId)) songId = detailId.replace(/\D/g, '');
      }
    } catch (_) {}
  }
  return songId;
}

function qqGtk(cookieHeader) {
  const obj = parseCookieString(cookieHeader);
  const key = obj.qm_keyst || obj.qqmusic_key || obj.skey || obj.p_skey || '';
  if (!key) return 5381;
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash += (hash << 5) + key.charCodeAt(i);
    hash &= 0x7fffffff;
  }
  return hash & 0x7fffffff;
}

function isQQSongMid(value) {
  const raw = String(value || '').trim();
  return /^[0-9A-Za-z]{10,20}$/.test(raw) && !/^\d+$/.test(raw);
}

function collectQQFavSets(body) {
  const idSet = new Set();
  const midSet = new Set();
  const idMap = (body && (body.map || (body.data && body.data.map))) || {};
  const midMap = (body && (body.mapmid || (body.data && body.data.mapmid))) || {};
  if (Array.isArray(idMap)) {
    idMap.forEach((id) => { if (id != null) idSet.add(String(id)); });
  } else if (idMap && typeof idMap === 'object') {
    Object.keys(idMap).forEach((key) => {
      idSet.add(String(key));
      if (idMap[key] != null) idSet.add(String(idMap[key]));
    });
    Object.values(idMap).forEach((val) => { if (val != null) idSet.add(String(val)); });
  }
  if (midMap && typeof midMap === 'object') {
    Object.keys(midMap).forEach((mid) => {
      midSet.add(String(mid));
      if (midMap[mid] != null) idSet.add(String(midMap[mid]));
    });
    Object.values(midMap).forEach((val) => { if (val != null) idSet.add(String(val)); });
  }
  return { idSet, midSet, idMap, midMap };
}

async function fetchQQFavCatalog(cookieHeader) {
  const uin = qqCookieUin(cookieHeader);
  const gtk = qqGtk(cookieHeader);
  let body = null;
  try {
    body = await qqGetJSON('https://c.y.qq.com/splcloud/fcgi-bin/fcg_musiclist_getmyfav.fcg', {
      dirid: 201,
      dirinfo: 1,
      g_tk: gtk,
      format: 'json',
      loginUin: uin,
      hostUin: uin,
    }, cookieHeader);
  } catch (_) {}
  const sets = collectQQFavSets(body || {});
  if (!sets.idSet.size && !sets.midSet.size) {
    try {
      const json = await qqMusicRequest({
        comm: { uin, format: 'json' },
        req_0: {
          module: 'music.musicasset.SongFavRead',
          method: 'GetSongIdList',
          param: { uin: Number(uin) || uin, dirId: 201 },
        },
      }, cookieHeader);
      const list = (((json.req_0 || {}).data || {}).songIds) || (((json.req_0 || {}).data || {}).songIdList) || [];
      list.map(String).forEach((id) => sets.idSet.add(id));
    } catch (_) {}
  }
  return sets;
}

export async function handleQQSongLikeCheck(ids, cookieHeader) {
  const status = await getQQLoginStatus(cookieHeader);
  const liked = {};
  if (!status.loggedIn) return { provider: 'qq', error: 'LOGIN_REQUIRED', loggedIn: false, liked, ids };
  const catalog = await fetchQQFavCatalog(cookieHeader);
  (ids || []).forEach((id) => {
    const raw = String(id || '').trim();
    const numeric = raw.replace(/\D/g, '');
    liked[id] = catalog.idSet.has(raw)
      || (numeric && catalog.idSet.has(numeric))
      || (isQQSongMid(raw) && catalog.midSet.has(raw));
  });
  return { provider: 'qq', loggedIn: true, ids, liked };
}

function qqLikeWriteResult(json) {
  const block = (json && json.req_0) || {};
  const data = block.data || {};
  const code = Number(block.code ?? data.code ?? (json && json.code) ?? 0);
  if (code === 1000) return { ok: false, loginRequired: true, code, block, data };
  if (code && code !== 0 && code !== 200) return { ok: false, code, block, data };
  const business = Number(data.ret ?? data.resultCode ?? data.errCode ?? 0);
  if (typeof data.result === 'number' && data.result !== 0 && data.result !== 200) {
    return { ok: false, code: data.result, block, data };
  }
  if (business && business !== 0 && business !== 200 && typeof data.result !== 'object') {
    return { ok: false, code: business, block, data };
  }
  const failed = data.v_failedSongId || data.v_failSongId || data.vFailedSongId || data.failedSongIds;
  if (Array.isArray(failed) && failed.length) return { ok: false, code: business || -1, block, data };
  return { ok: true, code: code || 0, block, data };
}

async function qqPlaylistDetailWrite(method, songId, cookieHeader, songType) {
  const sid = Number(songId);
  if (!Number.isFinite(sid) || sid <= 0) return null;
  const json = await qqMusicRequest({
    comm: buildQQAuthComm(cookieHeader),
    req_0: {
      module: 'music.musicasset.PlaylistDetailWrite',
      method,
      param: {
        dirId: 201,
        v_songInfo: [{ songId: sid, songType: songType == null ? 0 : Number(songType) }],
      },
    },
  }, cookieHeader);
  return { json, ...qqLikeWriteResult(json) };
}

async function qqSongFavWrite(method, songId, cookieHeader, songType) {
  const sid = Number(songId);
  if (!Number.isFinite(sid) || sid <= 0) return null;
  const uin = qqCookieUin(cookieHeader);
  const json = await qqMusicRequest({
    comm: buildQQAuthComm(cookieHeader),
    req_0: {
      module: 'music.musicasset.SongFavWrite',
      method,
      param: {
        uin: Number(uin) || uin,
        v_uin: Number(uin) || uin,
        dirId: 201,
        ids: [sid],
        songTypes: [songType == null ? 0 : Number(songType)],
      },
    },
  }, cookieHeader);
  return { json, ...qqLikeWriteResult(json) };
}

async function qqAddToFavByMid(songMid, cookieHeader) {
  const uin = qqCookieUin(cookieHeader);
  const gtk = qqGtk(cookieHeader);
  const mid = String(songMid || '').trim();
  if (!mid) return null;
  const body = await qqGetJSON('https://c.y.qq.com/splcloud/fcgi-bin/fcg_music_add2songdir.fcg', {
    midlist: mid,
    typelist: '13',
    dirid: 201,
    addtype: '',
    formsender: 4,
    r2: 0,
    r3: 1,
    utf8: 1,
    g_tk: gtk,
    loginUin: uin,
    hostUin: uin,
    format: 'json',
  }, cookieHeader);
  const code = Number(body && (body.code ?? body.ret ?? body.retCode ?? 0));
  if (code === 1000) return { ok: false, loginRequired: true, code, body };
  if (!code) return { ok: true, code: 0, body };
  return { ok: false, code, body };
}

async function qqDelFromFavById(songId, cookieHeader) {
  const uin = qqCookieUin(cookieHeader);
  const gtk = qqGtk(cookieHeader);
  const id = String(songId || '').replace(/\D/g, '');
  if (!id) return null;
  const body = await qqGetJSON('https://c.y.qq.com/qzone/fcgi-bin/fcg_music_delbatchsong.fcg', {
    loginUin: uin,
    hostUin: uin,
    uin,
    dirid: 201,
    ids: id,
    types: '3',
    source: 103,
    formsender: 4,
    flag: 2,
    from: 3,
    utf8: 1,
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: 0,
    platform: 'yqq.post',
    needNewCode: 0,
    g_tk: gtk,
  }, cookieHeader);
  const code = Number(body && (body.code ?? body.ret ?? body.retCode ?? 0));
  if (code === 1000) return { ok: false, loginRequired: true, code, body };
  if (!code) return { ok: true, code: 0, body };
  return { ok: false, code, body };
}

export async function handleQQSongLike(id, mid, like, cookieHeader) {
  const status = await getQQLoginStatus(cookieHeader);
  if (!status.loggedIn) return { provider: 'qq', error: 'LOGIN_REQUIRED', loggedIn: false };
  const songMid = String(mid || (isQQSongMid(id) ? id : '') || '').trim();
  const songId = await resolveQQSongNumericId(isQQSongMid(id) ? '' : id, songMid, cookieHeader);
  if (!songId && !songMid) return { provider: 'qq', error: 'MISSING_QQ_SONG_ID', loggedIn: true };

  const fail = (res, wantLiked, extra) => ({
    provider: 'qq',
    error: (res && res.data && (res.data.msg || res.data.message || res.data.errMsg))
      || (res && res.block && (res.block.msg || res.block.message || res.block.errMsg))
      || (res && res.body && (res.body.msg || res.body.message))
      || (wantLiked ? 'QQ_UNLIKE_FAILED' : 'QQ_LIKE_FAILED'),
    loggedIn: true,
    id: songId || '',
    mid: songMid,
    liked: !!wantLiked,
    code: res && res.code,
    ...(extra || {}),
  });

  if (like !== false) {
    if (songId) {
      for (const songType of [0, 13]) {
        try {
          const res = await qqPlaylistDetailWrite('AddSonglist', songId, cookieHeader, songType);
          if (res && res.loginRequired) return { provider: 'qq', error: 'LOGIN_REQUIRED', loggedIn: false, mid: songMid };
          if (res && res.ok) return { provider: 'qq', loggedIn: true, id: songId, mid: songMid, liked: true, code: res.code || 0, via: 'PlaylistDetailWrite' };
        } catch (_) {}
      }
      for (const songType of [0, 13]) {
        try {
          const res = await qqSongFavWrite('AddSong', songId, cookieHeader, songType);
          if (res && res.loginRequired) return { provider: 'qq', error: 'LOGIN_REQUIRED', loggedIn: false, mid: songMid };
          if (res && res.ok) return { provider: 'qq', loggedIn: true, id: songId, mid: songMid, liked: true, code: res.code || 0, via: 'SongFavWrite' };
        } catch (_) {}
      }
    }
    if (songMid) {
      try {
        const res = await qqAddToFavByMid(songMid, cookieHeader);
        if (res && res.loginRequired) return { provider: 'qq', error: 'LOGIN_REQUIRED', loggedIn: false, mid: songMid };
        if (res && res.ok) return { provider: 'qq', loggedIn: true, id: songId || '', mid: songMid, liked: true, code: 0, via: 'add2songdir' };
        if (res && !res.ok) return fail(res, false, { mid: songMid, via: 'add2songdir' });
      } catch (err) {
        return { provider: 'qq', error: err.message || 'QQ_LIKE_FAILED', loggedIn: true, mid: songMid, liked: false };
      }
    }
    return fail(null, false, { mid: songMid });
  }

  let delId = songId;
  if (!delId && songMid) {
    const catalog = await fetchQQFavCatalog(cookieHeader);
    if (catalog.midMap && catalog.midMap[songMid] != null) delId = String(catalog.midMap[songMid]);
  }
  if (delId) {
    for (const songType of [0, 13]) {
      try {
        const res = await qqPlaylistDetailWrite('DelSonglist', delId, cookieHeader, songType);
        if (res && res.loginRequired) return { provider: 'qq', error: 'LOGIN_REQUIRED', loggedIn: false, mid: songMid };
        if (res && res.ok) return { provider: 'qq', loggedIn: true, id: delId, mid: songMid, liked: false, code: res.code || 0, via: 'PlaylistDetailWrite' };
      } catch (_) {}
    }
    for (const songType of [0, 13]) {
      try {
        const res = await qqSongFavWrite('DelSong', delId, cookieHeader, songType);
        if (res && res.loginRequired) return { provider: 'qq', error: 'LOGIN_REQUIRED', loggedIn: false, mid: songMid };
        if (res && res.ok) return { provider: 'qq', loggedIn: true, id: delId, mid: songMid, liked: false, code: res.code || 0, via: 'SongFavWrite' };
      } catch (_) {}
    }
    try {
      const res = await qqDelFromFavById(delId, cookieHeader);
      if (res && res.loginRequired) return { provider: 'qq', error: 'LOGIN_REQUIRED', loggedIn: false, mid: songMid };
      if (res && res.ok) return { provider: 'qq', loggedIn: true, id: delId, mid: songMid, liked: false, code: 0, via: 'delbatchsong' };
      if (res && !res.ok) return fail(res, true, { id: delId, via: 'delbatchsong' });
    } catch (err) {
      return { provider: 'qq', error: err.message || 'QQ_UNLIKE_FAILED', loggedIn: true, mid: songMid, liked: true };
    }
  }
  return fail(null, true, { mid: songMid, id: delId || songId || '', error: 'FAVORITE_ITEM_NOT_FOUND' });
}

function buildQQAuthComm(cookieHeader, extra) {
  const uin = qqCookieUin(cookieHeader) || '0';
  const musicKey = qqCookieMusicKey(cookieHeader);
  const comm = Object.assign({ uin, format: 'json', ct: musicKey ? 19 : 24, cv: 0, platform: 'yqq.json' }, extra || {});
  if (musicKey) comm.authst = musicKey;
  // 微信扫码登录的凭据必须带着自己的 tmeLoginType 回来，否则上游按 QQ 通道解析会拿不到数据。
  // 会话里没写这个 cookie 时（QQ 通道）保持原样，不引入新字段。
  const loginType = Number(parseCookieString(cookieHeader).tmeLoginType);
  if (Number.isFinite(loginType) && loginType > 0) comm.tmeLoginType = loginType;
  return comm;
}

function normalizeQQPlaylistCover(cover) {
  let url = String(cover || '').trim();
  if (!url) return '';
  if (url.startsWith('//')) url = `https:${url}`;
  if (/^http:\/\//i.test(url) && /(?:qlogo\.cn|qpic\.cn|qq\.com|gtimg\.cn)/i.test(url)) {
    url = `https://${url.slice(7)}`;
  }
  if (/y\.qq\.com\/music\/photo_new\//i.test(url)) {
    url = url.replace('://y.qq.com/music/photo_new/', '://y.gtimg.cn/music/photo_new/');
  }
  // Snap invalid photo_new sizes (80/120/320/400 → nearest official size).
  if (/\/music\/photo_new\/T00[12]R\d+x\d+M000/i.test(url)) {
    const m = url.match(/T00[12]R(\d+)x(\d+)M000/i);
    const cur = m ? Number(m[1]) : 0;
    const allowed = [68, 90, 126, 150, 180, 300, 500, 800];
    if (!cur || !allowed.includes(cur)) {
      const px = qqOfficialCoverSize(cur || 300);
      url = url.replace(/(T00[12]R)\d+x\d+(M000)/i, `$1${px}x${px}$2`);
    }
  }
  // QQ placeholder disc art — treat as empty so callers can fall back.
  if (/mediastyle\/(?:y|global)\/img\/cover_qzone/i.test(url)) return '';
  if (/T002R\d+x\d+M0000{10,}/i.test(url)) return '';
  return url;
}

function normalizeQQUserPlaylistRow(pl, opts) {
  opts = opts || {};
  if (!pl || typeof pl !== 'object') return null;
  const dirid = pl.dirid != null ? pl.dirid : (pl.dirId != null ? pl.dirId : pl.dir_id);
  const tid = pl.tid || pl.dissid || pl.diss_id || pl.dissId || pl.playlist_id || pl.playlistId;
  // Prefer real playlist tid; dirid-only rows (e.g. 我喜欢=201) still valid.
  const id = tid || pl.id || dirid;
  if (id == null || id === '') return null;
  // Upstream sometimes returns tid=0 for empty placeholders.
  if (String(id) === '0' && String(dirid || '') !== '201') return null;
  // GetPlaylistByUin uses camelCase dirName; older APIs use dissname/title.
  const name = String(
    pl.dirName || pl.dirname || pl.dir_name || pl.DissName || pl.dissname || pl.diss_name ||
    pl.Title || pl.title || pl.name || ''
  ).trim();
  const cover = normalizeQQPlaylistCover(
    pl.diss_cover || pl.logo || pl.picurl || pl.picUrl || pl.pic_url || pl.bigpicUrl || pl.bigpic_url ||
    pl.albumPicUrl || pl.album_pic_url || pl.cover || pl.pic || pl.headurl || pl.imgurl || pl.img || pl.portrait || ''
  );
  const trackCount = Number(
    pl.songNum || pl.songnum || pl.song_cnt || pl.song_num || pl.total_song_num ||
    pl.cnt || pl.total_num || pl.totalNum || 0
  ) || 0;
  const playCount = Number(
    pl.play_cnt || pl.playCnt || pl.listen_num || pl.listennum || pl.play_count || pl.playCount || pl.playcnt || 0
  ) || 0;
  const creator = pl.nickname || pl.nick || pl.creator || pl.host_nickname || pl.hostname || '';
  const subscribed = opts.subscribed != null
    ? !!opts.subscribed
    : !!(pl.subscribed || pl.isFav || pl.is_fav || pl.fav);
  const diridStr = dirid != null && dirid !== '' ? String(dirid) : '';
  return {
    id: String(id),
    qqId: String(tid || pl.dissid || id),
    dirid: diridStr,
    name: name || (diridStr === '201' ? '我喜欢' : '未命名歌单'),
    cover,
    trackCount,
    playCount,
    creator,
    provider: 'qq',
    subscribed,
  };
}

function qqPlaylistDedupeKey(pl) {
  if (!pl) return '';
  const dirid = String(pl.dirid || '');
  const id = String(pl.id || pl.qqId || '');
  // 「我喜欢」 always keyed by dirid so tid/dirid variants collapse.
  if (dirid === '201' || id === '201' || pl.name === '我喜欢') return 'liked:201';
  if (id) return `id:${id}`;
  if (dirid) return `dir:${dirid}`;
  return `name:${pl.name || ''}`;
}

function mergeQQUserPlaylists(lists) {
  const seen = new Set();
  const out = [];
  (lists || []).flat().forEach((pl) => {
    if (!pl) return;
    const key = qqPlaylistDedupeKey(pl);
    if (!key) return;
    if (seen.has(key)) {
      const idx = out.findIndex((item) => qqPlaylistDedupeKey(item) === key);
      if (idx < 0) return;
      const cur = out[idx];
        // Prefer "created/liked" (subscribed=false) when the same playlist appears in both feeds.
        out[idx] = Object.assign({}, cur, {
          name: (cur.name && cur.name !== '未命名歌单') ? cur.name : pl.name,
          cover: cur.cover || pl.cover,
          trackCount: Math.max(Number(cur.trackCount) || 0, Number(pl.trackCount) || 0),
          playCount: Math.max(Number(cur.playCount) || 0, Number(pl.playCount) || 0),
          dirid: cur.dirid || pl.dirid,
          qqId: cur.qqId || pl.qqId,
          subscribed: !!(cur.subscribed && pl.subscribed),
        });
      return;
    }
    seen.add(key);
    out.push(pl);
  });
  return out;
}

function ensureQQLikedPlaylist(playlists, uin) {
  const list = Array.isArray(playlists) ? playlists.slice() : [];
  const likedIdx = list.findIndex((pl) => qqPlaylistDedupeKey(pl) === 'liked:201');
  if (likedIdx >= 0) {
    const liked = Object.assign({}, list[likedIdx], {
      name: list[likedIdx].name || '我喜欢',
      dirid: '201',
      subscribed: false,
    });
    list.splice(likedIdx, 1);
    list.unshift(liked);
    return list;
  }
  list.unshift({
    id: '201',
    qqId: '201',
    dirid: '201',
    name: '我喜欢',
    cover: uin ? `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(String(uin))}&s=100` : '',
    trackCount: 0,
    playCount: 0,
    creator: '',
    provider: 'qq',
    subscribed: false,
  });
  return list;
}

async function fetchQQUserCreatedPlaylistsLegacy(uin, cookieHeader) {
  const gtk = qqGtk(cookieHeader);
  const body = await qqGetJSON('https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss', {
    hostUin: 0,
    hostuin: uin,
    sin: 0,
    size: 200,
    g_tk: gtk,
    loginUin: uin,
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: '0',
    platform: 'yqq.json',
    needNewCode: '0',
  }, cookieHeader);
  if (!body || body.code === 1000) return [];
  const list = (body.data && body.data.disslist) || [];
  return list.map((pl) => normalizeQQUserPlaylistRow(pl, { subscribed: false })).filter(Boolean);
}

async function fetchQQUserCreatedPlaylistsByUin(uin, cookieHeader) {
  const json = await qqMusicRequest({
    comm: buildQQAuthComm(cookieHeader),
    req_0: {
      module: 'music.musicasset.PlaylistBaseRead',
      method: 'GetPlaylistByUin',
      param: { uin: String(uin) },
    },
  }, cookieHeader);
  const block = json && json.req_0;
  const code = Number(block && block.code);
  if (code && code !== 0 && code !== 200) return [];
  const data = (block && block.data) || {};
  const list = data.v_playlist || data.vPlaylist || data.playlist || data.list || [];
  return (Array.isArray(list) ? list : [])
    .map((pl) => normalizeQQUserPlaylistRow(pl, { subscribed: false }))
    .filter(Boolean);
}

async function fetchQQUserCreatedPlaylists(uin, cookieHeader) {
  const primary = await fetchQQUserCreatedPlaylistsByUin(uin, cookieHeader).catch(() => []);
  if (primary && primary.length) return primary;
  return fetchQQUserCreatedPlaylistsLegacy(uin, cookieHeader).catch(() => []);
}

async function fetchQQUserCollectedPlaylistsLegacy(uin, cookieHeader) {
  const body = await qqGetJSON('https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg', {
    ct: 20,
    cid: 205360956,
    userid: uin,
    reqtype: 3,
    sin: 0,
    ein: 200,
  }, cookieHeader);
  const list = (body && body.data && body.data.cdlist) || [];
  return list.map((pl) => normalizeQQUserPlaylistRow(pl, { subscribed: true })).filter(Boolean);
}

async function fetchQQUserCollectedPlaylistsFavApi(uin, cookieHeader) {
  const json = await qqMusicRequest({
    comm: buildQQAuthComm(cookieHeader),
    req_0: {
      module: 'music.musicasset.PlaylistFavRead',
      method: 'CgiGetPlaylistFavInfo',
      param: { uin: String(uin), offset: 0, size: 200 },
    },
  }, cookieHeader);
  const block = json && json.req_0;
  const code = Number(block && block.code);
  if (code && code !== 0 && code !== 200) return [];
  const data = (block && block.data) || {};
  const list = data.v_list || data.vList || data.list || data.cdlist || [];
  return (Array.isArray(list) ? list : [])
    .map((pl) => normalizeQQUserPlaylistRow(pl, { subscribed: true }))
    .filter(Boolean);
}

async function fetchQQUserCollectedPlaylists(uin, cookieHeader) {
  const [legacy, modern] = await Promise.all([
    fetchQQUserCollectedPlaylistsLegacy(uin, cookieHeader).catch(() => []),
    fetchQQUserCollectedPlaylistsFavApi(uin, cookieHeader).catch(() => []),
  ]);
  return mergeQQUserPlaylists([modern, legacy]);
}

async function fetchQQPersonalPlaylists(uin, cookieHeader) {
  const json = await qqMusicRequest({
    comm: buildQQAuthComm(cookieHeader),
    req_0: { module: 'libPersonal.PersonalSvr', method: 'GetPlaylist', param: { uin, req_num: 200 } },
  }, cookieHeader);
  const block = json && json.req_0;
  const code = Number(block && block.code);
  if (code && code !== 0 && code !== 200) return [];
  const data = (block && block.data) || {};
  const list = data.cdlist || data.v_playlist || data.vPlaylist || [];
  return (Array.isArray(list) ? list : [])
    .map((pl) => normalizeQQUserPlaylistRow(pl, { subscribed: false }))
    .filter(Boolean);
}

export async function handleQQUserPlaylists(cookieHeader) {
  const status = await getQQLoginStatus(cookieHeader);
  if (!status.loggedIn) return { loggedIn: false, playlists: [] };
  const uin = status.uin || qqCookieUin(cookieHeader) || '0';
  let playlists = [];
  const createdResult = await fetchQQUserCreatedPlaylists(uin, cookieHeader).catch((error) => {
    noteQQLibraryStep('playlists:created:error', { message: error && error.message ? error.message : String(error) });
    return [];
  });
  const collectedResult = await fetchQQUserCollectedPlaylists(uin, cookieHeader).catch((error) => {
    noteQQLibraryStep('playlists:collected:error', { message: error && error.message ? error.message : String(error) });
    return [];
  });
  const personalResult = await fetchQQPersonalPlaylists(uin, cookieHeader).catch((error) => {
    noteQQLibraryStep('playlists:personal:error', { message: error && error.message ? error.message : String(error) });
    return [];
  });
  noteQQLibraryStep('playlists:sources', {
    created: createdResult.length,
    collected: collectedResult.length,
    personal: personalResult.length,
    loggedIn: true,
  });
  try {
    // Own playlists first (我喜欢 / 自建), then collected.
    playlists = mergeQQUserPlaylists([createdResult, personalResult, collectedResult]);
  } catch (error) {
    noteQQLibraryStep('playlists:merge:error', { message: error && error.message ? error.message : String(error) });
  }
  if (!playlists.length) {
    try {
      playlists = await fetchQQUserCreatedPlaylists(uin, cookieHeader);
    } catch (error) {
      noteQQLibraryStep('playlists:retry:error', { message: error && error.message ? error.message : String(error) });
    }
  }
  playlists = ensureQQLikedPlaylist(playlists, uin);
  noteQQLibraryStep('playlists:final', { count: playlists.length });
  return {
    loggedIn: true,
    playlists,
    provider: 'qq',
    count: playlists.length,
    createdCount: playlists.filter((pl) => !pl.subscribed).length,
    collectedCount: playlists.filter((pl) => pl.subscribed).length,
  };
}

function mapQQPlaylistSonglist(list) {
  return (Array.isArray(list) ? list : [])
    .map((item) => mapQQTrack(item, {}))
    .filter((song) => song.name || song.mid || song.qqId);
}

function extractQQPlaylistMeta(source) {
  const dirinfo = (source && source.dirinfo) || {};
  return {
    name: (source && (source.dissname || source.diss_title || source.title)) || dirinfo.title || '',
    cover: normalizeQQPlaylistCover((source && (source.logo || source.picurl)) || dirinfo.picurl || ''),
  };
}

async function fetchQQPlaylistTracksUcc(disstid, cookieHeader) {
  const uin = qqCookieUin(cookieHeader) || '0';
  const gtk = qqGtk(cookieHeader);
  const body = await qqGetJSON('https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg', {
    type: 1,
    json: 1,
    utf8: 1,
    onlysong: 0,
    new_format: 1,
    disstid,
    format: 'json',
    g_tk: gtk,
    loginUin: uin,
    hostUin: 0,
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: 0,
    platform: 'yqq.json',
    needNewCode: 0,
  }, cookieHeader);
  if (!body || Number(body.code) !== 0 || Number(body.subcode) !== 0 || !body.cdlist || !body.cdlist[0]) return null;
  const cd = body.cdlist[0];
  const songs = mapQQPlaylistSonglist(cd.songlist);
  if (!songs.length) return null;
  return { meta: extractQQPlaylistMeta(cd), songs };
}

async function fetchQQPlaylistTracksUniform(disstid, cookieHeader, hostUin) {
  const json = await qqMusicRequest({
    comm: Object.assign(buildQQAuthComm(cookieHeader), { cv: 4747474, needNewCode: 1 }),
    req_1: {
      module: 'music.srfDissInfo.aiDissInfo',
      method: 'uniform_get_Dissinfo',
      param: {
        disstid: Number(disstid) || disstid,
        userinfo: 1,
        tag: 1,
        orderlist: 1,
        song_begin: 0,
        song_num: 300,
        onlysonglist: 0,
        enc_host_uin: hostUin || '',
      },
    },
  }, cookieHeader);
  const block = json && json.req_1;
  const code = Number(block && block.code);
  if (!block || (code && code !== 0 && code !== 200)) return null;
  const result = block.data || {};
  const songs = mapQQPlaylistSonglist(result.songlist);
  if (!songs.length) return null;
  return { meta: extractQQPlaylistMeta(result), songs };
}

async function fetchQQPlaylistTracksPlaza(disstid, cookieHeader) {
  const json = await qqMusicRequest({
    comm: buildQQAuthComm(cookieHeader),
    req_0: {
      module: 'playlist.PlayListPlazaServer',
      method: 'GetPlaylistById',
      param: { id: Number(disstid) || disstid, num: 300, onlysong: 0 },
    },
  }, cookieHeader);
  const block = json && json.req_0;
  const code = Number(block && block.code);
  if (!block || (code && code !== 0 && code !== 200)) return null;
  const data = block.data || {};
  const songs = mapQQPlaylistSonglist(data.songlist || data.songList);
  if (!songs.length) return null;
  return {
    meta: {
      name: data.title || data.diss_title || '',
      cover: normalizeQQPlaylistCover(data.picurl || data.logo || ''),
    },
    songs,
  };
}

async function fetchQQDirPlaylistTracks(dirid, cookieHeader) {
  const uin = qqCookieUin(cookieHeader);
  if (!uin || dirid == null || dirid === '') return null;
  const dirNum = Number(dirid);
  const json = await qqMusicRequest({
    comm: buildQQAuthComm(cookieHeader),
    req_0: {
      module: 'music.musicasset.PlaylistFavRead',
      method: 'GetSongList',
      param: { dirId: dirNum, uin: Number(uin) || uin, order: 1, begin: 0, num: 300 },
    },
  }, cookieHeader);
  const block = json && json.req_0;
  const code = Number(block && block.code);
  if (!block || (code && code !== 0 && code !== 200)) return null;
  const data = block.data || {};
  const songs = mapQQPlaylistSonglist(data.songlist || data.songList || data.list);
  if (!songs.length) return null;
  return {
    meta: {
      name: data.title || data.diss_title || data.name || '',
      cover: normalizeQQPlaylistCover(data.picurl || data.logo || ''),
    },
    songs,
  };
}

async function fetchQQFavPlaylistTracks(cookieHeader) {
  const dirResult = await fetchQQDirPlaylistTracks(201, cookieHeader);
  if (dirResult && dirResult.songs.length) {
    return { meta: { name: '我喜欢', cover: dirResult.meta.cover || '' }, songs: dirResult.songs };
  }
  const uin = qqCookieUin(cookieHeader);
  const gtk = qqGtk(cookieHeader);
  try {
    const body = await qqGetJSON('https://c.y.qq.com/splcloud/fcgi-bin/fcg_musiclist_getmyfav.fcg', {
      dirid: 201,
      dirinfo: 1,
      g_tk: gtk,
      format: 'json',
      loginUin: uin,
      hostUin: uin,
    }, cookieHeader);
    const midMap = (body && body.mapmid) || {};
    const mids = Object.keys(midMap).filter(Boolean);
    if (!mids.length) return null;
    const items = mids.slice(0, 300).map((mid) => ({ mid, songmid: mid, id: midMap[mid] }));
    await qqSongDetailsBatch(items, cookieHeader);
    const songs = mapQQPlaylistSonglist(items);
    if (!songs.length) return null;
    return { meta: { name: '我喜欢', cover: '' }, songs };
  } catch (_) {}
  return null;
}

export async function handleQQPlaylistTracks(id, cookieHeader, options) {
  options = options || {};
  const disstid = String(id || '').trim();
  const dirid = options.dirid != null ? String(options.dirid).trim() : '';
  if (!disstid && !dirid) {
    return { provider: 'qq', id: '', tracks: [], songs: [], playlist: { provider: 'qq', tracks: [] } };
  }

  let meta = { id: disstid || dirid, name: '', cover: '', provider: 'qq' };
  let songs = [];
  const attempts = [];

  if (dirid === '201' || disstid === '201') attempts.push(() => fetchQQFavPlaylistTracks(cookieHeader));
  if (dirid && dirid !== '201') attempts.push(() => fetchQQDirPlaylistTracks(dirid, cookieHeader));
  if (disstid) {
    attempts.push(() => fetchQQPlaylistTracksUcc(disstid, cookieHeader));
    attempts.push(() => fetchQQPlaylistTracksPlaza(disstid, cookieHeader));
    attempts.push(() => fetchQQPlaylistTracksUniform(disstid, cookieHeader, options.hostUin || ''));
  }
  if (dirid && dirid !== '201' && disstid) {
    attempts.push(() => fetchQQDirPlaylistTracks(dirid, cookieHeader));
  }

  for (const attempt of attempts) {
    try {
      const result = await attempt();
      if (result && result.songs && result.songs.length) {
        if (result.meta) meta = { ...meta, ...result.meta };
        songs = result.songs;
        break;
      }
    } catch (_) {}
  }

  const outMeta = {
    ...meta,
    id: disstid || dirid,
    trackCount: songs.length,
    provider: 'qq',
  };
  return {
    ...outMeta,
    playlist: outMeta,
    tracks: songs,
    songs,
    provider: 'qq',
  };
}

export async function handleQQLyric(mid, id, cookieHeader) {
  const songMID = String(mid || '').trim();
  const songID = String(id || '').replace(/\D/g, '');
  if (!songMID && !songID) return { provider: 'qq', error: 'Missing QQ song mid or id', lyric: '' };
  let lyricText = '';
  let transText = '';
  try {
    const param = {};
    if (songMID) param.songMID = songMID;
    if (songID) param.songID = Number(songID);
    const json = await qqMusicRequest({
      comm: { ct: 24, cv: 0 },
      lyric: {
        module: 'music.musichallSong.PlayLyricInfo',
        method: 'GetPlayLyricInfo',
        param,
      },
    }, cookieHeader);
    const data = json && json.lyric && json.lyric.data;
    lyricText = decodeQQLyricText(data && data.lyric);
    transText = decodeQQLyricText(data && data.trans);
  } catch (_) {}
  if (!lyricText && songMID) {
    try {
      const body = await qqGetJSON('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg', {
        songmid: songMID,
        songtype: '0',
        format: 'json',
        nobase64: '1',
        g_tk: '5381',
        loginUin: qqCookieUin(cookieHeader) || '0',
        hostUin: '0',
        inCharset: 'utf8',
        outCharset: 'utf-8',
        notice: '0',
        platform: 'yqq.json',
        needNewCode: '0',
      }, cookieHeader);
      lyricText = decodeQQLyricText(body && body.lyric);
      transText = decodeQQLyricText(body && (body.trans || body.tlyric)) || transText;
    } catch (_) {}
  }
  return {
    provider: 'qq',
    id: songID,
    mid: songMID,
    lyric: lyricText,
    tlyric: transText,
    yrc: '',
    source: lyricText ? 'qq-extension' : 'qq-empty',
  };
}

export { getQQCookie, mapQQTrack, qqSongDetail };
export { qqMusicRequest, qqGetJSON, buildQQAuthComm, qqSongDetailsBatch };
