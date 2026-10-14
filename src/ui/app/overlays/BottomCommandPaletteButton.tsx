import React, { useEffect, useRef, useState } from 'react';
import { Command } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { openCommandPalette, useAppViewStore } from '../../../state/useAppViewStore';
import { usePlayerChromeSettingsStore } from '../../../state/usePlayerChromeSettingsStore';
import { useAndroidLayoutSettingsStore } from '../../../state/useAndroidLayoutSettingsStore';
import { useImmersiveChromeStore } from '../../../state/useImmersiveChromeStore';

// src/ui/app/overlays/BottomCommandPaletteButton.tsx
// 触屏设备按不了 Ctrl+K，所以在底部左下角放一个按钮打开同一个命令面板。
// 自动隐藏打开后，一段时间没有操作就淡出，触碰屏幕再出现。

/** 无操作多久后淡出。和播放控制条的自动隐藏节奏接近。 */
const AUTO_HIDE_DELAY_MS = 3500;

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'touchstart', 'keydown', 'wheel'] as const;

const BottomCommandPaletteButton: React.FC = () => {
    const { t } = useTranslation();
    const autoHide = usePlayerChromeSettingsStore(state => state.autoHideCommandPaletteButton);
    // 全沉浸模式：强制隐藏命令面板按钮。关闭后按钮回到 autoHide 决定的状态；
    // 如果 autoHide 本来就是开的，则保持自动隐藏，不会被强制常显。
    const immersiveModeEnabled = useAndroidLayoutSettingsStore(state => state.immersiveModeEnabled);
    const immersiveChromeHidden = useImmersiveChromeStore(state => state.immersiveChromeHidden);
    const currentView = useAppViewStore(state => state.view);
    // 全沉浸只在播放视图收起这颗按钮；歌单、歌曲浏览界面照旧显示。触摸唤回时
    // immersiveChromeHidden 变为 false，这颗按钮也一起回来。
    const immersiveActiveHere = immersiveModeEnabled && currentView === 'player' && immersiveChromeHidden;
    const paletteOpen = useAppViewStore(state => state.isCommandFilterOpen);
    const [visible, setVisible] = useState(true);

    // 退出全沉浸时把按钮交还给 autoHide 的节奏重新计时；autoHide 关闭时就常显。
    useEffect(() => {
        if (!immersiveActiveHere) setVisible(true);
    }, [immersiveActiveHere]);
    const hideTimerRef = useRef<number | null>(null);

    useEffect(() => {
        if (!autoHide) {
            if (hideTimerRef.current !== null) {
                window.clearTimeout(hideTimerRef.current);
                hideTimerRef.current = null;
            }
            setVisible(true);
            return undefined;
        }

        const scheduleHide = () => {
            if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
            hideTimerRef.current = window.setTimeout(() => {
                hideTimerRef.current = null;
                setVisible(false);
            }, AUTO_HIDE_DELAY_MS);
        };
        const reveal = () => {
            setVisible(true);
            scheduleHide();
        };

        reveal();
        ACTIVITY_EVENTS.forEach(eventName => {
            window.addEventListener(eventName, reveal, { passive: true });
        });
        return () => {
            ACTIVITY_EVENTS.forEach(eventName => {
                window.removeEventListener(eventName, reveal);
            });
            if (hideTimerRef.current !== null) {
                window.clearTimeout(hideTimerRef.current);
                hideTimerRef.current = null;
            }
        };
    }, [autoHide]);

    const shown = !immersiveActiveHere && !paletteOpen && (!autoHide || visible);

    return (
        <button
            type="button"
            // 文案键和 `openCommandPalette` 同属 help 块（键盘快捷键那一组），不是 ui。
            aria-label={t('help.commandPaletteButton')}
            title={t('help.commandPaletteButton')}
            onClick={() => openCommandPalette()}
            tabIndex={shown ? 0 : -1}
            aria-hidden={!shown}
            // 左下角 bottom-8 那一带是 Now Playing 提示条的位置（fixed left-6，底距跟随
            // 控制条基线）。这里抬到 120px，正好落在提示条上方，两者不再叠在一起。
            className="absolute left-4 bottom-[120px] z-[70] flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/35 text-white/70 shadow-lg backdrop-blur-md transition-opacity duration-300 hover:bg-black/50 hover:text-white"
            style={{
                opacity: shown ? 1 : 0,
                pointerEvents: shown ? 'auto' : 'none',
            }}
        >
            <Command size={18} />
        </button>
    );
};

export default BottomCommandPaletteButton;
