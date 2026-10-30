import type { SongResult } from '../../types';
import { getPlaybackSongKey, getPlaybackSourceRef } from '../../utils/appPlaybackGuards';

// src/services/onlineMusic/resourceKeys.ts

export type SongResourceKind = 'audio' | 'lyric' | 'cover' | 'theme' | 'replayGain';

/**
 * 歌词缓存要带「当时用的是哪个歌词源」。
 *
 * 为什么：自动匹配会按「首选源」的顺序去各平台找，找到的第一个就留下。缓存键若只按歌曲算，
 * 用户改了首选源以后，这首歌仍会命中旧源的缓存，设置看起来"切换没用"、要等很久才变。
 * 把偏好源并进键里，换源就等于换了一份缓存，立刻按新偏好重新匹配。
 * 其他 kind（音频、封面等）与歌词源无关，键不变。
 */
export const getSongResourceCacheKey = (
    kind: SongResourceKind,
    song: SongResult,
    lyricSource?: string | null,
): string => {
    const sourceRef = getPlaybackSourceRef(song);
    const versionedKind = kind === 'cover'
        && sourceRef.kind === 'online'
        && sourceRef.providerId === 'kugou'
        ? 'cover_v2'
        : kind;
    // 只有歌词带源；`none` 表示自动匹配没开（此时与偏好无关，键保持稳定）。
    const sourceSuffix = kind === 'lyric' && lyricSource ? `@${lyricSource}` : '';
    return `${versionedKind}_${getPlaybackSongKey(song)}${sourceSuffix}`;
};

export const getLegacySongResourceCacheKeys = (kind: SongResourceKind, song: SongResult): string[] => {
    const sourceRef = getPlaybackSourceRef(song);
    if (sourceRef.kind !== 'online' || sourceRef.providerId !== 'netease') return [];
    return [
        ...(sourceRef.variant === 'cloud' ? [`${kind}_cloud_${sourceRef.mediaId}`] : []),
        `${kind}_${sourceRef.mediaId}`,
    ];
};
