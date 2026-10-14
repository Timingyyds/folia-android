import type { SongResult } from '../types';

// src/lib/collectionOrderDiagnostics.ts
// Keeps a bounded trace of the order supplied by a provider and the order after pagination.

export type CollectionOrderPhase = 'page' | 'merged';
export type CollectionOrderSource = 'cache' | 'first-page' | 'sync' | 'provider-page';

export type CollectionOrderRecord = {
    at: number;
    phase: CollectionOrderPhase;
    source: CollectionOrderSource;
    providerId: string;
    collectionId: string;
    collectionType: string;
    offset: number;
    requestedLimit?: number;
    itemCount: number;
    hasMore?: boolean;
    nextOffset?: number;
    ids: string[];
};

export type CollectionOrderInput = Omit<CollectionOrderRecord, 'at' | 'ids'> & {
    tracks: readonly SongResult[];
};

const MAX_RECORDS = 48;
const MAX_AGE_MS = 15 * 60 * 1000;
const records: CollectionOrderRecord[] = [];

const trackId = (track: SongResult): string => {
    const source = track.sourceRef;
    if (source?.kind === 'online') {
        return `${source.providerId}:${source.mediaId}`;
    }
    return String(track.id ?? 'unknown');
};

const appendRecord = (input: CollectionOrderInput, phase: CollectionOrderPhase) => {
    const at = Date.now();
    while (records.length > 0 && at - records[0].at > MAX_AGE_MS) records.shift();
    records.push({
        at,
        phase,
        source: input.source,
        providerId: input.providerId,
        collectionId: String(input.collectionId),
        collectionType: input.collectionType,
        offset: input.offset,
        requestedLimit: input.requestedLimit,
        itemCount: input.itemCount,
        hasMore: input.hasMore,
        nextOffset: input.nextOffset,
        ids: input.tracks.map(trackId),
    });
    if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
};

export const recordCollectionOrderPage = (input: CollectionOrderInput): void => {
    appendRecord(input, 'page');
};

export const recordCollectionOrderMerged = (input: CollectionOrderInput): void => {
    appendRecord(input, 'merged');
};

export const clearCollectionOrderDiagnostics = (): void => {
    records.length = 0;
};

const sameSequence = (left: readonly string[], right: readonly string[]): boolean => (
    left.length === right.length && left.every((value, index) => value === right[index])
);

const orderVerdict = (record: CollectionOrderRecord): 'preserved' | 'reversed' | 'changed' | 'unknown' => {
    const firstPage = [...records]
        .reverse()
        .find(candidate => candidate.phase === 'page'
            && candidate.providerId === record.providerId
            && candidate.collectionId === record.collectionId
            && candidate.collectionType === record.collectionType
            && candidate.offset === 0);
    if (!firstPage || record.ids.length < firstPage.ids.length) return 'unknown';
    const prefix = record.ids.slice(0, firstPage.ids.length);
    if (sameSequence(prefix, firstPage.ids)) return 'preserved';
    if (sameSequence(prefix, [...firstPage.ids].reverse())) return 'reversed';
    return 'changed';
};

const shortList = (ids: readonly string[]): string => (
    ids.length <= 6
        ? `[${ids.join(',')}]`
        : `[${ids.slice(0, 3).join(',')} ... ${ids.slice(-3).join(',')}]`
);

export const getCollectionOrderDiagnosticLines = (): string[] => (
    records.map(record => {
        const total = record.itemCount;
        const first = record.ids.length === 0 ? '[]' : shortList(record.ids);
        const last = record.ids.length <= 6 ? first : shortList(record.ids.slice(-6));
        const verdict = record.phase === 'merged' ? orderVerdict(record) : undefined;
        return `  ${new Date(record.at).toISOString()} ${record.phase}`
            + ` provider=${record.providerId} type=${record.collectionType} collection=${record.collectionId}`
            + ` source=${record.source} offset=${record.offset} items=${total}`
            + `${record.requestedLimit === undefined ? '' : ` limit=${record.requestedLimit}`}`
            + `${record.hasMore === undefined ? '' : ` hasMore=${record.hasMore}`}`
            + `${record.nextOffset === undefined ? '' : ` next=${record.nextOffset}`}`
            + ` first=${first} last=${last}`
            + `${verdict ? ` orderCheck=${verdict}` : ''}`;
    })
);
