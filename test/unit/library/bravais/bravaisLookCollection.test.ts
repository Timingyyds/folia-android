import { describe, expect, it } from 'vitest';
import { isReservedSlot } from '@/components/wall/blockReservedSlots';
import { collectWallSlots, getWallSlot, type WallSlot } from '@/components/wall/wallSlots';
import type { BravaisItem, BravaisLayer } from '@/library/suites/bravais/bravaisLayer';
import {
    createBravaisDisplay,
    diffDisplays,
    resolveSlotFace,
    resolveSlotItem,
    type BravaisDisplay,
} from '@/library/suites/bravais/bravaisDisplay';
import { canReuseFinitePlan, planBravaisFinite } from '@/library/suites/bravais/bravaisFiniteWall';
import { findDisplayItemSlot } from '@/library/suites/bravais/bravaisItemSlots';
import { detectRemovedEntries, maskRemovedEntries } from '@/library/suites/bravais/bravaisRemoval';

// test/unit/library/bravais/bravaisLookCollection.test.ts
// B6b③ 透光 × B7 集合页（合并后）：部分透明的结构窗贯穿 B7 的所有 slot 计算——有限拼贴（rank i → 第 i 个非窗 slot、
// 剩下的空 slot 是窗、换窗数时不沿用旧规划）、补页周期（新页只填原本的墙面，窗不动）、remove-entry 的两段翻牌（rank
// 前移时跳过窗）、列表定位（反查落在显示那一项的非窗 slot 上）。

const metrics = { cellSize: 128, gap: 8 };
const view = { width: 1140, height: 1100, scale: 0.76 };
const items = (prefix: string, count: number): BravaisItem[] => Array.from({ length: count }, (_, index) => ({
    key: `${prefix}${index}`,
    kind: 'track',
    title: `${prefix}${index}`,
    subtitle: '',
    badge: String(index + 1),
}));
const layer = (entries: BravaisItem[], mode: BravaisLayer['mode'] = 'infinite', wall?: BravaisLayer['wall']): BravaisLayer => ({
    key: 'c',
    sessionKey: 'c',
    surface: 'collection',
    mode,
    items: entries,
    seam: { title: 'c', crumb: 'c', meta: '' },
    isInteractive: true,
    focusedEntryKey: null,
    nowPlayingKey: null,
    queuedKeys: new Set(),
    wall,
});
const partial = (windowsPerBlock: number) => ({ look: 'partial' as const, windowsPerBlock });
const around = (center: { x: number; y: number }, radius = 1600) => collectWallSlots(
    { left: center.x - radius, right: center.x + radius, top: center.y - radius, bottom: center.y + radius },
    metrics,
);
const reserved = (slot: WallSlot, k: number) => isReservedSlot(slot.column, slot.row, slot.slotIndex, k);

/** 有限态的显示：与 useBravaisDisplay 一样，用显示的每块窗数规划。 */
const finiteDisplay = (entries: BravaisItem[], count: number, k: number): BravaisDisplay => {
    const base = createBravaisDisplay(layer(entries, 'finite'), null, undefined, partial(k));
    const finite = planBravaisFinite({ count, anchorX: 0, center: { x: 0, y: 0 }, view, reservedPerBlock: base.reservedPerBlock });
    return { ...base, finite };
};

describe('finite tiling skips the structural windows', () => {
    it('puts rank i on the i-th non-window slot and turns every other empty slot into a window', () => {
        const all = items('t', 60);
        const display = finiteDisplay(all.slice(0, 25), all.length, 3);
        const order = display.finite!.order;
        expect(order.some(slot => reserved(slot, 3))).toBe(false);
        order.slice(0, 25).forEach((slot, rank) => {
            expect(resolveSlotFace(display, slot)).toEqual({ item: all[rank], kind: 'content' });
        });
        // 有内容的 rank 之后、以及有限世界里的窗位，在透明档都是窗（不是空画框）。
        for (const slot of around({ x: 0, y: 0 }, 900)) {
            if (resolveSlotItem(display, slot)) continue;
            expect(resolveSlotFace(display, slot).kind).toBe('window');
        }
    });

    it('holds fewer items per block as k grows, and replans when the window count changes', () => {
        const plan = (k: number) => planBravaisFinite({ count: 60, anchorX: 0, center: { x: 0, y: 0 }, view, reservedPerBlock: k });
        const three = plan(3);
        const six = plan(6);
        const perBlock = new Map<string, number>();
        for (const slot of six.order) perBlock.set(`${slot.column},${slot.row}`, (perBlock.get(`${slot.column},${slot.row}`) ?? 0) + 1);
        expect(Math.max(...perBlock.values())).toBe(6);
        expect(six.order.some(slot => reserved(slot, 6))).toBe(false);
        expect(canReuseFinitePlan(three, { anchorX: 0, count: 60, reservedPerBlock: 3 })).toBe(true);
        expect(canReuseFinitePlan(three, { anchorX: 0, count: 60, reservedPerBlock: 4 })).toBe(false);
        expect(canReuseFinitePlan(three, { anchorX: 0, count: 60 })).toBe(false);
    });
});

describe('background paging keeps the infinite period with windows', () => {
    it('fills only slots that were bare wall; windows and the start tile stay put', () => {
        const start = getWallSlot(0, 0, 0, metrics)!;
        const before = createBravaisDisplay(layer(items('t', 150), 'infinite', { periodCount: 400 }), start.key, undefined, partial(3));
        const after = createBravaisDisplay(layer(items('t', 300), 'infinite', { periodCount: 400 }), start.key, undefined, partial(3));
        const slots = around({ x: 0, y: 0 });
        const changes = diffDisplays(before, after, slots).filter(change => change.from !== change.to);
        expect(changes.length).toBeGreaterThan(0);
        expect(changes.every(change => change.from === null && !reserved(change.slot, 3))).toBe(true);
        for (const slot of slots.filter(candidate => reserved(candidate, 3))) {
            expect(resolveSlotFace(after, slot).kind).toBe('window');
        }
        const startKey = after.startSlotKey!;
        const shownStart = slots.find(slot => slot.key === startKey)!;
        expect(reserved(shownStart, 3)).toBe(false);
        expect(resolveSlotItem(after, shownStart)?.key).toBe('t0');
        // 还没补到的周期位置（≥ 条目数）在无限墙上仍是空画框，不是窗。
        expect(slots.some(slot => !reserved(slot, 3) && resolveSlotFace(after, slot).kind === 'wall')).toBe(true);
    });
});

describe('remove-entry with windows', () => {
    const before = items('t', 8);
    const removed = detectRemovedEntries(before, before.filter(item => item.key !== 't3'))!;

    it('on a finite wall masks the removed rank, then shifts later ranks over the non-window slots', () => {
        const old = finiteDisplay(before, before.length, 4);
        const order = old.finite!.order;
        const slots = around({ x: 0, y: 0 }, 900);
        const phaseOne = maskRemovedEntries(old, removed);
        const firstChanges = diffDisplays(old, phaseOne, slots).filter(change => change.from !== change.to);
        // 透明档的有限墙：被删的那一格先成窗（有限墙的空 slot），其余不动。
        expect(firstChanges.map(change => [change.slot.key, change.from, change.to])).toEqual([[order[3].key, 't3', 'window']]);

        const next = { ...createBravaisDisplay(layer(before.filter(item => item.key !== 't3'), 'finite'), null, undefined, partial(4)), finite: old.finite };
        const secondChanges = diffDisplays(phaseOne, next, slots).filter(change => change.from !== change.to);
        const rankOf = (slot: WallSlot) => order.findIndex(candidate => candidate.key === slot.key);
        expect(secondChanges.map(change => [rankOf(change.slot), change.to]).sort((a, b) => Number(a[0]) - Number(b[0]))).toEqual([
            [3, 't4'], [4, 't5'], [5, 't6'], [6, 't7'], [7, 'window'],
        ]);
        expect(secondChanges.some(change => reserved(change.slot, 4))).toBe(false);
    });

    it('on an infinite wall flips the removed copies to bare wall, then moves items up without touching windows', () => {
        const start = getWallSlot(1, 0, 5, metrics)!;
        const old = createBravaisDisplay(layer(before), start.key, undefined, partial(2));
        const slots = around({ x: start.centerX, y: start.centerY });
        const phaseOne = maskRemovedEntries(old, removed);
        const firstChanges = diffDisplays(old, phaseOne, slots).filter(change => change.from !== change.to);
        expect(firstChanges.length).toBeGreaterThan(0);
        expect(firstChanges.every(change => change.from === 't3' && change.to === null)).toBe(true);

        const next = createBravaisDisplay(layer(before.filter(item => item.key !== 't3')), old.startSlotKey, undefined, partial(2));
        const secondChanges = diffDisplays(phaseOne, next, slots).filter(change => change.from !== change.to);
        expect(secondChanges.length).toBeGreaterThan(0);
        expect(secondChanges.some(change => reserved(change.slot, 2))).toBe(false);
        const startSlot = slots.find(slot => slot.key === next.startSlotKey)!;
        expect(reserved(startSlot, 2)).toBe(false);
        expect(resolveSlotItem(next, startSlot)?.key).toBe('t0');
    });
});

describe('list locate lands on a content slot', () => {
    it('round-trips every item of an infinite wall to a non-window slot that shows it', () => {
        for (const k of [1, 3, 6]) {
            for (const count of [5, 37, 400]) {
                const start = getWallSlot(3, -2, 7, metrics)!;
                const display = createBravaisDisplay(layer(items('t', count), 'infinite', { periodCount: count + 20 }), start.key, undefined, partial(k));
                const near = { x: 2000, y: -900 };
                for (const index of [0, 1, Math.floor(count / 2), count - 1]) {
                    const slot = findDisplayItemSlot(display, `t${index}`, near);
                    expect(slot).not.toBeNull();
                    expect(reserved(slot!, k)).toBe(false);
                    expect(resolveSlotItem(display, slot!)?.key).toBe(`t${index}`);
                }
            }
        }
    });

    it('picks the nearest copy among the non-window slots', () => {
        const display = createBravaisDisplay(layer(items('t', 12)), null, undefined, partial(5));
        const near = { x: 9000, y: 4000 };
        const slot = findDisplayItemSlot(display, 't3', near)!;
        const copies = around(near, 2400).filter(candidate => resolveSlotItem(display, candidate)?.key === 't3');
        const distance = (candidate: { centerX: number; centerY: number }) => Math.hypot(candidate.centerX - near.x, candidate.centerY - near.y);
        expect(Math.min(...copies.map(distance))).toBeCloseTo(distance(slot));
    });

    it('uses the non-window rank slot on a finite wall', () => {
        const display = finiteDisplay(items('t', 5), 20, 6);
        const slot = findDisplayItemSlot(display, 't4', { x: 0, y: 0 })!;
        expect(slot.key).toBe(display.finite!.order[4].key);
        expect(reserved(slot, 6)).toBe(false);
    });
});
