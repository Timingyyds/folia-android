import { animate } from 'framer-motion';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { blockSeamPlan, getSeamGeometry } from '../../../ui/wall/seamPlan';
import type { WallViewCenter } from '../../../ui/wall/wallView';
import { BRAVAIS_METRICS, BRAVAIS_SEAM_TWEEN_S } from './bravaisConstants';
import type { BravaisLayer } from './bravaisLayer';
import { useBravaisSeamStore } from './bravaisSeamLevel';
import { resolveSeamContentIdentity, resolveVariantWidth, type BravaisSeamContentVariant } from './bravaisSeamTarget';
import { clearSeamFlipPhase, playSeamFlipIn, playSeamFlipOut } from './bravaisSeamMotion';
import type { BravaisFrameState } from './useBravaisFrame';

// src/library/suites/bravais/useBravaisSeam.ts
// 缝（设计稿 §5）：锚点（块边界的世界 x，React state——墙按它分左右两半）、开口宽度的补间（只写帧状态）、
// 缝里渲染的那套内容。换层、换等级时内容原地翻转：转到 90° 才换成新内容与新的排版宽度（翻转不重排），所以
// 「此刻渲染的内容」是单独的 state，只在换的那一刻 setState 一次。开口变宽或恢复时，锚点还在屏内就沿用它的
// 块边界、相机只做最小让位；不在屏内就在当前视口里另取最近的块边界（B5 的 blockSeamPlan）。
// 缝内过渡（设计稿 §7「缝内的过渡」）：内容翻转用 bravaisSeamMotion 的半圈（与墙上磁贴同一种绕 Y 轴的翻牌），降低动效
// （B11 的同一套判断）时换成 0.18s 淡出 → 换 → 淡入；从折叠回来时开口补间、内容随之淡入（降低动效时开口不补间，内容
// 淡入）。过渡中内容层挂 data-bravais-seam-flip。首页换页签也整条翻（2026-10-09 起，与原型一致）。

export type BravaisRenderedSeam = { variant: BravaisSeamContentVariant; layer: BravaisLayer | null };

/** 焦点此刻没落在任何控件上（被 inert 挤掉后浏览器交给了 body）。 */
const isFocusDropped = () => document.activeElement === null || document.activeElement === document.body;


export const useBravaisSeam = ({
    frameRef,
    renderFrame,
    layer,
    target,
    viewportWidth,
    contentRef,
    reducedMotion,
    reducedTransitions,
    tweenCamera,
    checkCull,
}: {
    frameRef: MutableRefObject<BravaisFrameState>;
    renderFrame: () => void;
    layer: BravaisLayer | null;
    /** 此刻的开口与内容（等级之上还有表单、列表面板、过滤框的临时展开，见 bravaisSeamTarget）。 */
    target: { width: number; variant: BravaisSeamContentVariant };
    viewportWidth: number;
    contentRef: RefObject<HTMLDivElement | null>;
    /** 开口补间降级（只看 lattice，与相机一致）。 */
    reducedMotion: boolean;
    /** 内容翻转降级成淡入淡出（B11 的同一套判断，bravaisMotion）。 */
    reducedTransitions: boolean;
    tweenCamera: (center: WallViewCenter) => void;
    /** 开口变了（可见的世界范围随之变了）：让相机检查要不要重新裁剪；force = 开口落定，按含开口的范围裁剪一次。 */
    checkCull: (force?: boolean) => void;
}) => {
    const level = useBravaisSeamStore(state => state.level);
    const [anchorX, setAnchorState] = useState<number | null>(null);
    const targetWidth = layer ? target.width : 0;
    const targetVariant: BravaisSeamContentVariant = layer ? target.variant : 'none';
    const [rendered, setRendered] = useState<BravaisRenderedSeam>({ variant: targetVariant, layer });
    const widthAnimationRef = useRef<{ stop: () => void } | null>(null);

    const setAnchor = useCallback((x: number | null) => {
        frameRef.current.anchorX = x;
        setAnchorState(x);
        renderFrame();
    }, [frameRef, renderFrame]);

    /** 缝锚点此刻在不在屏内（在就沿用它的块边界）。 */
    const isAnchorOnScreen = useCallback(() => {
        const { anchorX: x, view, center } = frameRef.current;
        if (x === null || !view) return false;
        const geometry = getSeamGeometry({ anchorX: x, cameraX: center.x, openWidth: 1, view });
        return geometry.screenX > 0 && geometry.screenX < view.width;
    }, [frameRef]);

    /** 要张开 `width` 的缝：选块边界、算相机的最小让位（相对 `center`，返回让位后的视图中心）。 */
    const planOpening = useCallback((center: WallViewCenter, width: number, preferAnchor: boolean) => {
        const { view, anchorX: current } = frameRef.current;
        if (!view) return { anchorX: current, center };
        const plan = blockSeamPlan({
            cameraX: center.x,
            openWidth: width,
            view,
            metrics: BRAVAIS_METRICS,
            preferX: preferAnchor && current !== null ? current : undefined,
        });
        return { anchorX: plan.x, center: { x: plan.cameraX, y: center.y } };
    }, [frameRef]);

    /** 开口补间到目标宽度（每帧只写帧状态与 DOM；途中快到裁剪边缘时补裁剪，落定时按含开口的可见范围裁剪一次）。 */
    const tweenWidth = useCallback((to: number, from = frameRef.current.openWidth) => {
        widthAnimationRef.current?.stop();
        frameRef.current.targetOpenWidth = to;
        if (reducedMotion || Math.abs(to - from) < 0.5) {
            widthAnimationRef.current = null;
            const changed = Math.abs(to - frameRef.current.openWidth) >= 0.5;
            frameRef.current.openWidth = to;
            renderFrame();
            checkCull(changed);
            return;
        }
        frameRef.current.openWidth = from;
        widthAnimationRef.current = animate(from, to, {
            duration: BRAVAIS_SEAM_TWEEN_S,
            ease: [0.65, 0, 0.35, 1],
            onUpdate: value => {
                frameRef.current.openWidth = value;
                renderFrame();
                checkCull();
            },
            onComplete: () => {
                widthAnimationRef.current = null;
                checkCull(true);
            },
        });
    }, [checkCull, frameRef, reducedMotion, renderFrame]);

    // 目标宽度变了（换层、换等级）就补间过去；折叠等级也写进帧状态（悬浮按钮常驻）。
    const hasLayer = Boolean(layer);
    // 「折叠」看的是生效的内容（过滤框、面板、表单开着时折叠等级暂不生效）。
    const isFolded = hasLayer && targetVariant === 'none';
    useEffect(() => {
        frameRef.current.hidden = isFolded;
        tweenWidth(targetWidth);
    }, [frameRef, isFolded, targetWidth, tweenWidth]);

    // 同一层换了开口（换等级、开合列表面板、表单态、过滤框的临时展开）且要张开：锚点在屏内就沿用、相机最小让位；
    // 不在屏内就另取一条块边界。换层时的开口由换层编排（useBravaisDisplay）一起算，这里不重复让位。
    const layerKey = layer?.key ?? null;
    const previousOpeningRef = useRef({ layerKey, width: targetWidth });
    useEffect(() => {
        const previous = previousOpeningRef.current;
        previousOpeningRef.current = { layerKey, width: targetWidth };
        if (previous.layerKey !== layerKey || previous.width === targetWidth) return;
        if (!layer || targetWidth <= 0) return;
        const plan = planOpening(frameRef.current.center, targetWidth, isAnchorOnScreen());
        if (plan.anchorX !== frameRef.current.anchorX) setAnchor(plan.anchorX);
        tweenCamera(plan.center);
    }, [frameRef, isAnchorOnScreen, layer, layerKey, planOpening, setAnchor, targetWidth, tweenCamera]);

    // 缝里的内容：换层（首页换页签也是换层，2026-10-09 起整条翻）或换形态时翻转（转到 90° 换内容与排版宽度），同一层的
    // 数据更新就地刷新（渲染时取最新的层）。
    const renderedLayer = rendered.layer && layer && resolveSeamContentIdentity(rendered.layer) === resolveSeamContentIdentity(layer) ? layer : rendered.layer;
    const renderedKey = `${rendered.variant}|${rendered.layer ? resolveSeamContentIdentity(rendered.layer) : ''}`;
    const targetKey = `${targetVariant}|${layer ? resolveSeamContentIdentity(layer) : ''}`;
    const latestTargetRef = useRef({ layer, targetVariant });
    latestTargetRef.current = { layer, targetVariant };
    const pendingInRef = useRef<{ fromNone: boolean; reduced: boolean; focused: HTMLElement | null; toggleByKeyboard: boolean } | null>(null);
    const inAnimationRef = useRef<Animation | null>(null);
    /** 放完的转出段停在 90°，等新内容渲染出来、转进段开始时才取消（中间不露出转正的旧内容）。 */
    const outAnimationRef = useRef<Animation | null>(null);
    // 翻转途中目标又换了（A → B → C）不重来：转到 90° 时换成最新的目标（latestTargetRef）。只有「要不要翻、怎么翻」变了
    // 才重跑（目标回到了正画着的内容、或换成了折叠）。
    const fromNone = renderedKey.startsWith('none|');
    const toNone = targetKey.startsWith('none|');
    const flipMode = renderedKey === targetKey ? 'none' : fromNone || toNone ? `swap|${targetKey}` : 'flip';
    useLayoutEffect(() => {
        if (flipMode === 'none') return undefined;
        const element = contentRef.current;
        // 转出的半圈里旧内容 inert（BravaisSeam），焦点会被浏览器移走：记下此刻聚焦的元素，换完内容它还在（同一种内容
        // 换了形态，React 复用了这个节点，例如书脊的「⋯」展开成窄缝）就把焦点还给它。
        const active = document.activeElement;
        const focused = element && active instanceof HTMLElement && element.contains(active) ? active : null;
        // 焦点在标题（切换开口的那个）上且是键盘焦点（:focus-visible）：换完内容把焦点交给新内容里的标题。
        const toggleByKeyboard = Boolean(focused?.hasAttribute('data-bravais-seam-toggle') && focused.matches(':focus-visible'));
        const swap = (animateIn: boolean) => {
            const next = latestTargetRef.current;
            pendingInRef.current = animateIn ? { fromNone, reduced: reducedTransitions, focused, toggleByKeyboard } : null;
            setRendered({ variant: next.targetVariant, layer: next.layer });
        };
        // 折叠与展开之间不翻：开口从 0 补间、内容随开口淡入（frame 的 contentOpacity）。降低动效时开口不补间，
        // 内容在折叠回来时淡入。
        if (!element || flipMode !== 'flip') {
            swap(Boolean(element) && fromNone && reducedTransitions);
            return undefined;
        }
        inAnimationRef.current?.cancel();
        inAnimationRef.current = null;
        let swapped = false;
        const out = playSeamFlipOut(element, 'y', reducedTransitions);
        outAnimationRef.current = out;
        out.onfinish = () => {
            swapped = true;
            swap(true);
        };
        return () => {
            if (!swapped) {
                out.cancel();
                clearSeamFlipPhase(element);
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fromNone 由 renderedKey 决定
    }, [contentRef, flipMode, reducedTransitions, renderedKey]);

    // 换完内容：新内容转进来（降低动效时淡入）。转进这一段不随上面的 effect 清理取消：换内容本身就会让它重跑。
    useLayoutEffect(() => {
        const pending = pendingInRef.current;
        if (pending === null) return;
        pendingInRef.current = null;
        outAnimationRef.current?.cancel();
        outAnimationRef.current = null;
        const element = contentRef.current;
        if (!element) return;
        const { focused } = pending;
        if (focused && focused.isConnected && element.contains(focused) && document.activeElement !== focused) {
            focused.focus({ preventScroll: true });
        } else if (focused && !focused.isConnected && pending.toggleByKeyboard && isFocusDropped()) {
            // fb10：用键盘在标题上切换了开口（完整信息条 ↔ 书脊），旧标题随内容卸载了：焦点交给新内容里的那个标题，
            // 再按一次 Enter 就切回去（鼠标点的不挪焦点）。
            element.querySelector<HTMLElement>('[data-bravais-seam-toggle]')?.focus({ preventScroll: true });
        }
        inAnimationRef.current = playSeamFlipIn(element, 'y', pending.reduced || pending.fromNone, () => { inAnimationRef.current = null; });
    }, [contentRef, rendered]);
    useEffect(() => () => {
        inAnimationRef.current?.cancel();
        outAnimationRef.current?.cancel();
    }, []);

    // 排版宽度跟着「此刻渲染的那套内容」走，不跟目标宽度走。
    useLayoutEffect(() => {
        frameRef.current.contentWidth = resolveVariantWidth(rendered.variant, viewportWidth);
        renderFrame();
    }, [frameRef, renderFrame, rendered.variant, viewportWidth]);

    useEffect(() => () => widthAnimationRef.current?.stop(), []);

    /** 自动出屏收起后，在当前视口里裂开一道新缝（不拉回原锚点，设计稿 §5）。 */
    const reopenHere = useCallback(() => {
        if (!layer || targetWidth <= 0) return;
        const plan = planOpening(frameRef.current.center, targetWidth, false);
        setAnchor(plan.anchorX);
        tweenWidth(targetWidth, 0);
        tweenCamera(plan.center);
    }, [frameRef, layer, planOpening, setAnchor, targetWidth, tweenCamera, tweenWidth]);

    /** 此刻缝本该张开却被挤到屏外收起了（边缘标签在场）。 */
    const isCollapsed = useCallback(() => {
        const { anchorX: x, view, center, openWidth } = frameRef.current;
        if (x === null || !view || targetWidth <= 0) return false;
        return getSeamGeometry({ anchorX: x, cameraX: center.x, openWidth: Math.max(openWidth, targetWidth), view }).collapsed;
    }, [frameRef, targetWidth]);

    const contentWidth = resolveVariantWidth(rendered.variant, viewportWidth);
    return {
        level,
        anchorX,
        setAnchor,
        targetWidth,
        rendered: { variant: rendered.variant, layer: renderedLayer, width: contentWidth },
        /** 正画着的内容正要翻走（转出的半圈、降低动效时的淡出）：缝把它藏起来，不可点、不进无障碍树。 */
        leaving: flipMode === 'flip',
        planOpening,
        isAnchorOnScreen,
        reopenHere,
        isCollapsed,
    };
};
