import React, { useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode, type Ref, type RefObject } from 'react';
import { BRAVAIS_REDUCED_FADE_MS } from './bravaisConstants';
import { useBravaisReducedTransitions } from './bravaisMotion';
import {
    clearSeamFlipPhase,
    playSeamFlipIn,
    playSeamFlipOut,
    refocusWithin,
    type BravaisSeamFlipAxis,
} from './bravaisSeamMotion';

// src/library/suites/bravais/BravaisSeamFlip.tsx
// 缝里一块内容的翻牌（设计稿 §7「缝内的过渡」）：
// - BravaisSeamFlip：`flipKey` 变了，这一块先带着旧内容转出半圈（旧内容 inert，不可点、不进无障碍树），转到 90° 换成
//   新内容再转回来；同一个 key 下的数据更新就地刷新。转出途中 key 又变了不重来，转到 90° 时换成最新的。换内容前焦点在
//   这一块里的，换完落到新内容里选中的那一项（否则第一个能聚焦的）。
// - useBravaisSeamFade：同一块内容换了样子（首页页签缩成一个字、标题隐藏）——淡入新的样子（只动 opacity）。
// - BravaisSeamFlipText：一行字（计数、状态、日期）变了，新字只转进半圈（不等旧字转出，打字过滤时不拖慢）。
// 降低动态效果时两者都换成淡入淡出（bravaisSeamMotion）。

type FlipProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
    flipKey: string;
    axis?: BravaisSeamFlipAxis;
    children: ReactNode;
    ref?: Ref<HTMLDivElement>;
};

/** 把外面给的 ref 与自己用的 ref 接到同一个元素上。 */
const assignRef = <T,>(ref: Ref<T> | undefined, value: T | null) => {
    if (typeof ref === 'function') ref(value);
    else if (ref) (ref as React.MutableRefObject<T | null>).current = value;
};

export const BravaisSeamFlip: React.FC<FlipProps> = ({ flipKey, axis = 'y', children, ref, ...rest }) => {
    const reduced = useBravaisReducedTransitions();
    const elementRef = useRef<HTMLDivElement | null>(null);
    const [shownKey, setShownKey] = useState(flipKey);
    /** 此刻画着的那个 key 的内容（同一个 key 下随渲染刷新；转出途中停在旧的那份）。 */
    const shownChildrenRef = useRef<ReactNode>(children);
    if (shownKey === flipKey) shownChildrenRef.current = children;
    const flipping = shownKey !== flipKey;
    const latestKeyRef = useRef(flipKey);
    latestKeyRef.current = flipKey;
    const outRef = useRef<Animation | null>(null);
    const inRef = useRef<Animation | null>(null);
    /** 转出放完、等新内容渲染出来再转进；记着换之前焦点在不在这一块里。 */
    const pendingInRef = useRef<{ hadFocus: boolean } | null>(null);
    const reducedRef = useRef(reduced);
    reducedRef.current = reduced;

    const setRef = (element: HTMLDivElement | null) => {
        elementRef.current = element;
        assignRef(ref, element);
    };

    useLayoutEffect(() => {
        if (!flipping) return undefined;
        const element = elementRef.current;
        if (!element) {
            setShownKey(latestKeyRef.current);
            return undefined;
        }
        inRef.current?.cancel();
        inRef.current = null;
        const hadFocus = element.contains(document.activeElement);
        const out = playSeamFlipOut(element, axis, reducedRef.current);
        outRef.current = out;
        out.onfinish = () => {
            pendingInRef.current = { hadFocus };
            setShownKey(latestKeyRef.current);
        };
        return () => {
            // 转出段放完后由转进段接手；还没放完（卸载）就地取消，内容回正。
            if (pendingInRef.current === null) {
                out.cancel();
                clearSeamFlipPhase(element);
            }
        };
    // 只在「开始翻」时跑：转出途中 key 又变了，转到 90° 时直接换成最新的（latestKeyRef）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [flipping]);

    useLayoutEffect(() => {
        const pending = pendingInRef.current;
        if (pending === null) return;
        pendingInRef.current = null;
        outRef.current?.cancel();
        outRef.current = null;
        const element = elementRef.current;
        if (!element) return;
        if (pending.hadFocus) refocusWithin(element);
        inRef.current = playSeamFlipIn(element, axis, reducedRef.current, () => { inRef.current = null; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shownKey]);

    useLayoutEffect(() => () => {
        outRef.current?.cancel();
        inRef.current?.cancel();
    }, []);

    return (
        <div ref={setRef} {...rest} inert={flipping || undefined} aria-hidden={flipping || rest['aria-hidden'] || undefined}>
            {flipping ? shownChildrenRef.current : children}
        </div>
    );
};

type FlipTextProps = HTMLAttributes<HTMLSpanElement> & {
    /** 变了就翻（一般就是显示的文字）。 */
    flipKey: string;
    axis?: BravaisSeamFlipAxis;
    as?: 'span' | 'div' | 'p';
};

/** 一行字变了：新字转进半圈（降级时淡入）。第一次挂载不翻。 */
export const BravaisSeamFlipText: React.FC<FlipTextProps> = ({ flipKey, axis = 'x', as = 'span', ...rest }) => {
    const reduced = useBravaisReducedTransitions();
    const elementRef = useRef<HTMLElement | null>(null);
    const previousRef = useRef(flipKey);
    const animationRef = useRef<Animation | null>(null);
    useLayoutEffect(() => {
        if (previousRef.current === flipKey) return;
        previousRef.current = flipKey;
        const element = elementRef.current;
        if (!element) return;
        animationRef.current?.cancel();
        animationRef.current = playSeamFlipIn(element, axis, reduced, () => { animationRef.current = null; });
    }, [axis, flipKey, reduced]);
    useLayoutEffect(() => () => animationRef.current?.cancel(), []);
    const Tag = as;
    return <Tag ref={(element: HTMLElement | null) => { elementRef.current = element; }} {...rest} />;
};

/** `key` 变了（第一次挂载不算），给这几个元素放一段 0.18s 的淡入（只动 opacity，不影响量高度）。 */
export const useBravaisSeamFade = (key: string, ...refs: RefObject<HTMLElement | null>[]) => {
    const previousRef = useRef(key);
    useLayoutEffect(() => {
        if (previousRef.current === key) return undefined;
        previousRef.current = key;
        const animations = refs.flatMap(ref => (ref.current
            ? [ref.current.animate([{ opacity: 0 }, { opacity: 1 }], { duration: BRAVAIS_REDUCED_FADE_MS, easing: 'ease-out' })]
            : []));
        return () => animations.forEach(animation => animation.cancel());
    // refs 是稳定的 ref 对象。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
};
