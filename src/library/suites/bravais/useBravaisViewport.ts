import { useEffect, useState, type RefObject } from 'react';
import type { WallView } from '../../../ui/wall/wallView';
import { getBravaisScale } from './bravaisConstants';

// src/library/suites/bravais/useBravaisViewport.ts
// stage 的视口尺寸与相机缩放：ResizeObserver 量出来，只有尺寸真的变了才写 state（离散；缩放档位按宽度断点）。
// 还没量到之前是 null：墙不画，免得用默认尺寸摆一遍再挪。

export const useBravaisViewport = (rootRef: RefObject<HTMLElement | null>): WallView | null => {
    const [view, setView] = useState<WallView | null>(null);

    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        const update = (width: number, height: number) => {
            if (width <= 0 || height <= 0) return;
            setView(current => (
                current && current.width === width && current.height === height
                    ? current
                    : { width, height, scale: getBravaisScale(width) }
            ));
        };
        update(root.clientWidth, root.clientHeight);
        const observer = new ResizeObserver(([entry]) => update(entry.contentRect.width, entry.contentRect.height));
        observer.observe(root);
        return () => observer.disconnect();
    }, [rootRef]);

    return view;
};
