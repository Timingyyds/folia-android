// src/lib/lyrics/icuFolia/lexicon.ts
// The word lists icu-folia's pipeline (segmenter.ts) applies on top of its engines. Everything here is
// data, so a bad split in the test corpus is usually fixed by adding a word here, or to
// jiebaLexicon.ts, rather than by touching the pipeline.

/**
 * Chinese function words that belong to the word BEFORE them: structural 的/地/得, aspect 了/着/过,
 * the plural 们, sentence-final particles, and their Cantonese counterparts. Attaching them makes a
 * Chinese unit "one content word plus what grammatically hangs off it", which is what a Japanese
 * bunsetsu from BudouX already is (君の, 夜に), so the two languages come out at the same grain.
 *
 * Both script forms are listed: the Chinese engine runs on simplified text, but this list is
 * checked against the original characters.
 */
export const CHINESE_TRAILING_PARTICLES = new Set([
    '的', '地', '得', '了', '着', '著', '过', '過', '们', '們',
    '吗', '嗎', '呢', '吧', '啊', '呀', '啦', '嘛', '哦', '喔', '么', '麼', '哇', '呐', '咯',
    // Cantonese
    '嘅', '咗', '喇', '囉', '咩', '㗎', '噃', '喎', '啫', '吖', '嘞',
]);

/**
 * Words a trailing particle must NOT attach to: prepositions, conjunctions, adverbs and copulas.
 * In 天和地 the 地 is a noun, not the adverbial particle, and 和地 would be nonsense; after these
 * words a "particle" is almost always something else.
 */
export const CHINESE_NON_HOSTS = new Set([
    '和', '与', '與', '跟', '同', '及', '或', '而', '在', '从', '從', '向', '对', '對', '把', '被', '给', '給',
    '让', '讓', '为', '為', '也', '都', '就', '又', '再', '还', '還', '才', '很', '太', '最', '更', '不', '没', '沒',
    '别', '別', '未', '是', '係', '唔', '冇', '啲',
]);
