import { bridgeRequest, isNativeBridgeAvailable } from '../../audioNative/core';
import { resolveAiConnection } from '../../../shared/ai/providerRegistry.mjs';
import {
    buildThemeSourcePrompt,
    buildThemeSystemPrompt,
    getGeminiResponseSchema,
    THEME_MAX_OUTPUT_TOKENS,
} from '../../../shared/themePrompt.mjs';
import { aiSettingsAsConnectionInput, readStoredAiModel, useAiSettingsStore } from '../../stores/useAiSettingsStore';
import { sanitizeDualTheme } from '../themeSanitizer';
import { applyStoredAnimationIntensityToDualTheme } from '../themePreferences';
import type { DualTheme } from '../../types';

// src/services/aiAndroid/client.ts
// 安卓版的人工智能请求层：**由 WebView 自己把请求发到服务商**。
//
// 桌面版由 Electron 主进程发（带着只有主进程能解密的 Key），网页版由部署方的 /api 路由发。
// 安卓两样都没有：没有主进程，也没有服务器路由。所以这里直接调服务商的 HTTP 接口，
// Key 由用户在设置里填、存在本机 localStorage。
//
// 传输走 FoliaBridge（原生 OkHttp），不是浏览器 fetch：一是绕开 CORS（OpenAI 官方端点不允许
// 浏览器跨域），二是本项目其余网络请求也都走它，行为一致。

/** 一次 AI 请求最多等多久。主题生成要生成两份完整主题，给得宽一点。 */
const REQUEST_TIMEOUT_MS = 120_000;
const MODEL_LIST_TIMEOUT_MS = 20_000;

export type AiNativeError = { message: string; status?: number };

const textOf = (body: string | undefined): string => body ?? '';

type RawResponse = { status: number; body: string };

/** 统一的 HTTP 出口：原生走 OkHttp 桥，网页/调试环境退回 fetch。 */
const request = async (
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number },
): Promise<RawResponse> => {
    const method = init.method ?? 'GET';
    const timeoutMs = init.timeoutMs ?? REQUEST_TIMEOUT_MS;
    if (isNativeBridgeAvailable()) {
        const answer = await bridgeRequest({ url, method, headers: init.headers, body: init.body, timeoutMs });
        return { status: answer.status, body: textOf(answer.body) };
    }
    const controller = new AbortController();
    const abort = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            method,
            headers: init.headers,
            body: init.body,
            signal: controller.signal,
        });
        return { status: response.status, body: await response.text() };
    } finally {
        clearTimeout(abort);
    }
};

/** 把服务商的错误正文压成一句能看的话。 */
const describeFailure = (response: RawResponse): string => {
    try {
        const data = JSON.parse(response.body);
        const message = data?.error?.message ?? data?.error?.status ?? data?.message;
        if (typeof message === 'string' && message) return message;
    } catch {
        // 不是 JSON，就用原文（截断）。
    }
    return textOf(response.body).slice(0, 300) || `HTTP ${response.status}`;
};

const ensureOk = (response: RawResponse) => {
    if (response.status >= 200 && response.status < 300) return;
    throw new Error(describeFailure(response));
};

/** 当前连接：服务商、端点、模型、要用的 Key。 */
export const resolveNativeConnection = () => {
    const settings = aiSettingsAsConnectionInput();
    const connection = resolveAiConnection(settings);
    const state = useAiSettingsStore.getState();
    const isGemini = connection.protocol === 'gemini';
    const apiKey = isGemini ? state.geminiKey.trim() : state.openaiKey.trim();
    const model = isGemini
        ? (readStoredAiModel('gemini') || connection.model)
        : (readStoredAiModel('openai') || connection.model);
    return {
        protocol: connection.protocol as 'gemini' | 'openai' | 'anthropic',
        presetId: connection.presetId as string,
        apiUrl: (connection.apiUrl || '').replace(/\/+$/, ''),
        model: model || '',
        apiKey,
        temperature: state.temperature,
    };
};

/** 能不能直接发请求（安卓直连版对 anthropic 协议暂不支持，走兼容端点即可）。 */
export const canUseNativeAi = (): boolean => {
    const { protocol, apiKey } = resolveNativeConnection();
    return Boolean(apiKey) && protocol !== 'anthropic';
};

const geminiGenerate = async (systemPrompt: string, userPrompt: string): Promise<string> => {
    const { apiUrl, model, apiKey, temperature } = resolveNativeConnection();
    if (!apiKey) throw new Error('还没有填 API Key');
    if (!model) throw new Error('还没有选模型');
    const url = `${apiUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: {
                temperature,
                maxOutputTokens: THEME_MAX_OUTPUT_TOKENS,
                responseMimeType: 'application/json',
                responseSchema: getGeminiResponseSchema(),
            },
        }),
    });
    ensureOk(response);
    const data = JSON.parse(response.body);
    const parts = data?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts) ? parts.map((part: any) => part?.text ?? '').join('') : '';
    if (!text) {
        const reason = data?.candidates?.[0]?.finishReason ?? data?.promptFeedback?.blockReason ?? '没有返回内容';
        throw new Error(`模型没有给出结果：${reason}`);
    }
    return text;
};

const openAiGenerate = async (systemPrompt: string, userPrompt: string): Promise<string> => {
    const { apiUrl, model, apiKey, temperature } = resolveNativeConnection();
    if (!apiKey) throw new Error('还没有填 API Key');
    if (!model) throw new Error('还没有选模型');
    if (!apiUrl) throw new Error('还没有填 API 地址');
    const response = await request(`${apiUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
            model,
            temperature,
            max_tokens: THEME_MAX_OUTPUT_TOKENS,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
        }),
    });
    ensureOk(response);
    const data = JSON.parse(response.body);
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('模型没有返回内容');
    return content;
};

const stripCodeFence = (text: string): string => text
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/, '')
    .trim();

/** 由歌词生成一套主题（亮/暗两份）。与桌面版同一套提示词与 Schema。 */
export const generateThemeNative = async (
    lyricsText: string,
    options?: { isPureMusic?: boolean; songTitle?: string },
): Promise<DualTheme> => {
    const { protocol } = resolveNativeConnection();
    if (protocol === 'anthropic') {
        throw new Error('安卓版暂不支持 Anthropic 原生协议，请在服务商里选一个 OpenAI 兼容端点');
    }
    const snippet = textOf(lyricsText).slice(0, 2000);
    const systemPrompt = buildThemeSystemPrompt(true);
    const userPrompt = buildThemeSourcePrompt(snippet, Boolean(options?.isPureMusic), options?.songTitle);
    const raw = protocol === 'gemini'
        ? await geminiGenerate(systemPrompt, userPrompt)
        : await openAiGenerate(systemPrompt, userPrompt);
    let parsed: unknown;
    try {
        parsed = JSON.parse(stripCodeFence(raw));
    } catch (error) {
        throw new Error(`模型返回的不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
    }
    const theme = applyStoredAnimationIntensityToDualTheme(sanitizeDualTheme(parsed as DualTheme));
    const label = protocol === 'gemini' ? 'Google Gemini (Android)' : 'OpenAI 兼容 (Android)';
    if (theme.light) theme.light.provider = label;
    if (theme.dark) theme.dark.provider = label;
    return theme;
};

/** 拉模型列表。Gemini 与 OpenAI 兼容的接口形状不同，各自解析。 */
export const listModelsNative = async (): Promise<Array<{ id: string; name: string }>> => {
    const { protocol, apiUrl, apiKey } = resolveNativeConnection();
    if (!apiKey) throw new Error('还没有填 API Key');
    if (protocol === 'gemini') {
        const response = await request(`${apiUrl}/models?key=${encodeURIComponent(apiKey)}&pageSize=200`, {
            timeoutMs: MODEL_LIST_TIMEOUT_MS,
        });
        ensureOk(response);
        const data = JSON.parse(response.body);
        const items = Array.isArray(data?.models) ? data.models : [];
        return items
            .filter((item: any) => Array.isArray(item?.supportedGenerationMethods)
                ? item.supportedGenerationMethods.includes('generateContent')
                : true)
            .map((item: any) => ({
                id: String(item?.name ?? '').replace(/^models\//, ''),
                name: String(item?.displayName ?? item?.name ?? '').replace(/^models\//, ''),
            }))
            .filter((item: { id: string }) => Boolean(item.id));
    }
    if (!apiUrl) throw new Error('还没有填 API 地址');
    const response = await request(`${apiUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeoutMs: MODEL_LIST_TIMEOUT_MS,
    });
    ensureOk(response);
    const data = JSON.parse(response.body);
    const items = Array.isArray(data?.data) ? data.data : [];
    return items
        .map((item: any) => ({ id: String(item?.id ?? ''), name: String(item?.id ?? '') }))
        .filter((item: { id: string }) => Boolean(item.id));
};

/** 连接测试：发一句最小请求，看能不能通。 */
export const testConnectionNative = async (): Promise<{ ok: boolean; message: string }> => {
    try {
        const models = await listModelsNative();
        if (models.length > 0) return { ok: true, message: `连接成功，可用模型 ${models.length} 个` };
        return { ok: true, message: '连接成功（该服务商没有返回模型列表）' };
    } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
};
