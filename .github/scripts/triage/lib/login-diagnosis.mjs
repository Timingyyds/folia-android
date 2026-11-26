// .github/scripts/triage/lib/login-diagnosis.mjs
// 扫码登录诊断：从 issue 里取出 Folia 生成的诊断报告，按维护者维护的已知原因表（login-playbook.json）做确定性匹配，
// 再与 LLM 的判断合并成一份写进 bot 状态的诊断结果。纯函数；LLM 调用在 io/run-issue.mjs。

import { scrubCredentials, truncateHeadTail } from './sanitize.mjs';

const REPORT_RE = /### Folia QR login diagnostics\s*```[^\n]*\n([\s\S]*?)```/g;
const ID_RE = /^[a-z0-9-]+$/;

// 校验已知原因表并预编译匹配规则；结构不对直接 throw，与 config.json 的处理一致。
export function validatePlaybook(playbook) {
    if (!playbook || typeof playbook !== 'object') throw new Error('login playbook: 不是对象');
    if (playbook.version !== 1) throw new Error(`login playbook: 不支持的 version ${playbook.version}`);
    for (const key of ['minConfidence', 'maxCauses', 'reportChars', 'descriptionChars']) {
        if (typeof playbook[key] !== 'number') throw new Error(`login playbook: 缺少数字字段 ${key}`);
    }
    if (!Array.isArray(playbook.causes)) throw new Error('login playbook: causes 必须是数组');
    const seen = new Set();
    for (const cause of playbook.causes) {
        if (!ID_RE.test(cause.id ?? '') || seen.has(cause.id)) throw new Error(`login playbook: id 非法或重复 ${cause.id}`);
        seen.add(cause.id);
        if (!Array.isArray(cause.providers) || !Array.isArray(cause.match)) throw new Error(`login playbook: ${cause.id} 缺少 providers / match`);
        if (!cause.title || !cause.symptoms || !Array.isArray(cause.steps) || cause.steps.length === 0) {
            throw new Error(`login playbook: ${cause.id} 缺少 title / symptoms / steps`);
        }
        // match 每一项是一条正则，或一组必须同时命中的正则。
        cause.matchers = cause.match.map(item => (Array.isArray(item) ? item : [item]).map(source => new RegExp(source, 'im')));
    }
    return playbook;
}

export const causeAppliesTo = (cause, provider) => cause.providers.length === 0 || cause.providers.includes(provider);

// 取出 issue 正文与作者补充评论里的最后一份诊断报告（代码块内的原文）；没有就返回 null。
export function extractQrReport(texts) {
    let last = null;
    for (const text of texts) {
        for (const match of String(text ?? '').matchAll(REPORT_RE)) last = match[1].trim();
    }
    return last || null;
}

export const stripQrReports = text => String(text ?? '').replace(REPORT_RE, '').replace(/### Folia QR login diagnostics/g, '');

// 确定性匹配：返回命中的已知原因 id，按表内顺序。
export function matchPlaybook(report, provider, playbook) {
    return playbook.causes
        .filter(cause => causeAppliesTo(cause, provider))
        .filter(cause => cause.matchers.some(group => group.every(pattern => pattern.test(report))))
        .map(cause => cause.id);
}

// 送进 LLM 的报告：擦凭据、去掉调用栈行（只占 token，原因在上一行的错误原文里），再按头尾截断。
export function reportForLlm(report, maxChars) {
    const compact = scrubCredentials(report)
        .split('\n')
        .filter(line => !/^\s+at\s+\S/.test(line))
        .join('\n');
    const head = Math.floor(maxChars * 0.7);
    return truncateHeadTail(compact, head, maxChars - head);
}

// 合并规则命中与 LLM 判断，得到写进 bot 状态的诊断结果。
// LLM 不可用时：报告没变就沿用上一次的 LLM 结论，否则只保留规则命中。返回 null 表示没有任何可说的内容。
export function mergeDiagnosis({ reportHash, ruleCauses, llm, previous, playbook }) {
    const source = llm?.status === 'ok'
        ? { kind: 'llm', value: llm.value }
        : previous?.source === 'llm' && previous.reportHash === reportHash
            ? { kind: 'llm', value: { causes: previous.llmCauses ?? [], analysis: previous.analysis, suggestions: previous.suggestions ?? [], needsMaintainer: previous.needsMaintainer } }
            : { kind: 'rules', value: null };
    const llmCauses = (source.value?.causes ?? [])
        .filter(item => item.confidence >= playbook.minConfidence)
        .map(item => item.id);
    const causes = [...new Set([...ruleCauses, ...llmCauses])].slice(0, playbook.maxCauses);
    const analysis = source.value?.analysis || null;
    const suggestions = source.value?.suggestions ?? [];
    if (!causes.length && !analysis && !suggestions.length) return null;
    return {
        reportHash,
        source: source.kind,
        causes,
        ruleCauses,
        llmCauses: source.value?.causes ?? [],
        analysis,
        suggestions,
        needsMaintainer: source.value?.needsMaintainer ?? null,
    };
}
