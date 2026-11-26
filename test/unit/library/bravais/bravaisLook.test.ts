import { describe, expect, it } from 'vitest';
import { isReservedSlot } from '@/components/wall/blockReservedSlots';
import { getBlockSlots, getWallSlot, parseWallSlotKey } from '@/components/wall/wallSlots';
import type { BravaisItem, BravaisLayer } from '@/library/suites/bravais/bravaisLayer';
import {
    createBravaisDisplay,
    diffDisplays,
    isDisplayedWallLook,
    resolveSlotFace,
    resolveSlotItem,
} from '@/library/suites/bravais/bravaisDisplay';
import {
    bravaisFaceKey,
    isPlateHole,
    isSeeThroughFace,
    nextWallLook,
    occludesPlayerFor,
    opensBackdropFor,
    backdropReportFor,
    resolveEmptySlotKind,
    resolveReservedPerBlock,
    resolveStartSlotKey,
    stepWindowsPerBlock,
} from '@/library/suites/bravais/bravaisLook';

// test/unit/library/bravais/bravaisLook.test.ts
// 透光（B6b③，设计稿 §11）的纯规则：三档下 slot 是什么、窗是插入的结构位（rank→slot 跳过它、k 单调、起点不落在窗上）、
// 换挡只翻开窗 / 关窗与内容挪了的 slot、外观动作的换挡、遮挡上报的取值。

const metrics = { cellSize: 128, gap: 8 };
const items = (prefix: string, count: number): BravaisItem[] => Array.from({ length: count }, (_, index) => ({
    key: `${prefix}${index}`,
    kind: 'track',
    title: `${prefix}${index}`,
    subtitle: '',
    badge: String(index + 1),
}));
const layer = (key: string, entries: BravaisItem[], mode: BravaisLayer['mode'] = 'infinite'): BravaisLayer => ({
    key,
    sessionKey: key,
    surface: 'collection',
    mode,
    items: entries,
    seam: { title: key, crumb: key, meta: '' },
    isInteractive: true,
    focusedEntryKey: null,
    nowPlayingKey: null,
    queuedKeys: new Set(),
});
const field = () => [0, 1].flatMap(column => [0, 1].flatMap(row => getBlockSlots(column, row, metrics)));
const partial = (windowsPerBlock: number) => ({ look: 'partial' as const, windowsPerBlock });

describe('look rules', () => {
    it('reserves structural windows only in the partial look', () => {
        expect(resolveReservedPerBlock({ look: 'solid', windowsPerBlock: 3 })).toBe(0);
        expect(resolveReservedPerBlock(partial(3))).toBe(3);
        expect(resolveReservedPerBlock(partial(9))).toBe(6);
        expect(resolveReservedPerBlock({ look: 'clear', windowsPerBlock: 3 })).toBe(0);
    });

    it('tells windows from bare wall for empty slots', () => {
        expect(resolveEmptySlotKind('partial', true, 'infinite')).toBe('window');
        // 无限墙没有内容只会是还没加载到：画空画框，免得整面墙透成一片。
        expect(resolveEmptySlotKind('partial', false, 'infinite')).toBe('wall');
        expect(resolveEmptySlotKind('clear', false, 'infinite')).toBe('wall');
        // 有限墙剩下的空 slot 在透明档也是窗。
        expect(resolveEmptySlotKind('partial', false, 'finite')).toBe('window');
        expect(resolveEmptySlotKind('clear', false, 'finite')).toBe('window');
        expect(resolveEmptySlotKind('solid', false, 'finite')).toBe('wall');
    });

    it('lets content see through only in the clear look, and never on the focus card', () => {
        expect(isSeeThroughFace('clear', 'content', false)).toBe(true);
        expect(isSeeThroughFace('clear', 'content', true)).toBe(false);
        expect(isSeeThroughFace('partial', 'content', false)).toBe(false);
        expect(isSeeThroughFace('clear', 'window', false)).toBe(false);
        expect(isPlateHole('window', false)).toBe(true);
        expect(isPlateHole('content', true)).toBe(true);
        expect(isPlateHole('content', false)).toBe(false);
        expect(isPlateHole('wall', false)).toBe(false);
    });

    it('gives faces an identity that changes when a slot opens, closes or turns see-through', () => {
        expect(bravaisFaceKey('a', 'content', false)).toBe('a');
        expect(bravaisFaceKey('a', 'content', true)).toBe('~a');
        expect(bravaisFaceKey(null, 'window', false)).toBe('window');
        expect(bravaisFaceKey(null, 'wall', false)).toBeNull();
    });

    it('cycles the look and steps windows only inside 1–6 on the partial look', () => {
        expect(nextWallLook('solid')).toBe('partial');
        expect(nextWallLook('partial')).toBe('clear');
        expect(nextWallLook('clear')).toBe('solid');
        expect(stepWindowsPerBlock(partial(3), 1)).toBe(4);
        expect(stepWindowsPerBlock(partial(6), 1)).toBeNull();
        expect(stepWindowsPerBlock(partial(1), -1)).toBeNull();
        expect(stepWindowsPerBlock({ look: 'clear', windowsPerBlock: 3 }, 1)).toBeNull();
    });

    it('reports covering the player only for the solid look', () => {
        expect(occludesPlayerFor('solid')).toBe(true);
        expect(occludesPlayerFor('partial')).toBe(false);
        expect(occludesPlayerFor('clear')).toBe(false);
    });

    // 2026-10-09：透明的缝也是透光处——实色墙 + 透明缝不算完全遮挡，visualizer 不能卸载；墙后画面的开关只在透着时报。
    it('counts a clear seam as a way through to the player', () => {
        expect(occludesPlayerFor('solid', true)).toBe(false);
        expect(occludesPlayerFor('solid', false)).toBe(true);
        expect(opensBackdropFor('solid', false)).toBe(false);
        expect(opensBackdropFor('solid', true)).toBe(true);
        expect(opensBackdropFor('partial', false)).toBe(true);
        expect(backdropReportFor('solid', false, true, true)).toEqual({ lyrics: false, blur: false });
        expect(backdropReportFor('solid', true, true, false)).toEqual({ lyrics: true, blur: false });
        expect(backdropReportFor('clear', false, false, true)).toEqual({ lyrics: false, blur: true });
    });
});

describe('windows are inserted structural slots', () => {
    it('skips windows when handing out items, so strict rank becomes "the i-th non-window slot"', () => {
        const display = createBravaisDisplay(layer('a', items('t', 200)), null, undefined, partial(3));
        const slots = getBlockSlots(0, 0, metrics);
        const content = slots.filter(slot => !isReservedSlot(0, 0, slot.slotIndex, 3));
        expect(content).toHaveLength(9);
        slots.forEach((slot) => {
            const face = resolveSlotFace(display, slot);
            if (isReservedSlot(0, 0, slot.slotIndex, 3)) {
                expect(face).toEqual({ item: null, kind: 'window' });
            } else {
                expect(face.kind).toBe('content');
            }
        });
        // 块内的非窗 slot 按序号依次拿到连续的条目（插入，不替换）。
        const indices = content.map(slot => Number(resolveSlotItem(display, slot)!.key.slice(1)));
        indices.slice(1).forEach((index, at) => expect(index).toBe(indices[at] + 1));
    });

    it('opens one more window per step and keeps the existing ones (monotonic in k)', () => {
        for (let k = 1; k < 6; k += 1) {
            const before = createBravaisDisplay(layer('a', items('t', 50)), null, undefined, partial(k));
            const after = createBravaisDisplay(layer('a', items('t', 50)), null, undefined, partial(k + 1));
            field().forEach((slot) => {
                if (resolveSlotFace(before, slot).kind === 'window') expect(resolveSlotFace(after, slot).kind).toBe('window');
            });
            const count = (display: typeof before) => field().filter(slot => resolveSlotFace(display, slot).kind === 'window').length;
            expect(count(after) - count(before)).toBe(4);
        }
    });

    it('never puts the start tile on a window', () => {
        const slots = getBlockSlots(3, -2, metrics);
        const reserved = slots.find(slot => isReservedSlot(3, -2, slot.slotIndex, 6))!;
        const display = createBravaisDisplay(layer('a', items('t', 40)), reserved.key, undefined, partial(6));
        expect(display.startSlotKey).not.toBe(reserved.key);
        const start = parseWallSlotKey(display.startSlotKey!)!;
        expect(start.column).toBe(3);
        expect(start.row).toBe(-2);
        expect(isReservedSlot(3, -2, start.slotIndex, 6)).toBe(false);
        expect(resolveSlotItem(display, getWallSlot(start.column, start.row, start.slotIndex, metrics)!)?.key).toBe('t0');
        // 非窗的起点原样保留。
        const kept = slots.find(slot => !isReservedSlot(3, -2, slot.slotIndex, 6))!;
        expect(resolveStartSlotKey(kept.key, 6)).toBe(kept.key);
    });

    it('turns leftover slots of a finite wall into windows in the see-through looks', () => {
        const display = createBravaisDisplay(layer('a', [], 'finite'), null, undefined, { look: 'clear', windowsPerBlock: 3 });
        expect(field().every(slot => resolveSlotFace(display, slot).kind === 'window')).toBe(true);
        const solid = createBravaisDisplay(layer('a', [], 'finite'), null);
        expect(field().every(slot => resolveSlotFace(solid, slot).kind === 'wall')).toBe(true);
    });
});

describe('changing the look flips only what changed', () => {
    it('keeps standing windows and unchanged content still when one more window opens', () => {
        const wall = layer('a', items('t', 500));
        const before = createBravaisDisplay(wall, null, undefined, partial(3));
        const after = createBravaisDisplay(wall, before.startSlotKey, undefined, partial(4));
        expect(isDisplayedWallLook(before, partial(4))).toBe(false);
        expect(isDisplayedWallLook(after, partial(4))).toBe(true);
        const changes = diffDisplays(before, after, field());
        const opened = changes.filter(change => change.from !== 'window' && change.to === 'window');
        expect(opened).toHaveLength(4);
        // 原来的窗不动，不翻。
        changes.filter(change => change.from === 'window').forEach(change => expect(change.to).toBe('window'));
        // 翻的只有面变了的 slot（开窗的，加上内容因跳过窗位而挪了的）。
        changes.forEach((change) => {
            const flips = change.from !== change.to;
            expect(flips).toBe(resolveSlotFace(before, change.slot).item?.key !== resolveSlotFace(after, change.slot).item?.key
                || resolveSlotFace(before, change.slot).kind !== resolveSlotFace(after, change.slot).kind);
        });
    });

    it('flips every content tile when the wall turns see-through, and nothing else', () => {
        const wall = layer('a', items('t', 30));
        const solid = createBravaisDisplay(wall, null);
        const clear = createBravaisDisplay(wall, null, undefined, { look: 'clear', windowsPerBlock: 3 });
        const changes = diffDisplays(solid, clear, field());
        expect(changes.every(change => change.to === `~${change.from}`)).toBe(true);
    });
});
