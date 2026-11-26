// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIBRARY_OCCLUSION_SETTLE_MS, useLibraryOcclusionSettled } from '@/hooks/useLibraryOcclusionSettled';

// test/unit/hooks/useLibraryOcclusionSettled.test.ts
// 遮挡稳定标记的时序（B6b）：进入要等首页淡入结束（LIBRARY_OCCLUSION_SETTLE_MS），离开在同一次渲染里立即为 false。

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
/** 每次渲染记下 hook 的返回值；最后一项就是当前值。 */
let renders: boolean[];

const Probe = ({ isOccludingHome }: { isOccludingHome: boolean }) => {
    renders.push(useLibraryOcclusionSettled(isOccludingHome));
    return null;
};

const render = (isOccludingHome: boolean) => {
    act(() => root.render(createElement(Probe, { isOccludingHome })));
};
const advance = (ms: number) => {
    act(() => { vi.advanceTimersByTime(ms); });
};
const current = () => renders[renders.length - 1];

beforeEach(() => {
    vi.useFakeTimers();
    renders = [];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
});

describe('useLibraryOcclusionSettled', () => {
    it('covers at least the home fade-in', () => {
        expect(LIBRARY_OCCLUSION_SETTLE_MS).toBeGreaterThanOrEqual(250);
    });

    it('stays false until the occlusion has held for the settle delay', () => {
        render(false);
        expect(current()).toBe(false);

        render(true);
        expect(current()).toBe(false);
        advance(LIBRARY_OCCLUSION_SETTLE_MS - 1);
        expect(current()).toBe(false);
        advance(1);
        expect(current()).toBe(true);
    });

    it('drops to false in the very render the occlusion ends, without waiting for an effect', () => {
        render(true);
        advance(LIBRARY_OCCLUSION_SETTLE_MS);
        expect(current()).toBe(true);

        const before = renders.length;
        render(false);
        // 条件变 false 的第一次渲染就已经是 false（visualizer 在这次提交里就重新挂载）。
        expect(renders[before]).toBe(false);
        expect(renders.slice(before).every(value => value === false)).toBe(true);
    });

    it('waits the full delay again on re-entry and restarts when the occlusion flickers', () => {
        render(true);
        advance(LIBRARY_OCCLUSION_SETTLE_MS);
        render(false);

        render(true);
        expect(current()).toBe(false);
        advance(LIBRARY_OCCLUSION_SETTLE_MS - 10);
        render(false);
        render(true);
        advance(LIBRARY_OCCLUSION_SETTLE_MS - 10);
        expect(current()).toBe(false);
        advance(10);
        expect(current()).toBe(true);
    });

    it('never settles while nothing occludes (grid, TUI, translucent looks)', () => {
        render(false);
        advance(LIBRARY_OCCLUSION_SETTLE_MS * 10);
        expect(renders.every(value => value === false)).toBe(true);
    });
});
