// src/lib/lyrics/icuFolia/jiebaLexicon.ts
// Words added to jieba's dictionary when icu-folia's engines load. Kept apart from lexicon.ts on
// purpose: segmenter.ts (in the main bundle) imports that file, and a module imported from both sides
// is moved into a shared chunk, which made the lazy engines chunk depend on app code. Only engines.ts
// imports this one, so it stays inside the lazy chunk.

/**
 * Words jieba's dictionary lacks, added at load in SIMPLIFIED form (the engine sees simplified text).
 * Mostly Cantonese, which the stock dictionary barely covers: without these 佢哋 comes out as two
 * unknown characters and 冇人會 glues 人 onto 會.
 */
export const CHINESE_EXTRA_WORDS = [
    '我哋', '你哋', '佢哋', '佢', '冇', '冇人', '唔好', '唔使', '唔系', '唔该', '唔知', '唔会', '唔识',
    '系咪', '喺度', '返嚟', '过嚟', '嚟', '点解', '乜嘢', '咩嘢', '咁样', '钟意', '而家', '依家', '听日',
    '琴日', '边度', '边个', '几时', '嗰度', '嗰个', '呢度', '呢个', '嘢', '心事', '揾', '睇', '攰',
];

/**
 * Dictionary words jieba should almost never choose, re-added at load with the lowest frequency.
 * 的话 ("if") swallows the particle 的 of the far more common 说过的话 ("the words said"), giving
 * 说过/的话. Demoted, the conditional reads 可以的/话, which still keeps 的 on its host.
 */
export const CHINESE_DEMOTED_WORDS = ['的话'];
