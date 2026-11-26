import type { UnifiedSong } from '../../../types';
import type { MediaId } from '../../../types/onlineMusic';
import { normalizeQqSong } from './qqNormalize';
import { requestQq } from './qqTransport';

// src/services/onlineMusic/qq/qqSongDetail.ts
// `/getSongInfo` 单曲详情：播放侧的 getSongDetail、搜索结果补 mid、歌单写入补数字 id 都用它。

export const getQqSongDetail = async (id: MediaId): Promise<UnifiedSong | null> => {
    const response = await requestQq<any>('song_info', { songmid: String(id) });
    const track = response?.response?.songinfo?.data?.track_info;
    if (!track || typeof track !== 'object') return null;
    const song = normalizeQqSong(track);
    return song.qqMid ? song : null;
};

const qqSongDetailRequests = new Map<string, Promise<UnifiedSong | null>>();

// 同一首歌的专辑与歌手会各触发一次解析，两次落到同一个 songmid 上，去重掉重复请求。
export const requestQqSongDetail = (songmid: string): Promise<UnifiedSong | null> => {
    const cached = qqSongDetailRequests.get(songmid);
    if (cached) return cached;

    const request = getQqSongDetail(songmid).finally(() => {
        if (qqSongDetailRequests.get(songmid) === request) qqSongDetailRequests.delete(songmid);
    });
    qqSongDetailRequests.set(songmid, request);
    return request;
};

// 一次批量查几首：与上游 0.7.27 保持一致，调用方（omni 的 songDetailsPerRequest）按这个数分组。
export const QQ_SONG_DETAILS_PER_REQUEST = 25;

// 按 id 查一首（播放侧 getSongDetail）：数字 songid 交给原生 /song_info 的 song_id 分支，
// 其余按 songmid 走，见 src/audioNative/qq.ts 的 /song_info。
export const getQqSongDetailById = async (id: MediaId): Promise<UnifiedSong | null> => getQqSongDetail(id);

// 按 id 批量查（播放侧 getSongDetails）：后端没有批量接口，逐首并发查，按入参顺序交回。
export const getQqSongDetails = async (ids: MediaId[]): Promise<(UnifiedSong | null)[]> =>
    Promise.all(ids.map((id) => getQqSongDetail(id)));
