import type { IcuFoliaEngines } from './segmenter';
import { createJieba } from './jieba';
import { CHINESE_DEMOTED_WORDS, CHINESE_EXTRA_WORDS } from './jiebaLexicon';

// src/lib/lyrics/icuFolia/engines.ts
// Loads icu-folia's engines: jieba (jieba.ts, on jieba's dictionary and HMM tables) for Chinese and
// BudouX for Japanese, with a traditional -> simplified character map in front of jieba.
//
// All of it arrives in lazy chunks, off the startup bundle: the dictionary and the HMM tables are
// Vite virtual modules built by dev/icuFolia/icuFoliaDataPlugin.mjs. Building the engines is a few
// single passes over that data (~10 ms), so it does not stall a frame the way a dictionary built in
// one long call would.

/** HMM words longer than this fall back to single characters; see jieba.ts for why two. */
const MAX_HMM_WORD_LENGTH = 2;

/**
 * Character-by-character, so the simplified text has exactly the original's code-unit offsets and
 * jieba's words map straight back onto the original characters. The map only holds characters whose
 * simplified form is a single BMP character (the plugin guarantees it), so lengths always match.
 */
const createSimplifier = (pairs: string) => {
    const map = new Map<string, string>();
    for (let index = 0; index + 1 < pairs.length; index += 2) map.set(pairs[index], pairs[index + 1]);
    return (text: string) => Array.from(text, char => map.get(char) ?? char).join('');
};

export const loadIcuFoliaEngines = async (): Promise<IcuFoliaEngines> => {
    const [dict, hmm, { createJapaneseParser }] = await Promise.all([
        import('virtual:icu-folia-dict'),
        import('virtual:icu-folia-hmm'),
        import('./budouxJapanese'),
    ]);

    const jieba = createJieba({
        words: dict.DICT_WORDS,
        freqs: dict.DICT_FREQS,
        total: dict.DICT_TOTAL,
        hmm: { start: hmm.HMM_START, trans: hmm.HMM_TRANS, emit: hmm.HMM_EMIT },
    }, { maxHmmWordLength: MAX_HMM_WORD_LENGTH });
    CHINESE_EXTRA_WORDS.forEach(word => jieba.addWord(word));
    CHINESE_DEMOTED_WORDS.forEach(word => jieba.addWord(word, 1));

    const simplify = createSimplifier(hmm.T2S_PAIRS);
    const japanese = createJapaneseParser();

    return {
        cutChinese(text) {
            // Offsets line up (see the simplifier), so each simplified word's length is also its
            // length in the original text.
            let cursor = 0;
            return jieba.cut(simplify(text)).map(word => {
                const original = text.slice(cursor, cursor + word.length);
                cursor += word.length;
                return original;
            });
        },
        parseJapanese: text => japanese.parse(text),
    };
};
