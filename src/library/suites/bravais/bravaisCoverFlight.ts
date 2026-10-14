import { getCoverIdentity, getSizedCoverUrl } from '../../../lib/coverUrl';

// src/library/suites/bravais/bravaisCoverFlight.ts
// 歌手页 ↔ 专辑页的封面飞行：点开专辑时，被点的那张专辑磁贴的封面飞到专辑海报上封面的位置（连同墙的倾斜，落到海报
// 封面自己的角度）；从这张专辑返回时，海报上的封面飞回墙上原来那一格。
// - 飞的是一张盖在最上面的 fixed 图（document.body 里），不碰墙与海报的 DOM 结构；去程时海报自己的封面先藏着，落地才露出来。
// - 一段到底：飞行的图在路上就变成海报封面的样子（同一张图，墨色硬阴影跟着长出来），落地同一帧换成海报自己的封面。
// - 两头都可能在动（相机补间、缝张开、倾斜），所以每帧重新量终点（measureQuad：在元素的三个角放零尺寸探针，读出屏幕上的
//   角点，倾斜与缩放都算在内），起点是出发那一刻量好的。
// - 去程的起点在点磁贴时记下（noteCoverFlightSource），海报挂载时取走（1.5s 内、封面相同才算）；回程按记下的 slot 找墙上
//   那一格（返回时墙按记忆恢复，原来那一格还是这张专辑）。
// - 降低动态效果（lattice）时不飞。

type Point = { x: number; y: number };
/** 元素在屏幕上的样子：中心、宽高（元素自己的坐标系里，已乘上缩放）、角度（弧度）。 */
export type BravaisQuad = { center: Point; width: number; height: number; angle: number };

const FLIGHT_MS = 640;
const BACK_FLIGHT_MS = 560;
const SOURCE_TTL_MS = 1500;
const BACK_WAIT_MS = 900;
const BASE_PX = 512;

const reducedMotion = () => (document.documentElement.dataset.reduceMotion ?? '').split(/\s+/).includes('lattice');

/**
 * 元素三个角在屏幕上的位置 → 中心、宽高、角度。元素要是定位元素（探针按 absolute 放）。
 * 三个探针一起挂上、一起读、一起撤：一次测量只强制排一次版（飞行每帧都在量）。read 在探针还挂着、排版刚算完时调，
 * 顺手读的样式与尺寸不会再触发一次排版。
 */
const measureQuadWith = <T,>(element: Element, read: () => T): [BravaisQuad | null, T | null] => {
    if (!element.isConnected) return [null, null];
    const probes = [['0', '0'], ['100%', '0'], ['0', '100%']].map(([left, top]) => {
        const span = document.createElement('span');
        span.style.cssText = `position:absolute;left:${left};top:${top};width:0;height:0;margin:0;padding:0;border:0;pointer-events:none;`;
        element.appendChild(span);
        return span;
    });
    const [a, b, c] = probes.map(span => {
        const rect = span.getBoundingClientRect();
        return { x: rect.left, y: rect.top };
    });
    const extra = read();
    probes.forEach(span => span.remove());
    const width = Math.hypot(b.x - a.x, b.y - a.y);
    const height = Math.hypot(c.x - a.x, c.y - a.y);
    if (width < 1 || height < 1) return [null, extra];
    return [{
        center: { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 },
        width,
        height,
        angle: Math.atan2(b.y - a.y, b.x - a.x),
    }, extra];
};

export const measureQuad = (element: Element): BravaisQuad | null => measureQuadWith(element, () => null)[0];

/** 两个状态之间插值（角度走最近的那一边）。 */
export const lerpQuad = (from: BravaisQuad, to: BravaisQuad, t: number): BravaisQuad => {
    let turn = to.angle - from.angle;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    const mix = (a: number, b: number) => a + (b - a) * t;
    return {
        center: { x: mix(from.center.x, to.center.x), y: mix(from.center.y, to.center.y) },
        width: mix(from.width, to.width),
        height: mix(from.height, to.height),
        angle: from.angle + turn * t,
    };
};

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

type Flight = { stop: () => void };
let current: Flight | null = null;

/** 封面下面那道硬阴影（海报封面的墨色阴影，元素自己坐标系里的偏移）。 */
export type BravaisHardShadow = { offset: number; color: string };
const NO_SHADOW: BravaisHardShadow = { offset: 0, color: 'transparent' };

/**
 * 飞一次：from 是固定的起点，target() 每帧给出终点（null = 终点没了，停在最后量到的地方）。
 * 一段到底，没有「飞到 → 再融合」的第二段：硬阴影从 shadow.from 一路变到 shadow.to，飞行中间叠一层抬起的软阴影；
 * - landing = 'swap'（去程）：终点长得和飞行的图一模一样（同一张图、同一道阴影），等终点的图解码好（最多再等 400ms），
 *   onDone 同步把终点露出来，下一帧撤掉飞行的图，中间没有淡入淡出；
 * - landing = 'fade'（回程）：终点是带标题的磁贴，和飞行的图不一样。飞到后等那一格换好内容，onDone 让它直接停在
 *   原位（结束它还没放完的落回），飞行的图再在它上面淡掉——封面就是这一格的入场，之后不会再落一次。
 */
const fly = ({ url, from, target, duration, shadow, landing, ready, lost, onDone }: {
    url: string;
    from: BravaisQuad;
    target: () => BravaisQuad | null;
    duration: number;
    /** 终点那头可以是函数（每帧量：海报刚挂载时还没缩放到位，开始时量的不准）；拿到的是这一帧量好的终点。 */
    shadow: { from: BravaisHardShadow; to: BravaisHardShadow | ((quad: BravaisQuad) => BravaisHardShadow) };
    landing: 'swap' | 'fade';
    /** swap：终点的图解码好了没有；fade：终点（墙上那一格）换好内容了没有。 */
    ready?: () => boolean;
    /** 终点没了、不会再回来（去程飞到一半就返回了）：飞行的图就地淡掉，不调 onDone。 */
    lost?: () => boolean;
    onDone?: () => void;
}) => {
    current?.stop();
    const image = document.createElement('div');
    image.className = 'bravais-cover-flight';
    image.setAttribute('aria-hidden', 'true');
    image.dataset.bravaisCoverFlight = '';
    image.style.cssText = `position:fixed;left:0;top:0;width:${BASE_PX}px;height:${BASE_PX}px;z-index:2147483000;pointer-events:none;`
        + `background:#222 center/cover no-repeat url("${getSizedCoverUrl(url, BASE_PX) || url}");transform-origin:0 0;will-change:transform;`;
    document.body.appendChild(image);
    const startedAt = performance.now();
    let frame = 0;
    let last = from;
    let finished = false;
    const remove = () => {
        image.remove();
        if (current === flight) current = null;
    };
    const finish = () => {
        if (finished) return;
        finished = true;
        cancelAnimationFrame(frame);
        try {
            onDone?.();
        } catch (error) {
            // 落地出错也要把飞行的图撤掉（它盖在最上层，留下来就一直挡着）。
            console.error(error);
        }
        if (landing === 'fade') {
            // 终点已经停好（onDone 里结束了它的入场），飞行的图在它上面淡掉。
            const fade = image.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-out', fill: 'forwards' });
            fade.onfinish = remove;
            return;
        }
        // 终点已经露出来（同一帧），下一帧再撤，不会空一帧。
        requestAnimationFrame(remove);
    };
    let shadowTo = typeof shadow.to === 'function' ? shadow.from : shadow.to;
    const draw = (quad: BravaisQuad, t: number) => {
        const lift = Math.sin(Math.PI * t);
        const to = shadowTo;
        const hard = shadow.from.offset + (to.offset - shadow.from.offset) * t;
        const color = t < 0.5 ? shadow.from.color : to.color;
        const alpha = Math.round((t < 0.5 ? 1 - t * 2 : t * 2 - 1) * 100);
        // 宽高直接写（不按比例拉伸）：起点与终点比例不同时封面按 cover 裁切，不变形。
        image.style.width = `${quad.width}px`;
        image.style.height = `${quad.height}px`;
        image.style.transform = `translate(${quad.center.x}px, ${quad.center.y}px) rotate(${quad.angle}rad) scale(${1 + lift * 0.05}) translate(-50%, -50%)`;
        image.style.boxShadow = `${hard}px ${hard}px 0 color-mix(in srgb, ${color} ${alpha}%, transparent), `
            + `${lift * 10}px ${lift * 16}px ${lift * 30}px rgba(0,0,0,${(lift * 0.4).toFixed(3)})`;
    };
    const abandon = () => {
        finished = true;
        cancelAnimationFrame(frame);
        const fade = image.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'ease-out', fill: 'forwards' });
        fade.onfinish = remove;
    };
    const step = (now: number) => {
        if (lost?.()) {
            abandon();
            return;
        }
        const elapsed = now - startedAt;
        const t = Math.min(1, elapsed / duration);
        const to = target() ?? last;
        last = to;
        if (typeof shadow.to === 'function') shadowTo = shadow.to(to);
        draw(lerpQuad(from, to, easeInOut(t)), easeInOut(t));
        const waiting = ready && !ready() && elapsed < duration + 600;
        if (t >= 1 && !waiting) finish();
        else frame = requestAnimationFrame(step);
    };
    const flight: Flight = { stop: finish };
    current = flight;
    draw(from, 0);
    frame = requestAnimationFrame(step);
    return flight;
};

/** 海报封面 ::before 那道硬阴影的偏移（元素自己的像素）与颜色，加上元素的布局宽度（换算成屏幕上的缩放用）。 */
const readCoverShadowStyle = (cover: HTMLElement) => {
    const before = getComputedStyle(cover, '::before');
    const match = /matrix\(([^)]+)\)/.exec(before.transform);
    return {
        offset: match ? Number(match[1].split(',')[4]) || 0 : 0,
        color: before.backgroundColor || 'transparent',
        layoutWidth: cover.offsetWidth,
    };
};

/**
 * 海报封面的那道硬阴影（::before 的偏移与颜色，按元素此刻在屏幕上的缩放换算）。quad 是已经量好的封面（飞行每帧
 * 刚量过）：直接用它的宽度算缩放，样式也不用再单独排一次版去读；没给就自己量，读样式顺带在量的时候。
 */
export const readCoverShadow = (cover: HTMLElement, quad?: BravaisQuad | null): BravaisHardShadow => {
    const [measured, style] = quad === undefined
        ? measureQuadWith(cover, () => readCoverShadowStyle(cover))
        : [quad, readCoverShadowStyle(cover)];
    const scale = measured && style?.layoutWidth ? measured.width / style.layoutWidth : 1;
    return { offset: (style?.offset ?? 0) * scale, color: style?.color ?? 'transparent' };
};

/** 键盘焦点在那一格上时它放大一圈（bravais.css 的 --bravais-pop-x / -y）：飞回去落到放大后的大小。 */
const withFocusPop = (tile: HTMLElement, quad: BravaisQuad | null): BravaisQuad | null => {
    if (!quad || !tile.hasAttribute('data-bravais-focused')) return quad;
    const popX = Number(tile.style.getPropertyValue('--bravais-pop-x')) || 1;
    const popY = Number(tile.style.getPropertyValue('--bravais-pop-y')) || 1;
    return { ...quad, width: quad.width * popX, height: quad.height * popY };
};

/** background-size 的第一层 → 封面在面板里画多大（封面按正方形算）。 */
const drawnCoverSize = (size: string, width: number, height: number): [number, number] => {
    const [a = 'auto', b = 'auto'] = size.split(',')[0].trim().split(/\s+/);
    // 铺满：画面就是整块面板（飞行层自己也按 cover 铺，同一块框里两边裁得一样）。
    if (a === 'cover') return [width, height];
    if (a === 'contain') return [Math.min(width, height), Math.min(width, height)];
    const length = (token: string, of: number) => (
        token.endsWith('%') ? (of * parseFloat(token)) / 100 : token.endsWith('px') ? parseFloat(token) : null
    );
    const w = length(a, width);
    const h = length(b, height);
    if (w !== null && h !== null) return [w, h];
    if (w !== null) return [w, w];
    if (h !== null) return [h, h];
    return [width, height];
};

/** background-position 的一个分量 → 离面板边多远（剩余空间 free）。 */
const coverOffset = (token: string | undefined, free: number) => {
    if (!token || token === 'center') return free / 2;
    if (token === 'left' || token === 'top') return 0;
    if (token === 'right' || token === 'bottom') return free;
    if (token.endsWith('%')) return (free * parseFloat(token)) / 100;
    return parseFloat(token) || 0;
};

/**
 * 磁贴上封面实际画出来的那一块：铺满裁切时就是整块面板；封面只占其中一块时（不铺满的 background-size），飞行要从
 * 这一块起飞、落回这一块，不然整格当封面，长宽比一路在变。按面板的 background-size / -position 算（布局尺寸，不含变换），焦点放大另外乘上。
 */
const tileCoverQuad = (tile: HTMLElement): BravaisQuad | null => {
    const face = tile.querySelector<HTMLElement>('.bravais-tile-face');
    // 面板的样式与布局尺寸在探针挂着时一起读（同一次排版）。
    const [quad, layout] = measureQuadWith(tile, () => (face ? {
        style: getComputedStyle(face),
        tileW: tile.offsetWidth,
        tileH: tile.offsetHeight,
        faceW: face.offsetWidth,
        faceH: face.offsetHeight,
        faceX: face.offsetLeft,
        faceY: face.offsetTop,
    } : null));
    if (!quad || !layout || !layout.tileW || !layout.tileH || !layout.faceW || !layout.faceH) {
        return withFocusPop(tile, quad);
    }
    const { style, tileW, tileH, faceW, faceH, faceX, faceY } = layout;
    const [w, h] = style.backgroundImage === 'none' ? [faceW, faceH] : drawnCoverSize(style.backgroundSize, faceW, faceH);
    const [px, py] = style.backgroundPosition.split(',')[0].trim().split(/\s+/);
    const focused = tile.hasAttribute('data-bravais-focused');
    const popX = focused ? Number(tile.style.getPropertyValue('--bravais-pop-x')) || 1 : 1;
    const popY = focused ? Number(tile.style.getPropertyValue('--bravais-pop-y')) || 1 : 1;
    // 面板绕自己的中心放大：封面中心离面板中心的距离一起放大。
    const faceCx = faceX + faceW / 2;
    const faceCy = faceY + faceH / 2;
    const cx = faceCx + (coverOffset(px, faceW - w) + w / 2 - faceW / 2) * popX;
    const cy = faceCy + (coverOffset(py, faceH - h) + h / 2 - faceH / 2) * popY;
    const scale = quad.width / tileW;
    const dx = (cx - tileW / 2) * scale;
    const dy = (cy - tileH / 2) * scale;
    const cos = Math.cos(quad.angle);
    const sin = Math.sin(quad.angle);
    return {
        center: { x: quad.center.x + dx * cos - dy * sin, y: quad.center.y + dx * sin + dy * cos },
        width: w * popX * scale,
        height: h * popY * scale,
        angle: quad.angle,
    };
};

// ---- 去程：点专辑磁贴 → 专辑海报 ----

type Source = { cardKey: string; slotKey: string; coverUrl: string; quad: BravaisQuad; at: number };
let source: Source | null = null;

/** 点了一张专辑磁贴：记下它此刻的样子（真正打开专辑时海报来取）。 */
export const noteCoverFlightSource = (tile: Element, cardKey: string, slotKey: string, coverUrl: string | undefined) => {
    if (!coverUrl) return;
    const quad = tile instanceof HTMLElement ? tileCoverQuad(tile) : measureQuad(tile);
    source = quad ? { cardKey, slotKey, coverUrl, quad, at: performance.now() } : null;
};

/** 专辑海报挂载：封面相同、刚点过的，取走它。 */
export const takeCoverFlightSource = (coverUrl: string | undefined): Source | null => {
    const taken = source;
    source = null;
    if (!taken || !coverUrl || reducedMotion()) return null;
    if (performance.now() - taken.at > SOURCE_TTL_MS) return null;
    return getCoverIdentity(taken.coverUrl) === getCoverIdentity(coverUrl) ? taken : null;
};

/** 从起点飞到海报上的封面（每帧量它）；落地时 onLand 同步让海报露出自己的封面。 */
export const flyCoverToPoster = (from: Source, cover: HTMLElement, onLand: () => void) => fly({
    url: from.coverUrl,
    from: from.quad,
    target: () => measureQuad(cover),
    duration: FLIGHT_MS,
    shadow: { from: NO_SHADOW, to: quad => readCoverShadow(cover, quad) },
    landing: 'swap',
    lost: () => !cover.isConnected,
    ready: () => {
        const image = cover.querySelector('img');
        return !image || (image.complete && image.naturalWidth > 0);
    },
    onDone: onLand,
});

// ---- 回程：专辑海报 → 墙上原来那一格 ----

type BackOrigin = { slotKey: string; cardKey: string };
let parkedBackOrigin: { layerKey: string; origin: BackOrigin } | null = null;

/** 海报卸载了但还在这张专辑上（开过滤、收起缝、开面板）：记下回程的终点，海报回来时接着用。 */
export const parkCoverBackOrigin = (layerKey: string, origin: BackOrigin) => {
    parkedBackOrigin = { layerKey, origin };
};

/** 海报挂载：同一张专辑之前记下的回程终点（换了专辑就作废）。 */
export const takeParkedCoverBackOrigin = (layerKey: string): BackOrigin | null => {
    const parked = parkedBackOrigin;
    parkedBackOrigin = null;
    return parked?.layerKey === layerKey ? parked.origin : null;
};

/**
 * 海报卸载时调。起点用海报事先量好的封面样子（from）——卸载那一刻换层已经开始，海报的布局不可靠。下一帧封面真的不在了
 * （不是开发模式下 effect 重跑）才出发，等墙上那一格出现（换层后 slot 重新渲染），飞回去。
 */
export const flyCoverBack = ({ cover, from, shadow, slotKey, cardKey, coverUrl }: {
    cover: Element;
    cardKey: string;
    from: BravaisQuad;
    shadow: BravaisHardShadow;
    slotKey: string;
    coverUrl: string;
}) => {
    if (reducedMotion()) return;
    const find = () => document.querySelector(`.bravais-tile[data-bravais-slot="${CSS.escape(slotKey)}"]`);
    const startedAt = performance.now();
    const wait = () => {
        if (cover.isConnected) return;
        const tile = find();
        if (tile instanceof HTMLElement) {
            const face = () => tile.querySelector<HTMLElement>('.bravais-tile-face');
            fly({
                url: coverUrl,
                from,
                target: () => (tile.isConnected ? tileCoverQuad(tile) : null),
                duration: BACK_FLIGHT_MS,
                shadow: { from: shadow, to: NO_SHADOW },
                landing: 'fade',
                // 那一格的内容换成这张专辑了（整墙波次在抬起时换内容）。
                ready: () => tile.dataset.libraryCard === cardKey,
                onDone: () => {
                    // 等到超时那一格也没换成这张专辑（去了别的墙）：别动它的动画，飞行的图淡掉就好。
                    if (tile.dataset.libraryCard !== cardKey) return;
                    face()?.getAnimations().forEach(animation => {
                        // 无限循环的动画（加载中的呼吸）finish() 会抛错，跳过。
                        if (animation.effect?.getComputedTiming().endTime === Infinity) return;
                        animation.finish();
                    });
                },
            });
            return;
        }
        if (performance.now() - startedAt < BACK_WAIT_MS) requestAnimationFrame(wait);
    };
    requestAnimationFrame(wait);
};
