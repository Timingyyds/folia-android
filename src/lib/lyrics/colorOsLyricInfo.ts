import type { Line, LyricData } from '../../types';

// src/lib/lyrics/colorOsLyricInfo.ts
// 把 App 的歌词模型转成 ColorOS 原生锁屏歌词能认的 `lyricInfo` JSON。
//
// 契约来自 ColorOS-Live-Lyrics-Bridge 的「播放器主动接入」协议
// （docs/PLAYER_INTEGRATION.zh-CN.md）：播放器把一段 JSON 字符串写进自己那个
// MediaSession 的 MediaMetadata["lyricInfo"]，ColorOS SystemUI 原生消费它，
// 装了 Bridge 之后再由 Bridge 接管逐字渲染、翻译按钮与样式。
//
// 三条 lane：
//   lyric            逐行 LRC，**必需**，系统官方列表只认这个。
//   rawLyric         增强 LRC（逐字绝对时间），只给 Bridge 的卡拉 OK 渲染用。
//   translationLyric 逐行 LRC，翻译 lane。
//
// 两条铁律：
//   1. 时间一律是**绝对**媒体位置（毫秒），不是相对本行的 offset。
//   2. 没有真实逐字时间时**不要**伪造 rawLyric —— 协议明确要求，伪造出来的
//      扫光在锁屏上是均匀的假节奏，比没有更糟。

/** metadata Parcel 不是无底洞：超过这个长度就放弃，宁可没有锁屏歌词也不要炸 Binder。 */
const MAX_LYRIC_INFO_CHARS = 200_000;

export interface ColorOsLyricInfoInput {
    title?: string | null;
    artist?: string | null;
    album?: string | null;
    /** 稳定歌曲 id；没有就用 trackKey 兜底。 */
    songId?: string | null;
    durationMs?: number;
    lines: Line[];
    /** 歌词源本身带逐字时间才有意义；false 时只出逐行 lane。 */
    isWordByWord?: boolean;
    /** 真实换曲时递增的代次。同一首歌补齐元数据不递增。 */
    sessionGeneration?: number;
}

export interface ColorOsLyricInfoResult {
    lyricInfo: string;
    /** 有没有翻译 lane —— 决定要不要挂 Bridge 的公共翻译按钮。 */
    hasTranslation: boolean;
}

/**
 * 时间标签 `mm:ss.mmm`。
 *
 * Bridge 的判定正则是 `[\d{1,3}:[0-9]{2}([.:][0-9]{1,3})?]`，三位毫秒是推荐写法。
 */
const formatTag = (ms: number): string => {
    const safe = Number.isFinite(ms) && ms > 0 ? Math.max(0, Math.round(ms)) : 0;
    const totalSeconds = Math.floor(safe / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const millis = safe % 1000;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        + `.${String(millis).padStart(3, '0')}`;
};

/** 只压平换行与控制字符，不动首尾空格。 */
const flatten = (text: string): string => (
    text.replace(/[\r\n\t]/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '')
);

/**
 * 歌词文本清洗。
 *
 * 换行必须干掉：LRC 一行就是一条时间轴记录，文本里带换行会把一条拆成两条，
 * 后面那条没有时间标签，SystemUI 那边会整条错位。剩下的控制字符同理。
 */
const sanitize = (text: string): string => flatten(text).trim();

interface PreparedLine {
    start: number;
    text: string;
    translation: string;
    rawLine: string | null;
}

/**
 * 预备每一行：时间强制单调不减（协议要求「行起点不得倒退」），
 * 并顺手把逐字 lane 拼出来。
 */
const prepareLines = (lines: Line[], withWords: boolean): {
    prepared: PreparedLine[];
    hasTranslation: boolean;
} => {
    const prepared: PreparedLine[] = [];
    let hasTranslation = false;
    let lastStart = -1;
    for (const line of lines ?? []) {
        const text = sanitize(line?.fullText ?? '');
        if (!text) continue;
        const start = Math.max(lastStart, Math.round((line?.startTime ?? 0) * 1000));
        lastStart = start;
        const translation = sanitize(line?.translation ?? '');
        if (translation) hasTranslation = true;
        prepared.push({
            start,
            text,
            translation,
            rawLine: withWords ? buildRawLine(line, start) : null,
        });
    }
    return { prepared, hasTranslation };
};

interface AlignedWord {
    startMs: number;
    endMs: number;
    text: string;
}

/**
 * 把 words 对齐回 fullText，拿到每个词之后紧跟的空白与标点。
 *
 * 西文歌词的 words 常常不带空格（空格只在 fullText 里），直接拼接会变成
 * `HelloWorld`。对齐不上（words 与 fullText 对不上）时退回 words 自己的文本 ——
 * 少几个空格也比整行错位好。
 */
const alignWords = (line: Line): AlignedWord[] => {
    const fallback = (line.words ?? [])
        .map(word => ({
            startMs: Math.round((word?.startTime ?? 0) * 1000),
            endMs: Math.round((word?.endTime ?? 0) * 1000),
            text: word?.text ?? '',
        }))
        .filter(entry => entry.text.length > 0);

    const full = line.fullText ?? '';
    let cursor = 0;
    const aligned: AlignedWord[] = [];
    let leading = '';
    for (const word of line.words ?? []) {
        const needle = (word?.text ?? '').trim();
        const index = needle ? full.indexOf(needle, cursor) : -1;
        if (index < 0) return fallback;
        const gap = full.slice(cursor, index);
        if (aligned.length > 0) {
            aligned[aligned.length - 1].text += gap;
        } else {
            leading = gap;
        }
        aligned.push({
            startMs: Math.round((word?.startTime ?? 0) * 1000),
            endMs: Math.round((word?.endTime ?? 0) * 1000),
            text: needle,
        });
        cursor = index + needle.length;
    }
    if (aligned.length === 0) return fallback;
    aligned[0].text = leading + aligned[0].text;
    aligned[aligned.length - 1].text += full.slice(cursor);
    return aligned;
};

/**
 * 逐字 lane：`[行起点]<字1起点>字1<字2起点>字2…<最后一个字的结束>`。
 *
 * 注意标签的位置：`<t>` 是**紧跟着那个字的开始时间**，所以第 n 个字的开始时间
 * 写在第 n-1 个字的文本后面，最后再补一个标签标记末字的视觉结束点。
 */
const buildRawLine = (line: Line, lineStartMs: number): string | null => {
    if ((line?.words ?? []).length < 2) return null;
    const words = alignWords(line);
    if (words.length < 2) return null;

    let body = '';
    let previousEnd: number | null = null;
    for (const word of words) {
        // 词与词之间有空档时补一个空段：`<上一词结束>` 直接跟 `<下一词开始>`，
        // 解析器会跳过空文本的那一段，扫光才不会在这段空档里匀速爬行。
        if (previousEnd !== null && word.startMs - previousEnd > 0.5) {
            body += `<${formatTag(previousEnd)}>`;
        }
        // 用 flatten 而不是 sanitize：词间空格是有意义的（协议第 4.2 节），
        // 逐词 trim 会把「Hello 」末尾那个空格削掉，拼出来就是 HelloWorld。
        body += `<${formatTag(word.startMs)}>${flatten(word.text)}`;
        previousEnd = word.endMs;
    }
    if (!body) return null;

    const lineEnd = Math.max(
        previousEnd ?? 0,
        Math.round((line?.endTime ?? 0) * 1000),
        lineStartMs);
    return `[${formatTag(lineStartMs)}]${body}<${formatTag(lineEnd)}>`;
};

/**
 * 拼出最终 payload；没有一条合法时间轴时返回 null（调用方应当 clear，而不是发个空壳）。
 */
export const buildColorOsLyricInfo = (
    input: ColorOsLyricInfoInput,
): ColorOsLyricInfoResult | null => {
    const lines = input.lines ?? [];
    if (lines.length === 0) return null;

    const withWords = input.isWordByWord === true;
    const { prepared, hasTranslation } = prepareLines(lines, withWords);
    if (prepared.length === 0) return null;

    const lyric = prepared.map(entry => `[${formatTag(entry.start)}]${entry.text}`).join('\n') + '\n';

    const rawEntries = prepared.filter(entry => entry.rawLine != null);
    // 整首只有一两句有逐字时间的话，Bridge 那边会出现「一半扫光一半不扫」的割裂感，
    // 不如整首都不给逐字 lane。
    const rawLyric = rawEntries.length === prepared.length
        ? rawEntries.map(entry => entry.rawLine).join('\n') + '\n'
        : '';

    const translationEntries = prepared.filter(entry => entry.translation.length > 0);
    const translationLyric = translationEntries.length > 0
        ? translationEntries
            .map(entry => `[${formatTag(entry.start)}]${entry.translation}`)
            .join('\n') + '\n'
        : '';

    const title = input.title ?? '';
    const artist = input.artist ?? '';
    const durationSeconds = Math.max(0, Math.round((input.durationMs ?? 0) / 1000));
    const songId = input.songId != null && String(input.songId).length > 0
        ? String(input.songId)
        : '';

    const payload: Record<string, unknown> = {
        songName: title,
        artist,
        album: input.album ?? '',
        songId,
        // 0 = 标准时间轴。
        lyricType: 0,
        lyric,
        noLyric: false,
        provider: 'top.izuna.foliamajor',
        source: 'folia-sonnet',
        // 身份键：让 Bridge 能认出「这是同一首歌」，从而拒绝过期 payload。
        trackKey: `${songId}|${title}|${artist}|${durationSeconds}`,
        sessionGeneration: Math.max(1, Math.round(input.sessionGeneration ?? 1)),
    };
    if (rawLyric) payload.rawLyric = rawLyric;
    if (translationLyric) payload.translationLyric = translationLyric;

    const lyricInfo = JSON.stringify(payload);
    if (lyricInfo.length > MAX_LYRIC_INFO_CHARS) return null;
    return { lyricInfo, hasTranslation: translationLyric.length > 0 };
};

/** 直接从 LyricData 构造的便捷入口。 */
export const buildColorOsLyricInfoFromLyricData = (
    lyricData: LyricData | null,
    meta: Omit<ColorOsLyricInfoInput, 'lines' | 'isWordByWord'>,
    sessionGeneration: number,
): ColorOsLyricInfoResult | null => {
    if (!lyricData?.lines?.length) return null;
    return buildColorOsLyricInfo({
        ...meta,
        lines: lyricData.lines,
        isWordByWord: lyricData.isWordByWord === true,
        sessionGeneration,
    });
};
