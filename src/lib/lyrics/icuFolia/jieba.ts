// src/lib/lyrics/icuFolia/jieba.ts
// jieba's Chinese segmentation, reimplemented for icu-folia: the word graph over a dictionary, the
// maximum-probability route through it, and the HMM (Viterbi over B/M/E/S) for runs of characters
// the dictionary does not cover. It replaces jieba-wasm, which held the dictionary in hash maps
// (~90 MB resident) and built them in one ~130 ms call on the main thread.
//
// Here the dictionary is one sorted string searched by binary search (see
// dev/icuFolia/icuFoliaDataPlugin.mjs for the format), a few MB in total, decoded in one pass.
//
// The algorithm follows jieba (and jieba-rs, which jieba-wasm wraps) step for step, including how
// ties are broken, so with `maxHmmWordLength: Infinity` it produces jieba's split. icu-folia caps HMM
// words at two characters: in lyrics, a three-character "word" the HMM invents from leftovers is
// usually wrong (天钓临 out of 杏花天钓临芳草地), while two-character ones are usually right.

export interface JiebaData {
    /** Every dictionary word, sorted by code unit, joined with '\n'. */
    words: string;
    /** Each word's frequency, in the same order, as base64 of unsigned LEB128 varints. */
    freqs: string;
    /** The sum of all frequencies in the dictionary file. */
    total: number;
    hmm: {
        start: Record<HmmState, number>;
        trans: Record<HmmState, Partial<Record<HmmState, number>>>;
        /** Per state: the characters, and their log probabilities as base64 float64. */
        emit: Record<HmmState, [string, string]>;
    };
}

export interface JiebaOptions {
    /** HMM words longer than this (in characters) fall back to single characters. Infinity = jieba. */
    maxHmmWordLength?: number;
}

export interface Jieba {
    /** Words for `text`, joining back to it exactly. `hmm: false` skips the HMM, as jieba's cut(..., HMM=False). */
    cut(text: string, hmm?: boolean): string[];
    /** jieba's add_word: adds or re-weights a word; without a frequency, one is suggested as jieba does. */
    addWord(word: string, freq?: number): number;
}

type HmmState = 'B' | 'E' | 'M' | 'S';

// Index order is alphabetical, which is also how jieba breaks ties between states.
const STATES: HmmState[] = ['B', 'E', 'M', 'S'];
const B = 0;
const E = 1;
const M = 2;
const S = 3;
const PREV_STATES: number[][] = [[E, S], [B, M], [M, B], [S, E]];
const MIN_FLOAT = -3.14e100;

// jieba-rs's "han" pattern for the top-level split, and jieba's narrower one inside the HMM.
const RE_HAN_DEFAULT = /([㐀-䶿一-鿿豈-﫿\u{20000}-\u{2A6DF}\u{2A700}-\u{2B73F}\u{2B740}-\u{2B81F}\u{2B820}-\u{2CEAF}\u{2CEB0}-\u{2EBEF}\u{2F800}-\u{2FA1F}a-zA-Z0-9+#&._%-]+)/u;
const RE_SKIP_DEFAULT = /(\r\n|\s)/u;
const RE_HAN_HMM = /([一-鿕]+)/u;
const RE_SKIP_HMM = /([a-zA-Z0-9]+(?:\.\d+)?%?)/u;
const LATIN_CHAR = /^[a-zA-Z0-9]$/;

const decodeBase64 = (base64: string): Uint8Array => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
};

const decodeVarints = (base64: string, count: number): Uint32Array => {
    const bytes = decodeBase64(base64);
    // jieba's largest frequency is under a million, far inside 32 bits.
    const values = new Uint32Array(count);
    let cursor = 0;
    for (let index = 0; index < count; index += 1) {
        let value = 0;
        let scale = 1;
        for (;;) {
            const byte = bytes[cursor++];
            value += (byte & 0x7f) * scale;
            if (byte < 0x80) break;
            scale *= 0x80;
        }
        values[index] = value;
    }
    return values;
};

/** String.split with a capturing pattern, as Python's re.split: matched pieces flagged, empties dropped. */
const splitKeep = (text: string, pattern: RegExp): Array<{ text: string; matched: boolean }> => (
    text.split(pattern)
        .map((piece, index) => ({ text: piece, matched: index % 2 === 1 }))
        .filter(piece => piece.text.length > 0)
);

export const createJieba = (data: JiebaData, options: JiebaOptions = {}): Jieba => {
    const maxHmmWordLength = options.maxHmmWordLength ?? Number.POSITIVE_INFINITY;

    // ---- dictionary: binary search over the sorted word string ----
    const { words } = data;
    let count = words.length > 0 ? 1 : 0;
    for (let index = 0; index < words.length; index += 1) if (words.charCodeAt(index) === 10) count += 1;
    const starts = new Int32Array(count + 1);
    for (let index = 0, word = 1; index < words.length; index += 1) {
        if (words.charCodeAt(index) === 10) starts[word++] = index + 1;
    }
    starts[count] = words.length + 1;
    const freqs = decodeVarints(data.freqs, count);

    // Lookups compare text[from, to) against the dictionary in place, character code by character
    // code. Slicing out a key per comparison made hundreds of short-lived strings per line, and the
    // garbage alone grew the renderer's heap by tens of MB that V8 then kept.

    /** Dictionary word `index` against text[from, to): negative, zero or positive, by code unit. */
    const compareAt = (index: number, text: string, from: number, to: number) => {
        const wordStart = starts[index];
        const wordLength = starts[index + 1] - 1 - wordStart;
        const keyLength = to - from;
        const shared = Math.min(wordLength, keyLength);
        for (let offset = 0; offset < shared; offset += 1) {
            const diff = words.charCodeAt(wordStart + offset) - text.charCodeAt(from + offset);
            if (diff !== 0) return diff;
        }
        return wordLength - keyLength;
    };

    /** First dictionary index whose word is >= text[from, to). */
    const lowerBound = (text: string, from: number, to: number) => {
        let low = 0;
        let high = count;
        while (low < high) {
            const mid = (low + high) >>> 1;
            if (compareAt(mid, text, from, to) < 0) low = mid + 1;
            else high = mid;
        }
        return low;
    };

    // Words added at runtime (add_word) sit in an overlay, so the sorted string never changes. The
    // overlay is only consulted (and a key only sliced out) for text starting with one of its letters.
    const added = new Map<string, number>();
    const addedPrefixes = new Set<string>();
    const addedFirstCodes = new Set<number>();
    let total = data.total;
    let logTotal = Math.log(total);

    /** The frequency of text[from, to) as a word, or 0 when it is not one. */
    const freqAt = (text: string, from: number, to: number) => {
        if (addedFirstCodes.has(text.charCodeAt(from))) {
            const extra = added.get(text.slice(from, to));
            if (extra !== undefined) return extra;
        }
        const index = lowerBound(text, from, to);
        return index < count && compareAt(index, text, from, to) === 0 ? freqs[index] : 0;
    };

    /** Whether some word starts with text[from, to) (jieba's "frag in FREQ" over its prefix dict). */
    const isPrefixAt = (text: string, from: number, to: number) => {
        if (addedFirstCodes.has(text.charCodeAt(from)) && addedPrefixes.has(text.slice(from, to))) return true;
        const index = lowerBound(text, from, to);
        if (index >= count) return false;
        const wordStart = starts[index];
        if (starts[index + 1] - 1 - wordStart < to - from) return false;
        for (let offset = 0; offset < to - from; offset += 1) {
            if (words.charCodeAt(wordStart + offset) !== text.charCodeAt(from + offset)) return false;
        }
        return true;
    };

    const freqOf = (word: string) => freqAt(word, 0, word.length);

    // ---- HMM tables ----
    const start = STATES.map(state => data.hmm.start[state]);
    const trans = STATES.map(from => STATES.map(to => data.hmm.trans[from][to] ?? MIN_FLOAT));
    const emit = STATES.map(state => {
        const [chars, logsBase64] = data.hmm.emit[state];
        const bytes = decodeBase64(logsBase64);
        const logs = new Float64Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 8);
        const table = new Map<string, number>();
        Array.from(chars).forEach((char, index) => table.set(char, logs[index]));
        return table;
    });

    /** jieba's finalseg Viterbi over one run of Han characters: the B/M/E/S label for each. */
    const viterbi = (chars: string[]): number[] => {
        const n = chars.length;
        const probs = new Float64Array(n * 4);
        const back = new Int8Array(n * 4);
        STATES.forEach((_, state) => {
            probs[state] = start[state] + (emit[state].get(chars[0]) ?? MIN_FLOAT);
        });
        for (let t = 1; t < n; t += 1) {
            for (let state = 0; state < 4; state += 1) {
                const emitProb = emit[state].get(chars[t]) ?? MIN_FLOAT;
                let best = Number.NEGATIVE_INFINITY;
                let bestPrev = -1;
                for (const prev of PREV_STATES[state]) {
                    const prob = probs[(t - 1) * 4 + prev] + trans[prev][state] + emitProb;
                    // Python's max over (prob, state) tuples: on a tie the later state letter wins.
                    if (prob > best || (prob === best && prev > bestPrev)) {
                        best = prob;
                        bestPrev = prev;
                    }
                }
                probs[t * 4 + state] = best;
                back[t * 4 + state] = bestPrev;
            }
        }
        const lastE = probs[(n - 1) * 4 + E];
        const lastS = probs[(n - 1) * 4 + S];
        let state = lastS >= lastE ? S : E;
        const labels = new Array<number>(n);
        for (let t = n - 1; t >= 0; t -= 1) {
            labels[t] = state;
            state = back[t * 4 + state];
        }
        return labels;
    };

    /** finalseg.cut over a run of leftovers: Viterbi on the Han parts, the rest passed through. */
    const cutHmm = (text: string, out: string[]) => {
        for (const block of splitKeep(text, RE_HAN_HMM)) {
            if (!block.matched) {
                splitKeep(block.text, RE_SKIP_HMM).forEach(piece => out.push(piece.text));
                continue;
            }
            const chars = Array.from(block.text);
            const labels = viterbi(chars);
            const words: string[] = [];
            let begin = 0;
            let next = 0;
            labels.forEach((label, index) => {
                if (label === B) {
                    begin = index;
                } else if (label === E) {
                    words.push(chars.slice(begin, index + 1).join(''));
                    next = index + 1;
                } else if (label === S) {
                    words.push(chars[index]);
                    next = index + 1;
                }
            });
            if (next < chars.length) words.push(chars.slice(next).join(''));
            words.forEach(word => {
                if (Array.from(word).length > maxHmmWordLength) out.push(...Array.from(word));
                else out.push(word);
            });
        }
    };

    /**
     * The word graph and its maximum-probability route, as jieba's get_DAG + calc. Positions are
     * characters (code points); `bounds` maps each to its code-unit offset in `text`.
     */
    const route = (text: string, bounds: Int32Array): Int32Array => {
        const n = bounds.length - 1;
        const best = new Float64Array(n + 1);
        const nextIndex = new Int32Array(n + 1);
        for (let index = n - 1; index >= 0; index -= 1) {
            let bestProb = Number.NEGATIVE_INFINITY;
            let bestEnd = index;
            let end = index;
            let found = false;
            while (end < n && isPrefixAt(text, bounds[index], bounds[end + 1])) {
                const freq = freqAt(text, bounds[index], bounds[end + 1]);
                if (freq) {
                    found = true;
                    const prob = Math.log(freq) - logTotal + best[end + 1];
                    // Ends are visited in ascending order, so >= keeps the longer word on a tie,
                    // as jieba's max over (prob, end) does.
                    if (prob >= bestProb) {
                        bestProb = prob;
                        bestEnd = end;
                    }
                }
                end += 1;
            }
            if (!found) {
                // Not even a one-character word here: the character stands alone, weighted as freq 1.
                bestProb = Math.log(1) - logTotal + best[index + 1];
                bestEnd = index;
            }
            best[index] = bestProb;
            nextIndex[index] = bestEnd + 1;
        }
        return nextIndex;
    };

    /** jieba's __cut_DAG (with HMM) / __cut_DAG_NO_HMM over one Han block. */
    const cutBlock = (text: string, hmm: boolean, out: string[]) => {
        const bounds = new Int32Array(Array.from(text).length + 1);
        for (let index = 0, offset = 0; offset < text.length; index += 1) {
            offset += text.codePointAt(offset)! > 0xffff ? 2 : 1;
            bounds[index + 1] = offset;
        }
        const n = bounds.length - 1;
        const nextIndex = route(text, bounds);
        let buffer: string[] = [];
        const flush = () => {
            if (buffer.length === 1) {
                out.push(buffer[0]);
            } else if (buffer.length > 1) {
                const run = buffer.join('');
                if (!freqOf(run)) cutHmm(run, out);
                else out.push(...buffer);
            }
            buffer = [];
        };
        let latin = '';
        for (let index = 0; index < n;) {
            const end = nextIndex[index];
            const word = text.slice(bounds[index], bounds[end]);
            if (!hmm) {
                // __cut_DAG_NO_HMM: single ASCII letters and digits run together into one word.
                if (end - index === 1 && LATIN_CHAR.test(word)) {
                    latin += word;
                } else {
                    if (latin) out.push(latin);
                    latin = '';
                    out.push(word);
                }
            } else if (end - index === 1) {
                buffer.push(word);
            } else {
                flush();
                out.push(word);
            }
            index = end;
        }
        if (hmm) flush();
        else if (latin) out.push(latin);
    };

    const cut = (text: string, hmm = true): string[] => {
        const out: string[] = [];
        for (const block of splitKeep(text, RE_HAN_DEFAULT)) {
            if (block.matched) {
                cutBlock(block.text, hmm, out);
                continue;
            }
            for (const piece of splitKeep(block.text, RE_SKIP_DEFAULT)) {
                if (piece.matched) out.push(piece.text);
                else out.push(...Array.from(piece.text));
            }
        }
        return out;
    };

    /** jieba-rs's suggest_freq: just high enough that the word survives as one piece. */
    const suggestFreq = (word: string) => {
        const logFreq = cut(word, false).reduce((sum, piece) => sum + Math.log(freqOf(piece) || 1) - logTotal, 0);
        return Math.max(Math.floor(Math.exp(logFreq + logTotal)) + 1, freqOf(word) || 1);
    };

    const addWord = (word: string, freq?: number) => {
        const weight = freq ?? suggestFreq(word);
        total += weight - freqOf(word);
        logTotal = Math.log(total);
        added.set(word, weight);
        addedFirstCodes.add(word.charCodeAt(0));
        const chars = Array.from(word);
        for (let length = 1; length <= chars.length; length += 1) addedPrefixes.add(chars.slice(0, length).join(''));
        return weight;
    };

    return { cut, addWord };
};
