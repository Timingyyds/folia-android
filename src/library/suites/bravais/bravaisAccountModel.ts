import type { TFunction } from 'i18next';
import type { OnlineProviderId, ProviderAccountSummary } from '../../../types/onlineMusic';
import type {
    LibraryAccountLogoutState,
    LibraryLoginPhase,
    LibraryProviderSwitchReason,
    LoginSelfCheckItem,
} from '../../core/contracts/account';
import type {
    LibraryLoginSelfCheckView,
    LibraryLoginView,
    LibraryProviderSwitchView,
} from '../../core/bindings/useLibraryAccount';
import { canLogoutProvider, isAwaitingLoginMethod, resolveProviderSelectLabel } from '../../core/model/accountRules';
import { canSwitchToProviderDirectly } from '../../core/model/onlineProviderAccountView';
import { translateHomeMessage } from '../../core/model/homeSources';

// src/library/suites/bravais/bravaisAccountModel.ts
// B10 账户（设计稿 §10.7）的纯投影：
// - 缝里的表单态：登录态（二维码 / 选登录方式 / 后端故障、状态行、重试 / 重启 / 关闭、失败帮助）与确认态（切换 / 取消），
//   由 account surface 从账户 controller 的已翻译视图投影出来，交给 stage 画；
// - 首页在线页签窄缝里的平台切换（account-select / account-logout）的行：当前标记、账户状态、选它会做什么、能不能登出。
// 这里只有数据（已翻译的文案与判定），回调另给；规则都来自 core/model/accountRules，与 grid 的弹窗 / 切换器一致。

// ─── 表单态：登录 ──────────────────────────────────────────────────────

/** 二维码位上画什么：二维码、还在要码、选方式的占位（不要码）、后端故障的原因（取代二维码）。 */
export type BravaisLoginQr =
    | { kind: 'image'; url: string }
    | { kind: 'loading' }
    | { kind: 'choose-method'; text: string }
    | { kind: 'backend-failure'; title: string; detail: string | null };

export type BravaisLoginMethodOption = { id: string; label: string; iconKey: string; selected: boolean };

/** 自检的一项：失败 / 提示项的文字带上错误码与域名，悬停提示是完整内容（与 grid 的自检摘要同一取法）。 */
export type BravaisLoginSelfCheckItem = {
    id: LoginSelfCheckItem['id'];
    state: LoginSelfCheckItem['state'];
    text: string;
    title: string;
};

/**
 * 失败后的自检：running 时 summary 是「正在检查」，自检本身出错时是出错说明，跑完是结论（卡在哪一层、该怎么做）；
 * 代理提示与逐项结果只在跑完时有。
 */
export type BravaisLoginSelfCheck = {
    state: 'running' | 'failed' | 'done';
    title: string;
    summary: string;
    proxyNote: string | null;
    items: readonly BravaisLoginSelfCheckItem[];
};

/**
 * 失败帮助（account-login-diagnostics）：按用户该做的顺序——简单办法（重启；换网络再重启）→ 自检结论 →
 * 收在「还是不行？」下面的诊断与反馈（escalation 的 label 是展开项的文字，prompt 是展开后的那句提示，
 * 扫过码才过期时单独一句）。
 */
export type BravaisLoginFailureHelp = {
    tips: { title: string; items: readonly string[] };
    selfCheck: BravaisLoginSelfCheck | null;
    /** elsewhere 非 null 时不给去 GitHub 反馈的按钮（网页版部署问题、非官方构建），prompt 已是这句。 */
    escalation: { label: string; prompt: string; elsewhere: string | null };
};

export type BravaisLoginForm = {
    kind: 'login';
    providerId: OnlineProviderId;
    /** 会话代次：诊断复制的反馈只属于这一轮。 */
    sessionId: number;
    phase: LibraryLoginPhase;
    title: string;
    note: string;
    /** 状态行；选方式的第一步与后端故障时为 null。 */
    status: string | null;
    tone: 'normal' | 'success' | 'error';
    qr: BravaisLoginQr;
    /** provider 声明了多种方式（QQ 两步式）；current 是已选方式的说明，还没选时为 null。 */
    methods: { title: string; hint: string; current: string | null; options: readonly BravaisLoginMethodOption[] } | null;
    /**
     * 重试：过期 / 失败、不在选方式的第一步、后端没有故障时出现；后端要求冷却时按钮在但禁用，并显示秒数
     * （retryCooldownSeconds，按失败那一刻算，与状态行一致；冷却结束时快照清掉它，按钮随之可用）。
     */
    retry: { label: string; disabled: boolean; cooldownSeconds: number | null } | null;
    /** 网易本地后端故障时的重启（account-backend-restart 声明了才有）；重启中禁用。 */
    restart: { label: string; restarting: boolean } | null;
    /**
     * 失败后的帮助（account-login-diagnostics 声明了、且视图给了 failureTips / diagnosticsPrompt 才有——什么时候给由
     * core 的 canShowLoginDiagnostics 决定，不按 provider 判断；后端没拉起来时也给）。
     */
    failureHelp: BravaisLoginFailureHelp | null;
    closeLabel: string;
};

export type BravaisLoginFeatures = {
    diagnostics: boolean;
    backendRestart: boolean;
};

/** 状态行的语气：扫码确认是成功；失败（error，或扫过码之后过期）是错误。 */
const resolveLoginTone = (view: LibraryLoginView): BravaisLoginForm['tone'] => {
    const { phase, failure } = view.session;
    if (phase === 'confirmed') return 'success';
    if (phase === 'error' || (phase === 'expired' && failure)) return 'error';
    return 'normal';
};

/** 已翻译的自检 → 缝里的自检摘要（没有自检时为 null）。 */
export const projectBravaisSelfCheck = (selfCheck: LibraryLoginSelfCheckView | null): BravaisLoginSelfCheck | null => {
    if (!selfCheck) return null;
    if (selfCheck.running) {
        return { state: 'running', title: selfCheck.title, summary: selfCheck.runningText, proxyNote: null, items: [] };
    }
    if (selfCheck.error) {
        return { state: 'failed', title: selfCheck.title, summary: selfCheck.error, proxyNote: null, items: [] };
    }
    return {
        state: 'done',
        title: selfCheck.title,
        summary: selfCheck.verdict ?? '',
        proxyNote: selfCheck.proxyNote,
        items: selfCheck.items.map(item => {
            const full = item.detail ? `${item.label}: ${item.detail}` : item.label;
            return { id: item.id, state: item.state, text: item.state === 'ok' ? item.label : full, title: full };
        }),
    };
};

/** 失败帮助：suite 声明了诊断、且视图此刻给了简单办法与诊断提示时才有。 */
export const projectBravaisFailureHelp = (view: LibraryLoginView, features: BravaisLoginFeatures): BravaisLoginFailureHelp | null => {
    const { failureTips, diagnosticsPrompt } = view;
    if (!features.diagnostics || !failureTips || !diagnosticsPrompt) return null;
    return {
        tips: { title: failureTips.title, items: failureTips.items },
        selfCheck: projectBravaisSelfCheck(view.selfCheck),
        escalation: { label: failureTips.escalation, prompt: diagnosticsPrompt, elsewhere: view.reportElsewhereNote },
    };
};

/** 一份已翻译的登录视图 → 缝里的登录态（与 grid 登录弹窗同一套显示条件）。 */
export const projectBravaisLoginForm = (view: LibraryLoginView, features: BravaisLoginFeatures): BravaisLoginForm => {
    const { session, methodStep, backendFailure } = view;
    const awaitingMethod = isAwaitingLoginMethod(session);
    const qr: BravaisLoginQr = backendFailure
        ? { kind: 'backend-failure', title: backendFailure.title, detail: session.backend.detail }
        : awaitingMethod && methodStep
            ? { kind: 'choose-method', text: methodStep.pending }
            : session.qrImageUrl
                ? { kind: 'image', url: session.qrImageUrl }
                : { kind: 'loading' };
    const canOfferRetry = (session.phase === 'expired' || session.phase === 'error') && !awaitingMethod && !backendFailure;
    return {
        kind: 'login',
        providerId: session.providerId,
        sessionId: session.id,
        phase: session.phase,
        title: view.title,
        note: view.note,
        status: view.status,
        tone: resolveLoginTone(view),
        qr,
        methods: methodStep
            ? {
                title: methodStep.title,
                hint: methodStep.hint,
                current: awaitingMethod ? null : methodStep.current,
                options: methodStep.options.map(option => ({
                    id: option.id,
                    label: option.label,
                    iconKey: option.iconKey,
                    selected: option.id === session.selectedMethodId,
                })),
            }
            : null,
        retry: canOfferRetry
            ? {
                label: view.retryLabel,
                disabled: session.retryCooldownSeconds !== null,
                cooldownSeconds: session.retryCooldownSeconds,
            }
            : null,
        restart: features.backendRestart && backendFailure
            ? {
                label: session.backend.restarting ? backendFailure.restartingLabel : backendFailure.restartLabel,
                restarting: session.backend.restarting,
            }
            : null,
        failureHelp: projectBravaisFailureHelp(view, features),
        closeLabel: view.closeLabel,
    };
};

// ─── 表单态：确认 ──────────────────────────────────────────────────────

export type BravaisConfirmForm = {
    kind: 'confirm';
    /** 确认 / 取消按它结算（过期的返回 stale）。 */
    requestId: number;
    providerId: OnlineProviderId;
    reason: LibraryProviderSwitchReason;
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel: string;
};

export const projectBravaisConfirmForm = (
    view: LibraryProviderSwitchView,
    labels: { confirm: string; cancel: string },
): BravaisConfirmForm => ({
    kind: 'confirm',
    requestId: view.request.id,
    providerId: view.request.to,
    reason: view.request.reason,
    title: view.title,
    description: view.description,
    confirmLabel: labels.confirm,
    cancelLabel: labels.cancel,
});

export type BravaisAccountForm = BravaisLoginForm | BravaisConfirmForm;

/**
 * 缝此刻该显示哪一个表单：待确认的切换优先（它可能紧跟在登录之后——扫码确认后问要不要切过去，也可能在登录界面
 * 开着时到来），其次是此刻该显示的登录（方式还在解析、扫码已确认时不显示）；都没有就是 null。
 */
export const resolveBravaisAccountForm = ({
    login,
    pendingSwitch,
    features,
    confirmLabels,
}: {
    login: LibraryLoginView | null;
    pendingSwitch: LibraryProviderSwitchView | null;
    features: BravaisLoginFeatures;
    confirmLabels: { confirm: string; cancel: string };
}): BravaisAccountForm | null => {
    if (pendingSwitch) return projectBravaisConfirmForm(pendingSwitch, confirmLabels);
    if (login?.visible) return projectBravaisLoginForm(login, features);
    return null;
};

// ─── 首页窄缝的平台切换 ────────────────────────────────────────────────

export type BravaisAccountRow = {
    providerId: OnlineProviderId;
    label: string;
    /** 平台全名（徽章没有头像时的读屏名，与 grid 切换器的第二行同一个字段）。 */
    displayName: string;
    /** 账户状态：昵称 / 未登录 / 无需登录 / 未配置。fb8 起不直接显示，放进行的可访问名与 title。 */
    detail: string;
    /**
     * fb8（用户实测：入口与列表改成 grid 切换器的「图标 / 头像 + 名称」）：行里平台名下面那行小字，只留区分所必需的——
     * 已登录的昵称、「无需登录」「未配置」（与 grid 切换器一致）；「未登录」不写字，由行尾的登录图标表达。
     */
    note: string;
    /** 已登录账户的头像与昵称（没有时为 null，界面退回平台徽章）。 */
    avatarUrl: string | null;
    nickname: string | null;
    current: boolean;
    /** 未配置的平台不能选（行禁用）。 */
    configured: boolean;
    /** 选它直接切换（已登录或无账户），否则要先登录。 */
    direct: boolean;
    /** 选它会做什么（「切换到 X」/「登录 X」）；当前平台与未配置的为空串。 */
    actionLabel: string;
    /**
     * 登出（规则同 grid 切换器：只有当前且已登录的平台有，canLogoutProvider）；已有登出在途时禁用，在途的那一行
     * 文案换成「正在登出」。
     */
    logout: { label: string; disabled: boolean } | null;
};

/** 切换器里的一行能不能现在登出：有登出入口，且没有登出在途（logout.status 不是 pending）。 */
export const canRunLogout = (row: Pick<BravaisAccountRow, 'logout'>): boolean => Boolean(row.logout && !row.logout.disabled);

const describeProviderStatus = (provider: ProviderAccountSummary, t: TFunction): string => {
    if (!provider.availability.configured) return t('libraryBravaisAccount.notConfigured');
    if (provider.requiresAccount === false) return t('home.providerNoAccount');
    return provider.user?.nickname || t('libraryBravaisAccount.notSignedIn');
};

/**
 * provider 列表 → 切换器的行。与 grid 的切换器一样不列运行时不可用的 provider（availability.reason 为
 * runtime-unavailable，例如本构建不带的后端）。
 */
export const projectAccountSwitcherRows = ({
    providers,
    activeProviderId,
    logout,
    t,
}: {
    providers: readonly ProviderAccountSummary[];
    activeProviderId: OnlineProviderId;
    logout: LibraryAccountLogoutState;
    t: TFunction;
}): BravaisAccountRow[] => {
    const logoutPending = logout.status === 'pending';
    return providers
        .filter(provider => provider.availability.reason !== 'runtime-unavailable')
        .map(provider => {
            const current = provider.providerId === activeProviderId;
            const configured = provider.availability.configured;
            const loggingOut = logoutPending && logout.providerId === provider.providerId;
            const detail = describeProviderStatus(provider, t);
            const nickname = configured && provider.requiresAccount !== false ? provider.user?.nickname || null : null;
            return {
                providerId: provider.providerId,
                label: provider.shortName || provider.displayName,
                displayName: provider.displayName || provider.shortName,
                detail,
                note: !configured || provider.requiresAccount === false || nickname ? detail : '',
                avatarUrl: nickname ? provider.user?.avatarUrl || null : null,
                nickname,
                current,
                configured,
                direct: canSwitchToProviderDirectly(provider),
                actionLabel: current || !configured ? '' : translateHomeMessage(t, resolveProviderSelectLabel(provider)),
                logout: canLogoutProvider(provider, activeProviderId)
                    ? {
                        label: loggingOut ? t('libraryBravaisAccount.loggingOut') : t('account.logout'),
                        disabled: logoutPending,
                    }
                    : null,
            };
        });
};
