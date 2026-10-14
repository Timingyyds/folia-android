import { create } from 'zustand';

// src/state/useWallHandoffStore.ts
// 两面墙的翻牌交接（设计稿 §7「进入队列」：资料库墙 ↔ Lattice）的会话状态机。App 不认识任何 suite：资料库那面墙
// （bravais 的 stage）以「首页墙」的身份登记一个 peer，Lattice 登记另一个；App 的 director 在视图切换的同一刻开一次会话，
// 两边各自订阅会话、按阶段动起来，并把「我准备好了」报回来。时间表（各段时长）由 director 传进来，store 不依赖组件。
//
// 阶段：
// - 进 Lattice（to-lattice）：closing（首页墙合上缝、关上窗；Lattice 挂上、量好尺寸，海报全部侧立看不见）→ 两边都报
//   准备好（或超时）后 flipping（从起点向外一波翻牌：首页墙翻出、Lattice 翻进）→ 结束（首页墙卸载）。
// - 回资料库墙（from-lattice）：waiting（Lattice 照常显示；首页墙在下面挂上，磁贴侧立、缝合着、窗关着）→ 首页墙报画好了
//   之后 flipping（Lattice 翻出、首页墙翻进）→ opening（Lattice 卸载；缝张开、窗打开）→ 结束。等不到就放弃（Lattice 照旧淡出）。
// - 降低动态效果（mode = fade）：不翻牌，整面淡入淡出交叉（Lattice 淡入盖上 / 淡出露出），flipping 这一段就是淡入淡出。
//   进 Lattice 时首页墙不用合缝（一开始就算准备好），仍要等 Lattice 挂上、量好尺寸再开始淡入（第一次进 Lattice 时它的
//   chunk 还在加载，不等的话首页墙先没了、Lattice 还没画出来）。
// 计时器都在这里（离散的几次 set），不经过 React 的逐帧更新。

export type WallHandoffDirection = 'to-lattice' | 'from-lattice';
export type WallHandoffMode = 'flip' | 'fade';
export type WallHandoffPhase = 'closing' | 'waiting' | 'flipping' | 'opening';
export type WallHandoffPoint = { x: number; y: number };
export type WallHandoffRect = { x: number; y: number; width: number; height: number };

/** 进 Lattice 时首页墙交给 Lattice 的对齐信息（客户区坐标）。 */
export type WallHandoffAlign = {
    /** 首页墙上展开着的聚焦卡（起点那张）；没有为 null。 */
    card: WallHandoffRect | null;
    /** 首页墙的一个格点（格子左上角）。 */
    gridPoint: WallHandoffPoint;
};

export type WallHandoffTiming = {
    /** flipping（翻牌一整波）的时长。 */
    waveMs: number;
    /** 降低动态效果时淡入淡出交叉的时长。 */
    fadeMs: number;
    /** 回资料库墙：翻完之后缝张开、窗打开的那一段。 */
    openMs: number;
    /** 进 Lattice：等两边准备好的上限，到点照样开翻。 */
    closeTimeoutMs: number;
    /** 回资料库墙：等首页墙画好的上限，到点放弃交接。 */
    waitTimeoutMs: number;
};

export type WallHandoffSession = {
    id: number;
    direction: WallHandoffDirection;
    mode: WallHandoffMode;
    phase: WallHandoffPhase;
    /** 进 Lattice：缝合上、窗关上了；回资料库墙：挂上并画好了。 */
    homeReady: boolean;
    /** 进 Lattice：Lattice 量好尺寸、摆好了相机。回资料库墙时不用（Lattice 一直在）。 */
    latticeReady: boolean;
    /** 波次的起点（客户区坐标），开翻时定下。 */
    origin: WallHandoffPoint | null;
    /** 开翻的时刻（performance.now()）；两边按它对表。 */
    startedAt: number | null;
    /** 首页墙有没有透光的窗（visualizer 要不要垫着）；回资料库墙时首页墙挂上后才知道，之前为 null。 */
    seeThrough: boolean | null;
    align: WallHandoffAlign | null;
    timing: WallHandoffTiming;
};

/** 首页墙（资料库的 stage）登记的 peer：此刻能不能交接、有没有窗、换层转场是不是降级了。 */
export type WallHandoffHomePeer = {
    canHandoff: () => boolean;
    seeThrough: () => boolean;
    reduced: () => boolean;
};

/** Lattice 登记的 peer：回资料库墙时波次从哪里开始（展开 / 聚焦的海报中心；没有为 null = 视口中心）。 */
export type WallHandoffLatticePeer = {
    getOrigin: () => WallHandoffPoint | null;
};

type WallHandoffState = {
    session: WallHandoffSession | null;
    homePeer: WallHandoffHomePeer | null;
    latticePeer: WallHandoffLatticePeer | null;
    registerHomePeer: (peer: WallHandoffHomePeer) => () => void;
    registerLatticePeer: (peer: WallHandoffLatticePeer) => () => void;
    /** 开一次会话（顶掉还没结束的那次）。返回会话 id。 */
    begin: (options: {
        direction: WallHandoffDirection;
        mode: WallHandoffMode;
        seeThrough: boolean | null;
        timing: WallHandoffTiming;
    }) => number;
    /** 首页墙准备好了：进 Lattice 时带上起点与对齐信息；回资料库墙时带上有没有窗、要不要降级。 */
    markHomeReady: (id: number, report?: {
        origin?: WallHandoffPoint | null;
        align?: WallHandoffAlign | null;
        seeThrough?: boolean;
        reduced?: boolean;
    }) => void;
    /** Lattice 量好尺寸、摆好相机了（进 Lattice）。 */
    markLatticeReady: (id: number) => void;
    /** 首页墙挂上后报告有没有窗（回资料库墙：visualizer 可以早一点装上）。 */
    reportSeeThrough: (id: number, seeThrough: boolean) => void;
    /** 放弃这次交接（视图又切走了、等不到）。 */
    abort: () => void;
};

let nextSessionId = 1;
let timer: ReturnType<typeof setTimeout> | null = null;

const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
};

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const viewportCenter = (): WallHandoffPoint => (
    typeof window === 'undefined'
        ? { x: 0, y: 0 }
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
);

export const useWallHandoffStore = create<WallHandoffState>((set, get) => {
    /** 只在会话还是 `id` 那一次时改它。 */
    const patch = (id: number, next: Partial<WallHandoffSession>) => {
        const session = get().session;
        if (!session || session.id !== id) return null;
        const updated = { ...session, ...next };
        set({ session: updated });
        return updated;
    };

    const finish = (id: number) => {
        const session = get().session;
        if (!session || session.id !== id) return;
        clearTimer();
        set({ session: null });
    };

    const schedule = (delayMs: number, run: () => void) => {
        clearTimer();
        timer = setTimeout(() => {
            timer = null;
            run();
        }, Math.max(0, delayMs));
    };

    /** 开翻：定下起点与时刻，排好下一段。 */
    const startWave = (id: number, origin: WallHandoffPoint | null) => {
        const session = patch(id, { phase: 'flipping', origin: origin ?? viewportCenter(), startedAt: now() });
        if (!session) return;
        const { timing } = session;
        const waveMs = session.mode === 'fade' ? timing.fadeMs : timing.waveMs;
        if (session.direction === 'to-lattice') {
            schedule(waveMs, () => finish(id));
            return;
        }
        // 回资料库墙：淡入淡出交叉没有「缝张开、窗打开」那一段（缝与窗本来就开着）。
        if (session.mode === 'fade') {
            schedule(waveMs, () => finish(id));
            return;
        }
        schedule(waveMs, () => {
            if (!patch(id, { phase: 'opening' })) return;
            schedule(timing.openMs, () => finish(id));
        });
    };

    const tryStartToLattice = (id: number) => {
        const session = get().session;
        if (!session || session.id !== id || session.phase !== 'closing') return;
        if (session.homeReady && session.latticeReady) startWave(id, session.origin);
    };

    return {
        session: null,
        homePeer: null,
        latticePeer: null,
        registerHomePeer: peer => {
            set({ homePeer: peer });
            return () => {
                if (get().homePeer === peer) set({ homePeer: null });
            };
        },
        registerLatticePeer: peer => {
            set({ latticePeer: peer });
            return () => {
                if (get().latticePeer === peer) set({ latticePeer: null });
            };
        },
        begin: ({ direction, mode, seeThrough, timing }) => {
            clearTimer();
            const id = nextSessionId;
            nextSessionId += 1;
            const session: WallHandoffSession = {
                id,
                direction,
                mode,
                phase: direction === 'to-lattice' ? 'closing' : 'waiting',
                // 淡入淡出交叉：首页墙不合缝，一开始就算准备好。
                homeReady: direction === 'to-lattice' && mode === 'fade',
                latticeReady: false,
                origin: null,
                startedAt: null,
                seeThrough,
                align: null,
                timing,
            };
            set({ session });
            if (direction === 'to-lattice') {
                schedule(timing.closeTimeoutMs, () => startWave(id, get().session?.origin ?? null));
            } else {
                schedule(timing.waitTimeoutMs, () => {
                    const current = get().session;
                    if (current?.id === id && current.phase === 'waiting') finish(id);
                });
            }
            return id;
        },
        markHomeReady: (id, report = {}) => {
            const session = get().session;
            if (!session || session.id !== id || session.homeReady) return;
            if (session.direction === 'to-lattice') {
                patch(id, {
                    homeReady: true,
                    origin: report.origin ?? null,
                    align: report.align ?? null,
                });
                tryStartToLattice(id);
                return;
            }
            if (session.phase !== 'waiting') return;
            patch(id, {
                homeReady: true,
                seeThrough: report.seeThrough ?? session.seeThrough,
                mode: report.reduced ? 'fade' : session.mode,
            });
            startWave(id, get().latticePeer?.getOrigin() ?? null);
        },
        markLatticeReady: id => {
            const session = get().session;
            if (!session || session.id !== id || session.latticeReady || session.direction !== 'to-lattice') return;
            patch(id, { latticeReady: true });
            tryStartToLattice(id);
        },
        reportSeeThrough: (id, seeThrough) => {
            const session = get().session;
            if (!session || session.id !== id || session.seeThrough === seeThrough) return;
            patch(id, { seeThrough });
        },
        abort: () => {
            clearTimer();
            if (get().session) set({ session: null });
        },
    };
});

/** 交接中的哪一面：资料库墙（home）或 Lattice。 */
export type WallHandoffSide = 'home' | 'lattice';

/** 这一面在这次交接里是离开（out）还是进来（in）。 */
export const resolveWallHandoffRole = (session: WallHandoffSession | null, side: WallHandoffSide): 'in' | 'out' | null => {
    if (!session) return null;
    const leaving: WallHandoffSide = session.direction === 'to-lattice' ? 'home' : 'lattice';
    return side === leaving ? 'out' : 'in';
};
