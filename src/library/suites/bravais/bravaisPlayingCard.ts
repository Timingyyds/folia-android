// src/library/suites/bravais/bravaisPlayingCard.ts
// 「从墙上播放」之后要保持展开的那张聚焦卡（实测反馈 fb3）：记的是层 key + 条目 key（不是 slot：回来时墙可能换了起点、
// 循环偏移，同一首在别的位置），回到这一层时展开正在播放的那首。全局只记一份（同一时间只有一张聚焦卡）。
// 放 sessionStorage 而不是组件状态：播放后进入播放页 / Lattice，离开首页约 350ms 后 stage 卸载（B1），回来时重新挂载。
// 每次都直接读写存储，不在内存里另存一份（与 bravaisLayoutMemory 同一个做法）。

export type BravaisPlayingCard = {
    /** 播放时所在的层（BravaisLayer.key）。 */
    layerKey: string;
    /** 播放的那一项（BravaisItem.key）。 */
    entryKey: string;
};

export const BRAVAIS_PLAYING_CARD_STORAGE_KEY = 'folia_bravais_playing_card:v1';

const storage = (): Storage | null => {
    try {
        return typeof sessionStorage === 'undefined' ? null : sessionStorage;
    } catch {
        return null;
    }
};

/** 解析一份记录；任何字段坏了就当没有。 */
export const parseBravaisPlayingCard = (raw: string | null): BravaisPlayingCard | null => {
    if (!raw) return null;
    try {
        const value = JSON.parse(raw) as Record<string, unknown>;
        if (!value || typeof value !== 'object') return null;
        const { layerKey, entryKey } = value;
        return typeof layerKey === 'string' && layerKey && typeof entryKey === 'string' && entryKey
            ? { layerKey, entryKey }
            : null;
    } catch {
        return null;
    }
};

export const readBravaisPlayingCard = (): BravaisPlayingCard | null => {
    try {
        return parseBravaisPlayingCard(storage()?.getItem(BRAVAIS_PLAYING_CARD_STORAGE_KEY) ?? null);
    } catch {
        return null;
    }
};

/** 从墙上播放了这一项（或回来时正在播放的换成了同一层里的另一首）：记下它。 */
export const armBravaisPlayingCard = (layerKey: string, entryKey: string) => {
    try {
        storage()?.setItem(BRAVAIS_PLAYING_CARD_STORAGE_KEY, JSON.stringify({ layerKey, entryKey }));
    } catch {
        // 配额满了或被禁用：回来时不展开而已。
    }
};

/** 用户自己收起了那张卡、或展开了别的歌：不再保持。 */
export const disarmBravaisPlayingCard = () => {
    try {
        storage()?.removeItem(BRAVAIS_PLAYING_CARD_STORAGE_KEY);
    } catch {
        // 同上。
    }
};
