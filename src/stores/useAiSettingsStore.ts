import { create } from 'zustand';
import { getStoredString, setStoredString } from './storagePrimitives';

// src/stores/useAiSettingsStore.ts
// 安卓版自己的 AI 连接设置。
//
// 桌面版把这些存在 Electron 主进程（safeStorage 加密，只有主进程能解密），安卓没有主进程，
// 所以这里落在 localStorage。**这不是加密存储**：界面上的说明要讲清楚这一点。
//
// 键名沿用桌面设置的命名（AI_PROVIDER / OPENAI_API_URL / …），这样外观配置导入导出、
// 以及 resolveAiConnection 那套服务商解析（shared/ai/providerRegistry.mjs）不用改写就能用。

const PROVIDER_KEY = 'AI_PROVIDER';
const PRESET_KEY = 'AI_PROVIDER_PRESET';
const OPENAI_URL_KEY = 'OPENAI_API_URL';
const OPENAI_MODEL_KEY = 'OPENAI_API_MODEL';
const GEMINI_MODEL_KEY = 'GEMINI_API_MODEL';
const GEMINI_KEY_KEY = 'GEMINI_API_KEY';
const OPENAI_KEY_KEY = 'OPENAI_API_KEY';
const TEMPERATURE_KEY = 'OPENAI_API_TEMPERATURE';

export type AiSettingsState = {
    /** 'gemini' 或 'openai'（后者含所有 OpenAI 兼容服务商）。 */
    provider: string;
    /** 选中的服务商预设 id（deepseek / kimi / custom / …）。 */
    presetId: string;
    apiUrl: string;
    model: string;
    geminiKey: string;
    openaiKey: string;
    temperature: number;
    setProvider: (value: string) => void;
    setPresetId: (value: string) => void;
    setApiUrl: (value: string) => void;
    setModel: (value: string) => void;
    setGeminiKey: (value: string) => void;
    setOpenaiKey: (value: string) => void;
    setTemperature: (value: number) => void;
};

const read = (key: string, fallback = '') => {
    try {
        return getStoredString(key, fallback);
    } catch {
        return fallback;
    }
};

const readTemperature = (): number => {
    const raw = Number.parseFloat(read(TEMPERATURE_KEY, '0.7'));
    return Number.isFinite(raw) ? raw : 0.7;
};

export const useAiSettingsStore = create<AiSettingsState>((set) => ({
    provider: read(PROVIDER_KEY, 'gemini') || 'gemini',
    presetId: read(PRESET_KEY, ''),
    apiUrl: read(OPENAI_URL_KEY, ''),
    model: '',
    geminiKey: read(GEMINI_KEY_KEY, ''),
    openaiKey: read(OPENAI_KEY_KEY, ''),
    temperature: readTemperature(),
    setProvider: (value) => { setStoredString(PROVIDER_KEY, value); set({ provider: value }); },
    setPresetId: (value) => { setStoredString(PRESET_KEY, value); set({ presetId: value }); },
    setApiUrl: (value) => { setStoredString(OPENAI_URL_KEY, value); set({ apiUrl: value }); },
    // 模型按协议分键存，和桌面版一致：Gemini 与 OpenAI 兼容各记各的。
    setModel: (value) => {
        const provider = useAiSettingsStore.getState().provider;
        setStoredString(provider === 'openai' ? OPENAI_MODEL_KEY : GEMINI_MODEL_KEY, value);
        set({ model: value });
    },
    setGeminiKey: (value) => { setStoredString(GEMINI_KEY_KEY, value); set({ geminiKey: value }); },
    setOpenaiKey: (value) => { setStoredString(OPENAI_KEY_KEY, value); set({ openaiKey: value }); },
    setTemperature: (value) => { setStoredString(TEMPERATURE_KEY, String(value)); set({ temperature: value }); },
}));

/** 按当前协议读回已存的模型名（换服务商时各读各的）。 */
export const readStoredAiModel = (provider: string): string => (
    read(provider === 'openai' ? OPENAI_MODEL_KEY : GEMINI_MODEL_KEY, '')
);

/** 组装成 resolveAiConnection 认的设置形状。 */
export const aiSettingsAsConnectionInput = () => {
    const state = useAiSettingsStore.getState();
    return {
        AI_PROVIDER: state.provider,
        AI_PROVIDER_PRESET: state.presetId,
        OPENAI_API_URL: state.apiUrl,
        OPENAI_API_MODEL: read(OPENAI_MODEL_KEY, ''),
        GEMINI_API_MODEL: read(GEMINI_MODEL_KEY, ''),
    };
};
