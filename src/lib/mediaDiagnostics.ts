import { noteLibraryStep } from '../audioNative/api/libraryTrace.js';

// src/lib/mediaDiagnostics.ts
// 播放链路的现场记录。除了「有没有加载成功」，这里还统计缓冲中断、网络停滞、主线程卡顿和
// 音频输出参数，用来区分网易云等平台的卡顿是取链失败、缓冲不足、解码问题还是输出链路问题。

export type AudioDeckId = 'A' | 'B';
export type AudioElementEventKind =
    | 'error'
    | 'canplay'
    | 'stalled'
    | 'waiting'
    | 'playing'
    | 'seeking'
    | 'seeked'
    | 'ratechange';

type PlaybackContinuity = {
    source: string;
    sourceKey: string;
    deck: AudioDeckId | '';
    startedAt: number;
    readyState: number;
    networkState: number;
    bufferedAheadSec: number | null;
    bufferedRanges: number;
    waitingCount: number;
    waitingTotalMs: number;
    waitingMaxMs: number;
    lastWaitingMs: number | null;
    waitingSinceMs: number | null;
    stalledCount: number;
    errorCount: number;
    clockLagCount: number;
    clockLagTotalMs: number;
    clockLagMaxMs: number;
    lastClockLagMs: number | null;
    lastEvent: string;
    lastEventAt: number;
    lastWallMs: number | null;
    lastMediaSec: number | null;
    clockSamples: number;
    lastClockProgressRatio: number | null;
    // 「歌卡」这类反馈：网络计数全是 0、缓冲也够，就得看有没有东西在动播放位置/速率，以及解码跟不跟得上。
    seekingCount: number;
    seekedCount: number;
    rateChangeCount: number;
    playbackRate: number | null;
    decodedBytes: number | null;
    decodedMediaSec: number | null;
    decodeBaseBytes: number | null;
    decodeBaseMediaSec: number | null;
};

/**
 * 本次播放实际解析到的流。只存元数据（码率 / 格式 / 主机），签名路径与 token 不进报告：
 * 「歌卡」是网络还是解码/设备，第一眼要看的就是拿到的到底是不是 flac、多高的码率、是不是试听片段。
 */
export type PlaybackStreamInfo = {
    provider: string;
    requestedLevel: string;
    resolvedLevel: string;
    bitrateKbps: number | null;
    format: string;
    host: string;
    sizeMb: number | null;
    trial: boolean;
    at: number;
};

type AudioContextDiagnostics = {
    state: string;
    sampleRate: number | null;
    baseLatencySec: number | null;
    outputLatencySec: number | null;
    latencyHint: string;
    renderCapacity: number | null;
    stateChangeCount: number;
    lastStateChangeAt: number | null;
    updatedAt: number;
};

const MAX_AGE_MS = 15 * 60 * 1000;

const now = (): number => (
    typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()
);

const wallNow = (): number => Date.now();

const emptyContinuity = (): PlaybackContinuity => ({
    source: 'none',
    sourceKey: '',
    deck: '',
    startedAt: wallNow(),
    readyState: 0,
    networkState: 0,
    bufferedAheadSec: null,
    bufferedRanges: 0,
    waitingCount: 0,
    waitingTotalMs: 0,
    waitingMaxMs: 0,
    lastWaitingMs: null,
    waitingSinceMs: null,
    stalledCount: 0,
    errorCount: 0,
    clockLagCount: 0,
    clockLagTotalMs: 0,
    clockLagMaxMs: 0,
    lastClockLagMs: null,
    lastEvent: 'none',
    lastEventAt: 0,
    lastWallMs: null,
    lastMediaSec: null,
    clockSamples: 0,
    lastClockProgressRatio: null,
    seekingCount: 0,
    seekedCount: 0,
    rateChangeCount: 0,
    playbackRate: null,
    decodedBytes: null,
    decodedMediaSec: null,
    decodeBaseBytes: null,
    decodeBaseMediaSec: null,
});

let continuity = emptyContinuity();
let playbackStreamInfo: PlaybackStreamInfo | null = null;
let audioContextDiagnostics: AudioContextDiagnostics = {
    state: 'none',
    sampleRate: null,
    baseLatencySec: null,
    outputLatencySec: null,
    latencyHint: 'unknown',
    renderCapacity: null,
    stateChangeCount: 0,
    lastStateChangeAt: null,
    updatedAt: 0,
};

/** Test-only isolation hook; production diagnostics intentionally keep the latest session. */
export const resetMediaDiagnosticsForTests = (): void => {
    continuity = emptyContinuity();
    playbackStreamInfo = null;
    notedReadySources.clear();
};

const updateAudioContextDiagnostics = (context: AudioContext): void => {
    const renderCapacity = (context as AudioContext & { renderCapacity?: number }).renderCapacity;
    audioContextDiagnostics = {
        ...audioContextDiagnostics,
        state: context.state || 'unknown',
        sampleRate: Number.isFinite(context.sampleRate) ? context.sampleRate : null,
        baseLatencySec: Number.isFinite(context.baseLatency) ? context.baseLatency : null,
        outputLatencySec: Number.isFinite(context.outputLatency) ? context.outputLatency : null,
        renderCapacity: typeof renderCapacity === 'number' && Number.isFinite(renderCapacity)
            ? renderCapacity
            : null,
        updatedAt: wallNow(),
    };
};

export const noteAudioContext = (
    context: AudioContext | null | undefined,
    latencyHint?: AudioContextLatencyCategory | 'unknown',
): void => {
    if (!context) return;
    audioContextDiagnostics.latencyHint = latencyHint || 'unknown';
    updateAudioContextDiagnostics(context);
    context.addEventListener('statechange', () => {
        audioContextDiagnostics.stateChangeCount += 1;
        audioContextDiagnostics.lastStateChangeAt = wallNow();
        updateAudioContextDiagnostics(context);
    });
};

const resetIfStale = (): void => {
    if (!continuity.startedAt || wallNow() - continuity.startedAt > MAX_AGE_MS) {
        continuity = emptyContinuity();
    }
};

const getBufferedState = (element: HTMLAudioElement): { aheadSec: number | null; ranges: number } => {
    const ranges = element.buffered?.length ?? 0;
    if (!ranges) return { aheadSec: null, ranges: 0 };
    const current = element.currentTime;
    for (let index = 0; index < ranges; index += 1) {
        const start = element.buffered.start(index);
        const end = element.buffered.end(index);
        if (current >= start && current <= end) return { aheadSec: Math.max(0, end - current), ranges };
    }
    const lastEnd = element.buffered.end(ranges - 1);
    return {
        aheadSec: lastEnd >= current ? Math.max(0, lastEnd - current) : 0,
        ranges,
    };
};

const ensureSource = (src: string, deck?: AudioDeckId): void => {
    resetIfStale();
    const sourceKey = src.slice(0, 300);
    if (continuity.sourceKey === sourceKey) return;
    const next = emptyContinuity();
    next.source = describeMediaSource(src);
    next.sourceKey = sourceKey;
    next.deck = deck ?? '';
    continuity = next;
};

const updateElementState = (element: HTMLAudioElement, deck?: AudioDeckId): void => {
    const buffered = getBufferedState(element);
    continuity.readyState = element.readyState;
    continuity.networkState = element.networkState;
    continuity.bufferedAheadSec = buffered.aheadSec;
    continuity.bufferedRanges = buffered.ranges;
    sampleDecodeProgress(element);
    if (deck) continuity.deck = deck;
};

/** Chromium 的解码字节计数（WebView 上是 webkitAudioDecodedByteCount）；拿不到就是 null，不猜。 */
const readDecodedBytes = (element: HTMLAudioElement): number | null => {
    const value = (element as HTMLAudioElement & { webkitAudioDecodedByteCount?: number })
        .webkitAudioDecodedByteCount;
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
};

/**
 * 采样解码进度。解码跟不上时「缓冲还很多、也没有 waiting 事件」，光看缓冲计数会得出
 * 「一切正常」的错误结论，所以这里另记一条：解码了多少字节、对应播放到哪里。
 */
const sampleDecodeProgress = (element: HTMLAudioElement): void => {
    const bytes = readDecodedBytes(element);
    if (bytes === null) return;
    continuity.decodedBytes = bytes;
    continuity.decodedMediaSec = element.currentTime;
    if (continuity.decodeBaseBytes === null) {
        continuity.decodeBaseBytes = bytes;
        continuity.decodeBaseMediaSec = element.currentTime;
    }
};

/** 记录本次播放解析到的流（见 PlaybackStreamInfo 注释）。 */
export const notePlaybackStreamInfo = (info: Partial<PlaybackStreamInfo> & { provider: string }): void => {
    const bitrate = Number(info.bitrateKbps);
    const sizeMb = Number(info.sizeMb);
    playbackStreamInfo = {
        provider: String(info.provider || 'unknown'),
        requestedLevel: String(info.requestedLevel ?? ''),
        resolvedLevel: String(info.resolvedLevel ?? 'unknown'),
        bitrateKbps: Number.isFinite(bitrate) ? bitrate : null,
        format: String(info.format ?? 'unknown'),
        host: String(info.host ?? 'unknown'),
        sizeMb: Number.isFinite(sizeMb) ? sizeMb : null,
        trial: Boolean(info.trial),
        at: wallNow(),
    };
};

/** 只回报协议 + 主机：在线播放地址带有签名路径与 token，不能整条写进报告。 */
export const describeMediaSource = (src: string | null | undefined): string => {
    if (!src) return 'none';
    if (src.startsWith('blob:')) return 'blob:';
    try {
        const url = new URL(src, 'https://localhost');
        return `${url.protocol}//${url.host}`;
    } catch {
        return 'unparseable';
    }
};

// canplay 在一次播放里可能触发多次（尤其是有两个 deck），只记第一次。
const notedReadySources = new Set<string>();

export const noteAudioElementEvent = (
    kind: AudioElementEventKind,
    target: HTMLAudioElement | null | undefined,
    deck?: AudioDeckId,
    trackContinuity = true,
): void => {
    const element = target;
    if (!element) return;
    const src = element.currentSrc || element.getAttribute('src') || '';
    if (trackContinuity) {
        ensureSource(src, deck);
        updateElementState(element, deck);
        const eventAt = wallNow();
        continuity.lastEvent = deck ? `${kind} deck=${deck}` : kind;
        continuity.lastEventAt = wallNow();

        if (kind === 'waiting') {
            if (continuity.waitingSinceMs === null) {
                continuity.waitingCount += 1;
                continuity.waitingSinceMs = eventAt;
            }
            continuity.lastWallMs = null;
            continuity.lastMediaSec = null;
        } else if (kind === 'playing') {
            if (continuity.waitingSinceMs !== null) {
                const durationMs = Math.max(0, eventAt - continuity.waitingSinceMs);
                continuity.lastWaitingMs = Math.round(durationMs);
                continuity.waitingTotalMs += durationMs;
                continuity.waitingMaxMs = Math.max(continuity.waitingMaxMs, durationMs);
                continuity.waitingSinceMs = null;
            }
            continuity.lastWallMs = now();
            continuity.lastMediaSec = element.currentTime;
        } else if (kind === 'stalled') {
            continuity.stalledCount += 1;
        } else if (kind === 'error') {
            continuity.errorCount += 1;
        } else if (kind === 'seeking') {
            continuity.seekingCount += 1;
        } else if (kind === 'seeked') {
            continuity.seekedCount += 1;
            // 换了播放位置，解码吞吐要重新起算，跨 seek 的平均值没有意义。
            continuity.decodeBaseBytes = null;
            continuity.decodeBaseMediaSec = null;
        } else if (kind === 'ratechange') {
            continuity.rateChangeCount += 1;
            continuity.playbackRate = Number.isFinite(element.playbackRate) ? element.playbackRate : null;
            continuity.decodeBaseBytes = null;
            continuity.decodeBaseMediaSec = null;
        }
    }

    if (kind === 'canplay') {
        const key = src.slice(0, 300);
        if (notedReadySources.has(key)) return;
        notedReadySources.add(key);
    }
    noteLibraryStep('audio', kind, {
        source: describeMediaSource(src),
        readyState: element.readyState,
        networkState: element.networkState,
        ...(kind === 'error'
            ? {
                code: element.error?.code ?? null,
                message: element.error?.message ?? null,
                paused: element.paused,
            }
            : {}),
    });
};

/** Samples buffered-ahead without writing a trace row on every progress event. */
export const noteAudioElementProgress = (
    target: HTMLAudioElement | null | undefined,
    deck?: AudioDeckId,
): void => {
    if (!target) return;
    const src = target.currentSrc || target.getAttribute('src') || '';
    if (!src) return;
    ensureSource(src, deck);
    updateElementState(target, deck);
};

/**
 * Detects a UI-thread stall: wall time moves but the media clock does not.
 *
 * `waiting` catches buffer underruns; this catches the case where the audio clock loses progress
 * without a waiting/stalled event, which is the shape an Android WebView jank takes.
 */
export const noteAudioTimeUpdate = (
    target: HTMLAudioElement | null | undefined,
    deck?: AudioDeckId,
): void => {
    if (!target || target.paused || target.ended) return;
    const src = target.currentSrc || target.getAttribute('src') || '';
    if (!src) return;
    ensureSource(src, deck);
    updateElementState(target, deck);

    const eventAt = now();
    const mediaSec = target.currentTime;
    const previousWall = continuity.lastWallMs;
    const previousMedia = continuity.lastMediaSec;
    continuity.lastWallMs = eventAt;
    continuity.lastMediaSec = mediaSec;
    if (previousWall === null || previousMedia === null) return;

    const wallDeltaMs = eventAt - previousWall;
    const mediaDeltaMs = (mediaSec - previousMedia) * 1000;
    // Android `timeupdate` commonly arrives around 250ms apart. The old 400ms gate made the
    // first meaningful playback sample disappear, so a reported audio stutter could look clean.
    if (wallDeltaMs < 200 || mediaDeltaMs < 0) return;

    continuity.clockSamples += 1;
    continuity.lastClockProgressRatio = wallDeltaMs > 0 ? mediaDeltaMs / wallDeltaMs : null;
    if (mediaDeltaMs >= wallDeltaMs * 0.75) return;

    const lostMs = Math.round(wallDeltaMs - mediaDeltaMs);
    if (lostMs < 150) return;
    continuity.clockLagCount += 1;
    continuity.clockLagTotalMs += lostMs;
    continuity.clockLagMaxMs = Math.max(continuity.clockLagMaxMs, lostMs);
    continuity.lastClockLagMs = lostMs;
    continuity.lastEvent = deck ? `clock-lag deck=${deck}` : 'clock-lag';
    continuity.lastEventAt = wallNow();
};

export type PlaybackContinuitySnapshot = ReturnType<typeof readPlaybackContinuitySnapshot>;

export const readPlaybackContinuitySnapshot = () => {
    resetIfStale();
    return {
        source: continuity.source,
        deck: continuity.deck || 'none',
        readyState: continuity.readyState,
        networkState: continuity.networkState,
        bufferedAheadSec: continuity.bufferedAheadSec,
        bufferedRanges: continuity.bufferedRanges,
        waitingCount: continuity.waitingCount,
        waitingTotalMs: Math.round(continuity.waitingTotalMs),
        waitingMaxMs: Math.round(continuity.waitingMaxMs),
        lastWaitingMs: continuity.lastWaitingMs,
        stalledCount: continuity.stalledCount,
        errorCount: continuity.errorCount,
        clockLagCount: continuity.clockLagCount,
        clockSamples: continuity.clockSamples,
        clockLagTotalMs: Math.round(continuity.clockLagTotalMs),
        clockLagMaxMs: Math.round(continuity.clockLagMaxMs),
        lastClockLagMs: continuity.lastClockLagMs,
        lastClockProgressRatio: continuity.lastClockProgressRatio,
        lastEvent: continuity.lastEvent,
        lastEventAt: continuity.lastEventAt,
        seekingCount: continuity.seekingCount,
        seekedCount: continuity.seekedCount,
        rateChangeCount: continuity.rateChangeCount,
        playbackRate: continuity.playbackRate,
        decodedBytes: continuity.decodedBytes,
        decodedMediaSec: continuity.decodedMediaSec,
        decodeBaseBytes: continuity.decodeBaseBytes,
        decodeBaseMediaSec: continuity.decodeBaseMediaSec,
        stream: playbackStreamInfo,
        audioContextState: audioContextDiagnostics.state,
        audioContextSampleRate: audioContextDiagnostics.sampleRate,
        audioContextBaseLatencySec: audioContextDiagnostics.baseLatencySec,
        audioContextOutputLatencySec: audioContextDiagnostics.outputLatencySec,
        audioContextLatencyHint: audioContextDiagnostics.latencyHint,
        audioContextRenderCapacity: audioContextDiagnostics.renderCapacity,
        audioContextStateChangeCount: audioContextDiagnostics.stateChangeCount,
        audioContextLastStateChangeAt: audioContextDiagnostics.lastStateChangeAt,
        audioContextUpdatedAt: audioContextDiagnostics.updatedAt,
    };
};
