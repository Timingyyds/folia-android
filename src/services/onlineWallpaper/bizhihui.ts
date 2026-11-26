import { decodeHtmlEntities, fetchWallpaperText, firstMatch } from './http';
import type { OnlineWallpaperItem, WallpaperCategory, WallpaperPage } from './types';

// src/services/onlineWallpaper/bizhihui.ts
// bizhihui.com：图片壁纸站，没有 JSON 接口，列表与详情都靠 HTML。
// 列表项是 `<a href="/p/{id}.html" title="...">` 加一张 CDN 缩略图；
// 详情页的原图在 og:image 里，站点会在文件名后加 `-arthumbs`，去掉才是原图。

const BIZHIHUI_BASE = 'https://www.bizhihui.com';

export const BIZHIHUI_CATEGORIES: WallpaperCategory[] = [
    { slug: 'tuijian', label: '精选推荐' },
    { slug: 'dongman', label: '卡通动漫' },
    { slug: 'renwu', label: '人物画照' },
    { slug: 'fengjing', label: '风景静物' },
    { slug: 'yingshi', label: '影视体育' },
    { slug: 'youxi', label: '游戏视觉' },
    { slug: 'meishi', label: '美食果蔬' },
    { slug: 'weimei', label: '唯美治愈' },
    { slug: 'mengchong', label: '动物萌宠' },
    { slug: 'yishu', label: '艺术绘画' },
    { slug: 'yuzhou', label: '宇宙星空' },
    { slug: 'keji', label: '军事科技' },
    { slug: 'jianyue', label: '简约主义' },
    { slug: 'jiche', label: '机车器械' },
    { slug: 'qita', label: '其它风格' },
];

export const bizhihuiListUrl = (page: number, category: string | null): string => {
    const safePage = Math.max(1, Math.floor(page));
    if (category) {
        return safePage <= 1
            ? `${BIZHIHUI_BASE}/${category}/?order=time`
            : `${BIZHIHUI_BASE}/${category}/${safePage}/?order=time`;
    }
    return safePage <= 1 ? `${BIZHIHUI_BASE}/` : `${BIZHIHUI_BASE}/page/${safePage}/`;
};

/** 站点给图片加的后缀（`-arthumbs` / `-pcthumbs`），去掉就是原图。 */
export const bizhihuiOriginalUrl = (url: string): string => (
    String(url || '').replace(/-(?:arthumbs|pcthumbs)(?=\.(?:jpe?g|png|webp|gif))/i, '')
);

const parseList = (html: string): OnlineWallpaperItem[] => {
    const items: OnlineWallpaperItem[] = [];
    const seen = new Set<string>();

    const push = (id: string, title: string, thumb: string, segment: string) => {
        if (!id || !thumb || seen.has(id)) return;
        seen.add(id);
        const resolutionMatch = /(\d{3,4})\s*[x×]\s*(\d{3,4})/.exec(segment);
        items.push({
            id: `bizhihui:${id}`,
            source: 'bizhihui',
            kind: 'image',
            title: decodeHtmlEntities(title) || `壁纸 ${id}`,
            thumbUrl: thumb.startsWith('//') ? `https:${thumb}` : thumb,
            pageUrl: `${BIZHIHUI_BASE}/p/${id}.html`,
            resolution: resolutionMatch ? `${resolutionMatch[1]}x${resolutionMatch[2]}` : undefined,
        });
    };

    // 缩略图卡片是 `<a class="item-img" href="/p/{id}.html" title="...">` 紧跟一张 CDN 图。
    // 只认这个锚点：页面里还有若干「相关推荐」的 /p/ 链接，按链接抠会把图和标题配错。
    const cardPattern = /<a\b[^>]*class="[^"]*\bitem-img\b[^"]*"[^>]*>/gi;
    let card: RegExpExecArray | null;
    while ((card = cardPattern.exec(html)) !== null) {
        const id = /\/p\/(\d+)\.html/i.exec(card[0])?.[1] ?? '';
        const segment = html.slice(card.index, Math.min(html.length, card.index + 1500));
        const thumb = firstMatch(segment, /<img\b[^>]*\bsrc="(https?:\/\/(?:aka\.doubaocdn\.com|s\.panlai\.com)\/[^"]+)"/i)
            || firstMatch(segment, /<img\b[^>]*\bsrc="([^"]+)"/i);
        const title = /<a\b[^>]*title="([^"]+)"/i.exec(card[0])?.[1]
            ?? /<img\b[^>]*alt="([^"]*)"/i.exec(segment)?.[1]
            ?? '';
        push(id, title, thumb, segment);
    }

    if (items.length === 0) {
        // 站点有的页面给相对地址（/p/123.html），有的给绝对地址；这里不再依赖卡片类名。
        const linkPattern = /<a\b[^>]*href="(?:https?:\/\/[^"\/]+)?\/p\/(\d+)\.html"[^>]*>/gi;
        let link: RegExpExecArray | null;
        while ((link = linkPattern.exec(html)) !== null) {
            const segment = html.slice(Math.max(0, link.index - 300), Math.min(html.length, link.index + 1200));
            const thumb = firstMatch(segment, /<img\b[^>]*\bsrc="(https?:\/\/(?:aka\.doubaocdn\.com|s\.panlai\.com)\/[^"]+)"/i)
                || firstMatch(segment, /<img\b[^>]*\bsrc="([^"]+)"/i);
            const title = /<a\b[^>]*title="([^"]+)"/i.exec(segment)?.[1]
                ?? /<img\b[^>]*alt="([^"]*)"/i.exec(segment)?.[1]
                ?? '';
            push(link[1], title, thumb, segment);
        }
    }

    return items;
};

export const fetchBizhihuiPage = async (page: number, category: string | null): Promise<WallpaperPage> => {
    const html = await fetchWallpaperText(bizhihuiListUrl(page, category), 'bizhihui');
    const items = parseList(html);
    return { items, hasMore: items.length >= 12 };
};

export type BizhihuiDownload = {
    downloadUrl: string;
    title: string;
    resolution: string;
    fileSize: string;
};

export const resolveBizhihuiDownload = async (pageUrl: string, fallbackTitle: string): Promise<BizhihuiDownload> => {
    const html = await fetchWallpaperText(pageUrl, 'bizhihui');
    const candidates = [
        firstMatch(html, /<meta\s+property="og:image"\s+content="([^"]+)"/i),
        firstMatch(html, /<img\b[^>]*class="[^"]*(?:img-lightbox|img-zoom-in)[^"]*"[^>]*src="([^"]+)"/i),
        firstMatch(html, /<img\b[^>]*src="(https:\/\/(?:aka\.doubaocdn\.com|s\.panlai\.com)\/[^"]+)"/i),
    ].filter(Boolean);
    const original = candidates.map(bizhihuiOriginalUrl).find(url => Boolean(url));
    if (!original) throw new Error('未找到原图地址');
    const title = decodeHtmlEntities(
        firstMatch(html, /<meta\s+property="og:title"\s+content="([^"]+)"/i)
        || firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i).replace(/<[^>]*>/g, '')
        || fallbackTitle,
    );
    const resolution = firstMatch(html, /(?:图片尺寸|壁纸分辨率)[：:]\s*(\d+\s*[x×]\s*\d+)/i).replace(/[×x]/, 'x').replace(/\s+/g, '');
    const fileSize = firstMatch(html, /文件大小[：:]\s*([\d.]+\s*[KMG]B?)/i);
    return {
        downloadUrl: original,
        title: title || fallbackTitle,
        resolution,
        fileSize,
    };
};
