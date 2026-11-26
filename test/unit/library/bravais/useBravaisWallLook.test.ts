// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLibraryWallLookStore } from '@/stores/useLibraryWallLookStore';
import { useBravaisWallLook } from '@/library/suites/bravais/useBravaisWallLook';

// test/unit/library/bravais/useBravaisWallLook.test.ts
// bravais stage 的遮挡上报（B6b③）：实色档报 true（宿主据此在首页完全显示后卸载 visualizer），部分透明 / 全透明报
// false；档位变了重新报，换窗数或无关的重渲染不重复报。
// 2026-10-09：「始终透明」的缝也是透光处——实色档 + 透明缝报 false；透出画面的歌词 / 模糊只在墙或缝透着时报 true；
// 透明开着时预设不生效（seamStyle 为 null）。

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let report: ReturnType<typeof vi.fn<(occludes: boolean) => void>>;
let reportBackdrop: ReturnType<typeof vi.fn<(backdrop: { lyrics: boolean; blur: boolean }) => void>>;
let lastSeamLook: ReturnType<typeof useBravaisWallLook>['seamLook'] | null = null;

const Probe = ({ tick }: { tick: number }) => {
    lastSeamLook = useBravaisWallLook(report, reportBackdrop).seamLook;
    return createElement('span', null, tick);
};

const render = (tick = 0) => {
    act(() => root.render(createElement(Probe, { tick })));
};

beforeEach(() => {
    report = vi.fn<(occludes: boolean) => void>();
    reportBackdrop = vi.fn<(backdrop: { lyrics: boolean; blur: boolean }) => void>();
    useLibraryWallLookStore.setState({
        look: 'partial',
        windowsPerBlock: 3,
        seamClear: false,
        seamStyle: 'paper',
        backdropLyrics: false,
        backdropBlur: false,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

describe('useBravaisWallLook', () => {
    it('reports no occlusion while any part of the wall lets the player through', () => {
        render();
        expect(report.mock.calls).toEqual([[false]]);
        act(() => useLibraryWallLookStore.setState({ look: 'clear' }));
        expect(report.mock.calls).toEqual([[false], [false]]);
    });

    it('reports occlusion on the solid look and drops it when the look turns see-through again', () => {
        useLibraryWallLookStore.setState({ look: 'solid' });
        render();
        expect(report).toHaveBeenLastCalledWith(true);
        act(() => useLibraryWallLookStore.setState({ look: 'partial' }));
        expect(report).toHaveBeenLastCalledWith(false);
        act(() => useLibraryWallLookStore.setState({ look: 'solid' }));
        expect(report).toHaveBeenLastCalledWith(true);
    });

    it('does not report again for a window count change or an unrelated render', () => {
        render(0);
        const calls = report.mock.calls.length;
        act(() => useLibraryWallLookStore.setState({ windowsPerBlock: 5 }));
        render(1);
        expect(report.mock.calls.length).toBe(calls);
    });

    it('counts a clear seam as a way through: the solid wall then reports no occlusion', () => {
        useLibraryWallLookStore.setState({ look: 'solid' });
        render();
        expect(report).toHaveBeenLastCalledWith(true);
        act(() => useLibraryWallLookStore.setState({ seamClear: true }));
        expect(report).toHaveBeenLastCalledWith(false);
        act(() => useLibraryWallLookStore.setState({ seamClear: false }));
        expect(report).toHaveBeenLastCalledWith(true);
    });

    it('reports the backdrop lyrics and blur only while the wall or the seam lets the player through', () => {
        useLibraryWallLookStore.setState({ look: 'solid', backdropLyrics: true, backdropBlur: true });
        render();
        expect(reportBackdrop).toHaveBeenLastCalledWith({ lyrics: false, blur: false });
        act(() => useLibraryWallLookStore.setState({ look: 'partial' }));
        expect(reportBackdrop).toHaveBeenLastCalledWith({ lyrics: true, blur: true });
        act(() => useLibraryWallLookStore.setState({ look: 'solid', seamClear: true }));
        expect(reportBackdrop).toHaveBeenLastCalledWith({ lyrics: true, blur: true });
        act(() => useLibraryWallLookStore.setState({ backdropLyrics: false }));
        expect(reportBackdrop).toHaveBeenLastCalledWith({ lyrics: false, blur: true });
        expect(lastSeamLook?.backdropBlur).toBe(true);
    });

    it('drops the solid preset while the seam is clear and keeps it for later', () => {
        useLibraryWallLookStore.setState({ seamStyle: 'dots' });
        render();
        expect(lastSeamLook).toEqual({ seamClear: false, seamStyle: 'dots', backdropBlur: false });
        act(() => useLibraryWallLookStore.setState({ seamClear: true }));
        expect(lastSeamLook).toEqual({ seamClear: true, seamStyle: null, backdropBlur: false });
        act(() => useLibraryWallLookStore.setState({ seamClear: false }));
        expect(lastSeamLook?.seamStyle).toBe('dots');
    });
});
