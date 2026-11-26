// test/unit/lyrics/icuFolia/corpus.ts
// icu-folia's lyric test set. Lines are written for this file in the style of lyrics, not quoted
// from songs.
//
// `expected` is the word split with whitespace pieces left out: "Baby/我/想你" for "Baby 我想你".
// The target grain is "one content word plus the function words that hang off it": a Japanese
// bunsetsu (君の / 夜に), and for Chinese a word with its trailing 的/了/着/吗 attached (走过的 / 日子啊).
// Prepositions, conjunctions and pronouns stand alone, as they do in a bunsetsu split. Where jieba's
// dictionary keeps a fixed phrase whole (太晚, 好想你, 向东流) that is accepted as the grain too.
//
// Coverage is organised by what can go wrong, one group per row. When adding a case, put it under
// the row it exercises; when a row has no case for a new kind of input, add a row.
//
//   zh/*        Chinese: the particle rule and its exceptions, words whose "particle" character is
//               really a content word (的确, 着急, 了解, 大地, 得到), idioms, reduplication, numbers and
//               measure words, names, classic ambiguous strings, line-initial interjections, vocables
//   zh-Hant/*   traditional text through the length-preserving simplifier, Taiwan and Hong Kong forms,
//               and simplified characters the simplifier must leave alone (么, 著)
//   yue         Cantonese words the lexicon adds and Cantonese particles
//   ja/*        bunsetsu, ー, 々, ヶ, katakana loanwords, hiragana-only, kanji-only, half-width kana
//   ko, th, other-scripts
//               scripts icu-folia must leave to ICU: Hangul, Thai, Lao, Khmer, Cyrillic, Arabic,
//               Hebrew, Devanagari, Latin with diacritics, German compounds, Vietnamese syllables
//   latin       contractions, the hyphen join and where it must not apply
//   mixed       scripts side by side in one line, the case per-line language detection gets wrong
//   lyric/*     what lyrics carry and prose does not: vocables, backing vocals in brackets, credit
//               and section labels, tildes, ellipses, full-width and repeated spaces
//   punctuation brackets, dashes, emoji, digits
//   unicode     non-BMP Han, ideographic variation selectors, zero-width and no-break spaces,
//               full-width Latin, enclosed numerals, ZWJ emoji, combining marks
//
// The invariants (rebuilds the text, whitespace stands alone, no boundary inside a grapheme) are
// checked on every line here and on random concatenations of them, in icuFolia.test.ts.
//
// GOLDEN must match exactly. KNOWN_GAPS are splits we know are wrong; they are pinned to what
// icu-folia produces today so that a change in them is noticed, and promoted to GOLDEN once fixed.

export interface CorpusCase {
    text: string;
    expected: string;
}

export interface KnownGap {
    text: string;
    /** What icu-folia produces today. */
    current: string;
    /** What it should produce. */
    wanted: string;
    why: string;
}

export const GOLDEN: Record<string, CorpusCase[]> = {
    'zh/particles': [
        { text: '你是我心里的一场雨', expected: '你/是/我/心里的/一场/雨' },
        { text: '故事的结局总是来得太晚', expected: '故事的/结局/总是/来得/太晚' },
        { text: '我们一起走过的那些日子啊', expected: '我们/一起/走过的/那些/日子啊' },
        { text: '风吹散了往事如烟', expected: '风/吹散了/往事如烟' },
        { text: '你还会想起我吗', expected: '你/还/会/想起/我吗' },
        { text: '街角的咖啡店亮着灯', expected: '街角的/咖啡店/亮着/灯' },
        { text: '把所有的思念写进信里', expected: '把/所有的/思念/写进/信里' },
        { text: '月光洒在安静的湖面', expected: '月光/洒/在/安静的/湖面' },
        { text: '慢慢地走回家', expected: '慢慢地/走/回家' },
        { text: '终于得到了自由', expected: '终于/得到了/自由' },
        // 的话 is demoted in the lexicon so it cannot swallow the particle of 说过的话
        { text: '你说过的话我都记得', expected: '你/说过的/话/我/都/记得' },
        { text: '如果可以的话', expected: '如果/可以的/话' },
    ],
    'zh/particle-characters-as-content-words': [
        // 天和地 is an HMM guess, and HMM words are capped at two characters (see jieba.ts)
        { text: '天和地之间只剩下我', expected: '天/和/地/之间/只/剩下/我' },
        { text: '的确是我错了', expected: '的确/是/我/错了' },
        { text: '别着急慢慢来', expected: '别着急/慢慢来' },
        { text: '我了解你的心', expected: '我/了解/你的/心' },
        { text: '脚下的大地', expected: '脚下的/大地' },
        { text: '你过来', expected: '你/过来' },
    ],
    'zh/idioms-and-reduplication': [
        { text: '我在人山人海里等你', expected: '我/在/人山人海/里/等/你' },
        { text: '可有可无的人', expected: '可有可无的/人' },
        { text: '一见钟情的那天', expected: '一见钟情的/那天' },
        { text: '千言万语说不出口', expected: '千言万语/说不出口' },
        { text: '轻轻地告诉你', expected: '轻轻地/告诉/你' },
        { text: '我们看看海吧', expected: '我们/看看/海吧' },
        { text: '走走停停', expected: '走走停停' },
    ],
    'zh/numbers-names-ambiguity': [
        { text: '那年我十七岁', expected: '那年/我/十七岁' },
        { text: '等了三千年', expected: '等了/三千年' },
        { text: '下了一场大雨', expected: '下了/一场/大雨' },
        { text: '长江的水向东流', expected: '长江的/水/向东流' },
        { text: '在北京的冬天', expected: '在/北京的/冬天' },
        { text: '结婚的和尚未结婚的', expected: '结婚的/和/尚未/结婚的' },
        { text: '乒乓球拍卖完了', expected: '乒乓球/拍卖/完了' },
    ],
    'zh/interjections-and-vocables': [
        { text: '啊我的爱人', expected: '啊/我的/爱人' },
        { text: '啦啦啦啦', expected: '啦啦啦啦' },
        { text: '哦哦哦', expected: '哦哦哦' },
        // three single characters; Tempera's single-character glue keeps them in one shot
        { text: '爱爱爱', expected: '爱/爱/爱' },
        {
            text: '我想要穿越这座城市的所有街道去找寻你留下的每一个足迹',
            expected: '我/想要/穿越/这座/城市的/所有/街道/去/找寻/你/留下的/每/一个/足迹',
        },
    ],
    'zh-Hant/taiwan': [
        { text: '後來我們終於明白', expected: '後來/我們/終於/明白' },
        { text: '眼淚落在記憶的角落', expected: '眼淚/落/在/記憶的/角落' },
        { text: '時間過得太快了', expected: '時間/過得/太快了' },
        { text: '你說過的話我都記得', expected: '你/說過的/話/我/都/記得' },
        { text: '城市的燈火漸漸熄滅', expected: '城市的/燈火/漸漸/熄滅' },
        { text: '在夢裡見到你', expected: '在/夢裡/見到/你' },
        { text: '看著你的眼睛', expected: '看著/你的/眼睛' },
    ],
    'zh-Hant/mixed-forms': [
        { text: '我爱你們', expected: '我/爱/你們' },
    ],
    // The simplifier maps characters one by one and also runs on simplified text, so it must not
    // rewrite a valid simplified character: OpenCC's Taiwan preset maps 么 -> 幺 and 著 -> 着.
    'zh-Hant/simplifier-keeps-simplified': [
        { text: '为什么你还不明白', expected: '为什么/你/还/不/明白' },
        { text: '他是著名的歌手', expected: '他/是/著名的/歌手' },
        { text: '我一直想著你', expected: '我/一直/想著/你' },
        { text: '這首歌是他的著作', expected: '這/首歌/是/他的/著作' },
    ],
    yue: [
        { text: '冇人會明白我嘅心事', expected: '冇人/會/明白/我嘅/心事' },
        { text: '我哋唔使再講嘢', expected: '我哋/唔使/再/講/嘢' },
        { text: '佢哋今晚唔返嚟', expected: '佢哋/今晚/唔/返嚟' },
        { text: '點解你唔講', expected: '點解/你/唔/講' },
        { text: '我真係好鍾意你', expected: '我/真係/好/鍾意/你' },
    ],
    'ja/bunsetsu': [
        { text: '君の声が聞こえる', expected: '君の/声が/聞こえる' },
        { text: '僕らは今夜も眠れない', expected: '僕らは/今夜も/眠れない' },
        { text: '忘れた物を取りに帰る', expected: '忘れた/物を/取りに/帰る' },
        { text: '明日へ走り出せ', expected: '明日へ/走り出せ' },
        { text: '夢ならばどれほどよかった', expected: '夢ならば/どれほど/よかった' },
    ],
    'ja/scripts-and-marks': [
        { text: 'ラブソングを歌おう', expected: 'ラブソングを/歌おう' },
        { text: '時々思い出す', expected: '時々/思い出す' },
        { text: '三ヶ月が過ぎた', expected: '三ヶ月が/過ぎた' },
        { text: 'あなたのことがすきです', expected: 'あなたの/ことが/すきです' },
        { text: 'コーヒーとチョコレート', expected: 'コーヒーと/チョコレート' },
        { text: 'ありがとう', expected: 'ありがとう' },
        { text: '永遠', expected: '永遠' },
        { text: '運命', expected: '運命' },
        { text: 'ｶﾀｶﾅで書いた', expected: 'ｶﾀｶﾅで/書いた' },
    ],
    ko: [
        { text: '너를 사랑하고 있어 오늘도', expected: '너를/사랑하고/있어/오늘도' },
        { text: '보고 싶다 정말', expected: '보고/싶다/정말' },
    ],
    th: [
        { text: 'ฉันรักเธอ', expected: 'ฉัน/รัก/เธอ' },
        { text: 'คิดถึงเธอทุกวัน', expected: 'คิดถึง/เธอ/ทุก/วัน' },
    ],
    'other-scripts': [
        { text: 'Я люблю тебя', expected: 'Я/люблю/тебя' },
        { text: 'أحبك يا قلبي', expected: 'أحبك/يا/قلبي' },
        { text: 'אני אוהב אותך', expected: 'אני/אוהב/אותך' },
        { text: 'मैं तुमसे प्यार करता हूँ', expected: 'मैं/तुमसे/प्यार/करता/हूँ' },
        { text: 'Aku cinta kamu', expected: 'Aku/cinta/kamu' },
        { text: 'Herzschmerz und Sehnsucht', expected: 'Herzschmerz/und/Sehnsucht' },
        { text: 'Ich wünsch mir', expected: 'Ich/wünsch/mir' },
        { text: 'ຂ້ອຍຮັກເຈົ້າ', expected: 'ຂ້ອຍ/ຮັກ/ເຈົ້າ' },
        { text: 'ខ្ញុំស្រលាញ់អ្នក', expected: 'ខ្ញុំ/ស្រលាញ់/អ្នក' },
        { text: 'Em của ngày hôm qua', expected: 'Em/của/ngày/hôm/qua' },
    ],
    latin: [
        { text: "I don't wanna sleep tonight", expected: "I/don't/wanna/sleep/tonight" },
        { text: 'rock-and-roll never dies', expected: 'rock-and-roll/never/dies' },
        { text: 'a well‐known story', expected: 'a/well‐known/story' },
        { text: 'Dime que sí, mi amor', expected: 'Dime/que/sí/,/mi/amor' },
        { text: "c'est la vie", expected: "c'est/la/vie" },
        { text: 'café au lait', expected: 'café/au/lait' },
        { text: 'nine - five', expected: 'nine/-/five' },
    ],
    mixed: [
        { text: 'Baby 我想你想到失眠', expected: 'Baby/我/想/你/想到/失眠' },
        { text: '你是我的 sunshine 照亮我的心', expected: '你/是/我的/sunshine/照亮/我的/心' },
        { text: 'I love you 君が好き', expected: 'I/love/you/君が/好き' },
        { text: 'Never give up 明日へ', expected: 'Never/give/up/明日へ' },
        { text: '너를 사랑해 forever', expected: '너를/사랑해/forever' },
        { text: 'ฉันรักเธอ baby', expected: 'ฉัน/รัก/เธอ/baby' },
        { text: 'さよなら 再见了青春', expected: 'さよなら/再见了/青春' },
        { text: 'K-pop 和 J-pop', expected: 'K-pop/和/J-pop' },
    ],
    'lyric/vocables-and-labels': [
        { text: 'la la la', expected: 'la/la/la' },
        { text: 'Oh oh oh yeah', expected: 'Oh/oh/oh/yeah' },
        { text: '我等你 (等你)', expected: '我/等/你/(/等/你/)' },
        { text: '作词：林夕', expected: '作词/：/林夕' },
        { text: 'Rap: 我的梦想', expected: 'Rap/:/我的/梦想' },
    ],
    'lyric/marks-and-spacing': [
        { text: '好想你～', expected: '好想你/～' },
        { text: '会いたい〜', expected: '会いたい/〜' },
        { text: '再见了……', expected: '再见了/…/…' },
        { text: '我爱你　我想你', expected: '我爱你/我/想/你' },
        { text: 'hello   world', expected: 'hello/world' },
    ],
    punctuation: [
        { text: '你好，世界！', expected: '你好/，/世界/！' },
        { text: '「夢」を見た', expected: '「/夢/」/を/見た' },
        { text: '啊——', expected: '啊/—/—' },
        { text: '（间奏）', expected: '（/间奏/）' },
        { text: '爱你 ❤️ 永远', expected: '爱/你/❤️/永远' },
        { text: '2024 年的夏天', expected: '2024/年的/夏天' },
    ],
    unicode: [
        { text: '𠮷野家', expected: '𠮷/野家' },
        // 葛 + an ideographic variation selector: ICU keeps the pair as one piece, outside the run
        { text: '葛󠄀城的雨', expected: '葛󠄀/城的/雨' },
        { text: '我爱​你', expected: '我/爱/​/你' },
        { text: 'hello world', expected: 'hello/world' },
        { text: 'ＬＯＶＥ 你', expected: 'ＬＯＶＥ/你' },
        { text: '①我爱你', expected: '①/我爱你' },
        { text: '👨‍👩‍👧一家人', expected: '👨‍👩‍👧/一家人' },
    ],
};

export const KNOWN_GAPS: KnownGap[] = [
    {
        text: '我们看过的桜の花',
        current: '我们看过的桜の/花',
        wanted: '我们/看过的/桜の/花',
        why: 'Chinese and Japanese in one run with nothing between them: the kana sends the whole run to BudouX.',
    },
    {
        text: '桜の花びらが舞い落ちる夜に',
        current: '桜の/花びらが/舞い/落ちる/夜に',
        wanted: '桜の/花びらが/舞い落ちる/夜に',
        why: 'BudouX splits the compound verb 舞い落ちる; its model, not a rule of ours.',
    },
    {
        text: 'さよならの向こう側',
        current: 'さよならの/向こう/側',
        wanted: 'さよならの/向こう側',
        why: 'BudouX splits the compound noun 向こう側.',
    },
    {
        text: '雨上がりの空に虹がかかって君の笑顔を思い出した',
        current: '雨上がりの/空に/虹が/かかって/君の笑/顔を/思い出した',
        wanted: '雨上がりの/空に/虹が/かかって/君の/笑顔を/思い出した',
        why: 'BudouX cuts through 笑顔 in a long line.',
    },
    {
        text: '穿著那件外套',
        current: '穿著/那/件/外套',
        wanted: '穿著/那件/外套',
        why: 'A demonstrative and its measure word stay apart when jieba has no entry for the pair.',
    },
    {
        text: '喺夢裏見到你',
        current: '喺/夢/裏/見到/你',
        wanted: '喺/夢裏/見到/你',
        why: 'After an unknown Cantonese character jieba prefers 梦/里 over 梦里.',
    },
];
