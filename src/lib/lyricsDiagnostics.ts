import type { LyricData, SongResult } from '../types';

// src/lib/lyricsDiagnostics.ts
// Bounded trace for "audio plays but lyrics disappear" reports. Only counts and identities are
// recorded; lyric text itself never enters the diagnostic report.

type DetailValue = string | number | boolean | null | undefined;

export type LyricsDiagnosticRecord = {
    at: number;
    event: string;
    song: string;
    songId: string;
    provider: string;
    sourceKind: string;
    detail: Record<string, DetailValue>;
};

const MAX_RECORDS = 80;
const MAX_AGE_MS = 15 * 60 * 1000;
const records: LyricsDiagnosticRecord[] = [];

const providerOf = (song: SongResult | null | undefined): string => {
    const source = song?.sourceRef;
    if (source?.kind === 'online') return source.providerId;
    return source?.kind || 'unknown';
};

const songLabel = (song: SongResult | null | undefined): string => {
    if (!song) return '(none)';
    const name = String(song.name || '').trim();
    return name.length > 80 ? `${name.slice(0, 80)}...` : name || '(unnamed)';
};

export const describeLyricsShape = (lyrics: LyricData | null | undefined) => {
    const lines = Array.isArray(lyrics?.lines) ? lyrics.lines : [];
    return {
        lines: lines.length,
        wordSegments: lines.filter(line => Array.isArray(line.wordSegments) && line.wordSegments.length > 0).length,
        translations: lines.filter(line => Boolean(line.translation)).length,
        isWordByWord: Boolean(lyrics?.isWordByWord),
        ttml: Boolean(lyrics?.ttml),
    } as Record<string, DetailValue>;
};

const formatValue = (value: DetailValue): string => {
    if (value === undefined || value === null) return String(value);
    if (typeof value === 'string') return /\s/.test(value) ? JSON.stringify(value) : value;
    return String(value);
};

export const noteLyricsDiagnostic = (
    event: string,
    song: SongResult | null | undefined,
    detail: Record<string, DetailValue> = {},
): void => {
    const at = Date.now();
    while (records.length > 0 && at - records[0].at > MAX_AGE_MS) records.shift();
    records.push({
        at,
        event,
        song: songLabel(song),
        songId: song ? String(song.id) : '(none)',
        provider: providerOf(song),
        sourceKind: song?.sourceRef?.kind || 'unknown',
        detail,
    });
    if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
};

export const clearLyricsDiagnostics = (): void => {
    records.length = 0;
};

export const getLyricsDiagnosticLines = (): string[] => {
    if (records.length === 0) return [];
    const base = records[0].at;
    return records.map(record => {
        const fields = Object.entries(record.detail)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => `${key}=${formatValue(value)}`);
        const offset = String(record.at - base).padStart(6, ' ');
        return `lyrics +${offset}ms ${record.event}`
            + ` song=${JSON.stringify(record.song)} id=${record.songId}`
            + ` provider=${record.provider} source=${record.sourceKind}`
            + (fields.length ? ` ${fields.join(' ')}` : '');
    });
};
