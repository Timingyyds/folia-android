import { useExclusiveKeyLayer, type ExclusiveKeyHandler } from '../../../hooks/useExclusiveKeyLayer';

// src/library/suites/tui/useLibraryTuiAccountKeys.ts
// TUI 账户层（登录框、切换确认）开着时的按键：在 window 的捕获阶段接管，开着就独占键盘。
// 与 TUI 其它按键不同，这里不靠「目标在不在输入框里」「有没有上层窗口」让路——账户层本身就是最上层，
// 登录与确认会阻塞流程，必须有人答复：
// - 不带修饰键的按键一律截住（stopPropagation），底下的 TUI 首页 / 集合层、命令面板的打字即筛选、全局的空格播放 /
//   暂停都收不到；可打印字符与处理了的键还会 preventDefault（不落进任何输入框、空格不滚动页面）。
// - 带 Ctrl / Alt / Meta 的组合键与 Tab 放过：浏览器与开发者工具的快捷键、Ctrl+K 命令面板与键盘焦点照常。
// - 焦点在账户层自己的按钮上时，Enter / 空格交还给按钮（原生激活），不当成「主动作」。
// - Enter / Escape 不响应长按重复。
// 只在 isActive（账户层显示着、且首页外壳可交互）时装上监听；集合层开着时它照样在最上层，集合层的 TUI 按键
// 看到 data-folia-keyboard-window 也会让路。
// B10：实现提到了 src/hooks/useExclusiveKeyLayer（bravais 缝里的登录态 / 确认态共用同一份），这里保留 TUI 的名字。

export type LibraryTuiAccountKeyHandler = ExclusiveKeyHandler;

export const useLibraryTuiAccountKeys = useExclusiveKeyLayer;
