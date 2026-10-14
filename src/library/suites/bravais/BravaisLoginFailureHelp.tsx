import React, { useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, ClipboardCopy, ExternalLink, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { OnlineProviderId } from '../../../types/onlineMusic';
import type { BravaisLoginFailureHelp, BravaisLoginSelfCheck } from './bravaisAccountModel';
import type { BravaisAccountActions } from './bravaisAccountStore';

// src/library/suites/bravais/BravaisLoginFailureHelp.tsx
// 缝里登录态的失败帮助（account-login-diagnostics，设计稿 §10.7）：缝只有 300px 宽，二维码下面一栏排下来，
// 按用户该做的顺序——
// 1. 几条简单办法（重启 Folia；换个网络再重启）；
// 2. 自检（running 时转圈与「正在检查」，跑完是结论、可能的代理提示与逐项结果，自检出错时是出错说明）；
// 3. 收起的「还是不行？」：展开后才有提示、报告内容的告知、复制诊断与去 GitHub 反馈——不一上来就让人发 issue；
//    网页版部署问题或非官方构建不给去 GitHub 的按钮，提示语换成该找谁（escalation.elsewhere）。
// 报告要等点了才生成（会等还在跑的自检）。重试后失败形态清空，这块随之卸载；调用方按会话代次给 key，下一次失败重新收起。

type CopyState = 'idle' | 'working' | 'copied' | 'failed';

const SELF_CHECK_ICONS = { ok: Check, fail: X, warn: AlertTriangle, skip: Check } as const;

const SelfCheck: React.FC<{ selfCheck: BravaisLoginSelfCheck }> = ({ selfCheck }) => (
    <div className="bravais-login-help-section" data-bravais-login-self-check={selfCheck.state}>
        <p className="is-label">{selfCheck.title}</p>
        <p className={`is-summary is-${selfCheck.state}`} data-bravais-login-self-check-summary>
            {selfCheck.state === 'running' && <Loader2 aria-hidden className="animate-spin" />}
            <span>{selfCheck.summary}</span>
        </p>
        {selfCheck.proxyNote && <p className="is-soft">{selfCheck.proxyNote}</p>}
        {selfCheck.items.length > 0 && (
            <ul className="bravais-login-checks">
                {selfCheck.items.map(item => {
                    const Icon = SELF_CHECK_ICONS[item.state];
                    return (
                        <li key={item.id} className={`is-${item.state}`} title={item.title}
                            data-bravais-login-self-check-item={item.id} data-state={item.state}>
                            <Icon aria-hidden />
                            <span>{item.text}</span>
                        </li>
                    );
                })}
            </ul>
        )}
    </div>
);

const BravaisLoginFailureHelpView: React.FC<{
    help: BravaisLoginFailureHelp;
    providerId: OnlineProviderId;
    actions: Pick<BravaisAccountActions, 'copyDiagnostics' | 'openIssue'>;
}> = ({ help, providerId, actions }) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);
    const [copyState, setCopyState] = useState<CopyState>('idle');

    // 复制与反馈都先把报告放进剪贴板：链接放不下完整报告时，用户在 issue 页直接粘贴即可。
    const copy = async () => {
        setCopyState('working');
        const result = await actions.copyDiagnostics();
        setCopyState(result.copied ? 'copied' : 'failed');
        return result.report;
    };
    const report = async () => {
        actions.openIssue(providerId, await copy());
    };

    const copyLabel = copyState === 'copied'
        ? t('home.qrDiagnosticsCopied')
        : copyState === 'failed' ? t('home.qrDiagnosticsCopyFailed') : t('home.qrDiagnosticsCopy');
    const CopyIcon = copyState === 'working' ? Loader2 : copyState === 'copied' ? Check : ClipboardCopy;
    const Chevron = expanded ? ChevronDown : ChevronRight;

    return (
        <div className="bravais-login-help" data-bravais-login-failure-help>
            <div className="bravais-login-help-section">
                <p className="is-label">{help.tips.title}</p>
                <ol className="bravais-login-tips" data-bravais-login-tips>
                    {help.tips.items.map(item => <li key={item}>{item}</li>)}
                </ol>
            </div>
            {help.selfCheck && <SelfCheck selfCheck={help.selfCheck} />}
            <div className="bravais-login-help-section">
                <button type="button" className="bravais-login-escalation" aria-expanded={expanded}
                    data-bravais-form-action="toggle-diagnostics" onClick={() => setExpanded(value => !value)}>
                    <Chevron aria-hidden />
                    <span>{help.escalation.label}</span>
                </button>
                {expanded && (
                    <div className="bravais-login-diagnostics" data-bravais-login-diagnostics>
                        <p>{help.escalation.prompt}</p>
                        <p className="is-soft" data-bravais-login-disclosure>{t('home.qrDiagnosticsDisclosure')}</p>
                        <span className="bravais-login-diagnostics-buttons">
                            <button type="button" className="bravais-chrome-button is-primary" data-bravais-form-action="copy-diagnostics"
                                data-bravais-copy-state={copyState} disabled={copyState === 'working'} onClick={() => void copy()}>
                                <CopyIcon aria-hidden className={copyState === 'working' ? 'animate-spin' : undefined} />{copyLabel}
                            </button>
                            {!help.escalation.elsewhere && (
                                <button type="button" className="bravais-chrome-button" data-bravais-form-action="report-diagnostics"
                                    disabled={copyState === 'working'} onClick={() => void report()}>
                                    <ExternalLink aria-hidden />{t('home.qrDiagnosticsReport')}
                                </button>
                            )}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default BravaisLoginFailureHelpView;
