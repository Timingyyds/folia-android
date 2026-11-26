import { afterEach, describe, expect, it, vi } from 'vitest';
import { getWallSlot } from '@/components/wall/wallSlots';
import type { BravaisItem, BravaisLayer } from '@/library/suites/bravais/bravaisLayer';
import { createBravaisDisplay, resolveSlotItem } from '@/library/suites/bravais/bravaisDisplay';
import {
    armBravaisPlayingCard,
    BRAVAIS_PLAYING_CARD_STORAGE_KEY,
    disarmBravaisPlayingCard,
    parseBravaisPlayingCard,
    readBravaisPlayingCard,
} from '@/library/suites/bravais/bravaisPlayingCard';
import { resolveBravaisPlayingCardRestore } from '@/library/suites/bravais/useBravaisPlayingCard';

// test/unit/library/bravais/bravaisPlayingCard.test.ts
// 实测反馈 fb3：「从墙上播放后保持展开」的记忆（层 key + 条目 key，sessionStorage，坏数据当没有）与恢复规则
// （只在记忆的那一层、只展开正在播放的那首；焦点所在的那一份正是它时用那一份，否则离缝最近的一份；数据没到时等；
// 这一层里没有正在播放的歌就不展开）。

const metrics = { cellSize: 128, gap: 8 };
const items = (count: number): BravaisItem[] => Array.from({ length: count }, (_, index) => ({
    key: `t${index}`,
    kind: 'track',
    title: `t${index}`,
    subtitle: '',
    badge: String(index + 1),
}));
const layer = (overrides: Partial<BravaisLayer> = {}): BravaisLayer => ({
    key: 'collection:a',
    sessionKey: 'collection:a',
    surface: 'collection',
    mode: 'infinite',
    items: items(17),
    seam: { title: 'a', crumb: 'a', meta: '' },
    isInteractive: true,
    focusedEntryKey: null,
    nowPlayingKey: 't3',
    queuedKeys: new Set(),
    ...overrides,
});

describe('playing card memory', () => {
    let storage: Map<string, string>;
    afterEach(() => vi.unstubAllGlobals());
    const stubStorage = () => {
        storage = new Map();
        vi.stubGlobal('sessionStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => { storage.set(key, value); },
            removeItem: (key: string) => { storage.delete(key); },
        });
    };

    it('arms, reads back and disarms one record', () => {
        stubStorage();
        expect(readBravaisPlayingCard()).toBeNull();
        armBravaisPlayingCard('collection:a', 't3-0');
        expect(readBravaisPlayingCard()).toEqual({ layerKey: 'collection:a', entryKey: 't3-0' });
        armBravaisPlayingCard('collection:b', 't9-0');
        expect(readBravaisPlayingCard()).toEqual({ layerKey: 'collection:b', entryKey: 't9-0' });
        disarmBravaisPlayingCard();
        expect(storage.has(BRAVAIS_PLAYING_CARD_STORAGE_KEY)).toBe(false);
        expect(readBravaisPlayingCard()).toBeNull();
    });

    it('treats broken records as none', () => {
        expect(parseBravaisPlayingCard(null)).toBeNull();
        expect(parseBravaisPlayingCard('{')).toBeNull();
        expect(parseBravaisPlayingCard('{"layerKey":"a"}')).toBeNull();
        expect(parseBravaisPlayingCard('{"layerKey":"","entryKey":"x"}')).toBeNull();
        expect(parseBravaisPlayingCard('{"layerKey":"a","entryKey":3}')).toBeNull();
        expect(parseBravaisPlayingCard('{"layerKey":"a","entryKey":"x"}')).toEqual({ layerKey: 'a', entryKey: 'x' });
    });

    it('survives a storage that throws', () => {
        vi.stubGlobal('sessionStorage', {
            getItem: () => { throw new Error('denied'); },
            setItem: () => { throw new Error('quota'); },
            removeItem: () => { throw new Error('denied'); },
        });
        expect(() => armBravaisPlayingCard('a', 'b')).not.toThrow();
        expect(readBravaisPlayingCard()).toBeNull();
        expect(() => disarmBravaisPlayingCard()).not.toThrow();
    });
});

describe('restoring the playing card', () => {
    const near = { x: 0, y: 0 };
    const memory = { layerKey: 'collection:a', entryKey: 't3' };

    it('skips without a memory, or with one from another layer', () => {
        const display = createBravaisDisplay(layer(), null);
        expect(resolveBravaisPlayingCardRestore({ memory: null, display, focusedSlotKey: null, near }).kind).toBe('skip');
        expect(resolveBravaisPlayingCardRestore({ memory: { ...memory, layerKey: 'collection:b' }, display, focusedSlotKey: null, near }).kind).toBe('skip');
    });

    it('waits while the layer has no data yet', () => {
        expect(resolveBravaisPlayingCardRestore({ memory, display: createBravaisDisplay(layer({ items: [] }), null), focusedSlotKey: null, near }).kind).toBe('wait');
        expect(resolveBravaisPlayingCardRestore({ memory, display: createBravaisDisplay(layer({ wall: { loading: true } }), null), focusedSlotKey: null, near }).kind).toBe('wait');
    });

    it('does not force anything open when nothing on this layer is playing', () => {
        const display = createBravaisDisplay(layer({ nowPlayingKey: null }), null);
        expect(resolveBravaisPlayingCardRestore({ memory, display, focusedSlotKey: null, near }).kind).toBe('skip');
    });

    it('expands the playing song on the copy nearest the seam', () => {
        const display = createBravaisDisplay(layer(), null);
        const decision = resolveBravaisPlayingCardRestore({ memory, display, focusedSlotKey: null, near });
        expect(decision.kind).toBe('expand');
        if (decision.kind !== 'expand') return;
        expect(decision.entryKey).toBe('t3');
        expect(resolveSlotItem(display, decision.slot)?.key).toBe('t3');
        // 离 near 最近：任何显示 t3 的近处 slot 都不比它近。
        const distance = (slot: { centerX: number; centerY: number }) => Math.hypot(slot.centerX - near.x, slot.centerY - near.y);
        for (let column = -2; column <= 2; column += 1) {
            for (let row = -2; row <= 2; row += 1) {
                for (let index = 0; index < 12; index += 1) {
                    const slot = getWallSlot(column, row, index, metrics);
                    if (slot && resolveSlotItem(display, slot)?.key === 't3') expect(distance(slot)).toBeGreaterThanOrEqual(distance(decision.slot) - 0.001);
                }
            }
        }
    });

    it('keeps the keyboard-focused copy when it shows the playing song, and otherwise ignores the focus', () => {
        const display = createBravaisDisplay(layer(), null);
        const far = resolveBravaisPlayingCardRestore({ memory, display, focusedSlotKey: null, near: { x: 5000, y: 3000 } });
        expect(far.kind).toBe('expand');
        if (far.kind !== 'expand') return;
        const focused = resolveBravaisPlayingCardRestore({ memory, display, focusedSlotKey: far.slot.key, near });
        expect(focused.kind === 'expand' && focused.slot.key).toBe(far.slot.key);

        const other = getWallSlot(0, 0, 0, metrics)!;
        expect(resolveSlotItem(display, other)?.key).not.toBe('t3');
        const ignored = resolveBravaisPlayingCardRestore({ memory, display, focusedSlotKey: other.key, near });
        expect(ignored.kind === 'expand' && resolveSlotItem(display, ignored.slot)?.key).toBe('t3');
    });

    it('follows the song that is playing now when it moved on within the same layer', () => {
        const display = createBravaisDisplay(layer({ nowPlayingKey: 't5' }), null);
        const decision = resolveBravaisPlayingCardRestore({ memory, display, focusedSlotKey: null, near });
        expect(decision.kind === 'expand' && decision.entryKey).toBe('t5');
    });
});
