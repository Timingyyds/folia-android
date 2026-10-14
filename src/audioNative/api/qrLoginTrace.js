/**
 * 扫码登录链路的分步追踪。
 *
 * 只记录「哪一步失败、响应形态是什么」，不记录 cookie / token / 账号等隐私内容：
 * 诊断信息要能被用户原样贴进 issue。
 */

const MAX_ENTRIES = 40;
const MAX_ENTRY_AGE_MS = 10 * 60 * 1000;

let entries = [];
let startedAt = 0;

export function resetQrLoginTrace() {
  entries = [];
  startedAt = Date.now();
}

export function noteQrLoginStep(step, detail = {}) {
  const at = Date.now();
  if (!startedAt || at - startedAt > MAX_ENTRY_AGE_MS) {
    startedAt = at;
    entries = [];
  }
  entries = [...entries, { at, step, detail }].slice(-MAX_ENTRIES);
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

export function getQrLoginTraceLines(providerLabel = 'qr') {
  if (entries.length === 0) return [];
  const base = startedAt || entries[0].at;
  return entries.map(({ at, step, detail }) => {
    const fields = Object.entries(detail || {})
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${formatValue(value)}`);
    const offset = String(at - base).padStart(5, ' ');
    return `${providerLabel} step +${offset}ms ${step}${fields.length ? ` ${fields.join(' ')}` : ''}`;
  });
}
