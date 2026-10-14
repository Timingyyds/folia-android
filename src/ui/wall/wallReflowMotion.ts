import { calcGeneratorDuration, spring } from 'framer-motion';

// src/ui/wall/wallReflowMotion.ts
// 块内让位（点开一张卡、6×6 就地展开，块里其余磁贴换位）的运动参数，Lattice 与 bravais 共用一份。
// Lattice 的海报是 framer 元素，x / y / 宽高直接走这条弹簧；bravais 的磁贴外框走 CSS 过渡（只有聚焦块的 12 张带），
// 所以把同一条弹簧的归一化进度曲线采样成 CSS `linear()` 缓动，时长取 framer 把整块宽度的位移走到静止的时刻。
// 弹簧是线性系统：位移多大，进度曲线都同一条，只是 framer 收尾（差 ≤0.5、速度 ≤2/s 时跳到终点）的时刻随位移略有先后
// ——块内任何位移都不超过块宽，所以在这个时长内两边每一帧的位置相同（差在半个世界单位以内）。

/**
 * 让位弹簧（mass 1）：Lattice 海报的 x / y / 宽高都走它，展开的那张与让位的那些同参、同时起步、不错开，收回同参。
 * 阻尼比 34 / (2·√300) ≈ 0.98，几乎临界阻尼：从静止起步时单调趋近目标，不过冲、不回弹。
 */
export const WALL_REFLOW_SPRING = { type: 'spring', stiffness: 300, damping: 34 } as const;

/** 展开卡上控件行的出现（Lattice 的 `.lattice-poster-controls`）：卡片起步后 140ms 起、240ms 内从下方 12px 淡入。 */
export const WALL_REFLOW_CONTROLS_REVEAL = { delayMs: 140, durationMs: 240, risePx: 12 } as const;

/** 采样 linear() 缓动的间隔（毫秒）：4ms 时折线与弹簧的差在 816 单位（块内常见的最大位移）上不到半个单位。 */
const CURVE_STEP_MS = 4;

const reflowGenerator = (distance: number) => spring({
    stiffness: WALL_REFLOW_SPRING.stiffness,
    damping: WALL_REFLOW_SPRING.damping,
    keyframes: [0, distance],
});

/** framer 用这条弹簧把位移 distance（世界单位）走到静止的毫秒数——与 Lattice 上这段动画收尾的时刻相同。 */
export const wallReflowSettleMs = (distance: number) => calcGeneratorDuration(reflowGenerator(Math.max(Math.abs(distance), 1)), 1);

/** 一条按弹簧采样的让位曲线：时长、CSS `linear()` 缓动，以及按同一组点插值的 JS 缓动（逐帧推算位置时用，与 CSS 逐点一致）。 */
export type WallReflowCurve = {
    durationMs: number;
    css: string;
    ease: (progress: number) => number;
};

/**
 * 以位移 distance 走到静止的时长为准，把弹簧的归一化进度均匀采样成折线（首点 0、末点 1）。给 CSS 过渡用：
 * `transition: <prop> ${durationMs}ms ${css}`；JS 侧按 `ease` 推算同一条过渡此刻的进度。
 */
export const createWallReflowCurve = (distance: number): WallReflowCurve => {
    const span = Math.max(Math.abs(distance), 1);
    const durationMs = wallReflowSettleMs(span);
    const generator = reflowGenerator(span);
    const count = Math.max(Math.round(durationMs / CURVE_STEP_MS), 2) + 1;
    const points = Array.from({ length: count }, (_, index) => {
        if (index === count - 1) return 1;
        return Math.round((generator.next((durationMs * index) / (count - 1)).value / span) * 1e5) / 1e5;
    });
    const ease = (progress: number) => {
        if (progress <= 0) return points[0]!;
        if (progress >= 1) return 1;
        const position = progress * (count - 1);
        const index = Math.floor(position);
        const from = points[index]!;
        return from + (points[index + 1]! - from) * (position - index);
    };
    return { durationMs, css: `linear(${points.join(', ')})`, ease };
};
