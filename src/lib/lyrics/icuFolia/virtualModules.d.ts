// src/lib/lyrics/icuFolia/virtualModules.d.ts
// jieba's dictionary and HMM tables reach icu-folia as Vite virtual modules built by
// dev/icuFolia/icuFoliaDataPlugin.mjs, so TS has no real file to resolve and needs these declarations.

declare module 'virtual:icu-folia-dict' {
    /** Every dictionary word, sorted by code unit, joined with '\n'. */
    export const DICT_WORDS: string;
    /** The words' frequencies in the same order, as base64 of unsigned LEB128 varints. */
    export const DICT_FREQS: string;
    export const DICT_TOTAL: number;
}

declare module 'virtual:icu-folia-hmm' {
    type HmmState = 'B' | 'E' | 'M' | 'S';
    export const HMM_START: Record<HmmState, number>;
    export const HMM_TRANS: Record<HmmState, Partial<Record<HmmState, number>>>;
    /** Per state: the characters, and their log probabilities as base64 float64. */
    export const HMM_EMIT: Record<HmmState, [string, string]>;
    /** Traditional -> simplified, as consecutive (traditional, simplified) character pairs. */
    export const T2S_PAIRS: string;
}
