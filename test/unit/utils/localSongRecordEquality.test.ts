import { describe, expect, it } from 'vitest';
import { isSameLocalSongRecord } from '../../../src/utils/localSongRecordEquality';
import type { LocalSong } from '../../../src/types';

// test/unit/utils/localSongRecordEquality.test.ts
// Verifies local-song records compare by persisted content rather than identity.

const buildSong = (overrides: Partial<LocalSong> = {}): LocalSong => ({
    id: 'song-1',
    fileName: 'song.mp3',
    filePath: '/music/song.mp3',
    title: 'Song',
    titleOrigin: 'import',
    importedMetadata: { title: 'Song', titleSource: 'filename', artistNames: ['Artist'] },
    duration: 180000,
    fileSize: 1024,
    mimeType: 'audio/mpeg',
    addedAt: 1,
    ...overrides,
});

describe('isSameLocalSongRecord', () => {
    it('treats structurally equal copies as the same record', () => {
        const lyrics = { lines: [{ text: 'a', startTime: 0, endTime: 1 }] } as unknown as LocalSong['matchedLyrics'];
        expect(isSameLocalSongRecord(
            buildSong({ matchedLyrics: lyrics }),
            buildSong({ matchedLyrics: structuredClone(lyrics) }),
        )).toBe(true);
    });

    it('ignores the in-memory file handle and keys set to undefined', () => {
        expect(isSameLocalSongRecord(
            buildSong({ fileHandle: {} as FileSystemFileHandle, matchedLyrics: undefined }),
            buildSong(),
        )).toBe(true);
    });

    it('detects changed persisted fields, including nested ones', () => {
        expect(isSameLocalSongRecord(buildSong(), buildSong({ localCoverAssetId: 'sha256:x' }))).toBe(false);
        expect(isSameLocalSongRecord(
            buildSong(),
            buildSong({ importedMetadata: { title: 'Song', titleSource: 'filename', artistNames: ['Other'] } }),
        )).toBe(false);
        expect(isSameLocalSongRecord(
            buildSong({ onlineMetadata: { source: 'netease', artists: [], matchedAt: 1 } as unknown as LocalSong['onlineMetadata'] }),
            buildSong({ onlineMetadata: { source: 'netease', artists: [], matchedAt: 2 } as unknown as LocalSong['onlineMetadata'] }),
        )).toBe(false);
    });

    it('compares non-plain objects by identity', () => {
        expect(isSameLocalSongRecord(
            buildSong({ ...({ extra: new Date(1) } as object) }),
            buildSong({ ...({ extra: new Date(1) } as object) }),
        )).toBe(false);
    });
});
