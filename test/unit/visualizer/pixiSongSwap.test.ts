import { describe, expect, it, vi } from 'vitest';
import { PixiSongSwap } from '@/components/visualizer/pixiSongSwap';

// test/unit/visualizer/pixiSongSwap.test.ts
// tempera / lumiere 共用的两帧换歌交接：第一帧 stage、第二帧 commit；abort 立即 commit，销毁时只丢弃 staged，
// 等交接的 promise 无论哪条路都会 settle。

const createSwap = (stageResult: string | null = 'scene') => {
    const hooks = {
        stage: vi.fn((_song: string) => stageResult),
        commit: vi.fn((_song: string, _staged: string | null) => undefined),
        discard: vi.fn((_staged: string) => undefined),
    };
    return { swap: new PixiSongSwap<string, string>(hooks), hooks };
};

describe('PixiSongSwap', () => {
    it('stages on the first frame and commits on the second', async () => {
        const { swap, hooks } = createSwap();
        const done = swap.begin('next');
        expect(swap.active).toBe(true);
        expect(swap.song).toBe('next');

        swap.advance();
        expect(hooks.stage).toHaveBeenCalledWith('next');
        expect(swap.staged).toBe('scene');
        expect(hooks.commit).not.toHaveBeenCalled();

        swap.advance();
        expect(hooks.commit).toHaveBeenCalledWith('next', 'scene');
        expect(hooks.discard).not.toHaveBeenCalled();
        expect(swap.active).toBe(false);
        await expect(done).resolves.toBeUndefined();
    });

    it('commits immediately when aborted, with whatever was staged', async () => {
        const { swap, hooks } = createSwap();
        const controller = new AbortController();
        const done = swap.begin('next', controller.signal);
        swap.advance();
        controller.abort();
        expect(hooks.commit).toHaveBeenCalledWith('next', 'scene');
        expect(swap.active).toBe(false);
        await expect(done).resolves.toBeUndefined();
    });

    it('only discards the staged scene when settled without commit', async () => {
        const { swap, hooks } = createSwap();
        const done = swap.begin('next');
        swap.advance();
        swap.settle(false);
        expect(hooks.commit).not.toHaveBeenCalled();
        expect(hooks.discard).toHaveBeenCalledWith('scene');
        await expect(done).resolves.toBeUndefined();
    });

    it('commits with null after the staged scene was dropped', () => {
        const { swap, hooks } = createSwap();
        void swap.begin('next');
        swap.advance();
        swap.dropStaged();
        expect(hooks.discard).toHaveBeenCalledWith('scene');
        expect(swap.staged).toBeNull();
        swap.advance();
        expect(hooks.commit).toHaveBeenCalledWith('next', null);
    });

    it('detaches its abort listener once settled', () => {
        const { swap, hooks } = createSwap();
        const controller = new AbortController();
        void swap.begin('next', controller.signal);
        swap.advance();
        swap.advance();
        controller.abort();
        expect(hooks.commit).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when nothing is pending', () => {
        const { swap, hooks } = createSwap();
        swap.advance();
        swap.settle(true);
        swap.dropStaged();
        expect(hooks.stage).not.toHaveBeenCalled();
        expect(hooks.commit).not.toHaveBeenCalled();
        expect(swap.song).toBeNull();
    });
});
