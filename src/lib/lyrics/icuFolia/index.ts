import type { LyricData } from '../../../types';
import { segmentWithIcuFolia, type IcuFoliaEngines } from './segmenter';

// src/lib/lyrics/icuFolia/index.ts
// icu-folia: Folia's default word segmenter for lyrics. ICU (Intl.Segmenter) with its Chinese and
// Japanese replaced by jieba and BudouX; see segmenter.ts for how a line is cut.
//
// Its output is baked onto each Line as `autoWordSegments` by the lyric setter, rather than computed
// where the words are read: segmentation is read on paths that run per frame, and data on the line
// is what every layout cache and the lyric signature already key on. The engines load
// asynchronously, so lyrics that arrive first are baked again when they are ready (see
// useIcuFoliaSegmentation).

let engines: IcuFoliaEngines | null = null;
let loading: Promise<boolean> | null = null;

/** Starts loading the engines once. Resolves true when they are ready, false if they failed. */
export const loadIcuFolia = (
    loader: () => Promise<IcuFoliaEngines> = async () => (await import('./engines')).loadIcuFoliaEngines(),
): Promise<boolean> => {
    loading ??= loader().then(
        loaded => {
            engines = loaded;
            return true;
        },
        error => {
            // ICU stays the default; nothing a user sees depends on this having worked.
            console.warn('[icu-folia] engines failed to load, lyrics keep the ICU split', error);
            return false;
        },
    );
    return loading;
};

export const isIcuFoliaReady = () => engines !== null;

/** Test seam: forget loaded engines so a test can exercise the not-ready path. */
export const resetIcuFoliaForTests = () => {
    engines = null;
    loading = null;
    liveMemo.clear();
};

const LIVE_MEMO_LIMIT = 256;
const liveMemo = new Map<string, string[]>();

/**
 * icu-folia boundaries for text that has no baked line behind it (Folium mods build their own line
 * objects), or null while the engines are still loading. Memoised, because a mod may well ask every
 * frame; the copy keeps a caller's mutation out of the memo.
 */
export const segmentIcuFolia = (text: string): string[] | null => {
    if (!engines) {
        return null;
    }
    let boundaries = liveMemo.get(text);
    if (!boundaries) {
        boundaries = segmentWithIcuFolia(text, engines);
        if (liveMemo.size >= LIVE_MEMO_LIMIT) {
            liveMemo.delete(liveMemo.keys().next().value as string);
        }
        liveMemo.set(text, boundaries);
    }
    return [...boundaries];
};

const sameBoundaries = (a: string[] | undefined, b: string[]) => (
    a !== undefined && a.length === b.length && a.every((segment, index) => segment === b[index])
);

/**
 * Bakes icu-folia's split onto every line as `autoWordSegments`. Returns the input untouched when
 * the engines are not ready or every line already carries this exact split, so calling it again
 * (the late re-bake, a record patch) never replaces lyrics for nothing.
 */
export const applyAutoWordSegmentation = (lyrics: LyricData | null): LyricData | null => {
    if (!lyrics || !engines) {
        return lyrics;
    }

    let changed = false;
    const lines = lyrics.lines.map(line => {
        if (!line.fullText) {
            return line;
        }
        const boundaries = segmentWithIcuFolia(line.fullText, engines);
        if (sameBoundaries(line.autoWordSegments, boundaries)) {
            return line;
        }
        changed = true;
        return { ...line, autoWordSegments: boundaries };
    });

    return changed ? { ...lyrics, lines } : lyrics;
};
