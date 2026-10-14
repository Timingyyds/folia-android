import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { LibraryAccountSurfaceProps } from '../../core/contracts/account';
import { useLibraryAccountLogin, useLibraryAccountPendingSwitch } from '../../core/bindings/useLibraryAccount';
import { useExclusiveKeyLayer } from '../../../hooks/useExclusiveKeyLayer';
import { buildQrLoginIssueUrl } from '../../../lib/qrLoginDiagnosticReport';
import { resolveBravaisAccountForm, type BravaisAccountForm, type BravaisLoginFeatures } from './bravaisAccountModel';
import { bravaisAccountElementRef, publishBravaisAccount, type BravaisAccountActions } from './bravaisAccountStore';

// src/library/suites/bravais/BravaisAccount.tsx
// bravais 的 account surface（B10，设计稿 §10.7）：登录与切换确认都在缝里完成，不弹浮层、不接 accountLayerRef（宿主给的
// layer 忽略）。这里只渲染 null：订阅账户 controller 的登录会话与待确认切换（core 的绑定，已翻译），投影成缝的表单态
// （bravaisAccountModel），连同动作放进 bravaisAccountStore；stage 读它把缝强制拉到完整宽度、翻成登录态 / 确认态，
// 缝在表单显示时挂 data-folia-keyboard-window。
// - 按键：表单显示、且首页外壳可交互时，独占不带修饰键的按键（useExclusiveKeyLayer）。Esc 先撤销表单态（关闭登录 /
//   取消切换）；Enter 是此刻的主动作（确认切换；登录态里重试或重启后端），焦点在表单自己的按钮上时交还给按钮；
//   ←→↑↓ 在登录方式之间移动焦点（QQ 两步式），Enter 选它。
// - 失败帮助（account-login-diagnostics）：诊断报告等用户点了才生成；反馈先把报告放进剪贴板，再开 GitHub 的 issue 页。
// - 确认后立即翻回：controller 同步清掉待确认请求，不 await confirmSwitch 的事务（清理、刷新在后台走完）。
// - 寿命：controller 属于 App，换 suite 只换这个组件——登录会话与待确认切换都保持，换回来接着显示。卸载时清空 store
//   （关闭登录、取消切换的逻辑在宿主 LibraryAccountHost，不在这里）。
// - 可选动作按声明显示：没声明 account-login-diagnostics / account-backend-restart 就不给那个入口。

// Electron 里 window.open 会开一个新的 BrowserWindow，必须走主进程交给系统浏览器。
const openExternal = (url: string) => {
    if (window.electron?.openExternalUrl) {
        void window.electron.openExternalUrl(url);
        return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
};

const METHOD_SELECTOR = '[data-bravais-login-method]';

/** 在登录方式按钮之间移动焦点（没有方式时不处理）。 */
const moveMethodFocus = (delta: 1 | -1): boolean => {
    const container = bravaisAccountElementRef.current;
    const options = container ? [...container.querySelectorAll<HTMLButtonElement>(METHOD_SELECTOR)] : [];
    if (options.length === 0) return false;
    const focused = options.findIndex(option => option === document.activeElement);
    const selected = options.findIndex(option => option.getAttribute('aria-pressed') === 'true');
    const from = focused >= 0 ? focused : selected >= 0 ? selected : delta > 0 ? -1 : 0;
    options[(from + delta + options.length) % options.length].focus({ preventScroll: true });
    return true;
};

const BravaisAccount: React.FC<LibraryAccountSurfaceProps> = ({ account, isInteractive, declaredActions }) => {
    const { t } = useTranslation();
    const login = useLibraryAccountLogin(account);
    const pendingSwitch = useLibraryAccountPendingSwitch(account);
    const diagnostics = declaredActions.actions.includes('account-login-diagnostics');
    const backendRestart = declaredActions.actions.includes('account-backend-restart');
    const features = useMemo<BravaisLoginFeatures>(() => ({ diagnostics, backendRestart }), [backendRestart, diagnostics]);
    const form = useMemo<BravaisAccountForm | null>(() => resolveBravaisAccountForm({
        login,
        pendingSwitch,
        features,
        confirmLabels: { confirm: t('libraryBravaisAccount.confirmSwitch'), cancel: t('libraryBravaisAccount.cancel') },
    }), [features, login, pendingSwitch, t]);

    const accountRef = useRef(account);
    accountRef.current = account;
    const tRef = useRef(t);
    tRef.current = t;
    const actions = useMemo<BravaisAccountActions>(() => ({
        selectMethod: methodId => void accountRef.current.selectLoginMethod(methodId),
        retry: () => void accountRef.current.retryLogin(),
        restart: () => void accountRef.current.restartLoginBackend(),
        copyDiagnostics: async () => {
            let report: string | null = null;
            try {
                const result = await accountRef.current.buildLoginDiagnosticReport();
                if (result.status !== 'ok') throw new Error('no login session to report');
                report = result.report;
                await navigator.clipboard.writeText(report);
                return { report, copied: true };
            } catch (error) {
                console.warn('[ProviderQrLogin] diagnostics:copy-failed', error);
                return { report, copied: false };
            }
        },
        openIssue: (providerId, report) => openExternal(buildQrLoginIssueUrl({
            providerId,
            report: report ?? '',
            pasteHint: tRef.current('home.qrDiagnosticsPasteHint'),
        })),
        close: () => void accountRef.current.closeLogin(),
        // 不 await：controller 同步清掉待确认请求，缝随之翻回；清理与刷新在后台走完。
        confirm: requestId => void accountRef.current.confirmSwitch(requestId),
        cancel: requestId => void accountRef.current.cancelSwitch(requestId),
    }), []);

    // 布局阶段交出去：同一次提交里 stage 就能按它开缝，不先画一帧旧的开口。
    useLayoutEffect(() => {
        publishBravaisAccount(form, actions, isInteractive);
    }, [actions, form, isInteractive]);
    useEffect(() => () => publishBravaisAccount(null, null, false), []);

    useExclusiveKeyLayer({
        isActive: form !== null && isInteractive,
        containerRef: bravaisAccountElementRef,
        onKey: key => {
            if (!form) return false;
            if (form.kind === 'confirm') {
                if (key === 'Enter') actions.confirm(form.requestId);
                else if (key === 'Escape') actions.cancel(form.requestId);
                else return false;
                return true;
            }
            switch (key) {
                case 'Escape':
                    actions.close();
                    return true;
                case 'ArrowUp':
                case 'ArrowLeft':
                    return moveMethodFocus(-1);
                case 'ArrowDown':
                case 'ArrowRight':
                    return moveMethodFocus(1);
                case 'Enter':
                    if (form.retry && !form.retry.disabled) {
                        actions.retry();
                        return true;
                    }
                    if (form.restart && !form.restart.restarting) {
                        actions.restart();
                        return true;
                    }
                    return false;
                default:
                    return false;
            }
        },
    });

    return null;
};

export default BravaisAccount;
