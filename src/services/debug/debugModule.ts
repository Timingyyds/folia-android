import {
    isConsoleCaptureEnabled,
    recordMainProcessLines,
    setConsoleLogSink,
    subscribeToConsoleLog,
    type ConsoleLogEntry,
} from '../../utils/consoleLogBuffer';
import { nativeCapacitor, setMemoryLogSink, startLocalMemorySampling, stopLocalMemorySampling } from './memorySamples';

// src/services/debug/debugModule.ts
// The renderer's half of the developer debug module: the switches, and the pipe that sends console
// lines to the file the main process keeps.
//
// Everything here is optional-chained through `window.electron`. The browser build has no main
// process, so it has no log files either, and every function below is a no-op there rather than a
// feature that half-works. The switches still render - they just report the module as unavailable.

export type DebugLogMode = 'append' | 'overwrite';

export interface DebugModuleSnapshot {
    /** False in the browser build, and until the first answer from the main process arrives. */
    available: boolean;
    /** 内存监控在手机上由渲染进程自己采样，所以它不需要 Electron 主进程。 */
    memoryAvailable: boolean;
    /** 手机上的“写入本地文件”由原生插件落盘，所以这两个开关在手机上也能用。 */
    filesAvailable: boolean;
    /** 手机上是否已经选了自定义日志目录（决定要不要显示“恢复默认”）。 */
    logDirCustom: boolean;
    runtimeLogEnabled: boolean;
    runtimeLogMode: DebugLogMode;
    /** The session-log switch as the main process last heard it. See `syncCapture`. */
    consoleCaptureEnabled: boolean;
    memoryMonitorEnabled: boolean;
    memoryLogEnabled: boolean;
    memoryLogMode: DebugLogMode;
    memoryIntervalMs: number;
    logsRoot: string | null;
    runtimeFile: string | null;
    memoryFile: string | null;
}

const UNAVAILABLE: DebugModuleSnapshot = {
    available: false,
    memoryAvailable: false,
    filesAvailable: false,
    logDirCustom: false,
    runtimeLogEnabled: false,
    runtimeLogMode: 'append',
    consoleCaptureEnabled: true,
    memoryMonitorEnabled: false,
    memoryLogEnabled: false,
    memoryLogMode: 'overwrite',
    memoryIntervalMs: 2000,
    logsRoot: null,
    runtimeFile: null,
    memoryFile: null,
};

const bridge = () => (typeof window === 'undefined' ? undefined : window.electron);

let snapshot: DebugModuleSnapshot = UNAVAILABLE;
const listeners = new Set<() => void>();

const publish = (next: DebugModuleSnapshot) => {
    snapshot = next;
    listeners.forEach(listener => listener());
};

/** `useSyncExternalStore` reads this. Stable identity between changes, so React can compare it. */
export const getDebugModuleSnapshot = () => snapshot;

export const subscribeToDebugModule = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

const adopt = (state: DebugModuleState | undefined | null) => {
    if (!state) { publish(UNAVAILABLE); return; }
    // 桌面主进程不选日志目录：logDirCustom 只有手机那套（SAF 选目录）才有。
    publish({ available: true, memoryAvailable: true, filesAvailable: true, ...state, logDirCustom: false });
};

/*
 * 手机上没有主进程：所有开关存在 localStorage，采样由渲染进程做，日志由原生插件落盘。
 * `available` 仍为 false —— 它表示“有 Electron 主进程”，而不是“功能可用”。
 */
const LOCAL_DEBUG_KEY = 'folia.debug.local';
// 手机上只有「追加」一种写入方式，所以这里不存写入模式。
interface LocalDebugState {
    runtimeLogEnabled: boolean;
    memoryMonitorEnabled: boolean;
    memoryIntervalMs: number;
    memoryLogEnabled: boolean;
}
const readLocalDebug = (): LocalDebugState => {
    try {
        const raw = typeof localStorage === 'undefined' ? '' : localStorage.getItem(LOCAL_DEBUG_KEY);
        const parsed = raw ? JSON.parse(raw) as Partial<Record<keyof LocalDebugState, unknown>> : {};
        return {
            runtimeLogEnabled: parsed.runtimeLogEnabled === true,
            memoryMonitorEnabled: parsed.memoryMonitorEnabled === true,
            memoryIntervalMs: Number(parsed.memoryIntervalMs) > 0 ? Number(parsed.memoryIntervalMs) : 2000,
            memoryLogEnabled: parsed.memoryLogEnabled === true,
        };
    } catch {
        return {
            runtimeLogEnabled: false, memoryMonitorEnabled: false,
            memoryIntervalMs: 2000, memoryLogEnabled: false,
        };
    }
};

const writeLocalDebug = (patch: Partial<LocalDebugState>) => {
    const next = { ...readLocalDebug(), ...patch };
    try { localStorage.setItem(LOCAL_DEBUG_KEY, JSON.stringify(next)); } catch { /* 隐私模式忽略 */ }
    return next;
};

/** 手机上的两个日志文件位置，由原生插件给出（外部存储的 files/logs）。 */
let localPaths: { dir: string; runtime: string; memory: string; custom?: boolean } = { dir: '', runtime: '', memory: '' };
let localPathsLoaded = false;
const loadLocalPaths = async () => {
    if (localPathsLoaded) return;
    try {
        const paths = await nativeCapacitor()?.debugLogPaths?.();
        if (paths) { localPaths = paths; localPathsLoaded = true; }
    } catch { /* 路径拿不到就只显示 null，不影响写入 */ }
    publishLocalState();
};

/** 写入文件的一行：单行截断，避免一个巨大的响应体把日志文件与内存一起撑爆。 */
const MAX_RUNTIME_LINE_CHARS = 4000;

const formatRuntimeLine = (line: RuntimeLine) => {
    const stamp = new Date(line.at).toISOString();
    const tag = line.tag ? ` [${line.tag}]` : '';
    const text = line.text.length > MAX_RUNTIME_LINE_CHARS
        ? `${line.text.slice(0, MAX_RUNTIME_LINE_CHARS)}… (${line.text.length - MAX_RUNTIME_LINE_CHARS} chars clipped)`
        : line.text;
    return `${stamp} [${line.level}]${tag} ${text}\n`;
};

/** 手机：打开系统目录选择器。SAF 自带授权，不碰「所有文件访问」权限。 */
export const chooseLocalLogDir = async (): Promise<{ ok: boolean; message?: string }> => {
    const native = nativeCapacitor();
    if (!native?.debugPickLogDir) return { ok: false, message: '当前平台不支持选择目录' };
    try {
        const picked = await native.debugPickLogDir();
        if (picked?.cancelled) return { ok: false };
        if (picked?.error) return { ok: false, message: picked.error };
        localPathsLoaded = false;
        await loadLocalPaths();
        return { ok: true };
    } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
};

/** 手机：恢复为应用自己的 files/logs 目录。 */
export const resetLocalLogDir = async () => {
    const native = nativeCapacitor();
    if (!native?.debugResetLogDir) return;
    try {
        await native.debugResetLogDir();
        localPathsLoaded = false;
        await loadLocalPaths();
    } catch { /* 恢复失败时保持原样 */ }
};

const publishLocalState = () => {
    const local = readLocalDebug();
    publish({
        ...UNAVAILABLE,
        memoryAvailable: true,
        filesAvailable: true,
        logDirCustom: localPaths.custom === true,
        runtimeLogEnabled: local.runtimeLogEnabled,
        runtimeLogMode: 'append',
        memoryMonitorEnabled: local.memoryMonitorEnabled,
        memoryIntervalMs: local.memoryIntervalMs,
        memoryLogEnabled: local.memoryLogEnabled,
        memoryLogMode: 'append',
        logsRoot: localPaths.dir || null,
        runtimeFile: localPaths.runtime || null,
        memoryFile: localPaths.memory || null,
    });
    if (local.memoryMonitorEnabled) startLocalMemorySampling(local.memoryIntervalMs);
    else stopLocalMemorySampling();
};

/** 手机上的“写入本地文件”：整条 sample 追加（或首条覆盖）到 folia-memory.log。 */
const installLocalMemoryLogSink = () => {
    setMemoryLogSink(sample => {
        const local = readLocalDebug();
        const native = nativeCapacitor();
        if (!local.memoryLogEnabled || !native?.debugAppendLog) return;
        void native.debugAppendLog({
            kind: 'memory',
            text: `${JSON.stringify(sample)}\n`,
        }).catch(error => console.warn('[debug] 内存日志写入失败', error));
    });
};

/** Re-reads the switches from the main process, which owns them. */
export const refreshDebugModule = async () => {
    if (!bridge()) {
        installLocalMemoryLogSink();
        publishLocalState();
        void loadLocalPaths();
        return;
    }
    try {
        adopt(await bridge()?.debugGetState?.());
    } catch {
        publish(UNAVAILABLE);
    }
};

/**
 * Flips a switch and adopts whatever the main process says the state became.
 *
 * The answer is authoritative rather than optimistic on purpose: a mode change REOPENS the file, so
 * "which file is being written" changes with it, and the settings page shows that path. Guessing it
 * would show a filename nothing is writing to.
 */
export const setDebugModuleState = async (patch: Partial<Pick<DebugModuleSnapshot,
    'runtimeLogEnabled' | 'runtimeLogMode' | 'consoleCaptureEnabled' | 'memoryMonitorEnabled' | 'memoryLogEnabled' | 'memoryLogMode' | 'memoryIntervalMs'>>) => {
    if (!bridge()) {
        // 手机：开关写 localStorage 后立即生效（重开采样 / 下一批日志开始写）。
        // 写入方式只有追加，所以那两个 mode 字段在手机上被忽略。
        writeLocalDebug({
            ...(patch.runtimeLogEnabled !== undefined ? { runtimeLogEnabled: patch.runtimeLogEnabled } : {}),
            ...(patch.memoryMonitorEnabled !== undefined ? { memoryMonitorEnabled: patch.memoryMonitorEnabled } : {}),
            ...(patch.memoryIntervalMs ? { memoryIntervalMs: patch.memoryIntervalMs } : {}),
            ...(patch.memoryLogEnabled !== undefined ? { memoryLogEnabled: patch.memoryLogEnabled } : {}),
        });
        publishLocalState();
        return;
    }
    try {
        adopt(await bridge()?.debugSetState?.(patch));
    } catch {
        // Left as it was: reporting a switch as flipped when the write failed is worse than the
        // switch appearing not to move.
    }
};

/** Opens the log folder in the OS file manager. False when there is nothing to open. */
export const openDebugLogsFolder = async (which?: 'runtime' | 'memory') => {
    try {
        return (await bridge()?.debugOpenLogs?.(which)) ?? false;
    } catch {
        return false;
    }
};

// ---- runtime log pipe ------------------------------------------------------

/**
 * How long a line waits for company before it is sent.
 *
 * One IPC message per console line would be a real cost on a subsystem that logs in bursts - a
 * prefetch pass writes forty in a few milliseconds - and this module exists to diagnose overhead,
 * not to add it. A second of latency on a file nobody is tailing live is free.
 */
const BATCH_MS = 1000;
/** Send early rather than hold more than this. Keeps a burst out of the renderer's own memory. */
const BATCH_MAX = 200;

type RuntimeLine = { at: number; level: string; tag: string | null; text: string };
let queue: RuntimeLine[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;
/** 一批日志正在写盘：写完才发下一批，避免待写文本在内存里排队堆积。 */
let writeInFlight = false;

/**
 * Startup lines held until the main process says whether the runtime log is even on.
 *
 * The switch's real value arrives over an async IPC (see `installDebugModule`), and until it does
 * `snapshot.runtimeLogEnabled` is its `false` default - so a naive `enqueue` drops every line logged
 * before that answer, which is exactly the startup burst this pipe was installed early to catch. These
 * are buffered instead and either flushed or discarded once the answer is in. Bounded so a bridge that
 * never answers cannot grow it without end.
 */
let startupBuffer: RuntimeLine[] = [];
let startupBufferChars = 0;
let stateKnown = false;
const STARTUP_MAX = 2000;
/** 启动缓冲还按字符数封顶：行数上限挡不住「一行几 MB」这种情况。 */
const STARTUP_MAX_CHARS = 400_000;

const flush = () => {
    if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
    if (!queue.length) return;
    // 写盘是异步的：上一次还没回来就继续发，会让一批批待写文本堆在内存里。
    // 等它写完再发下一批（日志晚一秒无所谓，堆积到 OOM 才是问题）。
    if (writeInFlight) {
        batchTimer = setTimeout(flush, BATCH_MS);
        return;
    }
    const lines = queue;
    queue = [];
    const electron = bridge();
    if (electron) {
        try { electron.debugWriteRuntimeLines?.(lines); } catch { /* the window is going away */ }
        return;
    }
    // 手机：没有主进程可写，交给原生插件追加到 folia-runtime.log。
    const native = nativeCapacitor();
    if (!native?.debugAppendLog) return;
    const local = readLocalDebug();
    if (!local.runtimeLogEnabled) return;
    writeInFlight = true;
    void native.debugAppendLog({
        kind: 'runtime',
        text: lines.map(formatRuntimeLine).join(''),
    }).catch(error => console.warn('[debug] 运行日志写入失败', error)).finally(() => {
        writeInFlight = false;
        if (queue.length && !batchTimer) batchTimer = setTimeout(flush, BATCH_MS);
    });
};

/** Called once the first main-process answer is in: keep the startup lines if logging is on, else drop. */
const settleStartupBuffer = () => {
    stateKnown = true;
    const held = startupBuffer;
    startupBuffer = [];
    startupBufferChars = 0;
    if (!held.length) return;
    if (!snapshot.runtimeLogEnabled) return; // logging off, or browser build - discard, do not write
    queue = held.concat(queue);
    flush();
};

const enqueue = (entry: ConsoleLogEntry) => {
    const text = entry.text.length > MAX_RUNTIME_LINE_CHARS
        ? `${entry.text.slice(0, MAX_RUNTIME_LINE_CHARS)}…`
        : entry.text;
    const line: RuntimeLine = { at: entry.at, level: entry.level, tag: entry.scope, text };
    // Before the first answer, buffer regardless: dropping on the not-yet-known default is what lost
    // the startup lines. Once known, read the switch live - it lives in a settings page that can be
    // flipped mid-session, so a pipe that checked once at install would keep writing after it was off.
    if (!stateKnown) {
        if (startupBuffer.length >= STARTUP_MAX) return;
        if (startupBufferChars + text.length > STARTUP_MAX_CHARS) return;
        startupBuffer.push(line);
        startupBufferChars += text.length;
        return;
    }
    if (!snapshot.runtimeLogEnabled) return;
    queue.push(line);
    // 写盘慢的时候队列会变长：封顶，丢掉最旧的，宁可日志少几行也不能涨到 OOM。
    if (queue.length > BATCH_MAX * 10) queue = queue.slice(queue.length - BATCH_MAX * 10);
    if (queue.length >= BATCH_MAX) { flush(); return; }
    if (batchTimer) return;
    batchTimer = setTimeout(flush, BATCH_MS);
};

/**
 * Keeps the main process told whether the session log is on.
 *
 * The switch lives in the renderer, because the browser build has it too. The main process owns
 * the log file and its own console lines, and off has to mean off for those as well: nothing in
 * the panel and a file still being written is two answers to one switch. Null until the main
 * process has said what it holds, and for good in the browser build.
 */
let captureAtMain: boolean | null = null;
const syncCapture = () => {
    const enabled = isConsoleCaptureEnabled();
    if (captureAtMain === null || captureAtMain === enabled) return;
    captureAtMain = enabled;
    void setDebugModuleState({ consoleCaptureEnabled: enabled });
};

/**
 * Starts the module. Idempotent, and safe to call before the main process has answered.
 *
 * Called from bootstrap rather than from a component: the lines worth having are the startup ones,
 * and a pipe that opens when a settings page first renders misses every one of them.
 */
let installed = false;
export const installDebugModule = () => {
    if (installed || typeof window === 'undefined') return;
    installed = true;
    setConsoleLogSink(enqueue);
    // The main process's console joins the panel, whether or not the file is being written.
    bridge()?.onDebugMainLines?.(recordMainProcessLines);
    // A buffered line is worth less than the crash it was recorded during.
    window.addEventListener('pagehide', flush);
    // The first answer decides the fate of everything logged before it arrived. `finally`, not
    // `then`: a rejected refresh leaves the snapshot UNAVAILABLE, which is the correct "discard" case.
    void refreshDebugModule().finally(() => {
        // Before the startup lines are sent: the main process opens the file on this message, and
        // the lines behind it are then written, not dropped.
        captureAtMain = snapshot.available ? snapshot.consoleCaptureEnabled : null;
        syncCapture();
        settleStartupBuffer();
    });
    // The buffer tells its listeners about the switch as well as about every line.
    subscribeToConsoleLog(syncCapture);
};
