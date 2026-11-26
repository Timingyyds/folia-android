import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    applyAutoWordSegmentation,
    isIcuFoliaReady,
    loadIcuFolia,
    resetIcuFoliaForTests,
    segmentIcuFolia,
} from '../../../../src/utils/lyrics/icuFolia';
import { segmentWithIcuFolia, type IcuFoliaEngines } from '../../../../src/utils/lyrics/icuFolia/segmenter';
import {
    getWordSegmentationKey,
    hasWordSegmentationOverride,
    segmentLyricWords,
} from '../../../../src/utils/lyrics/wordSegmentation';
import { getLyricsSignature } from '../../../../src/components/visualizer/songHandover';
import { buildPostLyricLayoutUnits } from '../../../../src/utils/lyrics/cjkSemanticLayout';
import type { Line, LyricData, Word } from '../../../../src/types';
import { GOLDEN, KNOWN_GAPS } from './corpus';

// test/unit/lyrics/icuFolia/icuFolia.test.ts
// icu-folia against its corpus (corpus.ts), the invariants every consumer of a word split relies
// on, and how its baked split ranks against the user's saved one. The engines load through the same
// path the app uses, wasm and all.

/** The corpus notation: word pieces joined by '/', whitespace pieces left out. */
const notate = (boundaries: string[]) => boundaries.filter(piece => piece.trim()).join('/');

const line = (fullText: string, extra: Partial<Line> = {}): Line => ({
    startTime: 0,
    endTime: 4,
    fullText,
    words: [],
    ...extra,
});

/** Every property the consumers of a split depend on, checked on one output. */
const expectWellFormed = (text: string, boundaries: string[]) => {
    expect(boundaries.join('')).toBe(text);
    expect(boundaries.every(piece => piece.length > 0)).toBe(true);
    // Whitespace runs stand alone (tempera reads word gaps from them), and never sit inside a word.
    boundaries.forEach(piece => {
        if (/\s/u.test(piece)) {
            expect(piece.trim()).toBe('');
        }
    });
    // No boundary falls inside a grapheme (Thai vowel marks, emoji sequences, surrogate pairs).
    const graphemeEnds = new Set<number>([0]);
    let offset = 0;
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
        offset += segment.length;
        graphemeEnds.add(offset);
    }
    let cursor = 0;
    boundaries.forEach(piece => {
        cursor += piece.length;
        expect(graphemeEnds.has(cursor)).toBe(true);
    });
};

const ALL_CASES = Object.values(GOLDEN).flat();

beforeAll(async () => {
    resetIcuFoliaForTests();
    expect(await loadIcuFolia()).toBe(true);
});

afterAll(() => {
    resetIcuFoliaForTests();
});

describe('icu-folia corpus', () => {
    for (const [group, cases] of Object.entries(GOLDEN)) {
        describe(group, () => {
            for (const { text, expected } of cases) {
                it(text, () => {
                    expect(notate(segmentIcuFolia(text)!)).toBe(expected);
                });
            }
        });
    }

    describe('known gaps (pinned to today’s output; promote to GOLDEN once fixed)', () => {
        for (const { text, current, wanted } of KNOWN_GAPS) {
            it(text, () => {
                const actual = notate(segmentIcuFolia(text)!);
                expect(actual).not.toBe(wanted);
                expect(actual).toBe(current);
            });
        }
    });
});

describe('icu-folia invariants', () => {
    it('holds for every corpus line', () => {
        ALL_CASES.forEach(({ text }) => expectWellFormed(text, segmentIcuFolia(text)!));
    });

    it('holds for random concatenations of corpus lines', () => {
        // A fixed LCG so a failure reproduces.
        let seed = 12345;
        const next = () => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed / 2147483648;
        };
        const glue = ['', ' ', '　', '，', '-', '\t'];
        for (let round = 0; round < 300; round += 1) {
            const parts = Array.from({ length: 1 + Math.floor(next() * 3) }, () => ALL_CASES[Math.floor(next() * ALL_CASES.length)].text);
            const text = parts.join(glue[Math.floor(next() * glue.length)]);
            expectWellFormed(text, segmentIcuFolia(text)!);
        }
    });

    it('holds for text outside the BMP and for odd input', () => {
        ['𠮷野家で食べた', '𠮷𠮷𠮷', '👨‍👩‍👧 家人', '   ', '。', 'a', '中'].forEach(text => {
            expectWellFormed(text, segmentIcuFolia(text)!);
        });
        expect(segmentIcuFolia('')).toEqual([]);
    });

    it('holds with no engines, where it is ICU plus the hyphen join', () => {
        ALL_CASES.forEach(({ text }) => expectWellFormed(text, segmentWithIcuFolia(text, null)));
        expect(notate(segmentWithIcuFolia('rock-and-roll', null))).toBe('rock-and-roll');
    });
});

describe('icu-folia pipeline rules', () => {
    // Engines that cut every character apart, so the rules are tested apart from jieba's dictionary.
    const perChar: IcuFoliaEngines = {
        cutChinese: text => Array.from(text),
        parseJapanese: text => [text],
    };

    it('attaches trailing particles to the word before them', () => {
        expect(notate(segmentWithIcuFolia('走过的日子啊', perChar))).toBe('走过的/日/子啊');
    });

    it('does not attach a particle to a preposition or conjunction', () => {
        expect(notate(segmentWithIcuFolia('天和地', perChar))).toBe('天/和/地');
        expect(notate(segmentWithIcuFolia('在的', perChar))).toBe('在/的');
    });

    it('does not attach a particle across whitespace or punctuation', () => {
        expect(notate(segmentWithIcuFolia('你 的', perChar))).toBe('你/的');
        expect(notate(segmentWithIcuFolia('你，的', perChar))).toBe('你/，/的');
    });

    it('sends a run with kana to the Japanese engine and a Han-only run to the Chinese one', () => {
        const seen: string[] = [];
        const spy: IcuFoliaEngines = {
            cutChinese: text => {
                seen.push(`zh:${text}`);
                return [text];
            },
            parseJapanese: text => {
                seen.push(`ja:${text}`);
                return [text];
            },
        };
        segmentWithIcuFolia('君が好き 我爱你 Baby', spy);
        expect(seen).toEqual(['ja:君が好き', 'zh:我爱你']);
    });

    it('falls back to ICU for a run when an engine returns something that does not rebuild it', () => {
        const broken: IcuFoliaEngines = {
            cutChinese: () => ['不', '对'],
            parseJapanese: () => [],
        };
        ['我爱你', '君が好き'].forEach(text => {
            expect(segmentWithIcuFolia(text, broken)).toEqual(segmentWithIcuFolia(text, null));
        });
    });

    it('joins hyphenated alphabetic words but not across spaces or CJK', () => {
        expect(notate(segmentWithIcuFolia('K-pop and well-known', null))).toBe('K-pop/and/well-known');
        expect(notate(segmentWithIcuFolia('nine - five', null))).toBe('nine/-/five');
        expect(notate(segmentWithIcuFolia('爱-恨', perChar))).toBe('爱/-/恨');
    });
});

describe('segmentLyricWords with icu-folia', () => {
    it('uses the baked icu-folia split when there is no saved one', () => {
        const baked = line('故事的结局', { autoWordSegments: ['故事的', '结局'] });
        expect(segmentLyricWords(baked).map(part => part.segment)).toEqual(['故事的', '结局']);
    });

    it('lets the user’s saved split win over the icu-folia one', () => {
        const both = line('故事的结局', { wordSegments: ['故事', '的结局'], autoWordSegments: ['故事的', '结局'] });
        expect(segmentLyricWords(both).map(part => part.segment)).toEqual(['故事', '的结局']);
    });

    it('ignores a stale icu-folia split and falls back to Intl.Segmenter', () => {
        const stale = line('故事的结局', { autoWordSegments: ['别的', '歌词'] });
        expect(segmentLyricWords(stale).map(part => part.segment).join('')).toBe('故事的结局');
        expect(segmentLyricWords(stale).map(part => part.segment)).not.toEqual(['别的', '歌词']);
    });

    it('does not count the icu-folia split as a user override', () => {
        expect(hasWordSegmentationOverride(line('故事的结局', { autoWordSegments: ['故事的', '结局'] }))).toBe(false);
    });

    it('marks whitespace and punctuation pieces of the baked split as not word-like', () => {
        const baked = line('Baby 我想你，', { autoWordSegments: segmentIcuFolia('Baby 我想你，')! });
        const flags = segmentLyricWords(baked).map(part => [part.segment, part.isWordLike]);
        expect(flags).toContainEqual([' ', false]);
        expect(flags).toContainEqual(['，', false]);
        expect(flags).toContainEqual(['Baby', true]);
    });
});

describe('cache keys and the lyric signature see the icu-folia split', () => {
    it('keys a baked split, and keeps it apart from a saved split of the same shape', () => {
        const auto = line('故事的结局', { autoWordSegments: ['故事的', '结局'] });
        const saved = line('故事的结局', { wordSegments: ['故事的', '结局'] });
        expect(getWordSegmentationKey(line('故事的结局'))).toBe('');
        expect(getWordSegmentationKey(auto)).not.toBe('');
        expect(getWordSegmentationKey(auto)).not.toBe(getWordSegmentationKey(saved));
    });

    it('changes the lyric signature when the split is baked onto lyrics already on screen', () => {
        const plain = [line('故事的结局'), line('你好')];
        const baked = plain.map(source => ({ ...source, autoWordSegments: segmentIcuFolia(source.fullText)! }));
        expect(getLyricsSignature(baked)).not.toBe(getLyricsSignature(plain));
    });
});

describe('applyAutoWordSegmentation', () => {
    const lyrics = (): LyricData => ({ lines: [line('故事的结局'), line(''), line('Hello')] });

    it('bakes the split onto every line with text', () => {
        const baked = applyAutoWordSegmentation(lyrics())!;
        expect(baked.lines[0].autoWordSegments).toEqual(segmentIcuFolia('故事的结局'));
        expect(baked.lines[1].autoWordSegments).toBeUndefined();
        expect(baked.lines[2].autoWordSegments).toEqual(['Hello']);
    });

    it('returns the same object when applied again, so a late re-bake replaces nothing', () => {
        const baked = applyAutoWordSegmentation(lyrics());
        expect(applyAutoWordSegmentation(baked)).toBe(baked);
    });

    it('keeps the user’s saved split on the line next to the baked one', () => {
        const source: LyricData = { lines: [line('故事的结局', { wordSegments: ['故事', '的结局'] })] };
        const baked = applyAutoWordSegmentation(source)!;
        expect(baked.lines[0].wordSegments).toEqual(['故事', '的结局']);
        expect(segmentLyricWords(baked.lines[0]).map(part => part.segment)).toEqual(['故事', '的结局']);
    });

    it('passes null through', () => {
        expect(applyAutoWordSegmentation(null)).toBeNull();
    });
});

describe('before the engines load', () => {
    it('leaves lyrics untouched and has no live split, then catches up once loaded', async () => {
        resetIcuFoliaForTests();
        expect(isIcuFoliaReady()).toBe(false);
        const source: LyricData = { lines: [line('故事的结局')] };
        expect(applyAutoWordSegmentation(source)).toBe(source);
        expect(segmentIcuFolia('故事的结局')).toBeNull();

        expect(await loadIcuFolia()).toBe(true);
        expect(applyAutoWordSegmentation(source)).not.toBe(source);
    });

    it('reports failure and stays on ICU when the engines cannot load', async () => {
        resetIcuFoliaForTests();
        const warn = console.warn;
        console.warn = () => {};
        try {
            expect(await loadIcuFolia(() => Promise.reject(new Error('offline')))).toBe(false);
        } finally {
            console.warn = warn;
        }
        expect(isIcuFoliaReady()).toBe(false);
        resetIcuFoliaForTests();
        expect(await loadIcuFolia()).toBe(true);
    });
});

describe('consumers of the baked split', () => {
    /** Parser words the way karaoke lyrics time them: one per character, spaces as their own word. */
    const perCharWords = (text: string): Word[] => Array.from(text, (char, index) => ({
        text: char,
        startTime: index,
        endTime: char.trim() ? index + 1 : index,
    }));

    it('groups per-character parser words along the baked split (Partita, Sonnet layout units)', () => {
        const text = '我们一起走过的那些日子啊';
        const units = buildPostLyricLayoutUnits(
            { fullText: text, words: perCharWords(text), autoWordSegments: segmentIcuFolia(text)! },
            { semantic: true, sticky: true },
        );
        expect(units.map(unit => unit.text)).toEqual(['我们', '一起', '走过的', '那些', '日子啊']);
    });

    it('groups a Japanese line along its bunsetsu', () => {
        const text = '君の声が聞こえる';
        const units = buildPostLyricLayoutUnits(
            { fullText: text, words: perCharWords(text), autoWordSegments: segmentIcuFolia(text)! },
            { semantic: true, sticky: true },
        );
        expect(units.map(unit => unit.text)).toEqual(['君の', '声が', '聞こえる']);
    });

    it('keeps every corpus line alignable: no unit drops or duplicates a character', () => {
        ALL_CASES.forEach(({ text }) => {
            const units = buildPostLyricLayoutUnits(
                { fullText: text, words: perCharWords(text), autoWordSegments: segmentIcuFolia(text)! },
                { semantic: true, sticky: true },
            );
            expect(units.map(unit => unit.text).join('').replace(/\s/gu, '')).toBe(text.replace(/\s/gu, ''));
        });
    });
});

describe('icu-folia determinism and cost', () => {
    it('gives the same split every time, live or baked', () => {
        ALL_CASES.forEach(({ text }) => {
            const first = segmentIcuFolia(text);
            expect(segmentIcuFolia(text)).toEqual(first);
            expect(segmentWithIcuFolia(text, null).join('')).toBe(text);
            expect(applyAutoWordSegmentation({ lines: [line(text)] })!.lines[0].autoWordSegments).toEqual(first);
        });
    });

    it('bakes a 1000-line song well inside a frame budget per line', () => {
        const song: LyricData = {
            lines: Array.from({ length: 1000 }, (_, index) => line(`${ALL_CASES[index % ALL_CASES.length].text}${index}`)),
        };
        const started = performance.now();
        applyAutoWordSegmentation(song);
        const perLineMs = (performance.now() - started) / song.lines.length;
        // Measured around 0.007 ms on an M4 Pro; the bound only catches a regression of orders of magnitude.
        expect(perLineMs).toBeLessThan(1);
    });
});
