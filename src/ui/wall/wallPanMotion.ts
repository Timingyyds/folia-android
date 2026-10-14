// src/ui/wall/wallPanMotion.ts
// 墙面平移的运动参数与滚轮输入的判别，Lattice 队列墙与 bravais 墙共用一份（useWallPointerPan 读它）。
// - 拖动松手的惯性：framer `inertia`（指数衰减，时间常数 WALL_PAN_INERTIA.timeConstant）。
// - 鼠标滚轮：一格一格的离散大步长，累加进「待走的位移」，相机每帧按同一类指数曲线追上去（时间常数更短，一格在
//   约 0.25s 内基本走完）；连续滚动时位移叠加，速度与剩余距离成正比，所以不会越积越慢。
// - 触控板：自带连续的小增量与系统惯性，每个增量照旧当帧直接写进相机（再平滑一次只会发飘、拖后）。

/** 拖动松手后的惯性（framer `inertia`）。速度上限、投射系数与时间常数。 */
export const WALL_PAN_INERTIA = {
    /** 松手速度（px/s）低于它不滑行。 */
    minSpeed: 40,
    maxSpeed: 4000,
    power: 0.3,
    timeConstant: 280,
    restDelta: 0.5,
    /** 最后一次移动距松手超过这么久（ms）算停住了再松手，不滑行。 */
    staleReleaseMs: 80,
} as const;

/** 鼠标滚轮的平滑与判别参数。 */
export const WALL_WHEEL_SMOOTHING = {
    /** 追目标的指数时间常数（ms）：每过一个时间常数剩余位移缩到 1/e；一格 100px 约 240ms 走完 95%。 */
    timeConstantMs: 80,
    /** 剩余位移（px）小于它就直接落到目标并停下。 */
    restDistancePx: 0.5,
    /** 单帧时长上限（ms）：标签页切回来等长间隔不让相机一帧跳完。 */
    maxFrameMs: 50,
    /** deltaMode = 1（按行）时一行的像素数。 */
    lineHeightPx: 16,
    /**
     * 像素模式下单轴增量不小于它才可能是滚轮的一格。Chromium 一格约 100px（Windows / macOS 非连续滚轮）、
     * 约 53px（Linux）；触控板每个事件多是个位数到几十像素。
     */
    minNotchPx: 50,
    /** 两个滚轮事件间隔超过它（ms）算新的一次手势，重新判别。触控板（含系统惯性）事件间隔约一帧。 */
    gestureGapMs: 120,
} as const;

export type WallWheelSource = 'wheel' | 'trackpad';

type WheelSample = Pick<WheelEvent, 'deltaMode' | 'deltaX' | 'deltaY' | 'timeStamp'>;

/**
 * 滚轮来源的判别器（每面墙一个，带一次手势的记忆）：
 * 1. deltaMode 为行 / 页：鼠标滚轮（Firefox 等按行报告的滚轮）。
 * 2. 像素模式下两轴同时有增量，或单轴增量小于 minNotchPx：触控板（滚轮的一格只沿一个轴，且步长大）。
 * 3. 同一次手势（相邻事件间隔不超过 gestureGapMs）里一旦出现过触控板式的事件，整次手势都按触控板算：
 *    触控板快速一划、系统惯性的峰值也会有单轴大增量，不能半路改成平滑。
 * 4. 其余（单轴、步长不小于 minNotchPx）：鼠标滚轮。
 * 高分辨率滚轮（无级滚轮、Windows 上每格小于 120 单位）报的是小增量，按触控板直接跟手，本身就是细分的。
 */
export const createWallWheelClassifier = () => {
    let lastTime = Number.NEGATIVE_INFINITY;
    let gesture: WallWheelSource | null = null;
    return (event: WheelSample): WallWheelSource => {
        const sameGesture = event.timeStamp - lastTime <= WALL_WHEEL_SMOOTHING.gestureGapMs;
        lastTime = event.timeStamp;
        if (!sameGesture) gesture = null;
        if (event.deltaMode !== 0) {
            gesture = 'wheel';
            return gesture;
        }
        const x = Math.abs(event.deltaX);
        const y = Math.abs(event.deltaY);
        const singleAxis = (x === 0) !== (y === 0);
        if (!singleAxis || Math.max(x, y) < WALL_WHEEL_SMOOTHING.minNotchPx || gesture === 'trackpad') {
            gesture = 'trackpad';
            return gesture;
        }
        gesture = 'wheel';
        return gesture;
    };
};

/** 把一次滚轮事件换成相机要走的屏幕位移（px）：按行 / 页换算；Shift + 竖向滚轮改走横向。 */
export const wallWheelDelta = (event: Pick<WheelEvent, 'deltaMode' | 'deltaX' | 'deltaY' | 'shiftKey'>, viewportHeight: number) => {
    const unit = event.deltaMode === 1 ? WALL_WHEEL_SMOOTHING.lineHeightPx : event.deltaMode === 2 ? viewportHeight : 1;
    const horizontalFromShift = event.shiftKey && !event.deltaX;
    return {
        dx: (horizontalFromShift ? event.deltaY : event.deltaX) * unit,
        dy: (horizontalFromShift ? 0 : event.deltaY) * unit,
    };
};

/**
 * 平滑滚轮的一帧：剩余位移 pending 经过 dtMs 后这一帧该走多少（指数趋近，剩余不到 restDistancePx 时一次走完）。
 * 返回这一帧的位移与之后的剩余；剩余为 0 时动画结束。
 */
export const stepWallWheel = (pending: { x: number; y: number }, dtMs: number) => {
    const dt = Math.min(Math.max(dtMs, 0), WALL_WHEEL_SMOOTHING.maxFrameMs);
    const factor = 1 - Math.exp(-dt / WALL_WHEEL_SMOOTHING.timeConstantMs);
    let step = { x: pending.x * factor, y: pending.y * factor };
    const after = { x: pending.x - step.x, y: pending.y - step.y };
    if (Math.hypot(after.x, after.y) < WALL_WHEEL_SMOOTHING.restDistancePx) {
        step = { ...pending };
        return { step, pending: { x: 0, y: 0 } };
    }
    return { step, pending: after };
};
