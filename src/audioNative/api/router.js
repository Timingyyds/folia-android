import {
  getNeteaseCookie,
  getLoginInfo,
  handleSearch,
  handleSongUrl,
  handleLyric,
  handleDiscoverHome,
  handleUserPlaylists,
  handlePlaylistTracks,
  handleSongLikeCheck,
  handleSongLike,
  handleArtistDetail,
  handleSongComments,
  handlePodcastHot,
  handlePodcastSearch,
  handlePodcastDetail,
  handlePodcastPrograms,
  handlePodcastMy,
  handlePodcastMyItems,
  handlePlaylistCreate,
  handlePlaylistAddSong,
  handleLoginQrKey,
  handleLoginQrCreate,
  handleLoginQrCheck,
  handleHomeFeaturedReviews,
  proxyFetch,
} from './netease.js';
import {
  getQQCookie,
  getQQLoginStatus,
  warmQQLoginCookies,
  handleQQSearch,
  handleQQSongUrl,
  handleQQUserPlaylists,
  handleQQPlaylistTracks,
  handleQQLyric,
  handleQQArtistDetail,
  handleQQSongComments,
  handleQQSongLike,
  handleQQSongLikeCheck,
  handleQQLoginQrCreate,
  handleQQLoginQrCheck,
} from './qq.js';
import {
  getKGLoginStatus,
  getKGUserVipDetail,
  handleKGSearch,
  handleKGSongUrl,
  handleKGLyric,
  handleKGUserPlaylists,
  handleKGPlaylistTracks,
  handleKGPlaylistCreate,
  handleKGPlaylistAddSong,
  handleKGArtistDetail,
  handleKGLoginCookie,
  handleKGLoginQrKey,
  handleKGLoginQrCreate,
  handleKGLoginQrCheck,
  handleKGSongComments,
  handleKGSongLike,
  handleKGSongLikeCheck,
  ensureKGCookie,
} from './kugou.js';
import { setBrowserCookies, qqCookieUin, qqCookieMusicKey, parseCookieString } from './cookies.js';
import { buildWeatherRadio, fetchIpWeatherLocation } from './weather.js';

function createCookieBag() {
  let neteasePromise;
  let qqPromise;
  let kgPromise;
  return {
    netease() { return neteasePromise || (neteasePromise = getNeteaseCookie()); },
    qq() { return qqPromise || (qqPromise = getQQCookie()); },
    kg() { return kgPromise || (kgPromise = ensureKGCookie()); },
  };
}

function parseUrl(path, query) {
  const url = new URL(path, 'https://mineradio.local');
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value != null) url.searchParams.set(key, String(value));
  });
  return url;
}

function desktopOnly(path) {
  if (path.startsWith('/api/update/')) {
    return { ok: false, configured: false, error: 'DESKTOP_ONLY', message: '网页版不支持桌面更新通道' };
  }
  if (path === '/api/podcast/dj-beatmap') {
    return { ok: false, error: 'WEB_UNSUPPORTED', message: '网页版请使用本地节奏分析' };
  }
  return null;
}

export async function handleApiRequest(input) {
  const path = String(input.path || '/');
  const method = String(input.method || 'GET').toUpperCase();
  const query = input.query || {};
  let body = input.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  if (!body || typeof body !== 'object') body = {};
  const desktopStub = desktopOnly(path);
  if (desktopStub) return desktopStub;

  const cookies = createCookieBag();
  const url = parseUrl(path, query);

  if (path === '/api/search') {
    try {
      const limit = Number(url.searchParams.get('limit') || 20);
      const offset = Number(url.searchParams.get('offset') || 0);
      const songs = await handleSearch(url.searchParams.get('keywords') || '', limit, await cookies.netease(), offset);
      return { songs, provider: 'netease', hasMore: songs.length >= Math.max(4, Math.min(50, limit || 20)) };
    } catch (err) {
      return { songs: [], error: err.message || String(err), provider: 'netease' };
    }
  }

  if (path === '/api/qq/search') {
    const limit = Number(url.searchParams.get('limit') || 12);
    const page = Number(url.searchParams.get('page') || 1);
    const songs = await handleQQSearch(url.searchParams.get('keywords') || '', limit, await cookies.qq(), page);
    return { provider: 'qq', songs, hasMore: songs.length >= Math.max(4, Math.min(30, limit || 12)) };
  }

  if (path === '/api/kg/search') {
    const limit = Number(url.searchParams.get('limit') || 16);
    const page = Number(url.searchParams.get('page') || 1);
    const songs = await handleKGSearch(url.searchParams.get('keywords') || '', limit, await cookies.kg(), page);
    return { provider: 'kg', songs, hasMore: songs.length >= Math.max(4, Math.min(30, limit || 16)) };
  }

  if (path === '/api/song/url') {
    const loginInfo = await getLoginInfo(await cookies.netease());
    const info = await handleSongUrl(url.searchParams.get('id'), await cookies.netease(), url.searchParams.get('quality') || '');
    return { ...info, loggedIn: loginInfo.loggedIn, vipType: loginInfo.vipType || 0, vipLevel: loginInfo.vipLevel || 'none', isVip: !!loginInfo.isVip, isSvip: !!loginInfo.isSvip, vipLabel: loginInfo.vipLabel || '无VIP' };
  }

  if (path === '/api/qq/song/url') {
    const info = await handleQQSongUrl(url.searchParams.get('mid'), url.searchParams.get('mediaMid'), url.searchParams.get('quality') || '', await cookies.qq());
    const qqStatus = await getQQLoginStatus(await cookies.qq());
    return {
      ...info,
      loggedIn: qqStatus.loggedIn,
      playbackKeyReady: qqStatus.playbackKeyReady,
      vipType: qqStatus.vipType || 0,
      vipLevel: qqStatus.vipLevel || 'none',
      isVip: !!qqStatus.isVip,
      vipLabel: qqStatus.vipLabel || '无VIP',
    };
  }

  if (path === '/api/kg/song/url') {
    const info = await handleKGSongUrl(
      url.searchParams.get('hash') || url.searchParams.get('id'),
      url.searchParams.get('albumId') || url.searchParams.get('album_id'),
      url.searchParams.get('albumAudioId') || url.searchParams.get('album_audio_id'),
      url.searchParams.get('quality') || '',
      await cookies.kg(),
      {
        hash320: url.searchParams.get('hash320') || url.searchParams.get('hash_320') || '',
        hashSq: url.searchParams.get('hashSq') || url.searchParams.get('hash_sq') || url.searchParams.get('sqhash') || '',
      },
    );
    return info;
  }

  if (path === '/api/lyric') return handleLyric(url.searchParams.get('id'), await cookies.netease());
  if (path === '/api/qq/lyric') return handleQQLyric(url.searchParams.get('mid'), url.searchParams.get('id'), await cookies.qq());
  if (path === '/api/kg/lyric') {
    return handleKGLyric(
      url.searchParams.get('hash') || url.searchParams.get('id'),
      url.searchParams.get('albumAudioId') || url.searchParams.get('album_audio_id')
        || url.searchParams.get('albumId') || url.searchParams.get('album_id'),
      url.searchParams.get('duration') || '',
      url.searchParams.get('keyword') || url.searchParams.get('keywords') || url.searchParams.get('name') || '',
    );
  }

  if (path === '/api/kg/song/comments') {
    return handleKGSongComments(
      url.searchParams.get('hash') || url.searchParams.get('id'),
      url.searchParams.get('albumAudioId') || url.searchParams.get('album_audio_id'),
      Number(url.searchParams.get('limit') || 20),
      Number(url.searchParams.get('page') || 1),
    );
  }

  if (path === '/api/login/status') return getLoginInfo(await cookies.netease());
  if (path === '/api/qq/login/status') {
    const qqCookie = await warmQQLoginCookies().catch(() => cookies.qq());
    return getQQLoginStatus(qqCookie || await cookies.qq());
  }
  if (path === '/api/kg/login/status') return getKGLoginStatus(await cookies.kg());
  // KuGouMusicApi: /user/vip/detail
  if (path === '/api/kg/vip/detail' || path === '/api/kg/user/vip/detail') {
    return getKGUserVipDetail(await cookies.kg());
  }

  if (path === '/api/logout') return { ok: true, message: '网页版登出请在 music.163.com 退出账号' };
  if (path === '/api/qq/logout') return { ok: true, message: '网页版登出请在 y.qq.com 退出账号' };
  if (path === '/api/kg/logout') return { ok: true, message: '网页版登出请在 kugou.com 退出账号' };

  if (path === '/api/discover/home') return handleDiscoverHome(await cookies.netease());

  if (path === '/api/home/featured-reviews') {
    let seedSongs = [];
    const rawSeeds = url.searchParams.get('seeds');
    if (rawSeeds) {
      try { seedSongs = JSON.parse(rawSeeds); } catch (_) { seedSongs = []; }
    }
    return handleHomeFeaturedReviews(await cookies.netease(), await cookies.qq(), seedSongs);
  }
  if (path === '/api/user/playlists') return handleUserPlaylists(await cookies.netease(), Number(url.searchParams.get('limit') || 60));
  if (path === '/api/qq/user/playlists') return handleQQUserPlaylists(await cookies.qq());
  if (path === '/api/kg/user/playlists') return handleKGUserPlaylists(await cookies.kg());
  if (path === '/api/playlist/tracks') return handlePlaylistTracks(url.searchParams.get('id'), await cookies.netease());
  if (path === '/api/qq/playlist/tracks') {
    return handleQQPlaylistTracks(url.searchParams.get('id'), await cookies.qq(), {
      dirid: url.searchParams.get('dirid'),
      hostUin: url.searchParams.get('hostUin') || url.searchParams.get('hostuin') || '',
    });
  }
  if (path === '/api/kg/playlist/tracks') {
    return handleKGPlaylistTracks(
      url.searchParams.get('id') || url.searchParams.get('listid') || '',
      await cookies.kg(),
      url.searchParams.get('globalCollectionId') || url.searchParams.get('global_collection_id') || '',
    );
  }
  if (path === '/api/kg/playlist/create') {
    return handleKGPlaylistCreate(body.name || url.searchParams.get('name') || '', await cookies.kg());
  }
  if (path === '/api/kg/playlist/add-song') {
    return handleKGPlaylistAddSong(
      body.pid || body.listid || body.listId || url.searchParams.get('pid') || url.searchParams.get('listid') || '',
      body.hash || body.id || url.searchParams.get('hash') || '',
      body.albumId || body.album_id || url.searchParams.get('albumId') || '',
      body.albumAudioId || body.album_audio_id || url.searchParams.get('albumAudioId') || '',
      body.name || url.searchParams.get('name') || '',
      await cookies.kg(),
    );
  }
  if (path === '/api/song/like/check') {
    const ids = String(url.searchParams.get('ids') || url.searchParams.get('id') || '').split(',').map((s) => s.trim()).filter(Boolean);
    try {
      return await handleSongLikeCheck(ids, await cookies.netease());
    } catch (err) {
      return { error: err.message || String(err), loggedIn: false, liked: {}, ids };
    }
  }

  if (path === '/api/song/like') {
    const id = body.id || url.searchParams.get('id');
    const like = String(body.like != null ? body.like : (url.searchParams.get('like') || 'true')) !== 'false';
    try {
      return await handleSongLike(id, like, await cookies.netease());
    } catch (err) {
      return { error: err.message || String(err), loggedIn: false, id };
    }
  }

  if (path === '/api/qq/song/like/check') {
    const ids = String(url.searchParams.get('ids') || url.searchParams.get('id') || '').split(',').map((s) => s.trim()).filter(Boolean);
    return handleQQSongLikeCheck(ids, await cookies.qq());
  }

  if (path === '/api/qq/song/like') {
    const id = body.id || url.searchParams.get('id');
    const mid = body.mid || url.searchParams.get('mid') || url.searchParams.get('songmid');
    const like = String(body.like != null ? body.like : (url.searchParams.get('like') || 'true')) !== 'false';
    return handleQQSongLike(id, mid, like, await cookies.qq());
  }

  if (path === '/api/kg/song/like/check') {
    const ids = String(url.searchParams.get('ids') || url.searchParams.get('id') || '').split(',').map((s) => s.trim()).filter(Boolean);
    return handleKGSongLikeCheck(ids, await cookies.kg());
  }

  if (path === '/api/kg/song/like') {
    const hash = body.hash || url.searchParams.get('hash') || url.searchParams.get('id');
    const albumId = body.albumId || url.searchParams.get('albumId') || url.searchParams.get('album_id') || '';
    const albumAudioId = body.albumAudioId || url.searchParams.get('albumAudioId') || url.searchParams.get('album_audio_id') || '';
    const name = body.name || url.searchParams.get('name') || '';
    const like = String(body.like != null ? body.like : (url.searchParams.get('like') || 'true')) !== 'false';
    return handleKGSongLike(hash, albumId, albumAudioId, name, like, await cookies.kg());
  }

  if (path === '/api/playlist/create') {
    const name = String(body.name || url.searchParams.get('name') || '').trim();
    const privacy = String(body.privacy || url.searchParams.get('privacy') || '0');
    return handlePlaylistCreate(name, privacy, await cookies.netease());
  }

  if (path === '/api/playlist/add-song') {
    const pid = body.pid || url.searchParams.get('pid');
    const id = body.id || body.ids || url.searchParams.get('id') || url.searchParams.get('ids');
    return handlePlaylistAddSong(pid, id, await cookies.netease());
  }

  if (path === '/api/kg/artist/detail') {
    return handleKGArtistDetail(
      url.searchParams.get('id') || url.searchParams.get('singerid'),
      url.searchParams.get('name'),
      Number(url.searchParams.get('limit') || 36),
    );
  }

  if (path === '/api/artist/detail') return handleArtistDetail(url.searchParams.get('id'), Number(url.searchParams.get('limit') || 30), await cookies.netease());

  if (path === '/api/qq/artist/detail') {
    return handleQQArtistDetail(url.searchParams.get('mid') || url.searchParams.get('singermid'), Number(url.searchParams.get('limit') || 36), await cookies.qq());
  }

  if (path === '/api/song/comments') {
    return handleSongComments(url.searchParams.get('id'), Number(url.searchParams.get('limit') || 20), Number(url.searchParams.get('offset') || 0), await cookies.netease());
  }

  if (path === '/api/qq/song/comments') {
    return handleQQSongComments(
      url.searchParams.get('id') || url.searchParams.get('qqId'),
      url.searchParams.get('mid') || url.searchParams.get('songmid'),
      Number(url.searchParams.get('limit') || 20),
      Number(url.searchParams.get('offset') || 0),
      await cookies.qq(),
    );
  }

  if (path === '/api/podcast/hot') return handlePodcastHot(Number(url.searchParams.get('limit') || 18), await cookies.netease());
  if (path === '/api/podcast/search') return handlePodcastSearch(url.searchParams.get('keywords') || '', Number(url.searchParams.get('limit') || 18), await cookies.netease());
  if (path === '/api/podcast/detail') return handlePodcastDetail(url.searchParams.get('id') || url.searchParams.get('rid'), await cookies.netease());
  if (path === '/api/podcast/programs') return handlePodcastPrograms(url.searchParams.get('id') || url.searchParams.get('rid'), Number(url.searchParams.get('limit') || 36), await cookies.netease());
  if (path === '/api/podcast/my') return handlePodcastMy(await cookies.netease());
  if (path === '/api/podcast/my/items') {
    return handlePodcastMyItems(
      url.searchParams.get('key') || 'collect',
      Number(url.searchParams.get('limit') || 36),
      Number(url.searchParams.get('offset') || 0),
      await cookies.netease(),
    );
  }

  if (path === '/api/login/qr/key') return handleLoginQrKey();
  if (path === '/api/login/qr/create') return handleLoginQrCreate(url.searchParams.get('key'));
  if (path === '/api/login/qr/check') return handleLoginQrCheck(url.searchParams.get('key'));

  // sansenjian/qq-music-api compatible aliases + Bridge paths
  // GET  /user/getQQLoginQr | /getQQLoginQr | /api/qq/login/qr/create
  // POST /user/checkQQLoginQr | /checkQQLoginQr | /api/qq/login/qr/check
  if (
    path === '/api/qq/login/qr/create'
    || path === '/user/getQQLoginQr'
    || path === '/getQQLoginQr'
  ) {
    return handleQQLoginQrCreate();
  }
  if (
    path === '/api/qq/login/qr/check'
    || path === '/user/checkQQLoginQr'
    || path === '/checkQQLoginQr'
  ) {
    return handleQQLoginQrCheck(
      url.searchParams.get('qrsig') || body.qrsig || '',
      url.searchParams.get('ptqrtoken') || body.ptqrtoken || '',
    );
  }

  if (path === '/api/login/cookie') {
    const info = await getLoginInfo(await cookies.netease());
    return { ...info, saved: info.loggedIn, hasCookie: info.loggedIn, message: info.loggedIn ? '已读取浏览器 Cookie' : '请先在 music.163.com 登录' };
  }

  if (path === '/api/qq/login/cookie') {
    if (method === 'POST') {
      const raw = String(body.cookie || body.data || body.text || '').trim();
      const obj = parseCookieString(raw);
      if (!qqCookieUin(obj) || !qqCookieMusicKey(obj)) {
        return { provider: 'qq', loggedIn: false, error: 'INVALID_QQ_COOKIE', message: 'QQ cookie 缺少 uin 或有效登录票据' };
      }
      await setBrowserCookies('https://y.qq.com/', raw);
      const qqCookieAfter = await getQQCookie();
      const info = await getQQLoginStatus(qqCookieAfter);
      return { ...info, saved: info.loggedIn, hasCookie: info.loggedIn };
    }
    const qqCookie = await warmQQLoginCookies().catch(() => cookies.qq());
    const info = await getQQLoginStatus(qqCookie || await cookies.qq());
    return {
      ...info,
      saved: info.loggedIn,
      hasCookie: info.loggedIn,
      message: info.loggedIn
        ? '已读取浏览器 Cookie'
        : (info.message || '请先在 y.qq.com 扫码登录后再点刷新'),
    };
  }

  if (path === '/api/kg/login/cookie') {
    if (method === 'POST') {
      const raw = String(body.cookie || body.data || body.text || '').trim();
      return handleKGLoginCookie(raw);
    }
    const info = await getKGLoginStatus(await cookies.kg());
    return { ...info, saved: info.loggedIn, hasCookie: info.loggedIn, message: info.loggedIn ? '已读取浏览器 Cookie' : '请先在 kugou.com 登录' };
  }

  if (path === '/api/kg/login/qr/key') return handleKGLoginQrKey();
  if (path === '/api/kg/login/qr/create') return handleKGLoginQrCreate(url.searchParams.get('key'));
  if (path === '/api/kg/login/qr/check') return handleKGLoginQrCheck(url.searchParams.get('key'));

  if (path === '/api/weather/ip-location') return { ok: true, location: await fetchIpWeatherLocation() };

  if (path === '/api/weather/radio') {
    return buildWeatherRadio({
      city: url.searchParams.get('city') || url.searchParams.get('q') || '',
      lat: url.searchParams.get('lat'),
      lon: url.searchParams.get('lon'),
      timezone: url.searchParams.get('timezone') || '',
    });
  }

  if (path === '/api/cover') {
    const coverUrl = url.searchParams.get('url');
    if (!coverUrl || !/^https?:\/\//i.test(coverUrl)) return { __binary: true, error: 'Invalid cover url', status: 400 };
    const referer = /qq|gtimg|qpic|qlogo|y\.qq|imgcache\.qq/i.test(coverUrl) ? 'https://y.qq.com/'
      : (/kugou/i.test(coverUrl) ? 'https://www.kugou.com/' : 'https://music.163.com/');

    function snapQQCoverCandidate(raw, size) {
      const allowed = [300, 500, 180, 150, 800, 126, 90, 68];
      const src = String(raw || '');
      if (!/\/music\/photo_new\/T00[12]R\d+x\d+M000/i.test(src)) return '';
      const px = allowed.includes(Number(size)) ? Number(size)
        : allowed.reduce((best, n) => (Math.abs(n - Number(size || 300)) < Math.abs(best - Number(size || 300)) ? n : best), 300);
      return src.replace(/(T00[12]R)\d+x\d+(M000)/i, `$1${px}x${px}$2`);
    }

    async function fetchCoverBytes(target) {
      const proxied = await proxyFetch(target, { referer });
      if (proxied && proxied.error) return proxied;
      if (!proxied || !proxied.buffer || !proxied.buffer.byteLength) {
        return { __binary: true, error: 'Empty cover body', status: 502 };
      }
      try {
        const bytes = new Uint8Array(proxied.buffer);
        const parts = [];
        const step = 0x8000;
        for (let i = 0; i < bytes.length; i += step) {
          parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + step)));
        }
        let mime = String(proxied.contentType || 'image/jpeg').split(';')[0].trim() || 'image/jpeg';
        if (!/^image\//i.test(mime)) mime = 'image/jpeg';
        return {
          __binary: true,
          status: proxied.status || 200,
          contentType: mime,
          dataUrl: `data:${mime};base64,${btoa(parts.join(''))}`,
        };
      } catch (_) {
        return { __binary: true, ...(proxied || {}) };
      }
    }

    let result = await fetchCoverBytes(coverUrl);
    // QQ CDN 404s unsupported sizes (320/120/96…). Retry snapped official sizes.
    if (result && result.error && /photo_new\/T00[12]R\d+x\d+M000/i.test(coverUrl)) {
      const tried = new Set([coverUrl]);
      for (const size of [300, 500, 180, 150]) {
        const next = snapQQCoverCandidate(coverUrl, size);
        if (!next || tried.has(next)) continue;
        tried.add(next);
        result = await fetchCoverBytes(next);
        if (!result.error) break;
      }
    }
    return result;
  }

  if (path === '/api/audio') {
    const audioUrl = url.searchParams.get('url');
    if (!audioUrl) return { __binary: true, error: 'Missing url', status: 400 };
    return {
      __binary: true,
      ...(await proxyFetch(audioUrl, {
        referer: /qqmusic|gtimg|y\.qq/i.test(audioUrl) ? 'https://y.qq.com/'
          : (/kugou/i.test(audioUrl) ? 'https://www.kugou.com/' : 'https://music.163.com/'),
        range: input.headers && input.headers.range,
      })),
    };
  }

  if (path === '/api/beatmap/cache/status') return { ok: true, provider: 'extension-local', enabled: true };

  if (path === '/api/beatmap/cache') {
    if (method === 'GET') {
      const key = url.searchParams.get('key') || '';
      const stored = await chrome.storage.local.get([`beatmap:${key}`]);
      return stored[`beatmap:${key}`] || { ok: false, hit: false };
    }
    if (method === 'POST') {
      const key = body.key || url.searchParams.get('key') || '';
      if (key && body.map) await chrome.storage.local.set({ [`beatmap:${key}`]: { ok: true, hit: true, map: body.map } });
      return { ok: true };
    }
  }

  if (path === '/api/app/version') {
    return { name: 'mineradio-web', productName: 'Mineradio Web', version: '1.1.0-web', update: { configured: false } };
  }

  if (path === '/api/update/latest') {
    return { ok: false, configured: false, updateAvailable: false, message: '网页版请使用桌面安装包更新' };
  }

  return { error: 'NOT_FOUND', path, message: '扩展尚未实现该 API: ' + path };
}

function getExtensionVersion() {
  try {
    return chrome.runtime.getManifest().version || '0.0.0';
  } catch (_) {
    return '0.0.0';
  }
}

export async function getBridgeStatus() {
  const [neteaseCookie, qqCookie, kgCookie] = await Promise.all([
    getNeteaseCookie(),
    getQQCookie(),
    ensureKGCookie(),
  ]);
  const [netease, qq, kg] = await Promise.all([
    getLoginInfo(neteaseCookie),
    getQQLoginStatus(qqCookie),
    getKGLoginStatus(kgCookie),
  ]);
  return {
    version: getExtensionVersion(),
    netease: { loggedIn: netease.loggedIn, nickname: netease.nickname || '', avatar: netease.avatar || '' },
    qq: {
      loggedIn: qq.loggedIn,
      nickname: qq.nickname || '',
      avatar: qq.avatar || '',
      playbackKeyReady: qq.playbackKeyReady,
      vipType: qq.vipType || 0,
      isVip: !!qq.isVip,
      vipLabel: qq.vipLabel || '',
    },
    kg: {
      loggedIn: kg.loggedIn,
      nickname: kg.nickname || '',
      avatar: kg.avatar || '',
      isVip: !!kg.isVip,
      vipType: kg.vipType || 0,
      vipLabel: kg.vipLabel || '',
    },
  };
}
