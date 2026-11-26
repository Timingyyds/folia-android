import 'fake-indexeddb/auto';
import Dexie, { RangeSet } from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appDatabase } from '../../../src/services/appDatabase';
import { getLocalLibraryCatalogSnapshot } from '../../../src/services/localLibraryEntityRepository';
import type { LocalLibraryAssignment, LocalLibraryEntity } from '../../../src/types/localLibrary';

// test/unit/services/localLibraryCatalogSnapshotCache.test.ts
// Verifies the catalog snapshot is reused until a catalog write commits, and bypassed inside transactions.

const buildArtist = (id: string): LocalLibraryEntity => ({
    id,
    kind: 'artist',
    displayName: id,
    aliases: [id],
    normalizedAliases: [id],
    createdAt: 1,
    updatedAt: 1,
});

const buildAssignment = (songId: string, artistId: string): LocalLibraryAssignment => ({
    songId,
    artistEntityIds: [artistId],
    artistOrigin: 'import',
    albumOrigin: 'import',
    updatedAt: 1,
});

// storagemutated 在事务 oncomplete 里同步触发，写 promise resolve 后再让一拍，确保监听已经跑过。
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('local library catalog snapshot cache', () => {
    beforeEach(async () => {
        await appDatabase.delete();
        await appDatabase.open();
        await flush();
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await appDatabase.delete();
    });

    it('reuses the snapshot while the catalog tables are unchanged', async () => {
        await appDatabase.local_library_entities.put(buildArtist('artist-a'));
        await flush();
        const first = await getLocalLibraryCatalogSnapshot();
        const entityRead = vi.spyOn(appDatabase.local_library_entities, 'toArray');

        const second = await getLocalLibraryCatalogSnapshot();

        expect(second).toBe(first);
        expect(entityRead).not.toHaveBeenCalled();
    });

    it('ignores writes to unrelated tables', async () => {
        const first = await getLocalLibraryCatalogSnapshot();
        await appDatabase.session.put('value', 'unrelated-key');
        await flush();

        expect(await getLocalLibraryCatalogSnapshot()).toBe(first);
    });

    it('rereads after an entity or assignment write commits', async () => {
        const empty = await getLocalLibraryCatalogSnapshot();
        expect(empty.entities).toHaveLength(0);

        await appDatabase.local_library_entities.put(buildArtist('artist-b'));
        await flush();
        const withEntity = await getLocalLibraryCatalogSnapshot();
        expect(withEntity.entities.map(entity => entity.id)).toEqual(['artist-b']);

        await appDatabase.local_library_assignments.put(buildAssignment('song-1', 'artist-b'));
        await flush();
        const withAssignment = await getLocalLibraryCatalogSnapshot();
        expect(withAssignment.assignments.map(assignment => assignment.songId)).toEqual(['song-1']);
    });

    it('rereads after the database is deleted and recreated', async () => {
        await appDatabase.local_library_entities.put(buildArtist('artist-c'));
        await flush();
        expect((await getLocalLibraryCatalogSnapshot()).entities).toHaveLength(1);

        await appDatabase.delete();
        await appDatabase.open();
        await flush();

        expect((await getLocalLibraryCatalogSnapshot()).entities).toHaveLength(0);
    });

    it('rereads after a back/forward cache restore signals every table', async () => {
        const first = await getLocalLibraryCatalogSnapshot();

        Dexie.on.storagemutated.fire({ all: new RangeSet(-Infinity, [[]]) });

        expect(await getLocalLibraryCatalogSnapshot()).not.toBe(first);
    });

    it('reads uncommitted writes inside a transaction instead of the cache', async () => {
        await getLocalLibraryCatalogSnapshot();

        const insideTransaction = await appDatabase.transaction(
            'rw',
            [appDatabase.local_library_entities, appDatabase.local_library_assignments],
            async () => {
                await appDatabase.local_library_entities.put(buildArtist('artist-d'));
                return await getLocalLibraryCatalogSnapshot();
            },
        );

        expect(insideTransaction.entities.map(entity => entity.id)).toEqual(['artist-d']);
    });
});
