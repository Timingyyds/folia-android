import React, { useState } from 'react';
import { Check, Loader2, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
    readAiSettings,
    writeAiSettings,
    type AiProviderId,
} from '../../../svc/aiSettings';
import {
    testConfiguredAiConnection,
    type AiConnectionTestResult,
} from '../../../svc/aiThemeClient';

// src/ui/modal/settings/AiProviderSettings.tsx
// 安卓/网页版没有 Electron 主进程，AI 凭据由用户自己填并保存在本机。
// 桌面版沿用主进程设置，这里不参与。

type AiProviderSettingsProps = {
    settingsCardClass: string;
    isDaylight: boolean;
};

type TestState = 'idle' | 'running' | 'done';

const AiProviderSettings: React.FC<AiProviderSettingsProps> = ({ settingsCardClass, isDaylight }) => {
    const { t } = useTranslation();
    const [settings, setSettings] = useState(() => readAiSettings());
    const [testState, setTestState] = useState<TestState>('idle');
    const [testResult, setTestResult] = useState<AiConnectionTestResult | null>(null);

    // 即改即存：没有「保存」按钮，避免用户填完忘了提交。
    const update = (patch: Parameters<typeof writeAiSettings>[0]) => {
        setSettings(writeAiSettings(patch));
        setTestState('idle');
        setTestResult(null);
    };

    const runTest = async () => {
        if (testState === 'running') return;
        setTestState('running');
        setTestResult(null);
        const result = await testConfiguredAiConnection();
        setTestResult(result);
        setTestState('done');
    };

    const fieldClass = 'w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-white/30 transition-colors';
    const ghostButtonClass = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/15 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-default';
    const rowDividerClass = isDaylight ? 'border-black/5' : 'border-white/5';

    const renderProviderOption = (id: AiProviderId, label: string) => {
        const selected = settings.provider === id;
        return (
            <button
                key={id}
                type="button"
                aria-pressed={selected}
                onClick={() => update({ provider: id })}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${selected
                    ? 'bg-white/15 text-[var(--text-primary)]'
                    : 'opacity-55 hover:opacity-85 text-[var(--text-primary)]'}`}
            >
                {label}
            </button>
        );
    };

    return (
        <div className={`rounded-xl border overflow-hidden ${settingsCardClass}`}>
            <div className={`flex flex-wrap items-center justify-between gap-4 p-4 border-b ${rowDividerClass}`}>
                <div className="space-y-1 text-left min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        <Sparkles size={15} className="opacity-70" aria-hidden="true" />
                        {t('ui.aiTheme')}
                    </div>
                    <div className="text-xs opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                        {t('options.aiThemeDesc')}
                    </div>
                </div>
                <div className={`flex rounded-xl border p-1 shrink-0 ${isDaylight ? 'bg-black/[0.05] border-black/10' : 'bg-white/5 border-white/5'}`}>
                    {renderProviderOption('gemini', 'Google Gemini')}
                    {renderProviderOption('openai', t('options.otherCompatibleApi'))}
                </div>
            </div>

            <div className={`p-4 space-y-3 border-b ${rowDividerClass}`}>
                {settings.provider === 'gemini' ? (
                    <label className="block space-y-1 text-left">
                        <span className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.geminiApiKey')}
                        </span>
                        <input
                            type="password"
                            autoComplete="off"
                            spellCheck={false}
                            value={settings.geminiApiKey}
                            onChange={(event) => update({ geminiApiKey: event.target.value })}
                            placeholder="AIza..."
                            className={fieldClass}
                            style={{ color: 'var(--text-primary)' }}
                        />
                    </label>
                ) : (
                    <>
                        <label className="block space-y-1 text-left">
                            <span className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.openaiApiUrl')}
                            </span>
                            <input
                                type="text"
                                autoComplete="off"
                                spellCheck={false}
                                value={settings.openaiApiUrl}
                                onChange={(event) => update({ openaiApiUrl: event.target.value })}
                                placeholder="https://api.openai.com/v1 or https://api.deepseek.com"
                                className={fieldClass}
                                style={{ color: 'var(--text-primary)' }}
                            />
                        </label>
                        <label className="block space-y-1 text-left">
                            <span className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.openaiApiModel')}
                            </span>
                            <input
                                type="text"
                                autoComplete="off"
                                spellCheck={false}
                                value={settings.openaiApiModel}
                                onChange={(event) => update({ openaiApiModel: event.target.value })}
                                placeholder="gpt-5.6-luna / deepseek-v4-flash"
                                className={fieldClass}
                                style={{ color: 'var(--text-primary)' }}
                            />
                            <span className="block text-[10px] opacity-45" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.openaiApiModelDesc')}
                            </span>
                        </label>
                        <label className="block space-y-1 text-left">
                            <span className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.openaiApiTemperature')}
                            </span>
                            <input
                                type="number"
                                min="0"
                                max="2"
                                step="0.1"
                                value={settings.openaiApiTemperature}
                                onChange={(event) => update({ openaiApiTemperature: event.target.value })}
                                placeholder="0.7"
                                className={fieldClass}
                                style={{ color: 'var(--text-primary)' }}
                            />
                        </label>
                        <label className="block space-y-1 text-left">
                            <span className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.openaiApiKey')}
                            </span>
                            <input
                                type="password"
                                autoComplete="off"
                                spellCheck={false}
                                value={settings.openaiApiKey}
                                onChange={(event) => update({ openaiApiKey: event.target.value })}
                                placeholder="sk-..."
                                className={fieldClass}
                                style={{ color: 'var(--text-primary)' }}
                            />
                        </label>
                    </>
                )}

                <div className="flex flex-wrap items-center gap-3 text-left">
                    <button
                        type="button"
                        onClick={() => void runTest()}
                        disabled={testState === 'running'}
                        className={ghostButtonClass}
                        style={{ color: 'var(--text-primary)' }}
                    >
                        {testState === 'running'
                            ? <Loader2 size={13} className="animate-spin" />
                            : <Sparkles size={13} />}
                        {testState === 'running' ? t('options.aiTestRunning') : t('options.aiTestConnection')}
                    </button>
                    {testState === 'done' && testResult && (
                        <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                            {testResult.ok
                                ? <Check size={12} className="text-green-400" />
                                : <X size={12} className="text-red-400" />}
                            {testResult.ok
                                ? `${t('options.aiTestSuccess')} · ${t('options.aiTestDuration')} ${testResult.durationMs} ms`
                                    + `${testResult.model ? ` · ${t('options.aiTestModel')} ${testResult.model}` : ''}`
                                : `${t('options.aiTestFailed')}${testResult.error ? `: ${testResult.error}` : ''}`}
                        </span>
                    )}
                </div>
                {testState === 'done' && testResult?.ok && testResult.reply && (
                    <div className="text-[11px] opacity-55 break-words text-left" style={{ color: 'var(--text-secondary)' }}>
                        {testResult.reply}
                    </div>
                )}

                <div className="text-[10px] opacity-45 text-left" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.aiKeyStoredLocally')}
                </div>
            </div>
        </div>
    );
};

export default AiProviderSettings;
