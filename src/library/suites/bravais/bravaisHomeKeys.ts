import type { BravaisKeyInput } from './bravaisKeyboardModel';

// src/library/suites/bravais/bravaisHomeKeys.ts
// 首页墙上额外的按键（设计稿 §7.6，纯规则）：F6 / Shift+F6 切页签（TUI 切换来源的同一对键）；`/` 打开缝里的全局搜索框；批量模式（目录树面板
// 开着）照搬 TUI 目录页（useLibraryTuiDirectoryKeys）——Insert 切换选中并下移、Ctrl+A 全选、Ctrl+Enter /
// Ctrl+Shift+Enter 播放 / 加入队列所选、Delete 移除所选（先翻成确认态）。批量模式下 Enter 也是切换选中，那一条走
// 墙的 Enter（useBravaisInteractions 的 activate），不在这里。
// 这里只把按键翻成动作；能不能做（是不是首页、批量模式开没开）由处理器判断，不处理就不 preventDefault（Ctrl+A
// 在别处照常是全选文字）。重复按键（repeat）一律忽略。

export type BravaisHomeKeyAction =
    | { type: 'cycle-tab'; delta: 1 | -1 }
    | { type: 'open-search' }
    | { type: 'batch-toggle' }
    | { type: 'batch-select-all' }
    | { type: 'batch-play'; enqueue: boolean }
    | { type: 'batch-remove' };

export const resolveBravaisHomeKey = (input: BravaisKeyInput): BravaisHomeKeyAction | null => {
    const { key, shiftKey, altKey, ctrlKey, metaKey, repeat } = input;
    if (repeat || altKey) return null;
    const command = ctrlKey || metaKey;
    if (key === 'F6' && !command) return { type: 'cycle-tab', delta: shiftKey ? -1 : 1 };
    if (command) {
        if (key === 'Enter') return { type: 'batch-play', enqueue: shiftKey };
        if (!shiftKey && (key === 'a' || key === 'A')) return { type: 'batch-select-all' };
        return null;
    }
    // `/`：首页缝里的全局搜索框（「搜索在线平台」）。首页的过滤注册把 `/` 声明为保留键（批量模式除外），命令面板不把它
    // 当过滤字符交给缝；批量模式下处理器不接，它照常是过滤字符。
    if (key === '/') return { type: 'open-search' };
    if (shiftKey) return null;
    if (key === 'Insert') return { type: 'batch-toggle' };
    if (key === 'Delete') return { type: 'batch-remove' };
    return null;
};
