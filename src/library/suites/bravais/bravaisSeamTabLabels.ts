// src/library/suites/bravais/bravaisSeamTabLabels.ts
// 首页窄缝页签的「一个字」短形（fb2）：纵向放不下全名时，页签缩成一个字，全名留在 title / aria-label。
// 不加 locale key，从已翻译的全名推：取第一个字素（Intl.Segmenter），拉丁字母转大写——
// 中文「歌单 / 电台 / 专辑 / 本地」→「歌 / 电 / 专 / 本」，「Navi」→「N」；英文 Playlists / Radio / Albums / Folder / Navi
// → P / R / A / F / N，印尼文 Playlist / Radio / Album / Folder / Navi 同样。短形撞车时（两个页签同一个首字）撞车的
// 那几个改取前两个字素，仍然很短、但分得开。

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/** 全名的前 n 个字素（去掉首尾空白）。 */
const leadingGraphemes = (label: string, count: number): string => {
    const text = label.trim();
    const graphemes = segmenter ? Array.from(segmenter.segment(text), part => part.segment) : Array.from(text);
    return graphemes.slice(0, count).join('');
};

/** 一个页签的短形：第一个字素，字母转大写（中日韩字不受影响）。 */
export const abbreviateSeamTabLabel = (label: string, length = 1): string => {
    const head = leadingGraphemes(label, length);
    return head.charAt(0).toLocaleUpperCase() + head.slice(1);
};

/** 一组页签的短形（与输入同序）：撞车的改取两个字素。 */
export const abbreviateSeamTabLabels = (labels: readonly string[]): string[] => {
    const shorts = labels.map(label => abbreviateSeamTabLabel(label));
    const counts = new Map<string, number>();
    for (const short of shorts) counts.set(short, (counts.get(short) ?? 0) + 1);
    return shorts.map((short, index) => ((counts.get(short) ?? 0) > 1 ? abbreviateSeamTabLabel(labels[index]!, 2) : short));
};
