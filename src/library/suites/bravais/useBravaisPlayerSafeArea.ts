import { useCallback, useEffect } from 'react';
import { useSpring, useTransform } from 'framer-motion';
import { playerBottomBarLiveOffset } from '../../../state/motionSignals';
import { usePlaybackStore } from '../../../state/usePlaybackStore';
import { resolvePlayerSubtitleBottomFromPresence } from '../../../lib/playerBottomBarLayout';
import { BRAVAIS_SEAM_BASE_BOTTOM_PX, BRAVAIS_SEAM_SAFE_AREA_EXTRA_PX } from './bravaisConstants';

// src/library/suites/bravais/useBravaisPlayerSafeArea.ts
// 缝内容底部为底部播放胶囊让出的安全区（设计稿 §5「播放条安全区」）：与播放页字幕同一套几何（底距 + 80 + 8，
// 默认 120px）。底距读共享的 MotionValue（用户拖高播放条时跟手），胶囊在不在（有没有当前歌曲）走 presence 的连续
// 过渡；只要胶囊在场就始终让出，不按缝与胶囊是否水平重叠来切换。返回的是 MotionValue，绑在缝内容的 padding 上，
// 不经过 React；聚焦卡 / 键盘焦点让相机露出矩形时同步读一次当前值。

/** 胶囊出现 / 消失的过渡，与播放页字幕让位的参数相同。 */
const PRESENCE_SPRING = { stiffness: 280, damping: 28 } as const;

export const useBravaisPlayerSafeArea = () => {
    const hasPlayer = usePlaybackStore(state => state.currentSong !== null);
    const presence = useSpring(hasPlayer ? 1 : 0, PRESENCE_SPRING);
    useEffect(() => {
        presence.set(hasPlayer ? 1 : 0);
    }, [hasPlayer, presence]);

    const bottomPx = useTransform(
        [presence, playerBottomBarLiveOffset],
        ([value, offset]: number[]) => {
            const safe = resolvePlayerSubtitleBottomFromPresence(offset, 1) + BRAVAIS_SEAM_SAFE_AREA_EXTRA_PX;
            return BRAVAIS_SEAM_BASE_BOTTOM_PX + value * (safe - BRAVAIS_SEAM_BASE_BOTTOM_PX);
        },
    );
    const getBottomInset = useCallback(() => bottomPx.get(), [bottomPx]);
    return { bottomPx, getBottomInset };
};
