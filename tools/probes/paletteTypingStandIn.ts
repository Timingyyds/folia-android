import { useEffect } from 'react';
import { useAppViewStore } from '../../src/state/useAppViewStore';
import { isTextEntryTarget } from '../../src/lib/keyboardTargets';

// dev/probes/paletteTypingStandIn.ts
// 组件探针里没有命令面板（useCommandPalette 挂在 App 上）。墙上打字的分发由它负责：注册了自带输入位的过滤
// （CommandFilterHandle.ownInput，bravais 的缝）时，不带修饰键的可打印字符 / 输入法开头交给 ownInput.takeKey。
// 这里只照搬那一支（`:` 执行模式与可选的 `s` 不在探针里），让组件用例能在墙上直接打字；真实应用里的那一支由
// e2e（test/ui/bravaisCollectionFilter.spec.ts）覆盖。

export const usePaletteTypingStandIn = () => {
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.ctrlKey || event.altKey || event.metaKey || isTextEntryTarget(event.target)) return;
            const ownInput = useAppViewStore.getState().commandFilter?.ownInput;
            if (!ownInput) return;
            if (event.key === 'Process' || event.key === 'Unidentified' || event.key.length === 1) ownInput.takeKey(event);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);
};
