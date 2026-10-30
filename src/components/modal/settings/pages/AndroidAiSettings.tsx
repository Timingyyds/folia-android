import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, FoldedGroup, Reveal, Row, Select, TextField, option, type SettingsGroupDef } from '../kit';
import { AI_PROVIDER_PRESETS, resolveAiConnection } from '../../../../../shared/ai/providerRegistry.mjs';
import { canListAiModels, fetchAiModels } from '../../../../services/aiText';
import { generateThemeNative } from '../../../../services/aiAndroid/client';
import { readStoredAiModel, useAiSettingsStore } from '../../../../stores/useAiSettingsStore';

// src/components/modal/settings/pages/AndroidAiSettings.tsx
// 安卓版的 AI 连接设置：服务商、地址、Key、模型。
//
// 桌面版这块在 AiProviderSettings 里，只对 Electron 显示——那套走主进程存 Key（加密）。
// 安卓没有主进程，请求由 WebView 直连服务商，Key 落在本机 localStorage（不加密，界面上要讲清楚）。
// 提示词与 JSON Schema 与桌面版共用 shared/themePrompt.mjs，两条路径生成的主题一致。

const AI_ANDROID: SettingsGroupDef = { id: 'androidAiSettings', titleKey: 'options.androidAiSettings' };

const O = {
    provider: option(AI_ANDROID, 'androidAiProvider', 'options.aiProvider'),
    preset: option(AI_ANDROID, 'androidAiPreset', 'options.aiProviderPreset'),
    apiUrl: option(AI_ANDROID, 'androidAiApiUrl', 'options.openaiApiUrl'),
    apiKey: option(AI_ANDROID, 'androidAiApiKey', 'options.aiApiKey'),
    model: option(AI_ANDROID, 'androidAiModel', 'options.aiModel'),
};

type TestState = { status: 'idle' | 'running' | 'ok' | 'fail'; message: string };
type ModelEntry = { id: string; name: string };

const AndroidAiSettings: React.FC = () => {
    const { t } = useTranslation();
    const store = useAiSettingsStore();
    const [test, setTest] = useState<TestState>({ status: 'idle', message: '' });
    const [models, setModels] = useState<ModelEntry[]>([]);
    const [loadingModels, setLoadingModels] = useState(false);

    const usesOpenAi = store.provider === 'openai';
    // 换服务商时把该协议上次存的模型读回来。
    const [model, setModel] = useState(() => readStoredAiModel(store.provider));
    useEffect(() => {
        setModel(readStoredAiModel(store.provider));
    }, [store.provider]);

    const presets = useMemo(() => AI_PROVIDER_PRESETS.map(preset => ({
        value: preset.id,
        label: preset.label || t('options.aiCustomProvider'),
    })), [t]);

    // 当前连接（服务商预设给了地址与默认模型）
    const connection = useMemo(() => {
        const input = {
            AI_PROVIDER: store.provider,
            AI_PROVIDER_PRESET: store.presetId,
            OPENAI_API_URL: store.apiUrl,
            OPENAI_API_MODEL: model,
            GEMINI_API_MODEL: model,
        };
        return resolveAiConnection(input);
    }, [store.provider, store.presetId, store.apiUrl, model]);

    const presetOf = (id: string) => AI_PROVIDER_PRESETS.find(item => item.id === id);

    const choosePreset = (id: string) => {
        const preset = presetOf(id);
        store.setPresetId(id);
        if (preset) {
            if (preset.baseUrl) store.setApiUrl(preset.baseUrl);
            const next = preset.defaultModel || '';
            store.setModel(next);
            setModel(next);
        }
        setTest({ status: 'idle', message: '' });
        setModels([]);
    };

    const loadModels = async () => {
        setLoadingModels(true);
        setTest({ status: 'idle', message: '' });
        try {
            const result = await fetchAiModels({} as never);
            if (result && (result as { ok?: boolean }).ok) {
                const list = ((result as unknown as { models?: ModelEntry[] }).models ?? []);
                setModels(list);
                if (!list.length) setTest({ status: 'fail', message: t('options.aiNoModels') });
            } else {
                const message = (result as unknown as { message?: string })?.message ?? t('options.aiModelListFailed');
                setTest({ status: 'fail', message });
            }
        } catch (error) {
            setTest({ status: 'fail', message: error instanceof Error ? error.message : String(error) });
        } finally {
            setLoadingModels(false);
        }
    };

    const runTest = async () => {
        setTest({ status: 'running', message: '' });
        try {
            // 用一次最小的主题生成验证「地址 + Key + 模型」整条链路，模型列表接口未必都存在。
            await generateThemeNative('测试');
            setTest({ status: 'ok', message: t('options.aiTestOk') });
        } catch (error) {
            setTest({ status: 'fail', message: error instanceof Error ? error.message : String(error) });
        }
    };

    const modelOptions = models.length
        ? models.map(entry => ({ value: entry.id, label: entry.name || entry.id }))
        : (presetOf(store.presetId)?.suggestedModels ?? []).map((id: string) => ({ value: id, label: id }));

    return (
        <FoldedGroup def={AI_ANDROID} summary={usesOpenAi ? (presetOf(store.presetId)?.label || t('options.otherCompatibleApi')) : 'Google Gemini'}>
            <Row option={O.provider}>
                <Select
                    value={store.provider}
                    options={[
                        { value: 'gemini', label: 'Google Gemini' },
                        { value: 'openai', label: t('options.otherCompatibleApi') },
                    ]}
                    onChange={value => store.setProvider(value)}
                />
            </Row>
            <Reveal when={usesOpenAi}>
                <Row option={O.preset}>
                    <Select value={store.presetId || 'custom'} options={presets} onChange={choosePreset} />
                </Row>
                <Row option={O.apiUrl} hint={t('options.openaiApiUrlDesc')}>
                    <TextField value={store.apiUrl} onChange={value => store.setApiUrl(value)} type="url" placeholder="https://api.deepseek.com" />
                </Row>
            </Reveal>
            <Row option={O.apiKey} note={t('options.androidAiKeyNote')}>
                <TextField
                    value={usesOpenAi ? store.openaiKey : store.geminiKey}
                    onChange={value => (usesOpenAi ? store.setOpenaiKey(value) : store.setGeminiKey(value))}
                    type="password"
                    placeholder={usesOpenAi ? 'sk-...' : 'AIza...'}
                />
            </Row>
            <Row option={O.model} hint={connection.model ? `${t('options.aiCurrentModel')}: ${model || connection.model}` : undefined}>
                <TextField
                    value={model}
                    onChange={value => { setModel(value); store.setModel(value); }}
                    placeholder={presetOf(store.presetId)?.defaultModel || 'gemini-2.5-flash'}
                />
            </Row>
            <Row label={t('options.aiModelList')} hint={t('options.aiModelListDesc')}>
                <Button onClick={() => void loadModels()} disabled={loadingModels || !canListAiModels()}>
                    {loadingModels ? t('options.aiLoading') : t('options.aiLoadModels')}
                </Button>
            </Row>
            <Reveal when={modelOptions.length > 0}>
                <Row label={t('options.aiPickModel')} sub>
                    <Select value={model} options={modelOptions} onChange={value => { setModel(value); store.setModel(value); }} />
                </Row>
            </Reveal>
            <Row label={t('options.aiConnectionTest')} hint={test.status === 'idle' ? t('options.aiConnectionTestDesc') : test.message}>
                <Button onClick={() => void runTest()} disabled={test.status === 'running'}>
                    {test.status === 'running' ? t('options.aiTesting') : t('options.aiTestNow')}
                </Button>
            </Row>
        </FoldedGroup>
    );
};

export default AndroidAiSettings;
