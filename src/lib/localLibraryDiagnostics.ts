// src/lib/localLibraryDiagnostics.ts
// Bounded local-library trace for "playback stutters while local music is loading" reports.
// Records timings and counts only, never song names or file paths.

type LocalLibraryDetailValue = string | number | boolean | null | undefined;

type LocalLibraryRecord = {
    at: number;
    event: string;
    detail: Record<string, LocalLibraryDetailValue>;
};

const MAX_RECORDS = 40;
const MAX_AGE_MS = 15 * 60 * 1000;
const records: LocalLibraryRecord[] = [];

const formatValue = (value: LocalLibraryDetailValue): string => {
    if (value === undefined || value === null) return String(value);
    if (typeof value === 'string') return /\s/.test(value) ? JSON.stringify(value) : value;
    return String(value);
};

export const noteLocalLibraryDiagnostic = (
    event: string,
    detail: Record<string, LocalLibraryDetailValue> = {},
): void => {
    const at = Date.now();
    while (records.length > 0 && at - records[0].at > MAX_AGE_MS) records.shift();
    records.push({ at, event, detail });
    if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
};

export const clearLocalLibraryDiagnostics = (): void => {
    records.length = 0;
};

export const getLocalLibraryDiagnosticLines = (): string[] => {
    if (records.length === 0) return [];
    const base = records[0].at;
    return records.map(record => {
        const fields = Object.entries(record.detail)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => `${key}=${formatValue(value)}`);
        return `local +${String(record.at - base).padStart(6, ' ')}ms ${record.event}`
            + (fields.length ? ` ${fields.join(' ')}` : '');
    });
};
