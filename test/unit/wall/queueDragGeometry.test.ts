import { describe, expect, it } from 'vitest';
import {
    QUEUE_AUTOSCROLL_EDGE_PX,
    QUEUE_AUTOSCROLL_MAX_SPEED,
    QUEUE_ISLAND_ROW_HEIGHT,
    autoScrollEdgeAt,
    autoScrollVelocity,
    queueRowShift,
    resolveAutoScroll,
    resolveDropIndex,
} from '../../../src/components/wall/queueDragGeometry';
import { moveQueueItem } from '../../../src/utils/queueReorder';

// test/unit/wall/queueDragGeometry.test.ts
// 队列浮岛拖拽排序的纯几何：落点下标、落点两侧的行让开多少、贴边自动滚动的速度与起点边缘区的抑制；
// 以及「行按 queueRowShift 让开后，被拖的那首正好占住落点的槽」与 moveQueueItem 的结果一致。

const ROW = QUEUE_ISLAND_ROW_HEIGHT;

describe('resolveDropIndex', () => {
    it('is the slot the dragged row\'s centre line falls in', () => {
        expect(resolveDropIndex({ centerY: ROW / 2, rowCount: 10 })).toBe(0);
        expect(resolveDropIndex({ centerY: ROW - 1, rowCount: 10 })).toBe(0);
        expect(resolveDropIndex({ centerY: ROW, rowCount: 10 })).toBe(1);
        expect(resolveDropIndex({ centerY: ROW * 7.5, rowCount: 10 })).toBe(7);
    });

    it('clamps to the queue and survives an empty one', () => {
        expect(resolveDropIndex({ centerY: -200, rowCount: 10 })).toBe(0);
        expect(resolveDropIndex({ centerY: ROW * 400, rowCount: 10 })).toBe(9);
        expect(resolveDropIndex({ centerY: 120, rowCount: 0 })).toBe(0);
        expect(resolveDropIndex({ centerY: Number.NaN, rowCount: 5 })).toBe(0);
    });

    it('honours a custom row height', () => {
        expect(resolveDropIndex({ centerY: 125, rowHeight: 50, rowCount: 10 })).toBe(2);
    });
});

describe('queueRowShift', () => {
    it('moves the rows between from and to one row towards from', () => {
        // 往下拖：2 → 5，3..5 上移一行。
        expect([0, 1, 2, 3, 4, 5, 6].map(index => queueRowShift(index, 2, 5))).toEqual([0, 0, 0, -ROW, -ROW, -ROW, 0]);
        // 往上拖：5 → 2，2..4 下移一行。
        expect([0, 1, 2, 3, 4, 5, 6].map(index => queueRowShift(index, 5, 2))).toEqual([0, 0, ROW, ROW, ROW, 0, 0]);
    });

    it('moves nothing when the drop is where it started', () => {
        expect([0, 1, 2, 3].map(index => queueRowShift(index, 2, 2))).toEqual([0, 0, 0, 0]);
    });

    it('lands the dragged song in the drop slot, exactly where moveQueueItem puts it', () => {
        const queue = Array.from({ length: 9 }, (_, index) => `song-${index}`);
        for (const [from, to] of [[1, 6], [7, 0], [4, 4], [0, 8], [8, 3]]) {
            // 每一行让开之后的槽位：被拖的那首占 to，其余按位移落位。
            const slots: string[] = [];
            queue.forEach((song, index) => {
                const slot = index === from ? to : index + queueRowShift(index, from, to) / ROW;
                slots[slot] = song;
            });
            expect(slots).toEqual(moveQueueItem(queue, from, to));
        }
    });
});

describe('autoScrollVelocity', () => {
    const box = { top: 100, bottom: 420 };

    it('is still in the middle of the list', () => {
        expect(autoScrollVelocity({ ...box, pointerY: 260 })).toBe(0);
        expect(autoScrollVelocity({ ...box, pointerY: box.top + QUEUE_AUTOSCROLL_EDGE_PX })).toBe(0);
    });

    it('speeds up linearly towards each edge and tops out at and past it', () => {
        expect(autoScrollVelocity({ ...box, pointerY: box.top + QUEUE_AUTOSCROLL_EDGE_PX / 2 })).toBeCloseTo(-QUEUE_AUTOSCROLL_MAX_SPEED / 2);
        expect(autoScrollVelocity({ ...box, pointerY: box.top })).toBe(-QUEUE_AUTOSCROLL_MAX_SPEED);
        expect(autoScrollVelocity({ ...box, pointerY: box.top - 80 })).toBe(-QUEUE_AUTOSCROLL_MAX_SPEED);
        expect(autoScrollVelocity({ ...box, pointerY: box.bottom - QUEUE_AUTOSCROLL_EDGE_PX / 4 })).toBeCloseTo(QUEUE_AUTOSCROLL_MAX_SPEED * 0.75);
        expect(autoScrollVelocity({ ...box, pointerY: box.bottom + 300 })).toBe(QUEUE_AUTOSCROLL_MAX_SPEED);
    });

    it('narrows the edge zones on a list too short to hold both', () => {
        // 40px 高：每边只有 20px，正中不滚。
        expect(autoScrollVelocity({ top: 0, bottom: 40, pointerY: 20 })).toBe(0);
        expect(autoScrollVelocity({ top: 0, bottom: 40, pointerY: 10 })).toBeCloseTo(-QUEUE_AUTOSCROLL_MAX_SPEED / 2);
        expect(autoScrollVelocity({ top: 0, bottom: 0, pointerY: 0 })).toBe(0);
    });
});

describe('autoScrollEdgeAt', () => {
    const box = { top: 100, bottom: 420 };

    it('names the edge zone the pointer is in, counting overshoot past the list', () => {
        expect(autoScrollEdgeAt({ ...box, pointerY: 110 })).toBe('top');
        expect(autoScrollEdgeAt({ ...box, pointerY: 40 })).toBe('top');
        expect(autoScrollEdgeAt({ ...box, pointerY: 260 })).toBeNull();
        expect(autoScrollEdgeAt({ ...box, pointerY: 410 })).toBe('bottom');
        expect(autoScrollEdgeAt({ ...box, pointerY: 900 })).toBe('bottom');
        expect(autoScrollEdgeAt({ top: 0, bottom: 0, pointerY: 0 })).toBeNull();
    });
});

describe('resolveAutoScroll', () => {
    const box = { top: 100, bottom: 420 };

    it('holds the edge a drag started in until the pointer leaves that zone', () => {
        // 从最下一行的手柄开始拖：起点就在下边缘区里，那一侧先不滚。
        let state = resolveAutoScroll({ ...box, pointerY: 412, suppressedEdge: 'bottom' });
        expect(state).toEqual({ velocity: 0, suppressedEdge: 'bottom' });
        state = resolveAutoScroll({ ...box, pointerY: 418, suppressedEdge: state.suppressedEdge });
        expect(state).toEqual({ velocity: 0, suppressedEdge: 'bottom' });
        // 离开下边缘区：抑制解除。
        state = resolveAutoScroll({ ...box, pointerY: 300, suppressedEdge: state.suppressedEdge });
        expect(state).toEqual({ velocity: 0, suppressedEdge: null });
        // 再回到下边缘：照常滚。
        state = resolveAutoScroll({ ...box, pointerY: box.bottom, suppressedEdge: state.suppressedEdge });
        expect(state.velocity).toBe(QUEUE_AUTOSCROLL_MAX_SPEED);
        expect(state.suppressedEdge).toBeNull();
    });

    it('releases the hold when the pointer jumps straight to the other edge, which scrolls at once', () => {
        const state = resolveAutoScroll({ ...box, pointerY: box.top, suppressedEdge: 'bottom' });
        expect(state).toEqual({ velocity: -QUEUE_AUTOSCROLL_MAX_SPEED, suppressedEdge: null });
    });

    it('behaves like autoScrollVelocity when nothing is held', () => {
        for (const pointerY of [40, 110, 260, 410, 900]) {
            expect(resolveAutoScroll({ ...box, pointerY, suppressedEdge: null })).toEqual({
                velocity: autoScrollVelocity({ ...box, pointerY }),
                suppressedEdge: null,
            });
        }
    });
});
