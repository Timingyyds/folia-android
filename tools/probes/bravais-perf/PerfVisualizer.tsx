import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMotionValue } from 'framer-motion';
import { DEFAULT_THEME } from '../../../src/services/baseThemes';
import { getVisualizerRegistryEntry } from '../../../src/components/visualizer/registry';
import { DEFAULT_LUMIERE_TUNING, type Line, type LumiereRenderQuality, type VisualizerMode } from '../../../src/types';

// dev/probes/bravais-perf/PerfVisualizer.tsx
// 墙下面全屏挂一个真实 visualizer（默认绘光 full），喂加速时间轴（4×）与合成频谱，保证它每帧都在重绘——这就是透光档的
// 窗里露出来、实色档要卸载的那个东西。showText 默认 false：真实首页的 visualizer 不渲染歌词
// （useVisualizerRendererModel 只在播放页 showText），true 是播放页 / 早先台架的更重的对照。

const CJK_LINES = [
    '迷失在无边际这幽深的森林',
    '风吹过',
    '我们慢慢走回去，星河与风一起落在很远很远的地方',
    '光落在晨雾里',
    '你说夜色会把所有的名字都轻轻藏起来',
    '在城市尽头等一场迟到的雨',
];
const SECONDS_PER_LINE = 3;

const buildLines = (count: number): Line[] => Array.from({ length: count }, (_, index) => {
    const start = index * SECONDS_PER_LINE;
    const fullText = CJK_LINES[index % CJK_LINES.length]!;
    const chars = Array.from(fullText);
    const step = (SECONDS_PER_LINE - 0.2) / chars.length;
    return {
        id: `line-${index}`,
        words: chars.map((text, offset) => ({ text, startTime: start + offset * step, endTime: start + (offset + 1) * step })),
        startTime: start,
        endTime: start + SECONDS_PER_LINE - 0.1,
        fullText,
        translation: `translation ${index}`,
        isChorus: index % 4 === 0,
    };
});

const COVER_URL = `data:image/svg+xml;utf8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">'
    + '<rect width="600" height="600" fill="#2563eb"/><circle cx="300" cy="300" r="180" fill="#f97316"/></svg>',
)}`;

type PerfVisualizerProps = { mode: VisualizerMode; quality: LumiereRenderQuality; showText: boolean };

const PerfVisualizer: React.FC<PerfVisualizerProps> = ({ mode, quality, showText }) => {
    const currentTime = useMotionValue(0);
    const audioPower = useMotionValue(0.4);
    const bass = useMotionValue(0.4);
    const lowMid = useMotionValue(0.4);
    const mid = useMotionValue(0.4);
    const vocal = useMotionValue(0.4);
    const treble = useMotionValue(0.4);
    const audioBands = useMemo(() => ({ bass, lowMid, mid, vocal, treble }), [bass, lowMid, mid, vocal, treble]);
    const lines = useMemo(() => buildLines(400), []);
    const [lineIndex, setLineIndex] = useState(0);
    const lineIndexRef = useRef(0);

    // 时间轴与频谱：MotionValue 每帧写，React 只在换行时更新一次（离散）。
    useEffect(() => {
        let raf = 0;
        let last = performance.now();
        let elapsed = 0;
        const total = lines.length * SECONDS_PER_LINE;
        const tick = (now: number) => {
            elapsed = (elapsed + ((now - last) / 1000) * 4) % total;
            last = now;
            currentTime.set(elapsed);
            const phase = now / 1000;
            bass.set(0.35 + 0.3 * Math.sin(phase * 2.1));
            lowMid.set(0.35 + 0.3 * Math.sin(phase * 1.7));
            mid.set(0.35 + 0.3 * Math.sin(phase * 1.3));
            vocal.set(0.35 + 0.3 * Math.sin(phase * 2.6));
            treble.set(0.35 + 0.3 * Math.sin(phase * 3.1));
            audioPower.set(0.4 + 0.3 * Math.sin(phase * 1.9));
            const index = Math.min(lines.length - 1, Math.floor(elapsed / SECONDS_PER_LINE));
            if (index !== lineIndexRef.current) {
                lineIndexRef.current = index;
                setLineIndex(index);
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [audioPower, bass, currentTime, lines, lowMid, mid, treble, vocal]);

    const entry = getVisualizerRegistryEntry(mode);
    return (
        <div className="bperf-visualizer" data-perf-visualizer={mode}>
            {entry.render({
                currentTime,
                currentLineIndex: lineIndex,
                lines,
                theme: DEFAULT_THEME,
                audioPower,
                audioBands,
                showText,
                paused: false,
                seed: 'bravais-perf',
                coverUrl: COVER_URL,
                lumiereTuning: { ...DEFAULT_LUMIERE_TUNING, renderQuality: quality },
                songTitle: null,
                songArtist: null,
                songAlbum: null,
            } as never)}
        </div>
    );
};

export default PerfVisualizer;
