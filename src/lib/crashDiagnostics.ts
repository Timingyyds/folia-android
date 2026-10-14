// src/lib/crashDiagnostics.ts
// Last-resort crash trail for the copy-diagnostics flow. Native uncaught exceptions are written
// by CrashDiagnostics.java; this module mirrors WebView errors and exposes both to the report.

export type CrashDiagnosticEntry = {
    at: number;
    source: string;
    thread?: string;
    type: string;
    message: string;
    stack?: string;
    device?: string;
    sdk?: number;
};

const STORAGE_KEY = 'foliaCrashDiagnosticsV1';
const MAX_LOCAL_RECORDS = 20;
const MAX_STACK_CHARS = 12_000;
let installed = false;
let lastFingerprint = '';
let lastFingerprintAt = 0;

const text = (value: unknown): string => {
    if (value == null) return '';
    if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
};

const normalizeEntry = (input: Partial<CrashDiagnosticEntry> & { at?: number | string }): CrashDiagnosticEntry => ({
    at: typeof input.at === 'string' ? Date.parse(input.at) || Date.now() : Number(input.at) || Date.now(),
    source: String(input.source || 'unknown').slice(0, 80),
    thread: input.thread ? String(input.thread).slice(0, 120) : undefined,
    type: String(input.type || 'error').slice(0, 240),
    message: String(input.message || '').replace(/\u0000/g, ' ').trim().slice(0, 2_000),
    stack: input.stack ? String(input.stack).replace(/\u0000/g, ' ').trim().slice(0, MAX_STACK_CHARS) : undefined,
    device: input.device ? String(input.device).slice(0, 160) : undefined,
    sdk: input.sdk == null ? undefined : Number(input.sdk) || undefined,
});

const readLocal = (): CrashDiagnosticEntry[] => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map(normalizeEntry) : [];
    } catch {
        return [];
    }
};

const writeLocal = (entries: CrashDiagnosticEntry[]) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_LOCAL_RECORDS))); } catch {}
};

const appendLocal = (entry: CrashDiagnosticEntry) => {
    writeLocal([...readLocal(), entry]);
};

const parseNativeHistory = (value: unknown): CrashDiagnosticEntry[] => {
    if (Array.isArray(value)) return value.map(normalizeEntry);
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.map(normalizeEntry) : [];
    } catch {
        return [];
    }
};

const getNativePlugin = (): any => (
    typeof window === 'undefined' ? null : (window as any).Capacitor?.Plugins?.FoliaNative ?? null
);

const errorDetails = (value: unknown): { type: string; message: string; stack?: string } => {
    if (value instanceof Error) {
        return {
            type: value.name || 'Error',
            message: value.message || String(value),
            stack: value.stack,
        };
    }
    return { type: typeof value === 'object' && value ? 'Object' : typeof value, message: text(value) };
};

export const recordCrashDiagnostic = (source: string, value: unknown, extra: Partial<CrashDiagnosticEntry> = {}) => {
    const details = errorDetails(value);
    const entry = normalizeEntry({
        at: Date.now(),
        source,
        thread: 'webview',
        type: details.type,
        message: details.message,
        stack: details.stack,
        ...extra,
    });
    const fingerprint = `${entry.source}|${entry.type}|${entry.message}`;
    const now = Date.now();
    if (fingerprint === lastFingerprint && now - lastFingerprintAt < 10_000) return;
    lastFingerprint = fingerprint;
    lastFingerprintAt = now;
    appendLocal(entry);

    const plugin = getNativePlugin();
    if (plugin?.recordRuntimeDiagnostic) {
        void plugin.recordRuntimeDiagnostic({
            source: entry.source,
            thread: entry.thread,
            type: entry.type,
            message: entry.message,
            stack: entry.stack,
        }).catch(() => undefined);
    }
};

export const readCrashDiagnostics = async (): Promise<CrashDiagnosticEntry[]> => {
    const plugin = getNativePlugin();
    if (plugin?.getCrashDiagnostics) {
        try {
            const result = await plugin.getCrashDiagnostics();
            const nativeEntries = parseNativeHistory(result?.history);
            if (nativeEntries.length > 0) return nativeEntries.slice(-MAX_LOCAL_RECORDS);
        } catch {}
    }
    return readLocal().slice(-MAX_LOCAL_RECORDS);
};

export type HeartbeatSnapshot = {
    last: string | null;
    previous: string | null;
};

export type DiagnosticsHeartbeats = {
    playback: HeartbeatSnapshot;
    service: HeartbeatSnapshot;
};

const emptyHeartbeat = (): HeartbeatSnapshot => ({ last: null, previous: null });

export const readDiagnosticsHeartbeats = async (): Promise<DiagnosticsHeartbeats> => {
    const plugin = getNativePlugin();
    if (!plugin?.getCrashDiagnostics) {
        return { playback: emptyHeartbeat(), service: emptyHeartbeat() };
    }
    try {
        const result = await plugin.getCrashDiagnostics();
        const read = (value: unknown) => (typeof value === 'string' && value ? value : null);
        return {
            playback: {
                last: read(result?.heartbeat),
                previous: read(result?.previousHeartbeat),
            },
            service: {
                last: read(result?.serviceHeartbeat),
                previous: read(result?.previousServiceHeartbeat),
            },
        };
    } catch {
        return { playback: emptyHeartbeat(), service: emptyHeartbeat() };
    }
};

export const clearCrashDiagnostics = async (): Promise<void> => {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    const plugin = getNativePlugin();
    if (plugin?.clearCrashDiagnostics) {
        try { await plugin.clearCrashDiagnostics(); } catch {}
    }
};

export const installCrashDiagnostics = (): void => {
    if (installed || typeof window === 'undefined') return;
    installed = true;
    window.addEventListener('error', event => {
        recordCrashDiagnostic('window-error', event.error ?? event.message, {
            message: event.message ? `${event.message} @ ${event.filename || 'unknown'}:${event.lineno || 0}:${event.colno || 0}` : undefined,
        });
    });
    window.addEventListener('unhandledrejection', event => {
        recordCrashDiagnostic('unhandled-rejection', event.reason);
    });
};
