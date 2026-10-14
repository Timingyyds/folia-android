import type { BravaisDisplay } from './bravaisDisplay';
import type { BravaisItem } from './bravaisLayer';

// src/library/suites/bravais/bravaisRemoval.ts
// remove-entry 在墙上的两段翻牌（设计稿 §10.2「remove-entry」）：
// 1. 被删的那一项（聚焦卡先收起）所在的 slot 翻成墙面——旧帧按住，只把它遮掉；
// 2. 翻完以后换上新数据，后面的 rank 依次前移一格，从那个 slot 向外错开翻牌（严格 rank 的自然结果）。
// core 不等动画：控制器确认后立即提交给资源，只是展示层在第一段期间沿用旧的条目列表。这里是判断「这次数据更新是不是
// 一次移除」与第一段显示的纯规则；同一首的重复条目（在线歌单上游按歌删）会一起消失，每日推荐的「不喜欢」原位换一首。

/** 一次更新里最多这么多条消失才算「移除」；再多是重新拉取、换日期一类的整表替换，直接翻。 */
export const MAX_REMOVED_ENTRIES = 4;

/**
 * 前后两份条目列表之间是不是一次移除：有 1..MAX 条消失，新增的不多于消失的（每日推荐的「不喜欢」会补一首），
 * 留下来的条目相对顺序不变。是就返回消失的条目 key，否则 null。
 */
export const detectRemovedEntries = (
    before: readonly BravaisItem[],
    after: readonly BravaisItem[],
): ReadonlySet<string> | null => {
    if (before === after || before.length === 0) return null;
    const afterKeys = new Set(after.map(item => item.key));
    const beforeKeys = new Set(before.map(item => item.key));
    const removed = new Set(before.filter(item => !afterKeys.has(item.key)).map(item => item.key));
    if (removed.size === 0 || removed.size > MAX_REMOVED_ENTRIES) return null;
    const added = after.filter(item => !beforeKeys.has(item.key)).length;
    if (added > removed.size) return null;
    const kept = before.filter(item => afterKeys.has(item.key)).map(item => item.key);
    const keptAfter = after.filter(item => beforeKeys.has(item.key)).map(item => item.key);
    if (kept.length !== keptAfter.length || kept.some((key, index) => keptAfter[index] !== key)) return null;
    return removed;
};

/** 第一段的显示：还是旧帧，只是消失的条目翻成墙面。 */
export const maskRemovedEntries = (display: BravaisDisplay, removed: ReadonlySet<string>): BravaisDisplay => ({
    ...display,
    hiddenKeys: removed,
});
