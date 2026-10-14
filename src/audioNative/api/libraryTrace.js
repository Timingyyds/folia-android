/**
 * 在线曲库加载的追踪记录。
 *
 * 只记录「请求了什么、上游回了什么形态、解析出多少条」，不记录 cookie / token。
 * 设置 → 帮助 → 复制诊断数据 会把它一起导出。
 */

const MAX_ENTRIES = 60;
const MAX_AGE_MS = 15 * 60 * 1000;

let entries = [];
let startedAt = 0;

function push(step, detail) {
  const at = Date.now();
  if (!startedAt || at - startedAt > MAX_AGE_MS) {
    startedAt = at;
    entries = [];
  }
  entries.push({ at, step, detail: detail || {} });
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
}

/** provider 例如 qq / kugou / netease。 */
export function noteLibraryStep(provider, step, detail = {}) {
  push(`${provider}:${step}`, detail);
}

export function resetLibraryTrace() {
  entries = [];
  startedAt = Date.now();
}

const formatValue = (value) => {
  if (value === undefined || value === null) return String(value);
  if (typeof value === 'string') return /\s/.test(value) ? JSON.stringify(value) : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export function getLibraryTraceLines() {
  if (!entries.length) return [];
  const base = startedAt || entries[0].at;
  return entries.map(({ at, step, detail }) => {
    const fields = Object.entries(detail || {})
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${formatValue(value)}`);
    const offset = String(at - base).padStart(6, ' ');
    return `library +${offset}ms ${step}${fields.length ? ` ${fields.join(' ')}` : ''}`;
  });
}

// 只取响应的结构信息，避免把完整 payload（可能含账号数据）写进报告。
export function describePayload(payload) {
  if (payload === null || payload === undefined) return 'null';
  if (Array.isArray(payload)) return `array(${payload.length})`;
  if (typeof payload !== 'object') return typeof payload;
  const keys = Object.keys(payload);
  return `object{${keys.slice(0, 12).join(',')}${keys.length > 12 ? ',…' : ''}}`;
}
