// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SoraBackground from '../../../src/components/visualizer/backgrounds/sora/SoraBackground';
import soraEntry from '../../../src/components/visualizer/backgrounds/sora/entry';
import { motionValue } from 'framer-motion';
import type { AudioBands, Theme } from '../../../src/types';

// test/unit/visualizer/soraBackground.test.ts

const gpu = vi.hoisted(() => ({
    createProgramInfo: vi.fn(() => ({ program: {} })),
    drawBufferInfo: vi.fn(), setUniforms: vi.fn(), deleteProgram: vi.fn(), deleteBuffer: vi.fn(),
}));
vi.mock('twgl.js', () => ({
    getContext: (canvas: HTMLCanvasElement) => ({
        canvas, COLOR_BUFFER_BIT: 1, BLEND: 2, ONE: 3, ONE_MINUS_SRC_ALPHA: 4, POINTS: 5,
        viewport: vi.fn(), clearColor: vi.fn(), clear: vi.fn(), enable: vi.fn(), blendFunc: vi.fn(), useProgram: vi.fn(),
        deleteProgram: gpu.deleteProgram, deleteBuffer: gpu.deleteBuffer,
    }),
    createProgramInfo: gpu.createProgramInfo,
    createBufferInfoFromArrays: () => ({ attribs: { a_index: { buffer: {} } } }),
    resizeCanvasToDisplaySize: vi.fn(), setBuffersAndAttributes: vi.fn(),
    setUniforms: gpu.setUniforms, drawBufferInfo: gpu.drawBufferInfo,
}));

let root: Root;
let host: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let resize: () => void;
let disconnect: ReturnType<typeof vi.fn>;
const theme = { primaryColor: '#ff0000', accentColor: '#00ff00' } as Theme;
const render = (paused: boolean, nextTheme = theme, strict = false) => act(() => {
    const component = createElement(SoraBackground, { theme: nextTheme, isDaylight: false, paused });
    root.render(strict ? createElement(StrictMode, null, component) : component);
});
const tick = (now: number) => act(() => {
    const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(now);
});

beforeEach(() => {
    vi.clearAllMocks(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    frames = new Map(); let handle = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        frames.set(++handle, callback); return handle;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback: () => void) { resize = callback; }
        observe() {} disconnect = disconnect;
    });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
    act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});

describe('Sora background scheduling', () => {
    it('honors the shared static mode even while playback continues', () => {
        act(() => root.render(soraEntry.render({
            theme, isDaylight: false, paused: false, staticMode: true,
            audioPower: motionValue(0), audioBands: {} as AudioBands,
        })));
        tick(100); tick(200);
        expect(gpu.drawBufferInfo).toHaveBeenCalledTimes(1); expect(frames.size).toBe(0);
    });

    it('draws once while paused, then redraws only for palette and size changes', () => {
        render(true); tick(100); expect(gpu.drawBufferInfo).toHaveBeenCalledTimes(1); expect(frames.size).toBe(0);
        tick(200); expect(gpu.drawBufferInfo).toHaveBeenCalledTimes(1);
        render(true, { ...theme, accentColor: '#0000ff' }); tick(300);
        expect(gpu.drawBufferInfo).toHaveBeenCalledTimes(2); expect(frames.size).toBe(0);
        act(() => { resize(); resize(); }); expect(frames.size).toBe(1); tick(400);
        expect(gpu.drawBufferInfo).toHaveBeenCalledTimes(3); expect(gpu.createProgramInfo).toHaveBeenCalledTimes(1);
    });

    it('stops on pause and resumes without advancing by the idle time', () => {
        render(false); tick(100); tick(200);
        expect(gpu.setUniforms.mock.calls.at(-1)?.[1].u_time).toBeCloseTo(0.1);
        render(true); tick(300); expect(frames.size).toBe(0);
        render(false); tick(10000);
        expect(gpu.setUniforms.mock.calls.at(-1)?.[1].u_time).toBeCloseTo(0.1);
        tick(10100); expect(gpu.setUniforms.mock.calls.at(-1)?.[1].u_time).toBeCloseTo(0.2);
    });

    it('releases observers, frames and GPU resources under StrictMode', () => {
        render(false, theme, true); expect(frames.size).toBe(1); tick(100);
        act(() => root.unmount()); expect(frames.size).toBe(0);
        expect(disconnect).toHaveBeenCalledTimes(2);
        expect(gpu.deleteProgram).toHaveBeenCalledTimes(2); expect(gpu.deleteBuffer).toHaveBeenCalledTimes(2);
        root = createRoot(host);
    });
});
