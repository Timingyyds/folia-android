import { BRAVAIS_LAYOUT_STORAGE_PREFIX } from './entry';

// src/library/suites/bravais/bravaisLayoutMemory.ts
// 每一层的布局记忆（设计稿 §10.8）：相机（视图中心）、缝的锚点（块边界的世界 x）、无限拼贴的起点 slot、
// 键盘焦点所在的 slot。放 sessionStorage 而不是组件状态：离开首页约 350ms 后 stage 卸载（B1），回来时按层恢复。
// 键前缀定义在 entry.ts（manifest 的 layout.forget 就在那里按会话键删掉，entry 不能静态 import 本模块）。
// 每次都直接读写 sessionStorage，不在内存里另存一份：forget 只删存储，不会留下一份过期的缓存。

export type BravaisLayoutRecord = {
    /** 视图中心（缝基准线下的世界点）。 */
    center: { x: number; y: number } | null;
    /** 缝的锚点（块边界的世界 x）。 */
    anchorX: number | null;
    /** 无限拼贴的起点 slot（显示第 1 项的那个）。 */
    startSlotKey: string | null;
    /** 离开时键盘焦点所在的 slot（返回时焦点回到当初被点的那张）。 */
    focusSlotKey: string | null;
};

export const EMPTY_BRAVAIS_LAYOUT: BravaisLayoutRecord = {
    center: null,
    anchorX: null,
    startSlotKey: null,
    focusSlotKey: null,
};

const storage = (): Storage | null => {
    try {
        return typeof sessionStorage === 'undefined' ? null : sessionStorage;
    } catch {
        return null;
    }
};

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const asString = (value: unknown) => (typeof value === 'string' && value ? value : null);

/** 解析一份记录；任何字段坏了就当没有（不让一份脏数据把相机扔到无穷远）。 */
export const parseBravaisLayoutRecord = (raw: string | null): BravaisLayoutRecord | null => {
    if (!raw) return null;
    try {
        const value = JSON.parse(raw) as Record<string, unknown>;
        if (!value || typeof value !== 'object') return null;
        const center = value.center as { x?: unknown; y?: unknown } | null | undefined;
        return {
            center: center && isFiniteNumber(center.x) && isFiniteNumber(center.y) ? { x: center.x, y: center.y } : null,
            anchorX: isFiniteNumber(value.anchorX) ? value.anchorX : null,
            startSlotKey: asString(value.startSlotKey),
            focusSlotKey: asString(value.focusSlotKey),
        };
    } catch {
        return null;
    }
};

export const readBravaisLayout = (sessionKey: string): BravaisLayoutRecord | null => (
    parseBravaisLayoutRecord(storage()?.getItem(BRAVAIS_LAYOUT_STORAGE_PREFIX + sessionKey) ?? null)
);

export const writeBravaisLayout = (sessionKey: string, record: BravaisLayoutRecord) => {
    try {
        storage()?.setItem(BRAVAIS_LAYOUT_STORAGE_PREFIX + sessionKey, JSON.stringify(record));
    } catch {
        // 配额满了或被禁用：布局记忆只是锦上添花。
    }
};
