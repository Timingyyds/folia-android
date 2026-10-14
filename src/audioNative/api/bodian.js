import CryptoJS from '../vendor/crypto-es.mjs';
import { noteLibraryStep } from './libraryTrace.js';
import { buildQrDataUrl } from './qrImage.js';
import { noteQrLoginStep, resetQrLoginTrace } from './qrLoginTrace.js';

// Browser/Android adaptation of bodian-music-api@0.1.2. The desktop package uses node:https,
// node:crypto and node:zlib; this implementation uses WebView fetch, crypto-es and browser
// base64 helpers. The operation names and response shapes stay aligned with that package.

const API_ORIGIN = 'https://bd-api.kuwo.cn';
const LYRIC_ORIGIN = 'https://mlyric.kuwo.cn';
const STORAGE_KEY = 'bodianSessionV1';
const QR_TTL_MS = 5 * 60 * 1000;
// Android 的原生桥默认 15 秒；波点取码节点偶发握手慢，单独放宽并重试一次。
const BODIAN_QR_KEY_TIMEOUT_MS = 20000;
const BODIAN_QR_KEY_ATTEMPTS = 2;
const BODIAN_QR_RETRY_DELAY_MS = 500;
const BODIAN_QR_STATUS_TIMEOUT_MS = 30000;

const md5 = value => CryptoJS.MD5(String(value || '')).toString();

const bytesToBase64 = (bytes) => {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
};

const utf8ToBase64 = value => bytesToBase64(new TextEncoder().encode(String(value)));

const base64ToUtf8 = (value) => {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
};

const sessionState = {
  loaded: false,
  revision: 0,
  session: null,
};

const loadSession = () => {
  if (sessionState.loaded) return;
  sessionState.loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.uid && parsed.token) {
      sessionState.session = {
        uid: String(parsed.uid),
        token: String(parsed.token),
        user: parsed.user && typeof parsed.user === 'object' ? parsed.user : null,
      };
    }
  } catch (_) {}
};

const getSession = () => {
  loadSession();
  return sessionState.session;
};

const setSession = (session) => {
  loadSession();
  sessionState.session = session;
  sessionState.revision += 1;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(session)); } catch (_) {}
};

const clearSession = () => {
  loadSession();
  sessionState.session = null;
  sessionState.revision += 1;
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
};

class BodianError extends Error {
  constructor(code, message, upstreamCode) {
    super(message);
    this.name = 'BodianError';
    this.code = code;
    this.upstreamCode = upstreamCode;
  }
}

const signQuery = (path, params, body = '') => {
  const query = new URLSearchParams(params).toString();
  let seed = `kuwotest${Array.from(query).filter(char => /[a-z0-9]/i.test(char)).sort().join('')}`;
  if (body) seed += md5(`${body}kuwotest`);
  return md5(`${seed}${path}`);
};

const desktopHeaders = deviceId => ({
  'User-Agent': 'Dart/3.3 (dart:io)',
  plat: 'win',
  channel: 'W1',
  ver: '1.1.7',
  svrver: '13',
  'api-ver': 'application/json',
  brand: 'Windows',
  net: 'wifi',
  devid: deviceId,
  qimei36: deviceId,
  'Content-Type': 'application/json',
});

const readResponsePayload = async (response) => {
  const fallback = response.clone();
  try {
    return await response.json();
  } catch {
    const contentEncoding = String(response.headers.get('content-encoding') || '').toLowerCase();
    if (contentEncoding.includes('gzip') && typeof DecompressionStream !== 'undefined' && fallback.body) {
      try {
        const stream = fallback.body.pipeThrough(new DecompressionStream('gzip'));
        return await new Response(stream).json();
      } catch (_) {}
    }
    const contentType = response.headers.get('content-type') || 'unknown';
    throw new BodianError(
      'invalid-response',
      `Bodian returned an unreadable response (HTTP ${response.status}, content-type ${contentType})`,
    );
  }
};

const createClient = (deviceId) => ({
  async call(path, options = {}) {
    const {
      params = {},
      body,
      method = 'GET',
      signed = false,
      anonymous = false,
      lyric = false,
      timeoutMs = 0,
    } = options;
    if (!String(path).startsWith('/') || String(path).includes('..')) {
      throw new BodianError('unsupported', 'Invalid Bodian path');
    }
    const session = anonymous ? null : getSession();
    const query = { ...params, uid: String(session?.uid || '-1'), token: session?.token || '' };
    const bodyText = body === undefined ? '' : JSON.stringify(body);
    if (signed) {
      query.timestamp = String(Date.now());
      query.sign = signQuery(path, query, bodyText);
    }
    const url = new URL(path, lyric ? LYRIC_ORIGIN : API_ORIGIN);
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined) url.searchParams.set(key, String(value));
    });
    const headers = desktopHeaders(deviceId);
    if (session) {
      headers.uid = String(session.uid);
      headers.token = session.token;
    }
    const response = await fetch(url.toString(), {
      method,
      headers,
      ...(bodyText ? { body: bodyText } : {}),
      redirect: 'follow',
      ...(Number(timeoutMs) > 0 ? { foliaTimeoutMs: Number(timeoutMs) } : {}),
    });
    let payload = null;
    try { payload = await readResponsePayload(response); } catch (error) {
      if (error instanceof BodianError) throw error;
    }
    if (response.status === 401) {
      throw new BodianError('auth-required', 'Bodian sign-in is required', 401);
    }
    if (!response.ok) {
      throw new BodianError('network', `Bodian HTTP ${response.status}`, response.status);
    }
    if (!payload || Number(payload.code) !== 200) {
      const code = Number(payload?.code);
      if (code === 407) {
        const message = payload?.msg || payload?.message;
        throw new BodianError(
          'region-restricted',
          typeof message === 'string' && message.trim()
            ? message.trim()
            : '由于版权保护，该资源仅限中国大陆地区使用',
          code,
        );
      }
      throw new BodianError(
        code === 11012 ? 'auth-required' : code === 20018 ? 'not-playable' : 'invalid-response',
        `Bodian rejected the request (code ${payload?.code ?? 'missing'})`,
        payload?.code,
      );
    }
    return payload;
  },
});

const mediaId = (value) => {
  const id = String(value ?? '');
  if (!/^\d{1,20}$/.test(id) || /^0+$/.test(id)) {
    throw new BodianError('invalid-response', 'Invalid Bodian media id');
  }
  return id;
};

const pagination = (params, firstPage = 0) => {
  const limit = Number(params.limit ?? 50);
  const offset = Number(params.offset ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
    throw new BodianError('invalid-response', 'Invalid Bodian pagination');
  }
  return { pn: Math.floor(offset / limit) + firstPage, rn: limit };
};

const pageData = (data, params, field) => {
  if (!Array.isArray(data?.[field])) return data;
  const limit = Number(params.limit ?? 50);
  const offset = Number(params.offset ?? 0);
  const raw = data[field];
  const items = raw.slice(offset % limit);
  const pageEnd = (Math.floor(offset / limit) + 1) * limit;
  const total = Number(data.total);
  const knownTotal = data.total != null && Number.isSafeInteger(total) && total >= 0;
  const hasMore = raw.length > 0 && (knownTotal ? pageEnd < total : raw.length === limit);
  return {
    ...data,
    [field]: items,
    bodianPagination: {
      nextOffset: hasMore ? pageEnd : Math.max(offset + items.length, knownTotal ? Math.min(pageEnd, total) : offset + items.length),
      hasMore,
    },
  };
};

const playlistSource = (value) => {
  const source = Number(value ?? 4);
  if (![1, 2, 3, 4, 5, 6].includes(source)) {
    throw new BodianError('invalid-response', 'Invalid Bodian playlist source');
  }
  return source;
};

const moduleId = (value) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 0 || id > 100) {
    throw new BodianError('invalid-response', 'Invalid Bodian home module id');
  }
  return id;
};

const discoverIndex = (value) => {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0 || index > 100) {
    throw new BodianError('invalid-response', 'Invalid Bodian Discover index');
  }
  return index;
};

const page = async (client, path, params, field, firstPage = 0, extra = {}) => {
  const data = (await client.call(`/api/${path}`, {
    params: { ...extra, ...pagination(params, firstPage) },
  })).data;
  return pageData(data, params, field);
};

const callData = async (client, path, params) => (await client.call(`/api/${path}`, { params })).data;

const createCatalogOperations = client => ({
  search: async (params) => {
    if (typeof params.query !== 'string' || !params.query.trim() || params.query.length > 500) {
      throw new BodianError('invalid-response', 'Invalid Bodian search query');
    }
    return page(client, 'search/music/list', params, 'resultList', 0, {
      keyword: params.query.trim(),
      correct: 1,
    });
  },
  song_detail: params => callData(client, 'service/music/info', { musicId: mediaId(params.id) }),
  playlist_detail: params => callData(client, `service/playlist/info/${mediaId(params.id)}`, {
    source: playlistSource(params.source),
  }),
  playlist_tracks: params => page(client, `service/playlist/${mediaId(params.id)}/musicList`, params, 'list', 1, {
    source: playlistSource(params.source),
  }),
  album_detail: params => callData(client, `service/album/${mediaId(params.id)}`),
  album_tracks: params => page(client, `service/album/music/${mediaId(params.id)}`, params, 'resultList'),
  artist_detail: params => callData(client, `service/artist/${mediaId(params.id)}`),
  artist_songs: params => page(client, `service/artist/music/${mediaId(params.id)}`, params, 'resultList'),
  artist_albums: params => page(client, `service/artist/album/${mediaId(params.id)}`, params, 'resultList'),
  recommendations: () => callData(client, 'service/finds/playlist'),
  home_module: params => callData(client, 'service/home/module', { moduleId: moduleId(params.moduleId) }),
  ai_playlist_detail: params => callData(client, 'service/home/aiPlaylistDetail', { index: discoverIndex(params.index) }),
  personal_fm: () => callData(client, 'service/music/recommendList'),
  lyrics: async (params) => {
    const query = `type=lyric&req=2&lrcx=1&rid=${mediaId(params.id)}&songname=&artist=&corp=kuwo&fromchannel=bodian`;
    const result = await client.call('/mobi.s', {
      lyric: true,
      params: { f: 'bodian', q: utf8ToBase64(query) },
    });
    if (typeof result.data?.content !== 'string') {
      throw new BodianError('invalid-response', 'Bodian lyric content is missing');
    }
    return decodeLyrics(base64ToUtf8(result.data.content));
  },
});

const requireSession = () => {
  const session = getSession();
  if (!session) throw new BodianError('auth-required', 'Bodian sign-in is required');
  return session;
};

const collectionPage = (data, params, albums) => {
  const field = albums ? 'albumList' : 'playLists';
  if ((Array.isArray(data) && data.length === 0)
    || (data && typeof data === 'object' && Object.keys(data).length === 0)) {
    return { [field]: [], bodianPagination: { nextOffset: Number(params.offset ?? 0), hasMore: false } };
  }
  if (!Array.isArray(data?.playLists)) {
    throw new BodianError('invalid-response', 'Bodian collected list is missing');
  }
  const result = pageData(data, params, 'playLists');
  return {
    [field]: result.playLists.filter(item => (Number(item?.sourceType) === 6) === albums),
    bodianPagination: result.bodianPagination,
  };
};

const createLibraryOperations = client => {
  const paramsForUser = () => {
    const { uid } = requireSession();
    return { userId: uid, fromUid: uid };
  };
  return {
    async user_playlists(params) {
      const user = paramsForUser();
      const [owned, liked, collected] = await Promise.all([
        callData(client, 'service/playlist/userCreate', user),
        callData(client, 'service/playlist/fond', user),
        callData(client, 'service/collect/4/list', { ...user, ...pagination(params, 1) }),
      ]);
      return { owned, liked, collected: collectionPage(collected, params, false) };
    },
    async user_albums(params) {
      return collectionPage(
        await callData(client, 'service/collect/4/list', { ...paramsForUser(), ...pagination(params, 1) }),
        params,
        true,
      );
    },
    async liked_songs(params) {
      const liked = await callData(client, 'service/playlist/fond', paramsForUser());
      if (!liked?.id) return { list: [], total: 0 };
      return pageData(
        await callData(client, `service/playlist/${liked.id}/musicList`, {
          source: 5,
          ...pagination(params, 1),
        }),
        params,
        'list',
      );
    },
  };
};

const numericId = (value) => {
  const number = Number(mediaId(value));
  if (!Number.isSafeInteger(number)) throw new BodianError('invalid-response', 'Unsafe Bodian media id');
  return number;
};

const updatePlaylist = async (client, playlistId, tracks, remove, revision) => {
  if (sessionState.revision !== revision) {
    throw new BodianError('auth-required', 'Bodian account changed');
  }
  await client.call(`/api/service/playlist/music${remove ? '/delete' : ''}`, {
    method: 'POST',
    signed: true,
    body: { playListId: playlistId, musicIdList: tracks },
  });
  return null;
};

const createMutationOperations = client => {
  const playlistTracks = async (params, remove) => {
    const { uid } = requireSession();
    const revision = sessionState.revision;
    const id = numericId(params.id);
    if (typeof params.trackIds !== 'string' || params.trackIds.length > 2200) {
      throw new BodianError('invalid-response', 'Invalid Bodian track list');
    }
    const tracks = [...new Set(params.trackIds.split(',').map(numericId))];
    if (!tracks.length || tracks.length > 100) {
      throw new BodianError('invalid-response', 'Invalid Bodian track count');
    }
    const owned = await callData(client, 'service/playlist/userCreate', { userId: uid });
    const isOwned = Array.isArray(owned?.playLists)
      && owned.playLists.some(item => String(item.id) === String(id));
    if (!isOwned) {
      const liked = await callData(client, 'service/playlist/fond', { userId: uid });
      if (String(liked?.id) !== String(id)) {
        throw new BodianError('unsupported', 'Bodian playlist is not owned by the current account');
      }
    }
    return updatePlaylist(client, id, tracks, remove, revision);
  };
  return {
    playlist_tracks_add: params => playlistTracks(params, false),
    playlist_tracks_del: params => playlistTracks(params, true),
    async like_song(params) {
      const { uid } = requireSession();
      const revision = sessionState.revision;
      const id = numericId(params.id);
      if (typeof params.liked !== 'boolean') {
        throw new BodianError('invalid-response', 'Invalid Bodian like state');
      }
      const liked = await callData(client, 'service/playlist/fond', { userId: uid });
      return updatePlaylist(client, numericId(liked?.id), [id], !params.liked, revision);
    },
  };
};

const QUALITIES = {
  standard: { format: 'mp3', br: '128kmp3' },
  high: { format: 'mp3', br: '320kmp3' },
  lossless: { format: 'flac', br: '2000kflac' },
};

const validateAudioUrl = (value) => {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.toString();
  } catch {
    throw new BodianError('invalid-response', 'Bodian returned an invalid audio URL');
  }
};

const createPlaybackOperation = (client, deviceId) => async (params) => {
  const id = mediaId(params.id);
  const quality = params.quality === 'hires' ? 'lossless' : params.quality || 'high';
  if (!QUALITIES[quality]) throw new BodianError('unsupported', 'Unsupported Bodian audio quality');
  const freeSign = typeof params.freeSign === 'string' ? params.freeSign : '';
  if (freeSign.length > 4096) throw new BodianError('invalid-response', 'Invalid Bodian playback context');
  const right = (await client.call('/api/play/music/v2/checkRight', {
    params: { musicId: id, freeSign },
    signed: true,
  })).data;
  if (Number(right?.status) === 3) {
    const preview = right.audition;
    if (!preview || !Number.isFinite(Number(preview.start)) || !Number.isFinite(Number(preview.end))) {
      throw new BodianError('not-playable', 'Bodian preview is unavailable');
    }
    return {
      url: validateAudioUrl(preview.https || preview.url),
      quality: 'standard',
      fetchedAt: Date.now(),
      preview: { startTime: Number(preview.start), endTime: Number(preview.end) },
    };
  }
  if (Number(right?.status) === 7) {
    throw new BodianError(getSession() ? 'not-playable' : 'auth-required', 'Bodian requires additional playback rights');
  }
  if (right?.status === undefined) {
    throw new BodianError(getSession() ? 'not-playable' : 'auth-required', 'Bodian playback rights are unavailable');
  }
  const format = QUALITIES[quality];
  const body = { devId: deviceId, musicId: Number(id), ...format, freeSign };
  const audio = (await client.call('/api/play/music/v2/audioUrl', {
    params: { ...body, musicId: id },
    signed: true,
  })).data;
  return {
    url: validateAudioUrl(audio?.audioHttpsUrl || audio?.audioUrl),
    quality,
    fetchedAt: Date.now(),
  };
};

const decodeBodianWordTiming = (content) => {
  const tag = content.match(/\[kuwo:([0-7]+)(?:\]\[.*)?\]/);
  const factors = tag ? parseInt(tag[1], 8) : 11;
  const startFactor = Math.trunc(factors / 10);
  const durationFactor = factors % 10;
  if (!startFactor || !durationFactor) return null;
  return content.replace(/\[kuwo:[^\]]*\]/g, '').replace(/<(-?\d+),(-?\d+)>/g, (_match, left, right) => {
    const a = Number(left);
    const b = Number(right);
    const start = Math.trunc(Math.abs((a + b) / (2 * startFactor)));
    const duration = Math.trunc(Math.abs((a - b) / (2 * durationFactor)));
    return `<${start},${duration}>`;
  });
};

const decodeLyrics = content => ({
  mainText: content.replace(/<-?\d+,-?\d+>/g, '').replace(/\[kuwo:[^\]]*\]/g, ''),
  wordByWordText: /<-?\d+,-?\d+>/.test(content) ? decodeBodianWordTiming(content) : null,
});

const createAuthOperations = (client) => {
  const qrSessions = new Map();
  const currentQr = (key) => {
    const session = qrSessions.get(key);
    if (!session || session.expiresAt <= Date.now()) {
      qrSessions.delete(key);
      return null;
    }
    return session;
  };
  return {
    async login_qr_key() {
      for (const key of qrSessions.keys()) currentQr(key);
      if (qrSessions.size >= 5) throw new BodianError('unavailable', 'Too many pending Bodian logins');
      resetQrLoginTrace();
      let lastError = null;
      for (let attempt = 1; attempt <= BODIAN_QR_KEY_ATTEMPTS; attempt += 1) {
        const startedAt = Date.now();
        noteQrLoginStep('bod:qr:key:start', { attempt });
        try {
          const { data } = await client.call('/api/ucenter/login/qrCode', {
            anonymous: true,
            signed: true,
            timeoutMs: BODIAN_QR_KEY_TIMEOUT_MS,
          });
          if (typeof data?.qrCode !== 'string' || !data.qrCode) {
            throw new BodianError('invalid-response', 'Bodian QR key is missing');
          }
          qrSessions.set(data.qrCode, { expiresAt: Date.now() + QR_TTL_MS, revision: sessionState.revision });
          noteQrLoginStep('bod:qr:key:ok', { attempt, ms: Date.now() - startedAt });
          return { key: data.qrCode };
        } catch (error) {
          lastError = error;
          noteQrLoginStep('bod:qr:key:error', {
            attempt,
            ms: Date.now() - startedAt,
            message: error instanceof Error ? error.message : String(error),
          });
          if (attempt < BODIAN_QR_KEY_ATTEMPTS) {
            await new Promise(resolve => setTimeout(resolve, BODIAN_QR_RETRY_DELAY_MS));
          }
        }
      }
      noteQrLoginStep('bod:qr:key:failed', {
        message: lastError instanceof Error ? lastError.message : String(lastError),
      });
      throw lastError;
    },
    async login_qr_create({ key }) {
      if (!currentQr(key)) throw new BodianError('unavailable', 'Bodian QR code expired');
      const url = new URL('https://bodian-oia.kuwo.cn/bodian/download.html');
      url.search = new URLSearchParams({ pageName: 'login_pc', pt: '3', id: key }).toString();
      // 二维码图本地画（见 qrImage.js）：不再依赖 api.qrserver.com。
      try {
        return { imageUrl: buildQrDataUrl(url.toString()) };
      } catch (_) {
        return {
          imageUrl: `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=3&data=${encodeURIComponent(url.toString())}`,
        };
      }
    },
    async login_qr_check({ key }) {
      const qr = currentQr(key);
      if (!qr) return { state: 'expired' };
      const { data } = await client.call('/api/ucenter/login/qrCodeStatus', {
        params: { qrCode: key },
        anonymous: true,
        signed: true,
        timeoutMs: BODIAN_QR_STATUS_TIMEOUT_MS,
      });
      if (currentQr(key) !== qr || sessionState.revision !== qr.revision) return { state: 'expired' };
      if (Number(data?.status) === 1) return { state: 'waiting' };
      if (Number(data?.status) === 2) {
        qrSessions.delete(key);
        return { state: 'expired' };
      }
      if (Number(data?.status) !== 3) {
        throw new BodianError('invalid-response', 'Unrecognized Bodian QR status');
      }
      let login;
      try {
        login = (await client.call('/api/ucenter/users/login', {
          method: 'POST',
          body: { authType: 10, qrCode: key },
          signed: true,
          anonymous: true,
        })).data;
      } catch (error) {
        if (error.upstreamCode === 11027) return { state: 'scanned' };
        throw error;
      }
      if (currentQr(key) !== qr || sessionState.revision !== qr.revision) return { state: 'expired' };
      const values = [login?.id, login?.uid, login?.userInfo?.id, login?.userInfo?.uid].filter(value => value != null);
      const ids = values.map(value => typeof value === 'number' && !Number.isSafeInteger(value) ? '' : String(value));
      if (!ids.length || !/^[1-9]\d{0,19}$/.test(ids[0]) || ids.some(id => id !== ids[0])) {
        throw new BodianError('invalid-response', 'Bodian returned inconsistent account identity');
      }
      const rawUser = login?.userInfo || login?.user || {};
      const user = {
        id: ids[0],
        nickname: String(rawUser.nickname || ''),
        avatarUrl: String(rawUser.headImg || rawUser.avatarUrl || ''),
      };
      if (typeof login?.token === 'string' && login.token.trim()) {
        setSession({ uid: ids[0], token: login.token, user });
        qrSessions.clear();
        return { state: 'confirmed' };
      }
      throw new BodianError('invalid-response', 'Unrecognized Bodian QR status');
    },
    async login_qr_cancel({ key }) {
      qrSessions.delete(key);
      return null;
    },
    async login_status() {
      const session = getSession();
      if (!session) return null;
      if (session.user?.id !== session.uid) {
        clearSession();
        throw new BodianError('auth-required', 'Bodian session identity is inconsistent');
      }
      return session.user;
    },
    async logout() {
      qrSessions.clear();
      clearSession();
      return null;
    },
  };
};

const BODIAN_OPERATIONS = new Set([
  'search', 'song_detail', 'audio', 'lyrics', 'login_qr_key', 'login_qr_create', 'login_qr_check',
  'login_qr_cancel', 'login_status', 'logout', 'user_playlists', 'user_albums', 'liked_songs',
  'playlist_detail', 'playlist_tracks', 'album_detail', 'album_tracks', 'artist_detail',
  'artist_songs', 'artist_albums', 'recommendations', 'home_module', 'ai_playlist_detail',
  'personal_fm', 'like_song', 'playlist_tracks_add', 'playlist_tracks_del',
]);

const deviceId = (() => {
  const key = 'bodianDeviceId';
  try {
    const existing = localStorage.getItem(key);
    if (/^[a-f0-9]{32}$/i.test(existing || '')) return existing.toLowerCase();
  } catch (_) {}
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const value = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  try { localStorage.setItem(key, value); } catch (_) {}
  return value;
})();

const client = createClient(deviceId);
const operations = {
  ...createAuthOperations(client),
  ...createCatalogOperations(client),
  ...createLibraryOperations(client),
  ...createMutationOperations(client),
  audio: createPlaybackOperation(client, deviceId),
};

export async function handleBodianRequest(operation, params = {}) {
  const revision = sessionState.revision;
  noteLibraryStep('bodian', 'bridge:request', { operation });
  try {
    if (!BODIAN_OPERATIONS.has(operation)) {
      throw new BodianError('unsupported', 'Unsupported Bodian operation');
    }
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      throw new BodianError('invalid-response', 'Invalid Bodian request parameters');
    }
    const result = { ok: true, data: await operations[operation](params) };
    noteLibraryStep('bodian', 'bridge:result', { operation, ok: true });
    return result;
  } catch (error) {
    if (error instanceof BodianError && error.code === 'auth-required' && sessionState.revision === revision) {
      clearSession();
    }
    const errorText = error instanceof Error ? error.message : String(error || '');
    const timedOut = /timed out|timeout|abort|failed to fetch|network/i.test(errorText);
    const result = {
      ok: false,
      error: {
        code: error instanceof BodianError ? error.code : (timedOut ? 'network' : 'invalid-response'),
        message: error instanceof BodianError ? error.message : (errorText || 'Bodian operation failed'),
      },
    };
    noteLibraryStep('bodian', 'bridge:result', {
      operation,
      ok: false,
      code: result.error.code,
      message: result.error.message,
    });
    return result;
  }
}
