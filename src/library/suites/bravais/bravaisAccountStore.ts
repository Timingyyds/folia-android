import { create } from 'zustand';
import type { OnlineProviderId } from '../../../types/onlineMusic';
import type { BravaisAccountForm } from './bravaisAccountModel';

// src/library/suites/bravais/bravaisAccountStore.ts
// account surface（BravaisAccount）与 stage 之间的通道（B10，设计稿 §10.7）：登录态 / 确认态不进任何层描述——它们与
// 当前是哪一层无关（集合层开着时也可能来一个待确认切换），所以 surface 把投影好的表单与动作放在这里，stage 读它决定缝的
// 开口与内容（bravaisSeamTarget 的 login / confirm 变体），缝在表单显示且可交互时挂 data-folia-keyboard-window。
// 模块作用域：surface 与 stage 各自 lazy 加载、先后挂载都没关系；surface 卸载（换 suite、首页整个藏起）时清空。

/** 表单里的动作（surface 给，身份稳定；每个都直接调账户 controller，不 await 它的事务）。 */
export type BravaisAccountActions = {
    selectMethod: (methodId: string) => void;
    retry: () => void;
    restart: () => void;
    /** 生成诊断报告并复制到剪贴板：report 是生成出来的报告（生成失败为 null），copied 是复制成功。 */
    copyDiagnostics: () => Promise<{ report: string | null; copied: boolean }>;
    /** 打开 GitHub 反馈页（报告放得进链接时带上，否则只留粘贴提示）；Electron 里交给系统浏览器。 */
    openIssue: (providerId: OnlineProviderId, report: string | null) => void;
    close: () => void;
    confirm: (requestId: number) => void;
    cancel: (requestId: number) => void;
};

type BravaisAccountState = {
    form: BravaisAccountForm | null;
    actions: BravaisAccountActions | null;
    /** 首页外壳此刻可交互：只有这时缝才接管键盘。 */
    isInteractive: boolean;
    /** 缝里此刻渲染着的表单元素（判断焦点是不是在表单自己的按钮上）。 */
    element: HTMLElement | null;
};

export const useBravaisAccountStore = create<BravaisAccountState>(() => ({
    form: null,
    actions: null,
    isInteractive: false,
    element: null,
}));

export const publishBravaisAccount = (form: BravaisAccountForm | null, actions: BravaisAccountActions | null, isInteractive: boolean) => {
    const state = useBravaisAccountStore.getState();
    if (state.form === form && state.actions === actions && state.isInteractive === isInteractive) return;
    useBravaisAccountStore.setState({ form, actions, isInteractive });
};

export const setBravaisAccountElement = (element: HTMLElement | null) => {
    if (useBravaisAccountStore.getState().element !== element) useBravaisAccountStore.setState({ element });
};

/** 给独占按键层的 containerRef：每次现读 store（缝翻转换了 DOM 节点也跟得上）。 */
export const bravaisAccountElementRef = {
    get current(): HTMLElement | null {
        return useBravaisAccountStore.getState().element;
    },
};

/** 缝在账户表单显示时该接管键盘吗（表单在、且首页外壳可交互）。 */
export const selectBravaisAccountKeyboardWindow = (state: BravaisAccountState) => state.form !== null && state.isInteractive;

/** 缝的账户变体：确认态优先于登录态（见 resolveBravaisAccountForm）。 */
export const selectBravaisAccountVariant = (state: BravaisAccountState): 'login' | 'confirm' | null => (
    state.form ? state.form.kind : null
);
