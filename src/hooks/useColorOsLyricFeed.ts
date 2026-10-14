import React from 'react';
import {
    clearColorOsLyricInfo,
    getColorOsLyricsSupport,
    publishColorOsLyricInfo,
} from '../platform/foliaColorOsLyrics';
import { isCapacitorAndroid } from '../platform/runtime';
import { getSongAlbumLabel, getSongArtistLabel } from '../svc/onlineMusic/songMetadata';
import type { SongResult } from '../types';
import type { LyricData } from '../types';
import { getPlaybackSongKey } from '../lib/appPlaybackGuards';
import { buildColorOsLyricInfo } from '../lib/lyrics/colorOsLyricInfo';

// src/hooks/useColorOsLyricFeed.ts
// 把当前歌曲与歌词写进 MediaSession 的 MediaMetadata["lyricInfo"]，
// 让 ColorOS 的原生锁屏 / AOD 歌词页直接消费（装了 Bridge 之后再由它做逐字与样式增强）。
//
// 和 Lyricon 那条路最大的差别：**这里不需要任何第三方 App 或 Xposed 模块** ——
// ColorOS SystemUI 自己认这个键。所以开关不交给用户，只由原生侧的 ROM 探测决定：
// 不是 ColorOS 16+ 就整条通道不启动。
//
// 另一个差别是**不需要喂进度**：SystemUI 从 PlaybackState 自己取时钟往前推，
// 我们在段内一句话都不说，只在换歌 / 歌词换源时写一次。

type UseColorOsLyricFeedOptions = {
    lyrics: LyricData | null;
    song: SongResult | null;
    /** 时长（秒）。 */
    duration?: number;
};

export const useColorOsLyricFeed = ({
    lyrics,
    song,
    duration,
}: UseColorOsLyricFeedOptions): void => {
    const enabled = isCapacitorAndroid();
    const [supported, setSupported] = React.useState(false);

    // 判定每进程只做一次：原生那边要读 ROM 属性（必要时还要跑一次 getprop），
    // 结果在 platform 层缓存，这里只取回来决定要不要启动整条通道。
    React.useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        void getColorOsLyricsSupport().then((result) => {
            if (!cancelled) setSupported(result.supported);
        });
        return () => {
            cancelled = true;
        };
    }, [enabled]);

    const active = enabled && supported;
    const songKey = song ? getPlaybackSongKey(song) : null;

    /**
     * 换曲代次。
     *
     * 协议要求真实换曲时单调递增，而同一首歌的歌词/元数据补齐不递增 ——
     * Bridge 靠它分辨「这是新的歌」还是「同一首歌的迟到数据」。
     */
    const generationRef = React.useRef(1);
    const lastSongKeyRef = React.useRef<string | null>(null);
    React.useEffect(() => {
        if (lastSongKeyRef.current === songKey) return;
        lastSongKeyRef.current = songKey;
        generationRef.current += 1;
    }, [songKey]);

    React.useEffect(() => {
        if (!active) return;
        // 没有歌 / 这首歌没词：宁可清掉也不要把上一首的歌词留在锁屏上。
        if (!songKey || !lyrics?.lines?.length) {
            void clearColorOsLyricInfo();
            return;
        }
        const built = buildColorOsLyricInfo({
            title: song?.name ?? '',
            artist: song ? getSongArtistLabel(song) : '',
            album: song ? getSongAlbumLabel(song) : '',
            songId: song?.id == null ? null : String(song.id),
            durationMs: Math.max(0, Math.round((duration ?? 0) * 1000)),
            lines: lyrics.lines,
            isWordByWord: lyrics.isWordByWord === true,
            sessionGeneration: generationRef.current,
        });
        // 拼不出来（全是空行 / 体积越界）就当没词，别塞个空壳进去。
        if (!built) {
            void clearColorOsLyricInfo();
            return;
        }
        // songKey 必须一起过去：原生拿它跟当前 metadata 上的歌对齐，
        // 对不上就拒绝 —— 「旧异步结果覆盖新歌」正是协议点名要防的。
        void publishColorOsLyricInfo(built.lyricInfo, built.hasTranslation, songKey);
    }, [active, songKey, song, lyrics, duration]);
};
