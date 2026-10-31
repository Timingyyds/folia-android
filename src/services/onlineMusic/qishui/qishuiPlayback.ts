// src/services/onlineMusic/qishui/qishuiPlayback.ts
// 汽水的播放侧：按 id 取单曲、取不加密的播放地址、以及播放前的可用性检查。
// 显式检查是短命的账号事实；播放失败从不改它。

import type { OnlinePlaybackProvider, ProviderAudioSource, ProviderSongAvailability } from '../../../types/onlineMusic';
import { normalizeQishuiSong } from './qishuiNormalize';
import { qishuiSongId } from './qishuiMutations';
import { QishuiRequestError, requestQishui } from './qishuiTransport';

interface QishuiTrackCheck {
    id: string;
    riskResult: number;
    status: number;
}

const checks = new Map<string, { at: number; availability: ProviderSongAvailability }>();
let revision = 0;

export function clearQishuiPlayback() {
    revision += 1;
    checks.clear();
}

/**
 * 最近播放、收藏列表等接口有时只给 base_info，没有 display_info（封面/时长等）。
 * 这类歌在界面上就是「没有封面」。用一次批量 mget 补齐缺的展示字段，
 * 已经有封面的歌完全不动，不额外发请求。
 */
const fillMissingCovers = async (songs: ReturnType<typeof normalizeQishuiSong>[]) => {
    const missing = songs.filter(song => !song.album?.coverUrl).map(song => String(song.id));
    if (!missing.length) return;
    for (let index = 0; index < missing.length; index += 100) {
        const ids = missing.slice(index, index + 100);
        try {
            const rows = await requestQishui<unknown[]>('media_details', { ids });
            const details = new Map<string, ReturnType<typeof normalizeQishuiSong>>();
            for (const raw of rows) {
                try {
                    const detail = normalizeQishuiSong(raw);
                    details.set(String(detail.id), detail);
                } catch { /* 单条解析失败不影响其它歌 */ }
            }
            for (const song of songs) {
                if (song.album?.coverUrl) continue;
                const coverUrl = details.get(String(song.id))?.album?.coverUrl;
                if (coverUrl) song.album = { ...song.album, coverUrl };
            }
        } catch (error) {
            console.warn('[Qishui] Cover enrichment failed', error);
        }
    }
};

export async function readQishuiSongs(raw: unknown[]) {
    const songs = raw.map(normalizeQishuiSong);
    if (!songs.length) return songs;
    await fillMissingCovers(songs);
    const mine = revision;
    try {
        const data = await requestQishui<{ statuses: QishuiTrackCheck[] }>('check_tracks', {
            ids: songs.map(song => String(song.id)),
        });
        if (mine !== revision) return songs;
        const wanted = new Set(songs.map(song => String(song.id)));
        for (const row of data.statuses) {
            if (!wanted.has(row.id) || !Number.isInteger(row.riskResult) || row.riskResult < 0) continue;
            checks.delete(row.id);
            checks.set(row.id, {
                at: Date.now(),
                availability: row.riskResult === 0
                    ? { state: 'playable' }
                    : { state: 'unknown', reason: 'restricted' },
            });
        }
        while (checks.size > 500) checks.delete(checks.keys().next().value!);
    } catch (error) {
        // 可选的检查失败不该藏起本来能读的歌，也不该暗示歌曲下架。
        console.warn('[Qishui] Track availability check failed', error instanceof QishuiRequestError
            ? { code: error.code, upstreamCode: error.upstreamCode, message: error.message }
            : error);
    }
    return songs;
}

// 包里服务端没给这首歌时的原话（qishui-music-api@0.2.2 src/catalog.cjs `track`）。
const TRACK_NOT_RETURNED = 'Qishui did not return the track';

export const qishuiPlayback: OnlinePlaybackProvider = {
    audioQualityLevels: ['standard', 'high', 'lossless', 'hires'],
    // A VIP song's clip plays because third-party players get its whole audio encrypted only, not because of the account.
    previewNoticeKey: 'status.songVipFullUnavailable',
    async getSongDetail(id) {
        let raw: unknown;
        try {
            raw = await requestQishui('song_detail', { id: String(id) });
        } catch (error) {
            if (error instanceof QishuiRequestError && error.code === 'not-playable' && error.message === TRACK_NOT_RETURNED) {
                return null;
            }
            throw error;
        }
        return (await readQishuiSongs([raw]))[0];
    },
    getAudioSource: (song, quality) => requestQishui<ProviderAudioSource>('audio', {
        id: qishuiSongId(song),
        quality,
    }),
    getAvailability(song) {
        const check = checks.get(qishuiSongId(song));
        return check && Date.now() - check.at < 60_000 ? check.availability : { state: 'unknown' };
    },
};
