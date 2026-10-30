import React, { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PlayerState } from '../../../types';
import { currentTime } from '../../../stores/motionSignals';
import { selectDisplayPlayerState, selectDisplaySong, usePlaybackStore } from '../../../stores/usePlaybackStore';
import { ensureVideoLayerFileRestored, useVideoLayerSettingsStore } from '../../../stores/useVideoLayerSettingsStore';

// src/components/visualizer/videoLayer/VideoLayer.tsx
// Built-in muted video behind the lyrics (above the background, under the lyrics). The video follows
// playback without any per-frame React work: play/pause follows the player state, a jump in the
// playback clock (seek, song change) re-aligns it, and slow drift is corrected every few seconds.
// The video position is the song position modulo the video length, so a short loop keeps cycling.

const DRIFT_CHECK_MS = 2000;
const DRIFT_TOLERANCE_SEC = 0.35;
// A clock step bigger than this between two ticks is a seek or a song change, not playback.
const CLOCK_JUMP_SEC = 1;

interface VideoLayerProps {
    /** The shell's pause signal (window hidden etc.); the video stops even while music plays. */
    paused: boolean;
}

const VideoLayer: React.FC<VideoLayerProps> = ({ paused }) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const pausedRef = useRef(paused);
    pausedRef.current = paused;
    const alignRef = useRef<() => void>(() => {});
    const { enabled, url, opacity, fit, localFileUrl } = useVideoLayerSettingsStore(useShallow(state => ({
        enabled: state.videoLayerEnabled,
        url: state.videoLayerUrl,
        opacity: state.videoLayerOpacity,
        fit: state.videoLayerFit,
        localFileUrl: state.localFileUrl,
    })));
    const source = localFileUrl ?? (url || null);
    const active = enabled && Boolean(source);

    useEffect(() => {
        ensureVideoLayerFileRestored();
    }, []);

    useEffect(() => {
        const video = videoRef.current;
        if (!active || !video) return;

        const align = () => {
            // Held still while music plays (the shell's pause): the clock runs on, so following it would
            // only seek a stopped video over and over. It is aligned when the pause lifts.
            if (pausedRef.current && selectDisplayPlayerState(usePlaybackStore.getState()) === PlayerState.PLAYING) return;
            if (!Number.isFinite(video.duration) || video.duration <= 0 || video.seeking) return;
            const target = currentTime.get() % video.duration;
            if (Math.abs(video.currentTime - target) > DRIFT_TOLERANCE_SEC) video.currentTime = target;
        };
        // 视频层作为「背景」自己走，不跟着音乐停。
        //
        // 原来的写法只在「音乐正在播放」时才 play，主页（没有在放的歌）就一直停在某一帧，
        // 看到的是一张静止画面而不是动起来的视频。现在：只要这一层显示着就播，
        // 只有 App 自己要求停（静帧预览 staticMode、或音乐暂停且设置了停下）才停。
        // 进度对齐交给 align()，它只在音乐真的在放时才去对齐，不会把视频拖回去。
        const followState = () => {
            // 背景视频自己走：只要这一层显示着就播，不再依赖「音乐正在播放」。
            // 只有 pausedRef（静帧预览等）要求停时才停。进度对齐由 align() 负责，
            // 而 align() 只在音乐真的在放时才动作，不会把视频拖回去。
            if (pausedRef.current) {
                video.pause();
                return;
            }
            void video.play().catch(() => { /* 自动播放被拦时保持静帧，不报错 */ });
        };
        const onMetadata = () => {
            align();
            followState();
        };
        alignRef.current = align;

        video.addEventListener('loadedmetadata', onMetadata);
        if (video.readyState >= HTMLMediaElement.HAVE_METADATA) onMetadata();

        const unsubscribeStore = usePlaybackStore.subscribe((state, previous) => {
            if (selectDisplayPlayerState(state) !== selectDisplayPlayerState(previous)) followState();
            if (selectDisplaySong(state) !== selectDisplaySong(previous)) align();
        });
        let lastClock = currentTime.get();
        const unsubscribeClock = currentTime.on('change', (value) => {
            if (Math.abs(value - lastClock) > CLOCK_JUMP_SEC) align();
            lastClock = value;
        });
        const drift = window.setInterval(align, DRIFT_CHECK_MS);

        return () => {
            window.clearInterval(drift);
            unsubscribeClock();
            unsubscribeStore();
            video.removeEventListener('loadedmetadata', onMetadata);
            video.pause();
        };
    }, [active, source]);

    // The shell's pause flag changes without touching the source; only play/pause needs to follow.
    //
    // 背景视频自己走，不再要求「音乐正在播放」：那个条件会让主页（没有在放的歌）只剩一帧静止画面。
    // 现在只要这一层显示着且 App 没要求停就播；音乐正放时顺带对齐进度（alignRef），
    // 音乐没放时对齐函数本身也不会动作，不会把视频拉住。
    useEffect(() => {
        const video = videoRef.current;
        if (!active || !video) return;
        if (paused) {
            video.pause();
            return;
        }
        if (selectDisplayPlayerState(usePlaybackStore.getState()) === PlayerState.PLAYING) {
            alignRef.current();
        }
        void video.play().catch(() => { /* 自动播放被拦时保持静帧，不报错 */ });
    }, [active, paused]);

    if (!active || !source) return null;

    return (
        <video
            ref={videoRef}
            key={source}
            src={source}
            muted
            loop
            playsInline
            preload="auto"
            aria-hidden
            className="absolute inset-0 h-full w-full pointer-events-none"
            style={{ opacity, objectFit: fit }}
        />
    );
};

export default VideoLayer;
