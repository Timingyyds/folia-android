import type { WallDirection } from '../../../ui/wall/wallNavigation';

// src/library/suites/bravais/bravaisKeyboardModel.ts
// 墙上的按键（设计稿 §7.6，纯规则）：只认不可打印的键——方向键、Enter 一族、Esc、Home、PgUp / PgDn、Tab。
// 可打印字符由命令面板分发（打字即过滤，交给缝里的输入位，见 resolveBravaisTypingKey），Space 是全局的播放 / 暂停，都不在这里接管；带 Ctrl / Alt / Meta 的组合只处理表里
// 列出的那几个（Alt+Enter / Alt+Shift+Enter），其余一律放行。Esc 阶梯每次只处理一级。

export type BravaisKeyAction =
    | { type: 'move'; direction: WallDirection }
    | { type: 'enter' }
    | { type: 'enqueue' }
    | { type: 'open-album' }
    | { type: 'open-artist' }
    | { type: 'escape' }
    | { type: 'first' }
    | { type: 'last' }
    | { type: 'page'; direction: -1 | 1 }
    | { type: 'tab'; backwards: boolean };

export type BravaisKeyInput = {
    key: string;
    shiftKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    repeat: boolean;
};

const ARROWS: Record<string, WallDirection> = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
};

export const resolveBravaisKey = (input: BravaisKeyInput): BravaisKeyAction | null => {
    const { key, shiftKey, altKey, ctrlKey, metaKey, repeat } = input;
    if (ctrlKey || metaKey) return null;
    if (key === 'Enter') {
        if (repeat) return null;
        if (altKey) return { type: shiftKey ? 'open-artist' : 'open-album' };
        return { type: shiftKey ? 'enqueue' : 'enter' };
    }
    if (altKey) return null;
    if (key === 'Escape') return repeat ? null : { type: 'escape' };
    if (key === 'Tab') return { type: 'tab', backwards: shiftKey };
    if (shiftKey) return null;
    const direction = ARROWS[key];
    if (direction) return { type: 'move', direction };
    if (key === 'Home') return { type: 'first' };
    if (key === 'End') return { type: 'last' };
    if (key === 'PageDown') return { type: 'page', direction: 1 };
    if (key === 'PageUp') return { type: 'page', direction: -1 };
    return null;
};

/**
 * Esc 阶梯的一级（设计稿 §10.8：表单态 → 聚焦卡 → 键盘焦点 → 面板 → 过滤词 → onBack）。没有的级别跳过。
 * B9：首页的管理隐藏视图（view）排在面板之后、过滤词之前（两者互斥：有批量的目录没有可隐藏的条目）。
 */
export type BravaisEscapeStep = 'form' | 'focus-card' | 'keyboard-focus' | 'panel' | 'view' | 'query' | 'back';

export const resolveEscapeStep = ({
    hasForm = false,
    hasFocusCard,
    hasKeyboardFocus,
    hasPanel = false,
    hasViewMode = false,
    hasQuery = false,
    canGoBack,
}: {
    hasForm?: boolean;
    hasFocusCard: boolean;
    hasKeyboardFocus: boolean;
    hasPanel?: boolean;
    hasViewMode?: boolean;
    hasQuery?: boolean;
    canGoBack: boolean;
}): BravaisEscapeStep | null => {
    if (hasForm) return 'form';
    if (hasFocusCard) return 'focus-card';
    if (hasKeyboardFocus) return 'keyboard-focus';
    if (hasPanel) return 'panel';
    if (hasViewMode) return 'view';
    if (hasQuery) return 'query';
    return canGoBack ? 'back' : null;
};

/**
 * 墙上的「打字即过滤」（设计稿 §7.6）：不带 Ctrl / Alt / Meta 的可打印字符是过滤词的一个字（`char`），输入法的开头
 * （`Process` / `Unidentified`，还没有字）是 `ime`；Space（全局播放 / 暂停）与 `reserved` 里的键（首页的 `/` 是全局
 * 搜索）不算。按键先到命令面板，它留下自己的 `:` 之后经过滤注册的 ownInput 交给缝（useBravaisSeamFilter）。
 */
export const resolveBravaisTypingKey = (
    input: Pick<BravaisKeyInput, 'key' | 'altKey' | 'ctrlKey' | 'metaKey'>,
    reserved: readonly string[] = [],
): 'char' | 'ime' | null => {
    const { key, altKey, ctrlKey, metaKey } = input;
    if (altKey || ctrlKey || metaKey) return null;
    if (key === 'Process' || key === 'Unidentified') return 'ime';
    if ([...key].length !== 1 || key === ' ' || reserved.includes(key)) return null;
    return 'char';
};
