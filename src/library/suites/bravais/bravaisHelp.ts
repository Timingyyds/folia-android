import type { BravaisKeyInput } from './bravaisKeyboardModel';

// src/library/suites/bravais/bravaisHelp.ts
// 右下角工具面板「操作提示」的行（纯数据）：每行一件事，「说明 + 右侧一个按键标签」，与 Lattice 的帮助列表同一排版。
// 内容以 bravais 实际的键位为准（bravaisKeyboardModel / bravaisHomeKeys / 命令面板的全局键，设计稿 §7.6）；
// `probe` 是这行按键对应的一次按下，单测拿它过一遍按键规则，确认帮助里写的键真的有那个动作。
// 每面墙都注册了当前页过滤（设计稿 §7.6）：直接打字进缝里的过滤输入位，S 也只是一个过滤字符，所以不列 S；
// 命令面板只列 Ctrl / Cmd+K。`/` 是首页的「搜索在线平台」（批量模式下它也是过滤字符）。
// `typing` 是「打字」这一行的探针：过一遍 resolveBravaisTypingKey，确认普通字符算过滤字符、`/` 在首页被留给搜索。

export type BravaisHelpRow = {
    id: string;
    /** i18n key（libraryBravais.help*）。 */
    labelKey: string;
    /** 右侧按键标签；`mod` 是平台主修饰键的显示名（Ctrl / Cmd，PRIMARY_MODIFIER_LABEL）。 */
    kbd: (mod: string) => string;
    /** 墙上的按键规则会解析出的动作类型（命令面板的全局键没有，单测另外核对）。 */
    probe?: { input: Partial<BravaisKeyInput> & { key: string }; action: string };
    /** 打字过滤这一行：这个键应被认作过滤字符（resolveBravaisTypingKey，首页保留 `/`）。 */
    typing?: { key: string };
};

export const BRAVAIS_HELP_ROWS: readonly BravaisHelpRow[] = Object.freeze<BravaisHelpRow[]>([
    { id: 'filter', labelKey: 'libraryBravais.helpFilter', kbd: () => 'A–Z', typing: { key: 'a' } },
    { id: 'search', labelKey: 'libraryBravais.helpSearch', kbd: () => '/', probe: { input: { key: '/' }, action: 'open-search' } },
    { id: 'move', labelKey: 'libraryBravais.helpMove', kbd: () => '↑ ↓ ← →', probe: { input: { key: 'ArrowRight' }, action: 'move' } },
    { id: 'open', labelKey: 'libraryBravais.helpOpen', kbd: () => 'Enter', probe: { input: { key: 'Enter' }, action: 'enter' } },
    { id: 'play', labelKey: 'libraryBravais.helpPlay', kbd: () => 'Enter', probe: { input: { key: 'Enter' }, action: 'enter' } },
    { id: 'enqueue', labelKey: 'libraryBravais.helpEnqueue', kbd: () => 'Shift + Enter', probe: { input: { key: 'Enter', shiftKey: true }, action: 'enqueue' } },
    { id: 'back', labelKey: 'libraryBravais.helpBack', kbd: () => 'ESC', probe: { input: { key: 'Escape' }, action: 'escape' } },
    { id: 'seam', labelKey: 'libraryBravais.helpSeam', kbd: () => 'Tab', probe: { input: { key: 'Tab' }, action: 'tab' } },
    { id: 'tabs', labelKey: 'libraryBravais.helpTabs', kbd: () => 'F6', probe: { input: { key: 'F6' }, action: 'cycle-tab' } },
    // 执行模式 `:` + 外观动作 locate-playing 的执行键 `c`（bravais entry.ts）。
    { id: 'locate', labelKey: 'libraryBravais.helpLocate', kbd: () => ': + C' },
    // 工具面板顶部的「队列洗牌」「前往 Lattice」的键（命令面板的全局键，单测核对）：执行模式 `:` + 洗牌命令的执行键 `r`，
    // 与 navigate-lattice 的 Ctrl / Cmd+B。
    { id: 'shuffle', labelKey: 'libraryBravais.helpShuffle', kbd: () => ': + R' },
    { id: 'lattice', labelKey: 'libraryBravais.helpLattice', kbd: mod => `${mod} + B` },
    { id: 'commands', labelKey: 'libraryBravais.helpCommands', kbd: mod => `${mod} + K` },
]);
