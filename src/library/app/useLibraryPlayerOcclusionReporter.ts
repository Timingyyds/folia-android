import { useCallback, useEffect, useMemo } from 'react';
import {
    useLibraryPlayerOcclusionStore,
    type LibraryPlayerBackdrop,
    type LibraryPlayerOcclusionOwner,
} from '../../state/useLibraryPlayerOcclusionStore';

// src/library/app/useLibraryPlayerOcclusionReporter.ts
// stage 挂载位与遮挡 store 之间的接线（B6b）：给挂着的 stage 一个 reportPlayerOcclusion，并负责复位——
// 挂载位卸载（离开首页约 350ms 后 Home 返回 null）、换 suite、生效 suite 没有 stage 时，登记随之注销，
// 生效值回到 false。stage 不需要、也不应该自己在卸载时报 false。
// 透出画面的报告（reportPlayerBackdrop：歌词文字、模糊）走同一个持有者，复位规则相同。

/**
 * 按挂着的 stage 所属 suite 登记一个持有者，返回给 stage 的两个报告函数（同一 suite 内引用稳定）。
 * stageSuiteId 为 null（没有 stage）时不登记，返回的函数什么也不做。
 */
export const useLibraryPlayerOcclusionReporter = (stageSuiteId: string | null) => {
    // 每次挂载 / 换 suite 一个新身份：旧 stage 晚到的报告对不上新身份，不会生效。
    const owner = useMemo<LibraryPlayerOcclusionOwner | null>(
        () => (stageSuiteId === null ? null : { suiteId: stageSuiteId }),
        [stageSuiteId],
    );

    useEffect(() => {
        if (!owner) return undefined;
        const { mount, release } = useLibraryPlayerOcclusionStore.getState();
        mount(owner);
        return () => release(owner);
    }, [owner]);

    const reportPlayerOcclusion = useCallback((occludes: boolean) => {
        if (!owner) return;
        useLibraryPlayerOcclusionStore.getState().report(owner, occludes);
    }, [owner]);
    const reportPlayerBackdrop = useCallback((backdrop: LibraryPlayerBackdrop) => {
        if (!owner) return;
        useLibraryPlayerOcclusionStore.getState().reportBackdrop(owner, backdrop);
    }, [owner]);
    return { reportPlayerOcclusion, reportPlayerBackdrop };
};
