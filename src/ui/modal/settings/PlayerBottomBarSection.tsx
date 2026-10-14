import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Move, RotateCcw } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { Theme } from '../../../types';
import { CustomSelect } from '../../shared/CustomSelect';
import { playerBottomBarLiveOffset } from '../../../state/motionSignals';
import { usePlaybackStore } from '../../../state/usePlaybackStore';
import { usePlayerChromeSettingsStore } from '../../../state/usePlayerChromeSettingsStore';
import { usePlayerBottomBarLayoutStore } from '../../../state/usePlayerBottomBarLayoutStore';
import { PLAYER_BOTTOM_BAR_BASE_OFFSET_PX, resolvePlayerBottomBarMaxOffset } from '../../../lib/playerBottomBarLayout';
import { PLAYER_CONTROL_SLOT_OPTIONS, type PlayerControlSlotActionId } from '../../floating-player/playerControlSlotActions';

// src/ui/modal/settings/PlayerBottomBarSection.tsx
// 播放页底部基线的高度，以及进度条右侧两个按钮槽位。挂在「界面设置」的底部界面分区里。

/** 安卓容器里改用「调整位置」流程，见下面滑块的说明。 */
const isAndroidNative = typeof window !== 'undefined'
    && (window as unknown as { Capacitor?: { getPlatform?: () => string } })
        .Capacitor?.getPlatform?.() === 'android';

type PlayerBottomBarSectionProps = {
    settingsCardClass: string;
    utilityGhostButtonClass: string;
    rangeInputClass: string;
    /** 槽位下拉走 CustomSelect，菜单是 portal 到 body 的，拿不到容器的主题变量，只能传进去。 */
    isDaylight: boolean;
    theme?: Theme;
};

const PlayerBottomBarSection: React.FC<PlayerBottomBarSectionProps> = ({
    settingsCardClass,
    utilityGhostButtonClass,
    rangeInputClass,
    isDaylight,
    theme,
}) => {
    const { t } = useTranslation();
    const {
        playerBottomBarOffset,
        playerControlSlotPrimary,
        playerControlSlotSecondary,
        handleSetPlayerBottomBarOffset,
        handleSetPlayerControlSlot,
        hidePlayerProgressBar,
    } = usePlayerChromeSettingsStore(useShallow(state => ({
        playerBottomBarOffset: state.playerBottomBarOffset,
        playerControlSlotPrimary: state.playerControlSlotPrimary,
        playerControlSlotSecondary: state.playerControlSlotSecondary,
        handleSetPlayerBottomBarOffset: state.handleSetPlayerBottomBarOffset,
        handleSetPlayerControlSlot: state.handleSetPlayerControlSlot,
        hidePlayerProgressBar: state.hidePlayerProgressBar,
    })));
    const currentSong = usePlaybackStore(state => state.currentSong);
    const requestPositioning = usePlayerBottomBarLayoutStore(state => state.requestPositioning);
    const canStartPositioning = Boolean(currentSong) && !hidePlayerProgressBar;

    // 上限由视口高度决定，设置面板开着时缩放窗口也要跟着收，否则滑块量程是旧的。
    const [viewportHeight, setViewportHeight] = useState(
        () => (typeof window === 'undefined' ? 0 : window.innerHeight),
    );
    useEffect(() => {
        const syncHeight = () => setViewportHeight(window.innerHeight);
        syncHeight();
        window.addEventListener('resize', syncHeight);
        return () => window.removeEventListener('resize', syncHeight);
    }, []);
    const maxOffset = resolvePlayerBottomBarMaxOffset(viewportHeight);

    // 滑块和拖动改的是同一个值，所以这里也要同步推给 MotionValue，
    // 否则设置面板里拖滑块时播放页不会跟着动。
    const applyOffset = (next: number) => {
        handleSetPlayerBottomBarOffset(next);
        playerBottomBarLiveOffset.set(next);
    };

    // 触摸屏上，设置列表是可滚动的，手指蹭到这个滑块就会把控制条改到手指所在的
    // 位置（最大值大约是半屏，控制条会直接跳到画面中间）。所以触摸必须真的横向
    // 拖动一段距离才认可；鼠标的点击定位不受影响。
    const touchDragRef = useRef<{ pointerId: number; startX: number; armed: boolean } | null>(null);
    const TOUCH_DRAG_ARM_PX = 12;

    const handleOffsetPointerDown = (event: React.PointerEvent<HTMLInputElement>) => {
        if (event.pointerType !== 'touch') {
            touchDragRef.current = null;
            return;
        }
        touchDragRef.current = { pointerId: event.pointerId, startX: event.clientX, armed: false };
    };

    const handleOffsetPointerMove = (event: React.PointerEvent<HTMLInputElement>) => {
        const drag = touchDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId || drag.armed) return;
        if (Math.abs(event.clientX - drag.startX) >= TOUCH_DRAG_ARM_PX) {
            drag.armed = true;
        }
    };

    const handleOffsetPointerEnd = () => {
        touchDragRef.current = null;
    };

    const handleOffsetChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const drag = touchDragRef.current;
        // 只在「触摸但还没拖开」时忽略：那就是一次误碰。
        if (drag && !drag.armed) return;
        applyOffset(Number(event.target.value));
    };

    // 原生 <select> 的弹层由浏览器画，吃不到 --text-primary 以外的主题变量，暗色主题下
    // 白底配浅色文字直接看不清。仓库里所有设置下拉都走 CustomSelect，这里跟上。
    const slotOptions = useMemo(
        () => PLAYER_CONTROL_SLOT_OPTIONS.map(option => ({ value: option.id, label: t(option.labelKey) })),
        [t],
    );

    const renderSlotPicker = (
        slot: 'primary' | 'secondary',
        value: PlayerControlSlotActionId,
        label: string,
    ) => (
        <div className="flex min-w-[160px] flex-1 flex-col gap-1.5">
            <span className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>{label}</span>
            <CustomSelect
                value={value}
                onChange={next => handleSetPlayerControlSlot(slot, next as PlayerControlSlotActionId)}
                options={slotOptions}
                ariaLabel={label}
                isDaylight={isDaylight}
                theme={theme}
            />
        </div>
    );

    return (
        <>
            <div className={`p-4 rounded-xl border space-y-3 ${settingsCardClass}`}>
                <div className="space-y-1">
                    <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                        <Move size={14} />
                        {t('options.playerBottomBarOffset')}
                    </div>
                    <div className="text-xs opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                        {t('options.playerBottomBarOffsetDesc')}
                    </div>
                </div>

                {/*
                    安卓上不给这个滑块：它是一段自由量程（上限约半屏高），在可滚动的设置
                    列表里被手指蹭到一下就会把控制条改到手指位置，而且立刻持久化，装新版本
                    也不会自己恢复。要调位置就用下面的「调整位置」——那里有实时的范围提示
                    和确认/取消，误触可以退出。桌面版保留原来的滑块。
                */}
                {isAndroidNative ? (
                    <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        <span className="font-mono opacity-60">
                            {Math.min(maxOffset, playerBottomBarOffset)}px
                        </span>
                        <span className="opacity-50">{t('options.playerBottomBarOffsetAndroidHint')}</span>
                    </div>
                ) : (
                    <div className="flex items-center gap-3">
                        <input
                            type="range"
                            min={PLAYER_BOTTOM_BAR_BASE_OFFSET_PX}
                            max={maxOffset}
                            step={1}
                            value={Math.min(maxOffset, playerBottomBarOffset)}
                            onPointerDown={handleOffsetPointerDown}
                            onPointerMove={handleOffsetPointerMove}
                            onPointerUp={handleOffsetPointerEnd}
                            onPointerCancel={handleOffsetPointerEnd}
                            onChange={handleOffsetChange}
                            className={rangeInputClass}
                        />
                        <span className="w-14 text-right font-mono text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                            {Math.min(maxOffset, playerBottomBarOffset)}px
                        </span>
                    </div>
                )}

                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={requestPositioning}
                        disabled={!canStartPositioning}
                        title={canStartPositioning ? undefined : t('options.playerBottomBarRepositionUnavailable')}
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors disabled:opacity-35 ${utilityGhostButtonClass}`}
                        style={{ color: 'var(--text-primary)' }}
                    >
                        <Move size={14} />
                        <span>{t('options.playerBottomBarReposition')}</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => applyOffset(PLAYER_BOTTOM_BAR_BASE_OFFSET_PX)}
                        disabled={playerBottomBarOffset === PLAYER_BOTTOM_BAR_BASE_OFFSET_PX}
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors disabled:opacity-35 ${utilityGhostButtonClass}`}
                        style={{ color: 'var(--text-primary)' }}
                    >
                        <RotateCcw size={14} />
                        <span>{t('options.playerBottomBarReset')}</span>
                    </button>
                </div>
            </div>

            <div className={`p-4 rounded-xl border space-y-3 ${settingsCardClass}`}>
                <div className="space-y-1">
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {t('options.playerControlSlots')}
                    </div>
                    <div className="text-xs opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                        {t('options.playerControlSlotsDesc')}
                    </div>
                </div>
                <div className="flex flex-wrap gap-3">
                    {renderSlotPicker('primary', playerControlSlotPrimary, t('options.playerControlSlotPrimary'))}
                    {renderSlotPicker('secondary', playerControlSlotSecondary, t('options.playerControlSlotSecondary'))}
                </div>
            </div>
        </>
    );
};

export default PlayerBottomBarSection;
