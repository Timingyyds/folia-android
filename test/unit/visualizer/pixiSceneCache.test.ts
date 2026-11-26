import { describe, expect, it, vi } from 'vitest';
import { PixiSceneCache } from '@/components/visualizer/pixiSceneCache';

// test/unit/visualizer/pixiSceneCache.test.ts
// sonnet / tempera / lumiere 共用的段落场景缓存：越界不建、±1 之外剪掉（keep 里的保留）、换歌整批换下后
// 一次只销毁一个、运行时销毁时缓存与换下的全部释放。

const createCache = (count = 10) => {
    const hooks = {
        count: () => count,
        build: vi.fn((index: number) => `scene-${index}`),
        destroy: vi.fn((_scene: string) => undefined),
        detach: vi.fn((_scene: string) => undefined),
    };
    return { cache: new PixiSceneCache<string>(hooks), hooks };
};

describe('PixiSceneCache', () => {
    it('builds once per index and refuses out-of-range indices', () => {
        const { cache, hooks } = createCache(3);
        expect(cache.ensure(1)).toBe('scene-1');
        expect(cache.ensure(1)).toBe('scene-1');
        expect(hooks.build).toHaveBeenCalledTimes(1);
        expect(cache.ensure(-1)).toBeNull();
        expect(cache.ensure(3)).toBeNull();
        expect(cache.size).toBe(1);
    });

    it('prunes scenes beyond one paragraph unless kept', () => {
        const { cache, hooks } = createCache();
        [2, 3, 4, 5, 7].forEach(index => cache.ensure(index));
        cache.prune(4, new Set([7]));
        expect(hooks.destroy.mock.calls.map(([scene]) => scene)).toEqual(['scene-2']);
        expect([3, 4, 5, 7].every(index => cache.has(index))).toBe(true);
        cache.prune(4);
        expect(cache.has(7)).toBe(false);
    });

    it('retires the whole cache and frees one retired scene per drain', () => {
        const { cache, hooks } = createCache();
        cache.ensure(0);
        cache.ensure(1);
        cache.retireAll();
        expect(hooks.detach).toHaveBeenCalledTimes(2);
        expect(hooks.destroy).not.toHaveBeenCalled();
        expect(cache.size).toBe(0);
        expect(cache.hasRetired).toBe(true);

        cache.adopt(5, 'staged');
        expect(cache.get(5)).toBe('staged');

        expect(cache.drainRetired()).toBe(true);
        expect(hooks.destroy).toHaveBeenCalledTimes(1);
        expect(cache.drainRetired()).toBe(true);
        expect(cache.drainRetired()).toBe(false);
        expect(cache.hasRetired).toBe(false);
    });

    it('clear keeps retired scenes; destroyAll frees both', () => {
        const { cache, hooks } = createCache();
        cache.ensure(0);
        cache.retireAll();
        cache.ensure(1);
        cache.clear();
        expect(hooks.destroy.mock.calls.map(([scene]) => scene)).toEqual(['scene-1']);
        expect(cache.hasRetired).toBe(true);

        cache.ensure(2);
        cache.destroyAll();
        expect(hooks.destroy.mock.calls.map(([scene]) => scene)).toEqual(['scene-1', 'scene-2', 'scene-0']);
        expect(cache.size).toBe(0);
        expect(cache.hasRetired).toBe(false);
    });
});
