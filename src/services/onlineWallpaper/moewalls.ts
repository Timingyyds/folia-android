import { attributeOf, decodeHtmlEntities, fetchWallpaperText, firstMatch, stripTags } from './http';
import type { OnlineWallpaperItem, WallpaperCategory, WallpaperPage } from './types';

// src/services/onlineWallpaper/moewalls.ts
// moewalls.com：WordPress + bimber 主题的视频壁纸站。
// 列表页的卡片是 `<a class="g1-frame" title="..." href="...">`，缩略图带 `-thumb-364x205.jpg`；
// 详情页的下载按钮是 `<a id="moe-download" data-url="...">`，真正的下载地址在 go.moewalls.com。

const MOEWALLS_BASE = 'https://moewalls.com';
const MOEWALLS_DOWNLOAD_BASE = 'https://go.moewalls.com';

/** 站点分类（slug 与站点一致，label 用站点里的中文习惯叫法）。 */
export const MOEWALLS_CATEGORIES: WallpaperCategory[] = [
    { slug: 'abstract', label: '抽象' },
    { slug: 'animal', label: '动物' },
    { slug: 'anime', label: '动漫' },
    { slug: 'fantasy', label: '奇幻' },
    { slug: 'games', label: '游戏' },
    { slug: 'landscape', label: '风景' },
    { slug: 'nature', label: '自然' },
    { slug: 'space', label: '太空' },
    { slug: 'neon', label: '霓虹' },
    { slug: 'cyberpunk', label: '赛博朋克' },
    { slug: 'girls', label: '女孩' },
    { slug: 'boys', label: '男孩' },
    { slug: 'movies', label: '影视' },
    { slug: 'cars', label: '汽车' },
    { slug: 'flowers', label: '花卉' },
    { slug: 'water', label: '水流' },
    { slug: 'fire', label: '火焰' },
    { slug: 'rain', label: '雨天' },
    { slug: 'snow', label: '雪景' },
    { slug: 'holiday', label: '节日' },
];

export const moewallsListUrl = (page: number, category: string | null): string => {
    const safePage = Math.max(1, Math.floor(page));
    if (category) {
        return safePage <= 1
            ? `${MOEWALLS_BASE}/${category}/`
            : `${MOEWALLS_BASE}/${category}/page/${safePage}/`;
    }
    return safePage <= 1 ? `${MOEWALLS_BASE}/` : `${MOEWALLS_BASE}/page/${safePage}/`;
};

/** 卡片的缩略图可能写在 data-src（懒加载），优先取它。 */
const readThumb = (segment: string): string => (
    firstMatch(segment, /<img\b[^>]*\bdata-src="([^"]+)"/i)
    || firstMatch(segment, /<img\b[^>]*\bsrc="([^"]+)"/i)
);

const idFromUrl = (url: string, fallback: string): string => {
    const cleaned = url.replace(/[?#].*$/, '').replace(/\/+$/, '');
    const slug = cleaned.substring(cleaned.lastIndexOf('/') + 1);
    return slug || fallback;
};

const resolutionIn = (segment: string): string => {
    const classMatch = /resolutions-(\d{3,4}x\d{3,4})/i.exec(segment);
    if (classMatch) return classMatch[1];
    const textMatch = /(\d{3,4})\s*[x×]\s*(\d{3,4})/.exec(stripTags(segment));
    return textMatch ? `${textMatch[1]}x${textMatch[2]}` : '';
};

/**
 * 解析列表页。优先按 g1-frame 卡片取，找不到时退回 WordPress 的 article 结构，
 * 站点换主题后至少还能读到一半，而不是整页空白。
 */
const parseList = (html: string): OnlineWallpaperItem[] => {
    const items: OnlineWallpaperItem[] = [];
    const seen = new Set<string>();

    const push = (title: string, href: string, thumb: string, segment: string) => {
        if (!href || seen.has(href)) return;
        seen.add(href);
        const absolute = href.startsWith('http') ? href : `${MOEWALLS_BASE}${href.startsWith('/') ? '' : '/'}${href}`;
        const slug = idFromUrl(absolute, `moewalls-${items.length}`);
        items.push({
            id: `moewalls:${slug}`,
            source: 'moewalls',
            kind: 'video',
            title: decodeHtmlEntities(title) || slug.replace(/-live-wallpaper$/i, '').replace(/-/g, ' '),
            thumbUrl: thumb,
            pageUrl: absolute,
            resolution: resolutionIn(segment) || undefined,
        });
    };

    const framePattern = /<a\b[^>]*class="[^"]*\bg1-frame\b[^"]*"[^>]*>/gi;
    let frame: RegExpExecArray | null;
    while ((frame = framePattern.exec(html)) !== null) {
        const tag = frame[0];
        const href = attributeOf(tag, 'href');
        const title = attributeOf(tag, 'title');
        // 卡片里的图片在这个 <a> 之后，截到闭合标签足够。
        const close = html.indexOf('</a>', frame.index);
        const segment = html.slice(frame.index, close > 0 ? close : frame.index + 1600);
        const thumb = readThumb(segment);
        if (href) push(title, href, thumb, segment);
    }

    if (items.length === 0) {
        const articlePattern = /<article\b[^>]*class="[^"]*entry-tpl-grid[^"]*"[^>]*>/gi;
        let article: RegExpExecArray | null;
        while ((article = articlePattern.exec(html)) !== null) {
            const close = html.indexOf('</article>', article.index);
            const segment = html.slice(article.index, close > 0 ? close : article.index + 6000);
            const anchor = firstMatch(segment, /<div class="entry-featured-media[^"]*"[^>]*>\s*<a\b[^>]*>/i)
                || firstMatch(segment, /<a\b[^>]*class="[^"]*entry-featured-media[^"]*"[^>]*>/i)
                || firstMatch(segment, /<a\b[^>]*\btitle="[^"]*"[^>]*>/i);
            const href = attributeOf(anchor || segment, 'href');
            const title = attributeOf(anchor || segment, 'title');
            const thumb = readThumb(segment);
            if (href) push(title, href, thumb, segment);
        }
    }

    return items;
};

export const fetchMoewallsPage = async (page: number, category: string | null): Promise<WallpaperPage> => {
    const html = await fetchWallpaperText(moewallsListUrl(page, category), 'moewalls');
    const items = parseList(html);
    // 一页通常 12–24 条；少于 6 条基本就是最后一页了（站点没有可靠的页数接口）。
    return { items, hasMore: items.length >= 6 };
};

export type MoewallsDownload = {
    downloadUrl: string;
    title: string;
    resolution: string;
    fileSize: string;
};

/** 详情页里的下载地址：`data-url` 已经是编码好的 token，只能原样拼接，不能再编码一次。 */
export const resolveMoewallsDownload = async (pageUrl: string, fallbackTitle: string): Promise<MoewallsDownload> => {
    const html = await fetchWallpaperText(pageUrl, 'moewalls');
    const anchorTag = /<a\b[^>]*\bid="moe-download"[^>]*>/i.exec(html)?.[0] ?? '';
    const dataUrl = attributeOf(anchorTag, 'data-url')
        || firstMatch(html, /\bdata-url="([^"]+)"/i);
    if (!dataUrl) throw new Error('未找到下载链接');
    const title = decodeHtmlEntities(
        firstMatch(html, /<meta\s+property="og:title"\s+content="([^"]+)"/i)
        || firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i).replace(/<[^>]*>/g, '')
        || fallbackTitle,
    );
    const resolution = stripTags(firstMatch(html, /<em>\s*Resolution\s*<\/em>\s*([^<]+)/i));
    const fileSize = stripTags(firstMatch(html, /<em>\s*File Size\s*<\/em>\s*([^<]+)/i));
    return {
        downloadUrl: `${MOEWALLS_DOWNLOAD_BASE}/download.php?video=${dataUrl}`,
        title: title || fallbackTitle,
        resolution,
        fileSize,
    };
};
