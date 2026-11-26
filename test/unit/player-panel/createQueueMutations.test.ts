import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '../../../src/types';

// test/unit/player-panel/createQueueMutations.test.ts
// 队列变更里的拖拽移动（moveQueueSong）：写回播放 store 并持久化；没变或越界时什么都不做。
// 「下一首播放」（moveQueueSongToNext）：当前那首在队尾时也落在它后面。
// 每一次就地编辑都带着编辑前后的队列交给预取刷新（prefetchService.refreshPrefetchAfterQueueEdit）。

const mocks = vi.hoisted(() => ({
    setPlayQueue: vi.fn(),
    setStatusMessage: vi.fn(),
    refreshPrefetchAfterQueueEdit: vi.fn(),
}));

vi.mock('../../../src/stores/usePlaybackStore', () => ({ setPlayQueue: mocks.setPlayQueue }));
vi.mock('../../../src/stores/useStatusMessageStore', () => ({ setStatusMessage: mocks.setStatusMessage }));
vi.mock('../../../src/services/prefetchService', () => ({ refreshPrefetchAfterQueueEdit: mocks.refreshPrefetchAfterQueueEdit }));

const { createQueueMutations } = await import('../../../src/components/app/player-panel/createQueueMutations');

const song = (id: number): SongResult => ({
    id,
    name: `Song ${id}`,
    artists: [],
    album: { id: 1, name: 'Album' },
    durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: String(id) },
} as SongResult);

const setup = ({ count = 4, currentIndex = 0 }: { count?: number; currentIndex?: number } = {}) => {
    const playQueue = Array.from({ length: count }, (_, index) => song(index + 1));
    const persistLastPlaybackCache = vi.fn(async () => {});
    const currentSong = playQueue[currentIndex] ?? null;
    const mutations = createQueueMutations({
        currentSong,
        playQueue,
        persistLastPlaybackCache,
        t: key => key,
        queueAddBehavior: 'append',
        audioQuality: 'high',
        userId: 'user-1',
    });
    return { playQueue, currentSong, persistLastPlaybackCache, mutations };
};

const ids = (queue: SongResult[]) => queue.map(item => item.id);

beforeEach(() => {
    mocks.setPlayQueue.mockReset();
    mocks.setStatusMessage.mockReset();
    mocks.refreshPrefetchAfterQueueEdit.mockReset();
});

describe('createQueueMutations.moveQueueSong', () => {
    it('moves one song to the target index, writes the queue and persists it', () => {
        const { playQueue, persistLastPlaybackCache, mutations } = setup();
        mutations.moveQueueSong(3, 1);
        const expected = [playQueue[0], playQueue[3], playQueue[1], playQueue[2]];
        expect(mocks.setPlayQueue).toHaveBeenCalledWith(expected);
        expect(persistLastPlaybackCache).toHaveBeenCalledWith(playQueue[0], expected);
        expect(playQueue.map(item => item.id)).toEqual([1, 2, 3, 4]);
    });

    it('does nothing for a no-op or an out-of-range move', () => {
        const { persistLastPlaybackCache, mutations } = setup();
        mutations.moveQueueSong(2, 2);
        mutations.moveQueueSong(0, 4);
        mutations.moveQueueSong(-1, 0);
        expect(mocks.setPlayQueue).not.toHaveBeenCalled();
        expect(persistLastPlaybackCache).not.toHaveBeenCalled();
        expect(mocks.refreshPrefetchAfterQueueEdit).not.toHaveBeenCalled();
    });
});

describe('createQueueMutations.moveQueueSongToNext', () => {
    it('puts the song right after the playing one, even when the playing one is last', () => {
        // [1, 2, 3] 播 3：对 1 点「下一首播放」应得 [2, 3, 1]（以前目标被夹到队尾前，得到 [2, 1, 3]）。
        const { mutations } = setup({ count: 3, currentIndex: 2 });
        mutations.moveQueueSongToNext(0);
        expect(ids(mocks.setPlayQueue.mock.calls[0][0])).toEqual([2, 3, 1]);
    });

    it('moves forward and backward around a playing song in the middle', () => {
        const first = setup({ count: 5, currentIndex: 1 });
        first.mutations.moveQueueSongToNext(4);
        expect(ids(mocks.setPlayQueue.mock.calls[0][0])).toEqual([1, 2, 5, 3, 4]);
        const second = setup({ count: 5, currentIndex: 3 });
        second.mutations.moveQueueSongToNext(0);
        expect(ids(mocks.setPlayQueue.mock.calls[1][0])).toEqual([2, 3, 4, 1, 5]);
    });

    it('does nothing for the playing song, the song already next, or an out-of-range index', () => {
        const { mutations } = setup({ count: 4, currentIndex: 1 });
        mutations.moveQueueSongToNext(1);
        mutations.moveQueueSongToNext(2);
        mutations.moveQueueSongToNext(4);
        mutations.moveQueueSongToNext(-1);
        expect(mocks.setPlayQueue).not.toHaveBeenCalled();
    });

    it('moves to the front when the playing song is not in the queue', () => {
        const playQueue = [song(1), song(2), song(3)];
        const mutations = createQueueMutations({
            currentSong: song(9),
            playQueue,
            persistLastPlaybackCache: vi.fn(async () => {}),
            t: key => key,
            queueAddBehavior: 'append',
            audioQuality: 'high',
        });
        mutations.moveQueueSongToNext(2);
        expect(ids(mocks.setPlayQueue.mock.calls[0][0])).toEqual([3, 1, 2]);
    });
});

describe('createQueueMutations prefetch refresh', () => {
    it('hands every in-place edit the queue before and after it', () => {
        const { playQueue, currentSong, mutations } = setup();
        mutations.moveQueueSong(3, 1);
        mutations.moveQueueSongToNext(3);
        mutations.moveQueueSongToEnd(1);
        mutations.removeQueueSong(2);
        mutations.applyQueueBatchOperation('end', [1]);
        expect(mocks.refreshPrefetchAfterQueueEdit).toHaveBeenCalledTimes(5);
        for (const [index, call] of mocks.refreshPrefetchAfterQueueEdit.mock.calls.entries()) {
            expect(call[0]).toBe(currentSong);
            expect(call[1]).toBe(playQueue);
            expect(call[2]).toBe(mocks.setPlayQueue.mock.calls[index][0]);
            expect(call[3]).toBe('high');
            expect(call[4]).toBe('user-1');
        }
    });
});
