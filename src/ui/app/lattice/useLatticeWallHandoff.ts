import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { getPitch, type ReflowTile, type WallMetrics } from '../../wall/layout';
import type { LatticeCamera } from '../../wall/useWallCameraPan';
import {
    getWallHandoffSpot,
    rectCenter,
    resolveWallHandoffAlignment,
    type WallHandoffRect,
} from '../../wall/wallHandoff';
import {
    resolveWallHandoffRole,
    useWallHandoffStore,
    type WallHandoffSession,
} from '../../../state/useWallHandoffStore';
import type { QueueInstance } from '../../wall/layout';
import type { ActiveLatticePoster } from './useLatticePlaybackFocus';

// src/ui/app/lattice/useLatticeWallHandoff.ts
// Lattice 这面墙在翻牌交接里的一半（设计稿 §7「进入队列」；协议在 state/useWallHandoffStore，时间表在 wall/wallHandoff）。
// - 进 Lattice（这面墙进来，role = in）：挂上就不跑自己的入场波次（抬起落下），海报全部侧立（hold）；量好尺寸、摆好正在
//   播放那首的相机后报准备好；开翻那一刻先把相机对齐资料库墙（两边都有展开的卡时两张卡重合，否则只对齐格线、挪动不超过
//   半格），再让每张海报等到同一位置上资料库墙翻出半圈之后翻进来。
// - 回资料库墙（这面墙离开，role = out）：登记的 peer 给出波次起点（展开 / 键盘聚焦的海报，没有就视口中心）；开翻后每张海报
//   按到起点的距离翻出半圈，翻完 App 把整层卸掉（不再淡出）。
// - 降低动态效果（mode = fade）：海报不翻，进来时也不跑入场波次（整层由 App 淡入淡出）。
// 每张海报的排期按「会话 + 阶段 + 是否已对齐」缓存：同一段里重渲染拿到的是同一个对象，海报的 memo 不被打破、动画不重启。

export type LatticePosterHandoff =
    | { kind: 'hold' }
    | { kind: 'in'; delay: number; direction: -1 | 1 }
    | { kind: 'out'; delay: number; direction: -1 | 1 }
    | { kind: 'static' };

const HOLD: LatticePosterHandoff = { kind: 'hold' };
const STATIC: LatticePosterHandoff = { kind: 'static' };

type PosterRect = Omit<ReflowTile, 'instanceId'>;

export const useLatticeWallHandoff = ({
    containerRef,
    cameraRef,
    applyCamera,
    measured,
    metrics,
    activePoster,
    layout,
    focused,
    waitingForFocus,
}: {
    containerRef: RefObject<HTMLDivElement | null>;
    cameraRef: MutableRefObject<LatticeCamera>;
    applyCamera: (camera: LatticeCamera, updateBounds?: boolean) => void;
    measured: boolean;
    metrics: WallMetrics;
    activePoster: ActiveLatticePoster | null;
    layout: ReadonlyMap<string, PosterRect>;
    focused: QueueInstance | null;
    /** 正在播放那首该展开、但播放跟随还没把它摆出来（进来时等它，相机才是最终的样子）。 */
    waitingForFocus: boolean;
}) => {
    const session = useWallHandoffStore(state => state.session);
    const role = resolveWallHandoffRole(session, 'lattice');
    const flip = session?.mode === 'flip';
    const phase = session?.phase ?? null;
    const sessionId = session?.id ?? null;

    /** 世界矩形 → 客户区矩形（容器的位置 + 相机）。 */
    const toClient = useCallback((rect: PosterRect, origin?: DOMRect): WallHandoffRect => {
        const box = origin ?? containerRef.current?.getBoundingClientRect();
        const camera = cameraRef.current;
        return {
            x: (box?.left ?? 0) + camera.x + rect.x * camera.scale,
            y: (box?.top ?? 0) + camera.y + rect.y * camera.scale,
            width: rect.width * camera.scale,
            height: rect.height * camera.scale,
        };
    }, [cameraRef, containerRef]);

    // Lattice 的 peer：回资料库墙时波次从展开 / 键盘聚焦的那张海报开始。
    const latestRef = useRef({ activePoster, layout, focused });
    latestRef.current = { activePoster, layout, focused };
    useEffect(() => useWallHandoffStore.getState().registerLatticePeer({
        getOrigin: () => {
            const { activePoster: active, layout: rects, focused: keyboard } = latestRef.current;
            const rect = active ? rects.get(active.instance.instanceId) ?? active.instance : keyboard;
            return rect && containerRef.current ? rectCenter(toClient(rect)) : null;
        },
    }), [containerRef, toClient]);

    // 进 Lattice · closing：量好尺寸、正在播放那首摆好之后报准备好（淡入淡出交叉也等这一步再淡入）。
    useEffect(() => {
        if (role !== 'in' || phase !== 'closing' || sessionId === null || !measured || waitingForFocus) return;
        useWallHandoffStore.getState().markLatticeReady(sessionId);
    }, [measured, phase, role, sessionId, waitingForFocus]);

    // 进 Lattice · 开翻：先对齐相机（这时海报全都侧立着，挪相机看不见），对齐之后海报才排翻进的时刻。
    const [alignedId, setAlignedId] = useState<number | null>(null);
    useLayoutEffect(() => {
        if (!session || role !== 'in' || !flip || session.phase !== 'flipping' || !measured || alignedId === session.id) return;
        const box = containerRef.current?.getBoundingClientRect();
        const { align } = session;
        if (box && align) {
            const camera = cameraRef.current;
            const latticeCard = activePoster
                ? toClient(layout.get(activePoster.instance.instanceId) ?? activePoster.instance, box)
                : null;
            const shift = resolveWallHandoffAlignment({
                homeCard: align.card,
                latticeCard,
                homeGridPoint: align.gridPoint,
                latticeGridPoint: { x: box.left + camera.x, y: box.top + camera.y },
                pitchPx: getPitch(metrics) * camera.scale,
            });
            if (Math.abs(shift.x) > 0.01 || Math.abs(shift.y) > 0.01) {
                applyCamera({ ...camera, x: camera.x + shift.x, y: camera.y + shift.y }, true);
            }
        }
        setAlignedId(session.id);
    }, [activePoster, alignedId, applyCamera, cameraRef, containerRef, flip, layout, measured, metrics, role, session, toClient]);

    const aligned = session !== null && alignedId === session.id;
    const cacheKey = `${sessionId ?? ''}|${phase ?? ''}|${session?.mode ?? ''}|${aligned}`;
    const cacheRef = useRef<{ key: string; box: DOMRect | null; posters: Map<string, LatticePosterHandoff | null> }>({
        key: '',
        box: null,
        posters: new Map(),
    });
    if (cacheRef.current.key !== cacheKey) cacheRef.current = { key: cacheKey, box: null, posters: new Map() };

    /** 一张海报此刻的交接排期；不在交接里为 null。 */
    const getPosterHandoff = (instanceId: string, rect: PosterRect): LatticePosterHandoff | null => {
        if (!session || role === null) return null;
        if (!flip) return role === 'in' ? STATIC : null;
        const cache = cacheRef.current;
        const cached = cache.posters.get(instanceId);
        if (cached !== undefined) return cached;
        let value: LatticePosterHandoff | null;
        const { origin, startedAt } = session;
        const started = session.phase !== 'closing' && session.phase !== 'waiting' && origin !== null && startedAt !== null;
        if (role === 'in' && (!started || !aligned)) {
            value = HOLD;
        } else if (!started) {
            value = null;
        } else {
            cache.box ??= containerRef.current?.getBoundingClientRect() ?? null;
            const camera = cameraRef.current;
            const spot = getWallHandoffSpot(toClient(rect, cache.box ?? undefined), origin!, getPitch(metrics) * camera.scale);
            const now = performance.now();
            const at = role === 'in' ? spot.inAt : spot.outAt;
            value = { kind: role, delay: Math.max(0, startedAt! + at - now) / 1000, direction: spot.direction };
        }
        cache.posters.set(instanceId, value);
        return value;
    };

    return {
        role,
        session: session as WallHandoffSession | null,
        /** 进来的这一面不跑自己的入场波次（翻牌或整层淡入代替了它）。 */
        suppressEntrance: role === 'in',
        getPosterHandoff,
    };
};
