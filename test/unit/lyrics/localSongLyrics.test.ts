import { describe, expect, it } from 'vitest';
import type { LocalSong } from '@/types';
import { resolveLocalSongLyrics, selectLocalSongLyricsSource } from '@/utils/lyrics/localSongLyrics';
import { buildUnifiedLocalSong } from '@/services/playbackAdapters';

// test/unit/lyrics/localSongLyrics.test.ts
// Verifies automatic priority and explicit per-song selections resolve to the actual loaded source.

const buildSong = (patch: Partial<LocalSong> = {}): LocalSong => ({
    id: 'local-song',
    fileName: 'song.flac',
    filePath: 'Library/song.flac',
    title: 'Song',
    titleOrigin: 'import',
    importedMetadata: { title: 'Song', titleSource: 'embedded', artistNames: [], albumName: '' },
    duration: 180000,
    fileSize: 1,
    mimeType: 'audio/flac',
    addedAt: 1,
    hasLocalLyrics: true,
    localLyricsContent: '[00:00.00]Local',
    hasEmbeddedLyrics: true,
    embeddedLyricsContent: '[00:00.00]Embedded',
    matchedLyrics: { lines: [], isWordByWord: false },
    ...patch,
});

describe('local song lyric resolution', () => {
    it('selects the matched online result for an automatic online-first song', async () => {
        const song = buildSong();

        expect(selectLocalSongLyricsSource(song, 'online')).toBe('online');
        await expect(resolveLocalSongLyrics(song, 'online')).resolves.toEqual({
            lyrics: song.matchedLyrics,
            source: 'online',
        });
    });

    it('falls back to local lyrics when an online result is not available', () => {
        expect(selectLocalSongLyricsSource(buildSong({ matchedLyrics: undefined }), 'online')).toBe('local');
    });

    it('keeps an explicit local selection ahead of the automatic online priority', () => {
        expect(selectLocalSongLyricsSource(buildSong({ lyricsSource: 'local' }), 'online')).toBe('local');
    });

    it('a song marked as instrumental shows no lyrics unless local or embedded is picked explicitly', async () => {
        // 「不使用在线数据」会把 lyricsSource 清回自动；标记仍然生效，同目录与内嵌歌词不会自己回来。
        const marked = buildSong({ markedPureMusic: true, matchedIsPureMusic: true, matchedLyrics: undefined });

        expect(selectLocalSongLyricsSource(marked, 'local')).toBe('online');
        expect(selectLocalSongLyricsSource(marked, 'online')).toBe('online');
        await expect(resolveLocalSongLyrics(marked, 'local')).resolves.toEqual({ lyrics: null, source: 'online' });
        expect(buildUnifiedLocalSong({ localSong: marked, matchedSong: null, coverUrl: null, preferOnlineMetadata: false }).isPureMusic).toBe(true);

        expect(selectLocalSongLyricsSource({ ...marked, lyricsSource: 'embedded' }, 'local')).toBe('embedded');
        expect(buildUnifiedLocalSong({ localSong: { ...marked, lyricsSource: 'embedded' }, matchedSong: null, coverUrl: null, preferOnlineMetadata: false }).isPureMusic).toBe(false);
    });
});
