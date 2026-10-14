import { useMemo } from 'react';
import { usePlaybackStore } from '../../../state/usePlaybackStore';
import { getPlaybackSongKey } from '../../../lib/appPlaybackGuards';

// src/library/suites/bravais/useBravaisPlaybackMarks.ts
// 正在播放的那首、已在队列里的歌（按播放键）：surface 据此给层描述标 nowPlayingKey / queuedKeys（正在播放的磁贴
// 画 is-current，聚焦卡显示「✓ 已在队列」）。只订阅歌曲身份与队列引用，播放进度不会让它重算。

const NO_KEYS: ReadonlySet<string> = new Set();

export const useBravaisPlaybackMarks = () => {
    const currentSong = usePlaybackStore(state => state.currentSong);
    const playQueue = usePlaybackStore(state => state.playQueue);
    const playbackKey = useMemo(() => (currentSong ? getPlaybackSongKey(currentSong) : null), [currentSong]);
    const queuedPlaybackKeys = useMemo<ReadonlySet<string>>(
        () => (playQueue.length ? new Set(playQueue.map(getPlaybackSongKey)) : NO_KEYS),
        [playQueue],
    );
    return { playbackKey, queuedPlaybackKeys };
};
