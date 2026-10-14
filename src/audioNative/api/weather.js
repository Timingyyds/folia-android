import { getNeteaseCookie } from './cookies.js';
import { handleSearch } from './netease.js';

export async function fetchIpWeatherLocation() {
  try {
    const resp = await fetch('http://ip-api.com/json/?fields=status,message,country,regionName,city,lat,lon,timezone,query&lang=zh-CN');
    const data = await resp.json();
    if (data.status !== 'success') throw new Error(data.message || 'IP location failed');
    return {
      city: data.city || '',
      region: data.regionName || '',
      country: data.country || '',
      lat: data.lat,
      lon: data.lon,
      timezone: data.timezone || '',
      ip: data.query || '',
    };
  } catch (err) {
    return { city: '', region: '', country: '', lat: null, lon: null, timezone: '', ip: '', error: err.message };
  }
}

async function fetchOpenMeteo(lat, lon, timezone) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,is_day,precipitation',
    timezone: timezone || 'auto',
  });
  const resp = await fetch('https://api.open-meteo.com/v1/forecast?' + params.toString());
  return resp.json();
}

const MOOD_PRESETS = {
  sunny: {
    key: 'sunny',
    title: '晴光电台',
    tagline: '阳光正好，放一组明亮耐听的歌',
    keywords: ['阳光 流行', 'summer pop', 'City Pop', '轻快 华语'],
  },
  cloudy: {
    key: 'cloudy',
    title: '云层电台',
    tagline: '阴天也适合慢慢听',
    keywords: ['chill 氛围', 'indie pop', '阴天 歌单', 'Lo-fi'],
  },
  rain: {
    key: 'rain',
    title: '雨声电台',
    tagline: '雨天配慢节奏和温柔声线',
    keywords: ['雨天 安静', 'lofi rain', 'R&B', '陈奕迅'],
  },
  snow: {
    key: 'snow',
    title: '雪夜电台',
    tagline: '降温了，听点温暖的歌',
    keywords: ['冬日 温暖', '民谣', '治愈 华语', '慢歌'],
  },
  fog: {
    key: 'fog',
    title: '雾感电台',
    tagline: '低饱和天气，低饱和旋律',
    keywords: ['ambient pop', '氛围 电子', '慢节奏', '治愈'],
  },
  storm: {
    key: 'storm',
    title: '风暴电台',
    tagline: '外面很吵，里面要稳',
    keywords: ['摇滚 能量', '电子 节奏', '雨夜 摇滚', '鼓点'],
  },
};

function weatherMoodKey(code) {
  const c = Number(code);
  if ([0, 1].includes(c)) return 'sunny';
  if ([2, 3].includes(c)) return 'cloudy';
  if ([45, 48].includes(c)) return 'fog';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(c)) return 'rain';
  if ([71, 73, 75, 77, 85, 86].includes(c)) return 'snow';
  if ([95, 96, 99].includes(c)) return 'storm';
  return 'cloudy';
}

function uniqueSongs(songs) {
  const seen = new Set();
  return (songs || []).filter((song) => {
    const key = String(song && (song.id || `${song.name}|${song.artist}`) || '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return !!(song && song.name);
  });
}

function seedQueriesForMood(mood) {
  return (mood && mood.keywords ? mood.keywords.slice(0, 4) : ['chill 氛围', '今日推荐']);
}

export async function buildWeatherRadio(query) {
  query = query || {};
  let lat = query.lat != null ? Number(query.lat) : NaN;
  let lon = query.lon != null ? Number(query.lon) : NaN;
  let city = String(query.city || query.q || '').trim();
  let timezone = String(query.timezone || '').trim();
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    const loc = await fetchIpWeatherLocation();
    lat = loc.lat;
    lon = loc.lon;
    if (!city) city = loc.city || '';
    if (!timezone) timezone = loc.timezone || '';
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return {
      ok: false,
      error: 'LOCATION_UNAVAILABLE',
      weather: null,
      radio: { title: '天气电台', subtitle: '暂时无法定位，请先搜索歌曲。', seedQueries: [], songs: [] },
    };
  }
  const forecast = await fetchOpenMeteo(lat, lon, timezone);
  const current = forecast.current || {};
  const moodKey = weatherMoodKey(current.weather_code);
  const mood = MOOD_PRESETS[moodKey] || MOOD_PRESETS.cloudy;
  const queries = seedQueriesForMood(mood);
  const cookie = await getNeteaseCookie();
  let songs = [];
  const settled = await Promise.allSettled(queries.map((q) => handleSearch(q, 8, cookie)));
  settled.forEach((result) => {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) songs = songs.concat(result.value);
  });
  songs = uniqueSongs(songs).slice(0, 18);
  const title = city ? `${city} · ${mood.title}` : mood.title;
  const subtitle = `${mood.tagline} · ${Math.round(current.temperature_2m || 0)}°C`;
  return {
    ok: true,
    weather: {
      city,
      lat,
      lon,
      timezone: forecast.timezone || timezone,
      mood: moodKey,
      moodPreset: mood,
      temperature: current.temperature_2m,
      humidity: current.relative_humidity_2m,
      code: current.weather_code,
      isDay: current.is_day,
      precipitation: current.precipitation,
    },
    radio: {
      title,
      subtitle,
      seedQueries: queries,
      songs,
      updatedAt: Date.now(),
    },
  };
}
