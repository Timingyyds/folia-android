import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveWallHandoffRole, useWallHandoffStore, type WallHandoffTiming } from '../../../src/stores/useWallHandoffStore';
import { resolveWallHandoffPresentation } from '../../../src/components/app/presentation/wallHandoffPresentation';

// test/unit/stores/wallHandoffStore.test.ts
// 翻牌交接的会话状态机（资料库墙 ↔ Lattice）：进 Lattice 要两边都准备好才开翻、等不到也会按时开翻；回资料库墙要等首页墙
// 画好、等不到就放弃；降低动态效果是淡入淡出交叉；放弃 / 放完都清掉会话。另外核对 App 据会话摆的样子（首页层 / Lattice
// 留不留、visualizer 垫不垫）。

const TIMING: WallHandoffTiming = { waveMs: 780, fadeMs: 180, openMs: 400, closeTimeoutMs: 1200, waitTimeoutMs: 1600 };
const store = () => useWallHandoffStore.getState();

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
    store().abort();
});

afterEach(() => {
    store().abort();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('wall handoff session · into Lattice', () => {
    it('closes, waits for both walls, flips from the reported origin, then ends', () => {
        const id = store().begin({ direction: 'to-lattice', mode: 'flip', seeThrough: true, timing: TIMING });
        expect(store().session).toMatchObject({ id, phase: 'closing', seeThrough: true });
        expect(resolveWallHandoffRole(store().session, 'home')).toBe('out');
        expect(resolveWallHandoffRole(store().session, 'lattice')).toBe('in');

        store().markHomeReady(id, { origin: { x: 320, y: 240 }, align: { card: null, gridPoint: { x: 4, y: 6 } } });
        expect(store().session?.phase).toBe('closing');
        store().markLatticeReady(id);
        expect(store().session).toMatchObject({ phase: 'flipping', origin: { x: 320, y: 240 }, align: { gridPoint: { x: 4, y: 6 } } });
        expect(store().session?.startedAt).not.toBeNull();

        vi.advanceTimersByTime(TIMING.waveMs - 1);
        expect(store().session?.phase).toBe('flipping');
        vi.advanceTimersByTime(1);
        expect(store().session).toBeNull();
    });

    it('starts the wave anyway when one side never reports', () => {
        const id = store().begin({ direction: 'to-lattice', mode: 'flip', seeThrough: false, timing: TIMING });
        store().markHomeReady(id, { origin: { x: 10, y: 20 } });
        vi.advanceTimersByTime(TIMING.closeTimeoutMs);
        expect(store().session).toMatchObject({ phase: 'flipping', origin: { x: 10, y: 20 } });
    });

    it('cross-fades once Lattice is drawn when motion is reduced (no seam to close)', () => {
        const id = store().begin({ direction: 'to-lattice', mode: 'fade', seeThrough: false, timing: TIMING });
        expect(store().session).toMatchObject({ phase: 'closing', homeReady: true });
        store().markLatticeReady(id);
        expect(store().session?.phase).toBe('flipping');
        vi.advanceTimersByTime(TIMING.fadeMs);
        expect(store().session).toBeNull();
    });

    it('ignores reports from an older session', () => {
        const first = store().begin({ direction: 'to-lattice', mode: 'flip', seeThrough: false, timing: TIMING });
        const second = store().begin({ direction: 'to-lattice', mode: 'flip', seeThrough: false, timing: TIMING });
        store().markHomeReady(first, { origin: { x: 1, y: 1 } });
        store().markLatticeReady(first);
        expect(store().session).toMatchObject({ id: second, phase: 'closing', homeReady: false });
    });
});

describe('wall handoff session · back to the library wall', () => {
    it('waits for the library wall, flips from Lattice\'s origin, opens, then ends', () => {
        const unregister = store().registerLatticePeer({ getOrigin: () => ({ x: 700, y: 300 }) });
        const id = store().begin({ direction: 'from-lattice', mode: 'flip', seeThrough: null, timing: TIMING });
        expect(store().session?.phase).toBe('waiting');
        store().reportSeeThrough(id, true);
        expect(store().session?.seeThrough).toBe(true);

        store().markHomeReady(id, { seeThrough: true });
        expect(store().session).toMatchObject({ phase: 'flipping', origin: { x: 700, y: 300 } });
        vi.advanceTimersByTime(TIMING.waveMs);
        expect(store().session?.phase).toBe('opening');
        vi.advanceTimersByTime(TIMING.openMs);
        expect(store().session).toBeNull();
        unregister();
    });

    it('falls back to a cross-fade when the library wall asks for reduced transitions', () => {
        const id = store().begin({ direction: 'from-lattice', mode: 'flip', seeThrough: null, timing: TIMING });
        store().markHomeReady(id, { seeThrough: false, reduced: true });
        expect(store().session).toMatchObject({ mode: 'fade', phase: 'flipping' });
        vi.advanceTimersByTime(TIMING.fadeMs);
        expect(store().session).toBeNull();
    });

    it('gives up when the library wall never gets ready', () => {
        store().begin({ direction: 'from-lattice', mode: 'flip', seeThrough: null, timing: TIMING });
        vi.advanceTimersByTime(TIMING.waitTimeoutMs);
        expect(store().session).toBeNull();
    });
});

describe('App presentation of a handoff', () => {
    it('keeps Home and the visualizer while the windows close, then lets the visualizer go', () => {
        const id = store().begin({ direction: 'to-lattice', mode: 'flip', seeThrough: true, timing: TIMING });
        let presentation = resolveWallHandoffPresentation(store().session);
        expect(presentation).toMatchObject({ keepsHome: true, keepsLattice: false, active: true, keepsVisualizer: true, latticeOpacity: null });
        store().markHomeReady(id, { origin: { x: 0, y: 0 } });
        store().markLatticeReady(id);
        presentation = resolveWallHandoffPresentation(store().session);
        expect(presentation).toMatchObject({ keepsHome: true, keepsVisualizer: false });
    });

    it('never asks for the visualizer behind a solid wall', () => {
        store().begin({ direction: 'to-lattice', mode: 'flip', seeThrough: false, timing: TIMING });
        expect(resolveWallHandoffPresentation(store().session).keepsVisualizer).toBe(false);
        store().abort();
        const id = store().begin({ direction: 'from-lattice', mode: 'flip', seeThrough: null, timing: TIMING });
        store().reportSeeThrough(id, false);
        expect(resolveWallHandoffPresentation(store().session).keepsVisualizer).toBe(false);
    });

    it('keeps Lattice until the wave is over and mounts the visualizer as soon as the library wall has windows', () => {
        const id = store().begin({ direction: 'from-lattice', mode: 'flip', seeThrough: null, timing: TIMING });
        expect(resolveWallHandoffPresentation(store().session)).toMatchObject({ keepsLattice: true, keepsHome: false, keepsVisualizer: false });
        store().reportSeeThrough(id, true);
        expect(resolveWallHandoffPresentation(store().session).keepsVisualizer).toBe(true);
        store().markHomeReady(id, { seeThrough: true });
        expect(resolveWallHandoffPresentation(store().session).keepsLattice).toBe(true);
        vi.advanceTimersByTime(TIMING.waveMs);
        expect(resolveWallHandoffPresentation(store().session)).toMatchObject({ keepsLattice: false, keepsVisualizer: true });
    });

    it('fades Lattice in or out over the reduced-motion cross-fade', () => {
        const into = store().begin({ direction: 'to-lattice', mode: 'fade', seeThrough: false, timing: TIMING });
        expect(resolveWallHandoffPresentation(store().session).latticeOpacity).toEqual({ initial: 0, animate: 0 });
        store().markLatticeReady(into);
        expect(resolveWallHandoffPresentation(store().session).latticeOpacity).toEqual({ initial: 0, animate: 1 });
        store().abort();
        const id = store().begin({ direction: 'from-lattice', mode: 'fade', seeThrough: null, timing: TIMING });
        expect(resolveWallHandoffPresentation(store().session).latticeOpacity).toEqual({ initial: false, animate: 1 });
        store().markHomeReady(id, { seeThrough: false });
        expect(resolveWallHandoffPresentation(store().session)).toMatchObject({ latticeOpacity: { animate: 0 }, fadeSeconds: 0.18 });
        expect(resolveWallHandoffPresentation(null)).toMatchObject({ active: false, keepsHome: false, keepsLattice: false });
    });
});
