// src/lib/coverPrewarm.ts
//
// 换歌时先把要显示的封面解码掉。
//
// 「一打开专辑封面就卡一下」的代价几乎都来自第一次解码 + 首次纹理上传：它原本发生在用户点开
// 封面的那一帧，正好撞上浮层/背景动画。换歌时提前解码（浏览器解码结果会缓存），点开那一刻就
// 只剩绘制，代价从「用户操作那一帧」挪到「本来就忙的换歌时刻」。
//
// 只预热、不持有引用，也不改变任何显示逻辑：解码失败最多回到原来的行为。

/** 只记住最近预热过的 URL，避免长会话里无限增长。 */
const PREWARM_CACHE_LIMIT = 32;
const prewarmed = new Set<string>();

export const prewarmCoverImage = (url: string | null | undefined): void => {
    if (!url || typeof Image === 'undefined') return;
    if (prewarmed.has(url)) return;
    prewarmed.add(url);
    while (prewarmed.size > PREWARM_CACHE_LIMIT) {
        const oldest = prewarmed.values().next().value;
        if (oldest === undefined) break;
        prewarmed.delete(oldest);
    }
    try {
        const image = new Image();
        // 让浏览器在后台解码，且不要和当前可见内容的加载抢带宽。
        image.decoding = 'async';
        (image as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'low';
        image.src = url;
        // decode() 在部分实现里不存在；有就等它把解码真正做完（结果进浏览器缓存）。
        void image.decode?.().catch(() => undefined);
    } catch {
        // 预热失败不影响正常显示。
    }
};

/** 测试用：清掉「已预热」记录。 */
export const resetCoverPrewarmCache = (): void => {
    prewarmed.clear();
};
