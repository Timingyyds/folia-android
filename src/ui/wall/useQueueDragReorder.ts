import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import {
    QUEUE_DRAG_THRESHOLD_PX,
    QUEUE_ISLAND_ROW_HEIGHT,
    autoScrollEdgeAt,
    resolveAutoScroll,
    resolveDropIndex,
    type QueueAutoScrollEdge,
} from './queueDragGeometry';

// src/ui/wall/useQueueDragReorder.ts
// 队列浮岛（WallToolsQueueIsland）的指针拖拽排序。不用 framer 的 Reorder（它要求全部条目挂载，和虚拟列表冲突），
// 也不引入 dnd 库：
// - 手柄上按下后把指针捕获到浮岛列表的外框（captureRef，拖拽中不会卸载；被拖的那一行滚出虚拟窗口被卸掉也不丢指针），
//   移动超过 4px 才开始拖；
// - pointermove 只记下最新的 clientY，计算合并进 rAF：每帧算一次落点，落点变了才 setState（React 只在跨行时渲染）；
// - 幽灵行（浮岛画的那一份）的位置直接写 ref.style.transform，不走 React state；
// - 指针离列表上下边缘 32px 以内时 rAF 自动滚动（最快约 14px / 帧），滚动本身也会重新算落点；从某一侧的边缘区里
//   开始拖时那一侧先不滚，离开那一区之后才启用（resolveAutoScroll）；
// - 移动时发现主键已经松开（丢了 pointerup，例如松手发生在窗口外又没捕获到）就当作取消，不让会话一直挂着；
// - 松手时按 song key 复核队列：被拖的那首还在 from 才交给 onDrop，中途队列变了（切歌移除、别处编辑）就放弃。
// Esc 由浮岛的分层处理调 cancel()。

export type QueueDrag = { from: number; to: number };

type DragSession = {
    pointerId: number;
    from: number;
    to: number;
    songKey: string;
    startX: number;
    startY: number;
    clientY: number;
    /** 按下点离那一行顶边的距离：幽灵行跟着指针走时保持这个抓取点。 */
    grabOffset: number;
    /** 起点所在的边缘区（那一侧的自动滚动先不启用，离开那一区后清空）。 */
    suppressedEdge: QueueAutoScrollEdge | null;
    active: boolean;
    frame: number | null;
    target: HTMLElement;
    detach: () => void;
};

type UseQueueDragReorderOptions = {
    /** 承接指针捕获的稳定元素（浮岛的列表外框）。 */
    captureRef: RefObject<HTMLElement | null>;
    /** 列表的滚动元素（react-window List 的根）。 */
    getScrollElement: () => HTMLElement | null;
    rowCount: number;
    /** 下标 → 这首歌的 playback key（越界时 null）。 */
    keyAt: (index: number) => string | null;
    onDrop: (from: number, to: number) => void;
    rowHeight?: number;
};

export const useQueueDragReorder = ({
    captureRef,
    getScrollElement,
    rowCount,
    keyAt,
    onDrop,
    rowHeight = QUEUE_ISLAND_ROW_HEIGHT,
}: UseQueueDragReorderOptions) => {
    const [drag, setDrag] = useState<QueueDrag | null>(null);
    const sessionRef = useRef<DragSession | null>(null);
    const ghostNodeRef = useRef<HTMLElement | null>(null);
    const latest = useRef({ getScrollElement, rowCount, keyAt, onDrop, rowHeight });
    latest.current = { getScrollElement, rowCount, keyAt, onDrop, rowHeight };

    /** 幽灵行跟着指针走（相对列表视口，夹在上下各半行之内）。 */
    const placeGhost = (session: DragSession, listRect: DOMRect) => {
        const ghost = ghostNodeRef.current;
        if (!ghost) return;
        const height = latest.current.rowHeight;
        const y = Math.min(listRect.height - height / 2, Math.max(-height / 2, session.clientY - listRect.top - session.grabOffset));
        ghost.style.transform = `translate3d(0, ${y}px, 0)`;
    };

    /** 一帧：自动滚动一步、算落点（变了才 setState）、摆幽灵行；还在滚就约下一帧。 */
    const step = () => {
        const session = sessionRef.current;
        if (!session) return;
        session.frame = null;
        const element = latest.current.getScrollElement();
        if (!element) return;
        const rect = element.getBoundingClientRect();
        const { velocity, suppressedEdge } = resolveAutoScroll({
            pointerY: session.clientY,
            top: rect.top,
            bottom: rect.bottom,
            suppressedEdge: session.suppressedEdge,
        });
        session.suppressedEdge = suppressedEdge;
        let scrolled = false;
        if (velocity !== 0) {
            const before = element.scrollTop;
            element.scrollTop = before + velocity;
            scrolled = element.scrollTop !== before;
        }
        const height = latest.current.rowHeight;
        const to = resolveDropIndex({
            centerY: session.clientY - rect.top + element.scrollTop - session.grabOffset + height / 2,
            rowHeight: height,
            rowCount: latest.current.rowCount,
        });
        if (to !== session.to) {
            session.to = to;
            setDrag({ from: session.from, to });
        }
        placeGhost(session, rect);
        // 指针停在边缘不动时也要继续滚；滚到头了就停，等下一次移动再续上。
        if (scrolled) schedule();
    };

    const schedule = () => {
        const session = sessionRef.current;
        if (!session || !session.active || session.frame !== null) return;
        session.frame = requestAnimationFrame(step);
    };

    /** 结束这次拖拽：commit 时复核队列后交给 onDrop，否则只撤掉。 */
    const finish = useCallback((commit: boolean) => {
        const session = sessionRef.current;
        if (!session) return;
        sessionRef.current = null;
        session.detach();
        if (session.frame !== null) cancelAnimationFrame(session.frame);
        try {
            if (session.target.hasPointerCapture(session.pointerId)) session.target.releasePointerCapture(session.pointerId);
        } catch {
            // 元素已经不在文档里：捕获早就没了。
        }
        if (!session.active) return;
        setDrag(null);
        const { keyAt: readKey, onDrop: drop, rowCount: count } = latest.current;
        if (!commit || session.from === session.to || session.to >= count) return;
        if (readKey(session.from) !== session.songKey) return;
        drop(session.from, session.to);
    }, []);

    /** 手柄上按下指针（只认主键 / 主指针）。 */
    const beginDrag = useCallback((index: number, event: ReactPointerEvent<HTMLElement>) => {
        if (event.button !== 0 || !event.isPrimary || sessionRef.current) return;
        const target = captureRef.current;
        const songKey = latest.current.keyAt(index);
        const row = event.currentTarget.closest<HTMLElement>('[data-queue-index]');
        if (!target || songKey === null || !row) return;
        // 不让按下变成选字或把焦点挪到别处。
        event.preventDefault();
        try {
            target.setPointerCapture(event.pointerId);
        } catch {
            return;
        }

        const handleMove = (moveEvent: PointerEvent) => {
            const session = sessionRef.current;
            if (!session || moveEvent.pointerId !== session.pointerId) return;
            // 主键已经不在按着：pointerup 丢了，撤掉这次拖拽（不提交）。
            if ((moveEvent.buttons & 1) === 0) {
                finish(false);
                return;
            }
            session.clientY = moveEvent.clientY;
            if (!session.active) {
                const distance = Math.hypot(moveEvent.clientX - session.startX, moveEvent.clientY - session.startY);
                if (distance <= QUEUE_DRAG_THRESHOLD_PX) return;
                session.active = true;
                setDrag({ from: session.from, to: session.from });
            }
            schedule();
        };
        const handleUp = (upEvent: PointerEvent) => {
            if (upEvent.pointerId === sessionRef.current?.pointerId) finish(true);
        };
        const handleCancel = (cancelEvent: PointerEvent) => {
            if (cancelEvent.pointerId === sessionRef.current?.pointerId) finish(false);
        };
        // 拖拽中用滚轮滚列表：落点跟着变。
        const scrollElement = latest.current.getScrollElement();
        const scrollRect = scrollElement?.getBoundingClientRect();
        const handleScroll = () => schedule();

        target.addEventListener('pointermove', handleMove);
        target.addEventListener('pointerup', handleUp);
        target.addEventListener('pointercancel', handleCancel);
        target.addEventListener('lostpointercapture', handleCancel);
        scrollElement?.addEventListener('scroll', handleScroll, { passive: true });

        sessionRef.current = {
            pointerId: event.pointerId,
            from: index,
            to: index,
            songKey,
            startX: event.clientX,
            startY: event.clientY,
            clientY: event.clientY,
            grabOffset: event.clientY - row.getBoundingClientRect().top,
            suppressedEdge: scrollRect
                ? autoScrollEdgeAt({ pointerY: event.clientY, top: scrollRect.top, bottom: scrollRect.bottom })
                : null,
            active: false,
            frame: null,
            target,
            detach: () => {
                target.removeEventListener('pointermove', handleMove);
                target.removeEventListener('pointerup', handleUp);
                target.removeEventListener('pointercancel', handleCancel);
                target.removeEventListener('lostpointercapture', handleCancel);
                scrollElement?.removeEventListener('scroll', handleScroll);
            },
        };
    // schedule / step 是每次渲染新建的闭包，但它们只读 ref 与 setDrag，第一次渲染的那份一直对。
    }, [captureRef, finish]);

    /** 幽灵行的 ref：挂上时立刻摆到指针处，免得第一帧出现在列表顶上。 */
    const ghostRef = useCallback((node: HTMLElement | null) => {
        ghostNodeRef.current = node;
        const session = sessionRef.current;
        const element = latest.current.getScrollElement();
        if (node && session && element) placeGhost(session, element.getBoundingClientRect());
    }, []);

    const cancel = useCallback(() => finish(false), [finish]);
    /** 此刻是否正在拖（跨过了阈值）：切歌时的自动滚动在拖拽中跳过。 */
    const isDragging = useCallback(() => sessionRef.current?.active === true, []);

    // 卸载（面板收起、换墙）时撤掉进行中的拖拽。
    useEffect(() => () => finish(false), [finish]);

    return { drag, beginDrag, ghostRef, cancel, isDragging };
};
