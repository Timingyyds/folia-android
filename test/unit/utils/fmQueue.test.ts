import { describe, expect, it } from 'vitest';
import type { SongResult } from '@/types';
import { freshFmSongs } from '@/utils/fmQueue';

// test/unit/utils/fmQueue.test.ts

const online = (mediaId: string): SongResult => ({
    id: mediaId,
    name: mediaId,
    sourceRef: { kind: 'online', providerId: 'qq', mediaId },
} as unknown as SongResult);

describe('freshFmSongs', () => {
    // 队列按歌曲键找当前曲目：同一首歌出现两次会让「下一首」跳回前一次的位置。
    it('keeps only songs the queue does not hold yet, without repeats inside the batch', () => {
        const queue = [online('a'), online('b')];
        expect(freshFmSongs(queue, [online('b'), online('c'), online('c'), online('d')]).map(song => song.id))
            .toEqual(['c', 'd']);
    });

    it('returns nothing when the whole batch is already queued', () => {
        expect(freshFmSongs([online('a')], [online('a')])).toEqual([]);
    });
});
