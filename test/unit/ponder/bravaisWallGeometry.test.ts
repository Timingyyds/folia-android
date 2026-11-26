import { describe, expect, it } from 'vitest';
import {
    BRAVAIS_BACK_RINGS,
    BRAVAIS_ENTRANCE_WAVES,
    BRAVAIS_FOCUS_BLOCK_SLOTS,
    BRAVAIS_FOCUS_SLOT,
    BRAVAIS_OPEN_RINGS,
    BRAVAIS_ORIGIN_SLOT,
    BRAVAIS_VISIBLE_SLOTS,
    BRAVAIS_WALL_GEOMETRY,
    BRAVAIS_WINDOW_SLOT,
    bravaisCollectionItem,
    bravaisHomeItem,
    bravaisWindowedItem,
    isBravaisWindowSlot,
} from '@/components/ponder/surfaces/ponderBravaisGeometry';
import type { PonderRelativeRect } from '@/types/ponder';

// test/unit/ponder/bravaisWallGeometry.test.ts
// bravais 墙教程的合成界面是按真实结构算出来的（块、模板、翻牌的圈），写错了不会报错，只会画出一面叠在一起或缺一块的墙。

const box = (rect: PonderRelativeRect) => ({
    left: rect.left ?? 0,
    top: rect.top ?? 0,
    right: (rect.left ?? 0) + (rect.width ?? 0),
    bottom: (rect.top ?? 0) + (rect.height ?? 0),
});

const overlaps = (a: PonderRelativeRect, b: PonderRelativeRect) => {
    const x = box(a);
    const y = box(b);
    return x.left < y.right - 1e-9 && y.left < x.right - 1e-9 && x.top < y.bottom - 1e-9 && y.top < x.bottom - 1e-9;
};

const visibleKeys = BRAVAIS_VISIBLE_SLOTS.map(slot => slot.key).sort();

describe('bravais wall geometry', () => {
    it('屏内磁贴互不重叠，也压不到缝上', () => {
        BRAVAIS_VISIBLE_SLOTS.forEach((slot, index) => {
            BRAVAIS_VISIBLE_SLOTS.slice(index + 1).forEach(other => {
                expect(overlaps(slot.rect, other.rect), `${slot.key} × ${other.key}`).toBe(false);
            });
            expect(overlaps(slot.rect, BRAVAIS_WALL_GEOMETRY.seam), `${slot.key} 压到了缝`).toBe(false);
        });
    });

    it.each([
        ['打开集合', BRAVAIS_OPEN_RINGS],
        ['返回', BRAVAIS_BACK_RINGS],
        ['整墙入场', BRAVAIS_ENTRANCE_WAVES],
    ] as const)('%s的几圈恰好把屏内每张磁贴翻一次', (_, rings) => {
        const keys = rings.flat();
        expect([...keys].sort()).toEqual(visibleKeys);
        rings.forEach(ring => expect(ring.length).toBeGreaterThan(0));
    });

    it('打开集合从被点的那张开始，它原地成为新层的 01 号、封面不变', () => {
        expect(BRAVAIS_OPEN_RINGS[0]).toEqual([BRAVAIS_ORIGIN_SLOT.key]);
        const origin = BRAVAIS_VISIBLE_SLOTS.find(slot => slot.key === BRAVAIS_ORIGIN_SLOT.key)!;
        expect(bravaisCollectionItem(origin).number).toBe('01');
        expect(bravaisCollectionItem(origin).hue).toBe(bravaisHomeItem(origin).hue);
        expect(bravaisHomeItem(origin).kind).toBe('playlist');
    });

    it('聚焦卡的让位只在那一块里：放大成 6×6，其余七张铺满剩下的格子', () => {
        const block = box(BRAVAIS_WALL_GEOMETRY.block);
        BRAVAIS_FOCUS_BLOCK_SLOTS.forEach((slot, index) => {
            const rect = box(slot.rect);
            expect(rect.left).toBeGreaterThanOrEqual(block.left - 1e-9);
            expect(rect.top).toBeGreaterThanOrEqual(block.top - 1e-9);
            expect(rect.right).toBeLessThanOrEqual(block.right + 1e-9);
            expect(rect.bottom).toBeLessThanOrEqual(block.bottom + 1e-9);
            BRAVAIS_FOCUS_BLOCK_SLOTS.slice(index + 1).forEach(other => {
                expect(overlaps(slot.rect, other.rect), `${slot.key} × ${other.key}`).toBe(false);
            });
        });
        expect(BRAVAIS_WALL_GEOMETRY.focusCard).toEqual(BRAVAIS_FOCUS_BLOCK_SLOTS.find(slot => slot.key === BRAVAIS_FOCUS_SLOT.key)!.rect);
        expect(bravaisHomeItem(BRAVAIS_FOCUS_SLOT).kind).toBe('track');
    });

    it('窗是插入的：屏内每块都有窗，内容跳过窗位往后排，不会有一项被盖掉', () => {
        expect(isBravaisWindowSlot(BRAVAIS_WINDOW_SLOT)).toBe(true);
        const blocks = new Map<string, typeof BRAVAIS_VISIBLE_SLOTS[number][]>();
        BRAVAIS_VISIBLE_SLOTS.forEach(slot => {
            const key = `${slot.half}:${slot.bx}:${slot.by}`;
            blocks.set(key, [...(blocks.get(key) ?? []), slot]);
        });
        blocks.forEach((slots, key) => {
            const windows = slots.filter(isBravaisWindowSlot);
            expect(windows.length, `${key} 没有窗`).toBeGreaterThan(0);
            const shown = slots.map(bravaisWindowedItem).filter(Boolean);
            const original = slots.map(bravaisHomeItem);
            // 前面的内容一项不少地挪到非窗格子上（只有排到块尾放不下的才挤出这一块）。
            expect(shown).toEqual(original.slice(0, slots.length - windows.length));
        });
    });

    it('字幕要指的几张磁贴种类对得上', () => {
        const at = (rect: PonderRelativeRect) => BRAVAIS_VISIBLE_SLOTS.find(slot => slot.rect.left === rect.left && slot.rect.top === rect.top)!;
        expect(bravaisHomeItem(at(BRAVAIS_WALL_GEOMETRY.song)).kind).toBe('track');
        expect(bravaisHomeItem(at(BRAVAIS_WALL_GEOMETRY.collection)).kind).toBe('album');
        expect(bravaisHomeItem(at(BRAVAIS_WALL_GEOMETRY.artist)).kind).toBe('artist');
        expect(bravaisHomeItem(at(BRAVAIS_WALL_GEOMETRY.special)).special).toBe('liked');
        expect(bravaisHomeItem(at(BRAVAIS_WALL_GEOMETRY.fm)).special).toBe('personal-fm');
    });
});
