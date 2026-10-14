import type { BravaisDisplay } from './bravaisDisplay';
import type { BravaisLayer } from './bravaisLayer';
import { detectRemovedEntries } from './bravaisRemoval';

// src/library/suites/bravais/bravaisDisplayUpdate.ts
// 同一层的数据更新（加载、补页、过滤、排序、移除、正在播放换了）该怎么换上墙，纯规则：
// - refresh：墙上的内容规则没变（只是缝里的东西、回调、正在播放 / 队列标记变了），不比较、不翻牌；
// - filter：进出有限态或过滤词变了——屏内内容变了的 slot 都翻，从缝的两侧边缘开始（设计稿 §7 转场表）；
// - removal：一次移除——先把消失的条目翻成墙面、翻完再换上新数据（展示层按住旧帧，bravaisRemoval）；
// - update：其余（数据到达、补页、排序、换日期、重新拉取）只翻变了的 slot，从起点磁贴或缝开始。

export type BravaisDataUpdate =
    | { kind: 'refresh' }
    | { kind: 'filter' }
    | { kind: 'removal'; removed: ReadonlySet<string> }
    | { kind: 'update' };

const sameWall = (a: BravaisLayer['wall'], b: BravaisLayer['wall']) => (
    (a?.periodCount ?? 0) === (b?.periodCount ?? 0)
    && (a?.planCount ?? 0) === (b?.planCount ?? 0)
    && (a?.filterKey ?? '') === (b?.filterKey ?? '')
);

export const decideDataUpdate = (previous: BravaisDisplay, layer: BravaisLayer): BravaisDataUpdate => {
    const before = previous.layer;
    if (before.items === layer.items && before.mode === layer.mode && sameWall(before.wall, layer.wall)) return { kind: 'refresh' };
    if (before.mode !== layer.mode || (before.wall?.filterKey ?? '') !== (layer.wall?.filterKey ?? '')) return { kind: 'filter' };
    const removed = detectRemovedEntries(before.items, layer.items);
    return removed ? { kind: 'removal', removed } : { kind: 'update' };
};
