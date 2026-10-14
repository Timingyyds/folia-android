import { useMemo, useRef } from 'react';

// src/library/suites/bravais/useBravaisPopTo.ts
// 把宿主的 onPopTo（面包屑跳层，B11）变成层描述上身份稳定的回调：层描述只在数据变化时换身份，执行时读最新的宿主回调。
// 宿主没给（契约里是可选的）时为 undefined，面包屑画成不可点的文字。

export const useBravaisPopTo = (onPopTo: ((depth: number) => void) | undefined) => {
    const latestRef = useRef(onPopTo);
    latestRef.current = onPopTo;
    const available = Boolean(onPopTo);
    return useMemo(() => (available ? (depth: number) => latestRef.current?.(depth) : undefined), [available]);
};
