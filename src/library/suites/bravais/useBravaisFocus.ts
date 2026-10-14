import { useCallback, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { resolveRevealCenter, type RevealRect } from '../../../ui/wall/revealRect';
import type { WallViewCenter } from '../../../ui/wall/wallView';
import type { WallSlot } from '../../../ui/wall/wallSlots';
import { BRAVAIS_METRICS, BRAVAIS_REVEAL_PAD_PX } from './bravaisConstants';
import { resolveFocusReflow } from './bravaisDisplay';
import type { BravaisFrameState } from './useBravaisFrame';

// src/library/suites/bravais/useBravaisFocus.ts
// 两个独立的状态（与 Lattice 的 is-focused / is-expanded 对应）：键盘焦点（发丝线 + 主色环）与聚焦卡（6×6 块内让位，
// 全局只有一张）。都按 slot 记、只在离散变化时 setState。聚焦卡所在块的 12 个 slot 换成让位后的矩形（块外不动），
// 展开后与键盘焦点移动后相机做最小平移让矩形完整可见（底边避开播放条安全区），尽量让缝留在屏内（wall/revealRect）。
// 让位的过渡（展开、换卡、收起 / 换块时的归位）由 useBravaisReflowDriver 逐帧驱动，这里只给落定的让位表。

export const useBravaisFocus = ({
    frameRef,
    tweenTo,
    getBottomInset,
    onFocusEntry,
}: {
    frameRef: MutableRefObject<BravaisFrameState>;
    tweenTo: (center: WallViewCenter) => void;
    /** 此刻播放条安全区的高度（屏幕 px）；没有播放条时是普通边距。 */
    getBottomInset: () => number;
    /** 键盘焦点换到了某个 slot：stage 把它换成条目 key 交给层描述。 */
    onFocusEntry: (slotKey: string | null) => void;
}) => {
    const [focusedSlotKey, setFocusedSlotKey] = useState<string | null>(null);
    const [expandedSlotKey, setExpandedSlotKey] = useState<string | null>(null);
    const focusedRef = useRef(focusedSlotKey);
    focusedRef.current = focusedSlotKey;
    const expandedRef = useRef(expandedSlotKey);
    expandedRef.current = expandedSlotKey;

    const reflow = useMemo(() => resolveFocusReflow(expandedSlotKey), [expandedSlotKey]);
    const reflowRef = useRef(reflow);
    reflowRef.current = reflow;

    /** slot 此刻画在哪（聚焦块里取让位后的矩形）。 */
    const drawnRect = useCallback((slot: WallSlot): WallSlot => reflowRef.current.get(slot.key) ?? slot, []);

    const reveal = useCallback((rect: RevealRect) => {
        const frame = frameRef.current;
        if (!frame.view) return;
        tweenTo(resolveRevealCenter({
            rect,
            center: frame.center,
            view: frame.view,
            metrics: BRAVAIS_METRICS,
            anchorX: frame.anchorX,
            // 开口正在张开时按张开后的宽度让位（交接回来时缝张开与聚焦卡展开同时进行）。
            seamWidth: Math.max(frame.openWidth, frame.targetOpenWidth),
            pad: BRAVAIS_REVEAL_PAD_PX,
            bottomInset: getBottomInset(),
        }));
    }, [frameRef, getBottomInset, tweenTo]);

    const focusSlot = useCallback((slot: WallSlot | null, options: { reveal?: boolean } = {}) => {
        const key = slot?.key ?? null;
        if (focusedRef.current !== key) {
            focusedRef.current = key;
            setFocusedSlotKey(key);
            onFocusEntry(key);
        }
        if (slot && options.reveal) reveal(drawnRect(slot));
    }, [drawnRect, onFocusEntry, reveal]);

    const expand = useCallback((slot: WallSlot) => {
        expandedRef.current = slot.key;
        setExpandedSlotKey(slot.key);
        const rect = resolveFocusReflow(slot.key).get(slot.key);
        if (rect) reveal(rect);
    }, [reveal]);

    const collapse = useCallback(() => {
        if (expandedRef.current === null) return;
        expandedRef.current = null;
        setExpandedSlotKey(null);
    }, []);

    return {
        focusedSlotKey,
        expandedSlotKey,
        focusedRef,
        expandedRef,
        reflow,
        drawnRect,
        reveal,
        focusSlot,
        expand,
        collapse,
    };
};
