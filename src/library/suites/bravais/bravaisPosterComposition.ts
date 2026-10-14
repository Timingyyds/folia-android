// src/library/suites/bravais/bravaisPosterComposition.ts
// 歌手海报的构图（纯计算）：和凝彩一样按种子定死——同一个歌手每次打开都是同一幅，换一个歌手换一幅。种子是层的 key
// （含歌手 id），渲染层零随机。随机的只有构图：装定妆照的几何形（三种斜切块、圆窗）与它朝哪边，虚影错开的
// 方向，两条贯穿线的高度与角度，碎字的位置、字号与角度，斜线小方块与「· · ·」的位置。文字、按钮的位置都不随机。
// 几何形只占海报上部（不低于 76% 高），下面留给名字、热门歌曲与按钮。坐标都是海报宽高的百分比。

export type BravaisPosterShape =
    | { kind: 'polygon'; points: readonly (readonly [number, number])[] }
    | { kind: 'circle'; cx: number; cy: number };

export type BravaisPosterScrap = { x: number; y: number; size: number; deg: number; opacity: number };

export type BravaisPosterComposition = {
    shape: BravaisPosterShape;
    /** 虚影错开的方向（px）。 */
    ghost: { x: number; y: number };
    through: readonly { y: number; deg: number }[];
    scraps: readonly BravaisPosterScrap[];
    /** 斜线小方块在哪一边（与几何形相反的那边）、多高。 */
    hatch: { side: 'left' | 'right'; y: number };
    dots: { x: number; y: number };
};

/** FNV-1a，字符串 → 32 位种子。 */
export const hashPosterSeed = (seed: string) => {
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619) >>> 0;
    return hash;
};

/** mulberry32：同一个种子永远同一串数。 */
export const createRandom = (seed: number) => {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
};

/** 几何形都画在右边，mirror 时左右翻过来。 */
const SHAPES: readonly BravaisPosterShape[] = [
    { kind: 'polygon', points: [[18, 0], [100, 0], [100, 58], [46, 74]] },
    // 原来这里是倒三角（[6,0] [100,0] [62,70]），尖朝下的大三角太像梗图模板：换成横跨整幅、下缘斜切的一块。
    { kind: 'polygon', points: [[0, 0], [100, 0], [100, 50], [0, 66]] },
    { kind: 'polygon', points: [[44, 0], [100, 0], [100, 66], [58, 76]] },
    { kind: 'circle', cx: 64, cy: 30 },
];

/**
 * 碎字的候选位置：只在上半（名字之上）。下半是热门歌与按钮，碎字压在它们底下显得乱。任意两个上下错开 SCRAP_MIN_GAP
 * 以上就不会叠（宽度随词变，只有上下错开才稳）；20 / 30 / 40 这一列两两错得开，24 那个点只能和 40 搭。
 */
const SCRAP_SPOTS: readonly { x: number; y: number }[] = [
    { x: -2, y: 30 }, { x: 4, y: 20 }, { x: 30, y: 24 }, { x: 16, y: 40 },
];
/** 两个碎字上下至少错开这么多（海报高度的百分比；最大的碎字约 8 × 1.15 高）。 */
const SCRAP_MIN_GAP = 10;
/** 碎字最多几个（与 BravaisSeamPoster 的 scrapWords 一致）。 */
export const BRAVAIS_POSTER_SCRAP_COUNT = 2;

export const resolvePosterComposition = (seed: string): BravaisPosterComposition => {
    const random = createRandom(hashPosterSeed(seed));
    const between = (min: number, max: number) => min + (max - min) * random();
    const base = SHAPES[Math.floor(random() * SHAPES.length)];
    const mirror = random() < 0.4;
    const flip = (x: number) => (mirror ? 100 - x : x);
    const shape: BravaisPosterShape = base.kind === 'polygon'
        ? { kind: 'polygon', points: base.points.map(([x, y]) => [flip(x), y] as const) }
        : { kind: 'circle', cx: flip(base.cx), cy: base.cy };
    const ghostSign = random() < 0.5 ? -1 : 1;
    const spots = [...SCRAP_SPOTS];
    const scraps: BravaisPosterScrap[] = [];
    for (let rank = 0; rank < BRAVAIS_POSTER_SCRAP_COUNT; rank += 1) {
        const candidates = spots.filter(spot => scraps.every(other => Math.abs(other.y - spot.y) >= SCRAP_MIN_GAP));
        const spot = candidates[Math.floor(random() * candidates.length)];
        spots.splice(spots.indexOf(spot), 1);
        scraps.push({
            x: spot.x,
            y: spot.y,
            size: [8, 5][rank] * between(0.85, 1.15),
            deg: between(-9, 9),
            opacity: [0.8, 0.55][rank],
        });
    }
    return {
        shape,
        ghost: { x: 16 * ghostSign * (mirror ? -1 : 1), y: 16 },
        through: [
            { y: between(8, 18), deg: between(2, 7) * (random() < 0.5 ? -1 : 1) },
            { y: between(78, 88), deg: between(3, 8) * (random() < 0.5 ? -1 : 1) },
        ],
        scraps,
        hatch: { side: mirror ? 'right' : 'left', y: between(11, 16) },
        dots: { x: between(30, 56), y: between(7, 11) },
    };
};

/**
 * 底子往海报上方延伸的高度（海报高度的百分比，即 cqh）：海报跟着墙倾斜时，缝上下各多出一截出血（--bravais-poster-bleed），
 * 转过来会露进视口；贴着海报上缘的几何形顺着两条侧边一直延伸上去，出血那一截里也是同一块，看不出海报的上边。
 * 一整个海报高度足够盖住出血（缝本身会裁掉多出来的）。
 */
export const BRAVAIS_POSTER_SHAPE_RISE = 100;

type PosterPoints = readonly (readonly [number, number])[];

/** 多边形贴着上缘（y = 0）的顶点沿它的侧边延长到 y = -rise；侧边是与它相邻、不在上缘的那条边。 */
export const risePosterPoints = (points: PosterPoints, rise = BRAVAIS_POSTER_SHAPE_RISE): PosterPoints => points.map(([x, y], index) => {
    if (y !== 0) return [x, y] as const;
    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    const side = previous[1] !== 0 ? previous : next[1] !== 0 ? next : null;
    if (!side) return [x, -rise] as const;
    // 沿 (x, 0) → side 这条线往上走到 y = -rise。
    return [x + ((x - side[0]) / side[1]) * rise, -rise] as const;
});

/**
 * 几何形 → CSS clip-path，画在往上延伸了 BRAVAIS_POSTER_SHAPE_RISE 的框里（框顶在海报上方一整个海报高度、框底是海报底）：
 * 纵坐标用 cqh（海报高度），横坐标仍是百分比。圆窗不贴上缘，不延伸；半径按海报较短的一边定（容器单位，保持正圆）。
 */
export const posterShapeClipPath = (shape: BravaisPosterShape) => {
    const top = (y: number) => `${(y + BRAVAIS_POSTER_SHAPE_RISE).toFixed(3)}cqh`;
    if (shape.kind === 'circle') return `circle(min(34cqw, 27cqh) at ${shape.cx}% ${top(shape.cy)})`;
    return `polygon(${risePosterPoints(shape.points).map(([x, y]) => `${x.toFixed(3)}% ${top(y)}`).join(', ')})`;
};

/**
 * 专辑海报的构图（参考稿 album.png 竖过来）：同样按种子定死，同一张专辑每次一样。随机的只有：封面倾斜的角度与方向、
 * 胶带贴在哪、纸与色块之间那道斜线的两端高度（哪边高）、强调色下划线的长短、标题里放大那个词的错位与旋转、描边水印字
 * 在哪一边。文字与按钮的位置不随机。坐标是海报宽高的百分比。
 */
export type BravaisAlbumComposition = {
    coverDeg: number;
    tape: { x: number; deg: number };
    /** 纸的下缘：左端与右端的高度（%）。 */
    divider: { left: number; right: number };
    underline: number;
    hero: { x: number; y: number; deg: number };
    ghostSide: 'left' | 'right';
};

export const resolveAlbumComposition = (seed: string): BravaisAlbumComposition => {
    const random = createRandom(hashPosterSeed(`album:${seed}`));
    const between = (min: number, max: number) => min + (max - min) * random();
    const sign = () => (random() < 0.5 ? -1 : 1);
    const high = between(44, 50);
    const low = between(56, 62);
    const leftHigh = random() < 0.5;
    return {
        coverDeg: between(2.5, 6) * sign(),
        tape: { x: between(28, 58), deg: between(-5, 5) },
        divider: leftHigh ? { left: high, right: low } : { left: low, right: high },
        underline: between(38, 62),
        hero: { x: between(0.04, 0.12), y: between(0.12, 0.22), deg: between(2, 7) * sign() },
        ghostSide: random() < 0.5 ? 'left' : 'right',
    };
};
