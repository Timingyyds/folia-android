import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureLocalSongCoverAsset } from '../../../src/services/localMusicService';
import { saveLocalSong } from '../../../src/services/db';
import { parseEmbeddedMetadataAsync } from '../../../src/utils/localMetadataWorkerClient';
import type { LocalSong } from '../../../src/types';

// test/unit/services/localMusicCoverlessMemo.test.ts
// Verifies a file without embedded art is parsed once per file revision instead of on every playback.

vi.mock('../../../src/services/db', () => ({
    deleteDirHandle: vi.fn(),
    deleteLocalLibrarySnapshot: vi.fn(),
    deleteLocalSong: vi.fn(),
    deleteLocalSongs: vi.fn(),
    getDirHandles: vi.fn(),
    getFromCache: vi.fn(),
    getLocalLibrarySnapshot: vi.fn(),
    getLocalSongs: vi.fn(),
    saveDirHandles: vi.fn(),
    saveLocalLibrarySnapshot: vi.fn(),
    saveLocalSong: vi.fn(),
    saveLocalSongs: vi.fn(),
    saveToCache: vi.fn(),
}));

vi.mock('../../../src/services/coverCache', () => ({
    removeCachedCover: vi.fn(),
}));

vi.mock('../../../src/utils/localMetadataWorkerClient', () => ({
    parseEmbeddedMetadataAsync: vi.fn(),
}));

vi.mock('../../../src/services/localCoverAssetService', () => ({
    prepareLocalCoverBlob: vi.fn(),
    stageLocalCoverAsset: vi.fn(),
}));

class MutableFileHandle {
    kind = 'file' as const;
    file: File;

    constructor(public name: string, lastModified: number) {
        this.file = new File(['audio'], name, { type: 'audio/mpeg', lastModified });
    }

    async getFile() {
        return this.file;
    }
}

const buildSong = (id: string, fileHandle: MutableFileHandle): LocalSong => ({
    id,
    fileName: fileHandle.name,
    filePath: `/music/${fileHandle.name}`,
    fileHandle: fileHandle as unknown as FileSystemFileHandle,
    title: id,
    titleOrigin: 'import',
    importedMetadata: { title: id, titleSource: 'filename', artistNames: [] },
    duration: 180000,
    fileSize: 5,
    mimeType: 'audio/mpeg',
    addedAt: 1,
});

describe('coverless local song memo', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(parseEmbeddedMetadataAsync).mockResolvedValue({} as Awaited<ReturnType<typeof parseEmbeddedMetadataAsync>>);
    });

    it('parses a coverless file once and reparses only after the file changes', async () => {
        const handle = new MutableFileHandle('coverless.mp3', 1000);
        const song = buildSong('coverless-song', handle);

        expect(await ensureLocalSongCoverAsset(song)).toBe(song);
        expect(await ensureLocalSongCoverAsset(song)).toBe(song);
        expect(parseEmbeddedMetadataAsync).toHaveBeenCalledTimes(1);
        expect(saveLocalSong).not.toHaveBeenCalled();

        handle.file = new File(['audio'], 'coverless.mp3', { type: 'audio/mpeg', lastModified: 2000 });
        await ensureLocalSongCoverAsset(song);
        expect(parseEmbeddedMetadataAsync).toHaveBeenCalledTimes(2);
    });
});
