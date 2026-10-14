import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { planFlip, type FlipOrigin } from '../../../ui/wall/flipPlan';
import { nearestSeamBoundaryX } from '../../../ui/wall/seamPlan';
import { getViewWorldBounds, type WallView, type WallViewCenter } from '../../../ui/wall/wallView';
import { getWallSlot, parseWallSlotKey, type WallSlot } from '../../../ui/wall/wallSlots';
import type { WallCameraRange } from '../../../ui/wall/finiteWall';
import type { LibraryNavigationContext } from '../../core/contracts/suite';
import { BRAVAIS_METRICS, BRAVAIS_REDUCED_FADE_MS } from './bravaisConstants';
import {
    createBravaisDisplay,
    diffDisplays,
    findNearestSlot,
    isDisplayedWallLook,
    pointOrigin,
    resolveSlotFaceKey,
    toFlipSteps,
    toWaveSteps,
    type BravaisDisplay,
    type BravaisEntrance,
    type BravaisFlipStep,
} from './bravaisDisplay';
import { decideDataUpdate } from './bravaisDisplayUpdate';
import { canReuseFinitePlan, planBravaisFinite, resolveFiniteCameraRange, type BravaisFiniteState } from './bravaisFiniteWall';
import { findDisplayItemSlot } from './bravaisItemSlots';
import type { BravaisLayer } from './bravaisLayer';
import { readBravaisLayout, writeBravaisLayout } from './bravaisLayoutMemory';
import { resolveReservedPerBlock, type BravaisWallLook } from './bravaisLook';
import { releasePanelOnLayerChange } from './bravaisPanelHistory';
import { maskRemovedEntries } from './bravaisRemoval';
import { takeBravaisPendingOrigin } from './bravaisStageStore';
import { takeBravaisRemovalOrigin } from './bravaisUiStore';
import type { BravaisFrameState } from './useBravaisFrame';
import { planWallWave, WALL_WAVE_IN_MS, WALL_WAVE_MAX_DELAY_MS } from './bravaisWallWave';
import { isSourceOrigin, layerMatchesNavigation, resolveShiftKind, type BravaisShiftKind } from './bravaisShift';

// src/library/suites/bravais/useBravaisDisplay.ts
// 换层的编排（设计稿 §7 转场语法）：store 给出的当前层一变，就决定这是 push / back / 原地替换（首页换页签）还是同一层
// 的数据更新，算出新层的起点 slot、缝锚点与相机去处，对已渲染的 slot 比较前后内容排一次翻牌（wall 的 planFlip），
// 一次 setState 换上新的显示。缝保持张开、只翻缝里的内容（useBravaisSeam）；push 时被点的磁贴是起点磁贴，原地成为
// 新层的第 1 项；back 时相机回到父层离开时的位置，翻牌从缝开始。
// B7：同一层的数据更新分四种（bravaisDisplayUpdate）——进出有限态 / 过滤从缝的两侧边缘翻；移除先把那一项翻成墙面、
// 翻完（按住旧帧）再让后面的 rank 前移；有限态的相机钳制在有内容的部分；进入一层时没有起点磁贴就用会话的
// focusedEntryKey 摆键盘焦点。
// B6b③：透光换档 / 换窗数也走同一层的数据更新（只翻开窗、关窗与内容因跳过窗位而挪了的 slot）；有限拼贴按同一个
// 每块窗数规划，换窗数时重新规划。
// 布局记忆：push 离开一层时、stage 卸载时写 sessionStorage；back 时离开的那一层不写（「完成」刚让宿主忘掉了它）。
// B9：换首页页签（首页层之间的 replace）不从缝翻牌，而是整墙出场 → 入场（bravaisWallWave，沿用 Lattice 的 lift wave）。
// B11：换层种类加上来源（bravaisShift）——从搜索 / 播放页打开集合是整墙入场（enter，没有起点磁贴，相机直接就位），
// 回到来源是整墙出场（exit，下面的首页层在搜索页 / 淡出的首页之下落回）；栈里有重复的集合时「同一个键、深度变了」
// 也算换层（面包屑跳回同名的那一层）。降低动态效果（reducedTransitions）时波次换成从起点 / 缝开始的翻牌、由磁贴淡入淡出，
// 落定时刻按 0.18s 算。每次换层在显示上记一个 shift（种类 + 序号），stage 根节点据此标记。

/** 翻牌只排视口外扩这么多（世界单位）以内的磁贴。 */
const FLIP_OVERSCAN = 160;
/** 移除第一段（翻成墙面）放完之后再多等这么久才换上新数据。 */
const REMOVAL_SETTLE_MS = 40;

export type BravaisDisplayControls = {
    frameRef: MutableRefObject<BravaisFrameState>;
    view: WallView | null;
    /** 透光偏好（B6b③）：换档 / 换窗数走同一层的数据更新，只翻开窗、关窗与内容因跳过窗位而变了的 slot。 */
    wallLook: BravaisWallLook;
    /** 此刻渲染着的 slot（翻牌只比较它们）。 */
    slotsRef: MutableRefObject<readonly WallSlot[]>;
    /** 导航快照（深度、来源、各层的键）。 */
    navigation: LibraryNavigationContext;
    /** 换层转场降级成淡入淡出、不放整墙波次（bravaisMotion）。 */
    reducedTransitions: boolean;
    /** 这一层此刻的开口宽度（等级、面板、表单、过滤框都算进去了）。 */
    openWidthFor: (layer: BravaisLayer) => number;
    setAnchor: (x: number | null) => void;
    planOpening: (center: WallViewCenter, width: number, preferAnchor: boolean) => { anchorX: number | null; center: WallViewCenter };
    isAnchorOnScreen: () => boolean;
    moveTo: (center: WallViewCenter, forceRecull?: boolean) => void;
    tweenTo: (center: WallViewCenter) => void;
    /** 有限态的相机范围（无限态给 null）。 */
    setCameraRange: (range: WallCameraRange | null, settle?: boolean) => void;
    /** 换层时收起聚焦卡、按起点 / 记忆放键盘焦点。 */
    collapseFocusCard: () => void;
    getFocusedSlotKey: () => string | null;
    restoreFocus: (slotKey: string | null) => void;
    /** 挂载时不跑整墙入场（翻牌交接从 Lattice 回来：磁贴由交接翻进来）。只在第一次显示时问。 */
    suppressEntrance?: () => boolean;
};

const slotFromKey = (key: string | null): WallSlot | null => {
    const address = key ? parseWallSlotKey(key) : null;
    return address ? getWallSlot(address.column, address.row, address.slotIndex, BRAVAIS_METRICS) : null;
};

/**
 * 同一层的数据更新：还在翻的磁贴（目标没变、这次又没安排它）保留原来的安排，不被打断。B9：整墙入场还在进行时
 * （换到一个还在加载的页签，数据随后到达），这一次的磁贴仍走整墙的那一步，只把目标换成新内容（不改成从起点翻牌）。
 */
const mergeFlipSteps = (
    previous: BravaisDisplay,
    next: BravaisDisplay,
    fresh: ReadonlyMap<string, BravaisFlipStep>,
    slots: readonly WallSlot[],
    waveRunning = false,
): ReadonlyMap<string, BravaisFlipStep> => {
    if (previous.flips.size === 0) return fresh;
    const merged = new Map(fresh);
    if (waveRunning) {
        for (const [key, step] of fresh) {
            const running = previous.flips.get(key);
            if (running?.wave) merged.set(key, { ...running, to: step.to });
        }
    }
    for (const slot of slots) {
        if (merged.has(slot.key)) continue;
        const step = previous.flips.get(slot.key);
        if (step && step.to === resolveSlotFaceKey(next, slot)) merged.set(slot.key, step);
    }
    return merged;
};

export const useBravaisDisplay = (layer: BravaisLayer | null, controls: BravaisDisplayControls) => {
    const [display, setDisplay] = useState<BravaisDisplay | null>(null);
    const displayRef = useRef<BravaisDisplay | null>(null);
    const displayedDepthRef = useRef(controls.navigation.depth);
    /** 显示着的那一层打开时的导航来源（回到深度 0 时据此判断是不是回到搜索 / 播放页）。 */
    const displayedOriginRef = useRef(controls.navigation.origin);
    const shiftSeqRef = useRef(0);
    const flipTokenRef = useRef(0);
    const latestControls = useRef(controls);
    latestControls.current = controls;
    // 移除的第一段在放：期间来的层先不上墙，放完一次换上最新的（holdRelease 让 effect 重跑）。
    const holdRef = useRef<{ timer: ReturnType<typeof setTimeout>; origin: FlipOrigin } | null>(null);
    const releasedOriginRef = useRef<FlipOrigin | null>(null);
    const [holdRelease, setHoldRelease] = useState(0);
    // 翻牌在放（含移除按住旧帧的那一段）：给 stage 根节点挂 data-bravais-settling，探针据此等墙落定再操作。
    // 只在一次翻牌开始与结束时各 setState 一次（离散）。
    const [isSettling, setIsSettling] = useState(false);
    const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** B9：整墙出场 / 入场放到什么时候（这之前同一层的数据更新沿用整墙的那一步，只换目标）。 */
    const waveUntilRef = useRef(0);
    // B9：一次翻牌还没放完又来一次（整墙入场途中数据到达）时，落定时刻取两者里晚的那个，不被短的那次提前撤掉。
    const settleUntilRef = useRef(0);
    const markSettling = useCallback((planned: number | undefined) => {
        if (!planned || planned <= 0) return;
        // 降低动态效果：磁贴不错开、各自淡出淡入，0.18s 就落定。
        const durationMs = latestControls.current.reducedTransitions ? BRAVAIS_REDUCED_FADE_MS : planned;
        setIsSettling(true);
        const now = performance.now();
        const until = Math.max(settleUntilRef.current, now + durationMs + REMOVAL_SETTLE_MS * 2);
        settleUntilRef.current = until;
        if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
        settleTimerRef.current = setTimeout(() => {
            settleTimerRef.current = null;
            if (!holdRef.current) setIsSettling(false);
        }, until - now);
    }, []);

    /**
     * 换上新的显示。shift 给了就是一次换层（记下种类与序号、导航来源）；没给是同一层的数据更新，沿用上一次的 shift，
     * 整墙入场还没放完时也沿用它（入场途中到达的数据照样落回，不重启）。
     */
    const commit = useCallback((next: BravaisDisplay, depth: number, shift?: BravaisShiftKind | 'first') => {
        const previous = displayRef.current;
        const now = performance.now();
        const carried = previous?.entrance && now < previous.entrance.until ? previous.entrance : null;
        const committed: BravaisDisplay = {
            ...next,
            shift: shift ? { kind: shift, seq: (shiftSeqRef.current += 1) } : previous?.shift ?? null,
            entrance: next.entrance ?? (shift ? null : carried),
        };
        if (shift) displayedOriginRef.current = latestControls.current.navigation.origin;
        displayRef.current = committed;
        displayedDepthRef.current = depth;
        setDisplay(committed);
    }, []);

    /** 离开一层时记下它的相机、锚点、起点与键盘焦点。 */
    const remember = useCallback((current: BravaisDisplay) => {
        const { frameRef, getFocusedSlotKey } = latestControls.current;
        writeBravaisLayout(current.layer.sessionKey, {
            center: { ...frameRef.current.center },
            anchorX: frameRef.current.anchorX,
            startSlotKey: current.startSlotKey,
            focusSlotKey: getFocusedSlotKey(),
        });
    }, []);

    const planFlipFor = useCallback((before: BravaisDisplay | null, after: BravaisDisplay, origin: FlipOrigin) => {
        const { frameRef, slotsRef } = latestControls.current;
        const { view, center, openWidth } = frameRef.current;
        if (!view) return null;
        flipTokenRef.current += 1;
        const plan = planFlip({
            changes: diffDisplays(before, after, slotsRef.current),
            origin,
            visible: getViewWorldBounds(center, view, { seamWidth: openWidth, overscan: FLIP_OVERSCAN }),
            metrics: BRAVAIS_METRICS,
        });
        return { steps: toFlipSteps(flipTokenRef.current, plan), durationMs: plan.durationMs };
    }, []);

    /** 整墙出场 → 入场：从视口左上角量波次（视口加 overscan 以内的磁贴动，其余直接换）。 */
    const planWaveFor = useCallback((before: BravaisDisplay | null, after: BravaisDisplay) => {
        const { frameRef, slotsRef } = latestControls.current;
        const { view, center, openWidth } = frameRef.current;
        if (!view) return null;
        flipTokenRef.current += 1;
        const plan = planWallWave({
            changes: diffDisplays(before, after, slotsRef.current),
            viewport: getViewWorldBounds(center, view),
            visible: getViewWorldBounds(center, view, { seamWidth: openWidth, overscan: FLIP_OVERSCAN }),
            metrics: BRAVAIS_METRICS,
        });
        return { steps: toWaveSteps(flipTokenRef.current, plan), durationMs: plan.durationMs };
    }, []);

    /** 整墙入场（B11）：从此刻视口的左上角量错开，入场窗口 = 最大错开 + 落回时长（降低动效时是 0.18s 的淡入）。 */
    const planEntrance = useCallback((): BravaisEntrance | null => {
        const { frameRef, reducedTransitions } = latestControls.current;
        const { view, center } = frameRef.current;
        if (!view) return null;
        flipTokenRef.current += 1;
        const bounds = getViewWorldBounds(center, view);
        const startedAt = performance.now();
        const durationMs = reducedTransitions ? BRAVAIS_REDUCED_FADE_MS : WALL_WAVE_MAX_DELAY_MS + WALL_WAVE_IN_MS;
        return { token: flipTokenRef.current, corner: { left: bounds.left, top: bounds.top }, startedAt, until: startedAt + durationMs, reduced: reducedTransitions };
    }, []);

    /**
     * 有限态（过滤）：沿用上一次的规划或以缝为中心重新规划；无限态为 null。相机范围随之更新。规划跳过部分透明的结构窗
     * （与显示同一个 k），换窗数时不沿用旧规划。
     */
    const resolveFinite = useCallback((next: BravaisLayer, previous: BravaisFiniteState | null | undefined) => {
        const { frameRef, setCameraRange, openWidthFor, wallLook } = latestControls.current;
        const { view, center, anchorX } = frameRef.current;
        if (next.mode !== 'finite' || !view) {
            setCameraRange(null);
            return null;
        }
        const count = Math.max(next.items.length, next.wall?.planCount ?? 0);
        const reservedPerBlock = resolveReservedPerBlock(wallLook);
        const finite = canReuseFinitePlan(previous, { anchorX, count, reservedPerBlock })
            ? previous
            : planBravaisFinite({ count, anchorX, center, view, reservedPerBlock });
        setCameraRange(resolveFiniteCameraRange({ finite, itemCount: next.items.length, view, seamWidth: openWidthFor(next) }), true);
        return finite;
    }, []);

    /** 用会话记着的焦点条目摆键盘焦点（离缝最近的那一份）。 */
    const focusSessionEntry = useCallback((next: BravaisDisplay) => {
        const key = next.layer.focusedEntryKey;
        if (!key) return null;
        const { frameRef } = latestControls.current;
        const { anchorX, center } = frameRef.current;
        return findDisplayItemSlot(next, key, { x: anchorX ?? center.x, y: center.y })?.key ?? null;
    }, []);

    useLayoutEffect(() => {
        const controlsNow = latestControls.current;
        const { frameRef, slotsRef } = controlsNow;
        const previous = displayRef.current;
        const { wallLook } = controlsNow;
        if (!layer || !controls.view) return;
        const { navigation } = controlsNow;
        const depth = navigation.depth;
        // 同一个键、深度变了（栈里有重复的集合，面包屑跳回同名的那一层）：store 的层正是导航此刻的那一层时才算换层。
        const sameKeyShift = previous !== null && previous.layer.key === layer.key
            && depth !== displayedDepthRef.current && layerMatchesNavigation(layer, navigation);
        if (previous && previous.layer === layer && !sameKeyShift && !releasedOriginRef.current && isDisplayedWallLook(previous, wallLook)) return;
        // 移除的第一段还在放：等它放完。
        if (holdRef.current && previous && previous.layer.key === layer.key && !sameKeyShift) return;
        const width = controlsNow.openWidthFor(layer);
        const seamPoint = () => ({ x: frameRef.current.anchorX ?? frameRef.current.center.x, y: frameRef.current.center.y });
        const nearestToSeam = () => findNearestSlot(slotsRef.current, seamPoint())?.key ?? null;

        // 第一次（stage 挂载）：按记忆摆好相机与锚点，直接画出当前层，不跑翻牌。B11：从搜索 / 播放页打开集合时
        // （播放页回来 stage 才挂载）整墙入场。
        if (!previous) {
            const memory = readBravaisLayout(layer.sessionKey);
            let center = memory?.center ?? frameRef.current.center;
            frameRef.current.anchorX = memory?.anchorX ?? nearestSeamBoundaryX(center.x, BRAVAIS_METRICS);
            if (width > 0) center = controlsNow.planOpening(center, width, true).center;
            controlsNow.setAnchor(frameRef.current.anchorX);
            controlsNow.moveTo(center, true);
            releasePanelOnLayerChange('first', layer.key);
            const draft = createBravaisDisplay(layer, memory?.startSlotKey ?? null, undefined, wallLook);
            const entering = depth > 0 && isSourceOrigin(navigation.origin) && !controlsNow.suppressEntrance?.();
            const entrance = entering ? planEntrance() : null;
            const next = { ...draft, finite: resolveFinite(layer, null), entrance };
            commit(next, depth, entering ? 'enter' : 'first');
            if (entrance) markSettling(entrance.until - entrance.startedAt);
            controlsNow.restoreFocus(memory?.focusSlotKey ?? focusSessionEntry(next));
            return;
        }

        // 同一层的数据更新（含透光换档 / 换窗数：层没变但显示的透光偏好变了，按 update 翻）。
        if (previous.layer.key === layer.key && !sameKeyShift) {
            const released = releasedOriginRef.current;
            releasedOriginRef.current = null;
            const dataDecision = released ? { kind: 'update' as const } : decideDataUpdate(previous, layer);
            const decision = dataDecision.kind === 'refresh' && !isDisplayedWallLook(previous, wallLook)
                ? { kind: 'update' as const }
                : dataDecision;
            if (decision.kind === 'refresh') {
                commit({ ...previous, layer }, displayedDepthRef.current);
                return;
            }
            const start = slotFromKey(previous.startSlotKey);
            const startPoint = start ? { x: start.centerX, y: start.centerY } : seamPoint();

            if (decision.kind === 'removal') {
                // 第一段：旧帧按住，只把消失的条目翻成墙面，从被删的那张（或离缝最近的一份）开始。
                const originKey = takeBravaisRemovalOrigin(layer.key)
                    ?? findDisplayItemSlot(previous, [...decision.removed][0], seamPoint())?.key
                    ?? null;
                const originSlot = slotFromKey(originKey);
                const origin = pointOrigin(originSlot ? { x: originSlot.centerX, y: originSlot.centerY } : seamPoint());
                const masked = maskRemovedEntries(previous, decision.removed);
                const flip = planFlipFor(previous, masked, origin);
                controlsNow.collapseFocusCard();
                commit({ ...masked, flips: flip?.steps ?? masked.flips, flipToken: flipTokenRef.current }, displayedDepthRef.current);
                markSettling(flip?.durationMs);
                if (flip && flip.durationMs > 0) {
                    holdRef.current = {
                        origin,
                        timer: setTimeout(() => {
                            releasedOriginRef.current = holdRef.current?.origin ?? origin;
                            holdRef.current = null;
                            setHoldRelease(value => value + 1);
                        }, flip.durationMs + REMOVAL_SETTLE_MS),
                    };
                    return;
                }
                releasedOriginRef.current = null;
            }

            const finite = resolveFinite(layer, previous.finite);
            const draft = { ...createBravaisDisplay(layer, previous.startSlotKey, undefined, wallLook), finite };
            const origin: FlipOrigin = released
                ?? (decision.kind === 'filter'
                    ? { kind: 'seam-edges', x: frameRef.current.anchorX ?? frameRef.current.center.x }
                    : pointOrigin(startPoint));
            // B11：整墙入场还在放（入场途中数据到达）：不另排翻牌，磁贴在抬起 / 落回途中直接换成新内容。
            const entering = Boolean(previous.entrance && performance.now() < previous.entrance.until);
            const fresh = entering ? null : planFlipFor(previous, draft, origin);
            // 整墙有内容在翻：聚焦卡收起（它所在的块也可能在翻）。
            if (fresh && fresh.steps.size > 0) controlsNow.collapseFocusCard();
            const flips = mergeFlipSteps(previous, draft, fresh?.steps ?? new Map(), slotsRef.current, performance.now() < waveUntilRef.current);
            commit({ ...draft, flips, flipToken: flipTokenRef.current }, displayedDepthRef.current);
            markSettling(fresh?.durationMs);
            return;
        }

        // 换层：上一层若还在按住移除的第一段，直接放弃。
        if (holdRef.current) {
            clearTimeout(holdRef.current.timer);
            holdRef.current = null;
        }
        releasedOriginRef.current = null;
        const kind = resolveShiftKind({
            fromDepth: displayedDepthRef.current,
            toDepth: depth,
            fromOrigin: displayedOriginRef.current,
            toOrigin: navigation.origin,
        });
        const leaving = kind === 'back' || kind === 'exit';
        const hadKeyboardFocus = controlsNow.getFocusedSlotKey() !== null;
        controlsNow.collapseFocusCard();
        // 起点只给 push 用（整墙入场没有起点磁贴：被点的不在墙上）；任何换层都把它取走丢掉。
        const taken = takeBravaisPendingOrigin(previous.layer.key);
        const pending = kind === 'push' || kind === 'replace' ? taken : null;
        if (!leaving) remember(previous);
        releasePanelOnLayerChange(kind === 'enter' ? 'push' : kind === 'exit' ? 'back' : kind, layer.key);

        let center = frameRef.current.center;
        let startSlotKey: string | null;
        let origin: FlipOrigin;
        let focusKey: string | null = null;
        let focusFromSession = false;
        if (leaving) {
            const memory = readBravaisLayout(layer.sessionKey);
            center = memory?.center ?? center;
            if (memory?.anchorX !== undefined && memory.anchorX !== null) frameRef.current.anchorX = memory.anchorX;
            // B8：记忆里的起点是 null（这一层第一次画时没有起点，循环偏移按 0 算）也照记忆恢复，墙回到离开时的样子；
            // 只有没有记忆时才取离缝最近的 slot（以前一律取最近的，返回到这种层时整面墙换了一种排法）。
            startSlotKey = memory ? memory.startSlotKey : nearestToSeam();
            origin = pointOrigin(seamPoint());
            focusKey = memory?.focusSlotKey ?? null;
            focusFromSession = !focusKey;
        } else {
            const memory = pending ? null : readBravaisLayout(layer.sessionKey);
            // 整墙入场回到这一层上次离开时的位置（相机与缝的锚点一起，起点磁贴才在屏内）。
            if (kind === 'enter' && memory?.center) {
                center = memory.center;
                if (memory.anchorX !== null) frameRef.current.anchorX = memory.anchorX;
            }
            startSlotKey = pending?.slotKey ?? memory?.startSlotKey ?? nearestToSeam();
            const start = slotFromKey(startSlotKey);
            origin = pointOrigin(start ? { x: start.centerX, y: start.centerY } : seamPoint());
            if (hadKeyboardFocus) focusKey = startSlotKey;
            // 不是从一张磁贴打开的（从别处、换 suite 时正开着）：焦点落在会话记着的那一项上。
            focusFromSession = !pending && !hadKeyboardFocus;
        }
        // 缝保持张开：可见就沿用它的块边界，新开口放不下时相机最小让位（完全收起时不为看不见的缝平移相机）。
        if (width > 0) {
            const preferAnchor = leaving || controlsNow.isAnchorOnScreen();
            const plan = controlsNow.planOpening(center, width, preferAnchor);
            frameRef.current.anchorX = plan.anchorX;
            center = plan.center;
        }
        controlsNow.setAnchor(frameRef.current.anchorX);
        // 整墙入场：相机直接就位（被点的不在墙上，没有可以跟着走的东西），波次从就位后的视口左上角量。
        if (kind === 'enter') controlsNow.moveTo(center, true);
        const draft = { ...createBravaisDisplay(layer, startSlotKey, undefined, wallLook), finite: resolveFinite(layer, null) };
        const isHomeTabSwitch = kind === 'replace' && layer.surface === 'home' && previous.layer.surface === 'home';
        // 整墙波次：换首页页签（出场 → 入场）与回到来源（出场；首页层在遮盖之下落回）。降低动效时换成普通翻牌（磁贴淡入淡出）。
        const waves = (isHomeTabSwitch || kind === 'exit') && !controlsNow.reducedTransitions;
        const entrance = kind === 'enter' ? planEntrance() : null;
        const flips = entrance ? null : waves ? planWaveFor(previous, draft) : planFlipFor(previous, draft, origin);
        waveUntilRef.current = waves && flips ? performance.now() + flips.durationMs : 0;
        commit({ ...draft, flips: flips?.steps ?? draft.flips, flipToken: flipTokenRef.current, entrance }, depth, kind);
        markSettling(entrance ? entrance.until - entrance.startedAt : flips?.durationMs);
        if (kind !== 'enter') controlsNow.tweenTo(center);
        controlsNow.restoreFocus(focusFromSession ? focusSessionEntry(draft) ?? focusKey : focusKey);
    }, [commit, controls.navigation, controls.view, controls.wallLook, focusSessionEntry, holdRelease, layer, markSettling, planEntrance, planFlipFor, planWaveFor, remember, resolveFinite]);

    // stage 卸载（离开首页约 350ms 后）：记下当前层，回来时按它恢复；还在按住的移除第一段丢掉。
    useEffect(() => () => {
        if (holdRef.current) clearTimeout(holdRef.current.timer);
        if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
        holdRef.current = null;
        if (displayRef.current) remember(displayRef.current);
    }, [remember]);

    return { display, displayRef, isSettling };
};
