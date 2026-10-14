import { useEffect, useRef } from 'react';
import { hasBlockingWindow, isTextEntryTarget } from '../../../lib/keyboardTargets';
import { resolveBravaisKey } from './bravaisKeyboardModel';
import { resolveBravaisHomeKey } from './bravaisHomeKeys';
import type { BravaisWallKeyAction } from './useBravaisInteractions';

// src/library/suites/bravais/useBravaisKeyboard.ts
// 墙的按键监听（设计稿 §7.6）：只在 stage 此刻可交互（isInteractive 且当前层归 bravais）时装在 window 上。
// 焦点在输入框里、或存在接管键盘的窗口（data-folia-keyboard-window：命令面板、对话框）时让出；别人已经处理过的
// 按键（defaultPrevented）不再处理。按键 → 动作的规则在 bravaisKeyboardModel，处理器返回 true 才 preventDefault。
// B9：通用规则不认的键再交给首页的规则（bravaisHomeKeys：F6、批量模式的 Insert / Ctrl+A / Ctrl+Enter / Delete）。
// Tab 例外：焦点在输入框里也交给处理器（缝里的过滤位 / 搜索框里按 Tab 回墙；墙外的输入框由处理器放行），输入法组词中不接。

export const useBravaisKeyboard = (
    active: boolean,
    onAction: (action: BravaisWallKeyAction, target: EventTarget | null) => boolean,
) => {
    const latest = useRef(onAction);
    latest.current = onAction;

    useEffect(() => {
        if (!active) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.isComposing || hasBlockingWindow()) return;
            const action = resolveBravaisKey(event) ?? resolveBravaisHomeKey(event);
            if (!action) return;
            if (isTextEntryTarget(event.target) && action.type !== 'tab') return;
            if (latest.current(action, event.target)) event.preventDefault();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [active]);
};
