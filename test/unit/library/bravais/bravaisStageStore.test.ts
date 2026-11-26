import { afterEach, describe, expect, it } from 'vitest';
import type { BravaisLayer } from '@/library/suites/bravais/bravaisLayer';
import {
    applyLayerRegistration,
    registerBravaisLayer,
    releaseBravaisLayer,
    releaseLayerRegistration,
    resolveCurrentLayer,
    setBravaisPendingOrigin,
    takeBravaisLayerToken,
    takeBravaisPendingOrigin,
    useBravaisStageStore,
    type BravaisStageState,
} from '@/library/suites/bravais/bravaisStageStore';

// test/unit/library/bravais/bravaisStageStore.test.ts
// bravais 的层栈（B6）：surface 按 token 登记 / 放掉自己的层描述（AnimatePresence 换层时新旧先后不定，旧的放不掉新的），
// stage 按导航深度挑当前层（顶层没到时沿用上一次画的层、并标成不归 bravais）；打开磁贴记下的起点只给它记下时的那一层用。

const layer = (key: string, surface: BravaisLayer['surface'] = 'collection'): BravaisLayer => ({
    key,
    sessionKey: key,
    surface,
    mode: 'infinite',
    items: [],
    seam: { title: key, crumb: key, meta: '' },
    isInteractive: true,
    focusedEntryKey: null,
    nowPlayingKey: null,
    queuedKeys: new Set(),
});

const EMPTY: BravaisStageState = { home: null, top: null, pendingOrigin: null };

afterEach(() => useBravaisStageStore.setState(EMPTY));

describe('layer registrations', () => {
    it('updates its own registration and lets a newer token take over', () => {
        const first = layer('a');
        let state = applyLayerRegistration(EMPTY, 'top', 1, first);
        expect(state.top).toEqual({ token: 1, layer: first });
        expect(applyLayerRegistration(state, 'top', 1, first)).toBe(state);

        const second = layer('b');
        state = applyLayerRegistration(state, 'top', 2, second);
        expect(state.top).toEqual({ token: 2, layer: second });
        // 旧持有者晚一步卸载：放不掉新持有者。
        expect(releaseLayerRegistration(state, 'top', 1)).toBe(state);
        expect(releaseLayerRegistration(state, 'top', 2).top).toBeNull();
    });

    it('keeps the home and top slots independent in the module store', () => {
        const homeToken = takeBravaisLayerToken();
        const topToken = takeBravaisLayerToken();
        expect(topToken).toBeGreaterThan(homeToken);
        registerBravaisLayer('home', homeToken, layer('home:playlist', 'home'));
        registerBravaisLayer('top', topToken, layer('online:a:playlist:1'));
        releaseBravaisLayer('top', topToken);
        expect(useBravaisStageStore.getState().home?.layer.key).toBe('home:playlist');
        expect(useBravaisStageStore.getState().top).toBeNull();
    });
});

describe('resolveCurrentLayer', () => {
    const home = { token: 1, layer: layer('home:playlist', 'home') };
    const top = { token: 2, layer: layer('online:a:playlist:1') };

    it('draws the home layer at depth 0 and the top layer above it', () => {
        expect(resolveCurrentLayer({ depth: 0, home, top: null, previous: null })).toEqual({ layer: home.layer, owned: true });
        expect(resolveCurrentLayer({ depth: 1, home, top, previous: home.layer })).toEqual({ layer: top.layer, owned: true });
    });

    it('keeps the previous layer while the top one has not arrived or fell back to grid', () => {
        expect(resolveCurrentLayer({ depth: 1, home, top: null, previous: home.layer })).toEqual({ layer: home.layer, owned: false });
        expect(resolveCurrentLayer({ depth: 2, home, top: null, previous: top.layer })).toEqual({ layer: top.layer, owned: false });
    });

    it('is not owned at depth 0 before the home surface registers', () => {
        expect(resolveCurrentLayer({ depth: 0, home: null, top: null, previous: null })).toEqual({ layer: null, owned: false });
    });
});

describe('pending origin', () => {
    it('is taken once, and only by the layer it was recorded on', () => {
        setBravaisPendingOrigin({ fromLayerKey: 'home:playlist', slotKey: '0,0,3' });
        expect(takeBravaisPendingOrigin('home:playlist')).toEqual({ fromLayerKey: 'home:playlist', slotKey: '0,0,3' });
        expect(takeBravaisPendingOrigin('home:playlist')).toBeNull();

        setBravaisPendingOrigin({ fromLayerKey: 'home:playlist', slotKey: '0,0,3' });
        expect(takeBravaisPendingOrigin('online:a:playlist:1')).toBeNull();
        expect(useBravaisStageStore.getState().pendingOrigin).toBeNull();
    });
});
