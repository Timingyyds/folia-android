import { CHINESE_NON_HOSTS, CHINESE_TRAILING_PARTICLES } from './lexicon';

// src/lib/lyrics/icuFolia/segmenter.ts
// The icu-folia pipeline, with its engines passed in so it stays pure and testable without loading them.
//
// It does not guess a language per line. ICU's own word breaker already dispatches by script run
// (a Thai dictionary for Thai, whitespace for Latin and Hangul, a CJ dictionary for Han and kana),
// and it gets everything right except Chinese and Japanese. So icu-folia lets ICU cut the line,
// keeps every non-CJ piece as is, and only re-cuts the maximal runs of Han/kana pieces:
//
//   run contains kana  -> Japanese -> BudouX, which cuts bunsetsu (君の / 夢に)
//   Han only           -> Chinese  -> jieba on the simplified text, then trailing particles attach
//                                     back (故事 / 的 -> 故事的), so a unit is one content word plus
//                                     what hangs off it, the same grain as a bunsetsu
//
// Mixed lyrics need no special case: in "I love you 君が好き" or "Baby 我想你" the scripts are
// already separate ICU pieces. What still goes wrong is Chinese and Japanese inside ONE run with no
// space or punctuation between them (我们看过的桜の花): the kana makes the whole run Japanese. That
// case is rare in real lyrics and is kept as a known gap in the test corpus.

export interface IcuFoliaEngines {
    /** Chinese words for a Han-only run. Must join back to the input exactly. */
    cutChinese(text: string): string[];
    /** Japanese bunsetsu for a Han/kana run. Must join back to the input exactly. */
    parseJapanese(text: string): string[];
}

const CJ_PIECE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆〇]+$/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}ー]/u;
const ALPHABETIC_WORD = /^[\p{L}\p{M}\p{N}]+$/u;
const NOT_ALPHABETIC = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
// ASCII hyphen-minus, U+2010 hyphen, U+2011 non-breaking hyphen
const HYPHEN = /^[-‐‑]$/;
const HYPHEN_SPLIT = /[-‐‑]/;

/** A word written in an alphabet, where a hyphen joins words: not Han, kana or Hangul. */
const isAlphabeticWord = (piece: string) => ALPHABETIC_WORD.test(piece) && !NOT_ALPHABETIC.test(piece);

let icuSegmenter: Intl.Segmenter | null = null;

const icuWordPieces = (text: string): string[] => {
    icuSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'word' });
    return Array.from(icuSegmenter.segment(text), part => part.segment);
};

/** An engine's answer only counts when it rebuilds its input; anything else falls back to ICU. */
const rebuilds = (pieces: string[], text: string) => pieces.length > 0 && pieces.join('') === text;

/** 故事/的 -> 故事的, but 天/和/地 stays: 和 cannot host a particle. */
const attachTrailingParticles = (words: string[]): string[] => {
    const out: string[] = [];
    for (const word of words) {
        const host = out[out.length - 1];
        if (host !== undefined && CHINESE_TRAILING_PARTICLES.has(word) && !CHINESE_NON_HOSTS.has(host)) {
            out[out.length - 1] = host + word;
        } else {
            out.push(word);
        }
    }
    return out;
};

const cutCjRun = (run: string, icuPieces: string[], engines: IcuFoliaEngines | null): string[] => {
    if (!engines) {
        return icuPieces;
    }
    if (KANA.test(run)) {
        const bunsetsu = engines.parseJapanese(run);
        return rebuilds(bunsetsu, run) ? bunsetsu : icuPieces;
    }
    const words = engines.cutChinese(run);
    return rebuilds(words, run) ? attachTrailingParticles(words) : icuPieces;
};

/** rock / - / and / - / roll -> rock-and-roll. ICU already keeps don't and l'amour whole. */
const joinHyphenatedWords = (pieces: string[]): string[] => {
    const out: string[] = [];
    for (let index = 0; index < pieces.length; index += 1) {
        const piece = pieces[index];
        const previous = out[out.length - 1];
        const next = pieces[index + 1];
        // `previous` may already be a joined compound, so its last hyphen-separated word is what
        // has to be alphabetic.
        if (
            HYPHEN.test(piece)
            && previous !== undefined && next !== undefined
            && isAlphabeticWord(previous.split(HYPHEN_SPLIT).pop() ?? '') && isAlphabeticWord(next)
        ) {
            out[out.length - 1] = previous + piece + next;
            index += 1;
        } else {
            out.push(piece);
        }
    }
    return out;
};

/**
 * Word boundaries for a line of lyrics. Always joins back to `text`, keeps whitespace runs as
 * pieces of their own (as Intl.Segmenter does, which every consumer relies on), and with no engines
 * is plain ICU apart from the hyphen join.
 */
export const segmentWithIcuFolia = (text: string, engines: IcuFoliaEngines | null): string[] => {
    if (!text) {
        return [];
    }
    const pieces = icuWordPieces(text);
    const out: string[] = [];
    let index = 0;
    while (index < pieces.length) {
        if (!CJ_PIECE.test(pieces[index])) {
            out.push(pieces[index]);
            index += 1;
            continue;
        }
        const runPieces: string[] = [];
        while (index < pieces.length && CJ_PIECE.test(pieces[index])) {
            runPieces.push(pieces[index]);
            index += 1;
        }
        out.push(...cutCjRun(runPieces.join(''), runPieces, engines));
    }
    return joinHyphenatedWords(out);
};
