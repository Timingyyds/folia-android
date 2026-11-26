import { describe, expect, it } from 'vitest';
import { DICT_FREQS, DICT_TOTAL, DICT_WORDS } from 'virtual:icu-folia-dict';
import { HMM_EMIT, HMM_START, HMM_TRANS } from 'virtual:icu-folia-hmm';
import { createJieba, type JiebaOptions } from '../../../../src/utils/lyrics/icuFolia/jieba';
import reference from './jiebaReference.json';

// test/unit/lyrics/icuFolia/jieba.test.ts
// jieba.ts against jieba itself: jiebaReference.json holds jieba-rs's output (recorded from
// jieba-wasm before icu-folia dropped it) for 500 sentences, with and without the HMM, and after
// adding words. With no HMM length cap the reimplementation must match it word for word.

const DATA = {
    words: DICT_WORDS,
    freqs: DICT_FREQS,
    total: DICT_TOTAL,
    hmm: { start: HMM_START, trans: HMM_TRANS, emit: HMM_EMIT },
};

const build = (options: JiebaOptions = { maxHmmWordLength: Number.POSITIVE_INFINITY }) => createJieba(DATA, options);

describe('jieba.ts reproduces jieba', () => {
    it('matches jieba-rs with the HMM, on the stock dictionary', () => {
        const jieba = build();
        const mismatches = reference.stock.filter(([text, withHmm]) => jieba.cut(text).join('/') !== withHmm);
        expect(mismatches).toEqual([]);
    });

    it('matches jieba-rs without the HMM', () => {
        const jieba = build();
        const mismatches = reference.stock.filter(([text, , withoutHmm]) => jieba.cut(text, false).join('/') !== withoutHmm);
        expect(mismatches).toEqual([]);
    });

    it('matches jieba-rs after add_word, including the frequencies it suggests', () => {
        const jieba = build();
        reference.addedWords.forEach(word => jieba.addWord(word));
        reference.demotedWords.forEach(word => jieba.addWord(word, 1));
        const mismatches = reference.afterLexicon.filter(([text, withHmm]) => jieba.cut(text).join('/') !== withHmm);
        expect(mismatches).toEqual([]);
    });

    it('rebuilds its input exactly, also outside the BMP and around non-Han text', () => {
        const jieba = build();
        ['𠮷野家的饭', '〇〇七号', 'ABC中文123', '我爱 你\t啊', '葛󠄀城', ''].forEach(text => {
            expect(jieba.cut(text).join('')).toBe(text);
        });
    });
});

describe('the HMM length cap', () => {
    it('falls back to single characters for HMM words longer than the cap', () => {
        // The dictionary leaves 天/钓/临 as leftovers and the HMM, uncapped, glues them into one word.
        expect(build().cut('杏花天钓临芳草地')).toContain('天钓临');
        const capped = build({ maxHmmWordLength: 2 }).cut('杏花天钓临芳草地');
        expect(capped).not.toContain('天钓临');
        expect(capped.join('')).toBe('杏花天钓临芳草地');
        capped.forEach(word => expect(Array.from(word).length <= 2 || word === '杏花' || word === '芳草地').toBe(true));
    });

    it('keeps two-character HMM words', () => {
        // 小肉 is not in the dictionary; the HMM finds it, and the cap lets it through.
        expect(build({ maxHmmWordLength: 2 }).cut('我的小肉')).toContain('小肉');
    });

    it('leaves dictionary words of any length alone', () => {
        expect(build({ maxHmmWordLength: 2 }).cut('千言万语说不出口')).toContain('千言万语');
    });
});
