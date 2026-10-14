import { useEffect, useMemo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { MotionValue } from 'framer-motion';
import { PlayerState, type SongResult, type LyricData } from '../../../types';
import LatticePlaybackProvider, { type LatticePlaybackActions } from './LatticePlaybackProvider';
import { LatticeTransportContext, type LatticeTransport } from './LatticeTransportContext';
import PosterWall from './PosterWall';
import LatticeFocusButton from './LatticeFocusButton';
import WallBackButton from '../../wall/WallBackButton';
import { buildLatticeTiles, type LatticeTile } from './latticeModel';
import { useStableCallbacks } from '../../../hooks/useStableCallbacks';
import { useLatticeSettingsStore } from '../../../state/useLatticeSettingsStore';
import { countRender } from '../../../dev/renderCount';
import '../../wall/wall.css';
import './Lattice.css';
import LatticeLyricsProvider from './lyrics/LatticeLyricsProvider';
import type { LatticeLyricSource } from './lyrics/types';
import { getPlaybackSongKey } from '../../../lib/appPlaybackGuards';
import { isPrimaryModifierPressed, isSecondaryModifierPressed } from '../../../lib/platform';
import { isTextEntryTarget } from '../../../lib/keyboardTargets';
import { resolveWallHandoffRole, useWallHandoffStore } from '../../../state/useWallHandoffStore';

// Queue display layer; it renders the play queue and never mutates it.
// 翻牌交接（设计稿 §7「进入队列」，与资料库墙 bravais）：根节点挂 data-wall-handoff（in / out）与阶段。叠在资料库墙上面的
// 这段时间里墙面底色不画（下面那面墙的墙面就是同一份），颗粒与暗角由上面这层统一画一份（见 Lattice.css）。

type LatticeProps = {
    controls: LatticePlaybackActions;
    lyrics: LyricData | null;
    lyricSource: LatticeLyricSource;
    lyricKeywordColoringEnabled: boolean;
    currentSong: SongResult | null;
    playerState: PlayerState;
    currentTime: MotionValue<number>;
    playbackDuration: number;
    canTogglePlayback: boolean;
    queue: SongResult[];
    isDaylight: boolean;
    onBack: () => void;
    /** 工具面板的「主页」：总是回首页（左上角返回仍是历史返回）；缺省时没有那一格。 */
    onGoHome?: () => void;
    onOpenPlayer: () => void;
    onPlaySong: (song: SongResult, queue: SongResult[]) => void;
    onTogglePlayback: () => void;
    onSeek: (time: number) => void;
};

export default function Lattice({
    controls,
    lyrics,
    lyricSource,
    lyricKeywordColoringEnabled,
    currentSong,
    playerState,
    currentTime,
    playbackDuration,
    canTogglePlayback,
    queue,
    isDaylight,
    onBack,
    onGoHome,
    onOpenPlayer,
    onPlaySong,
    onTogglePlayback,
    onSeek,
}: LatticeProps) {
    countRender('Lattice');
    const { t } = useTranslation();
    const performanceMode = useLatticeSettingsStore(state => state.latticePerformanceMode);
    const vignette = useLatticeSettingsStore(state => state.latticeVignette);
    const lightsOn = useLatticeSettingsStore(state => state.latticeLightsOn);
    const posterTintEnabled = useLatticeSettingsStore(state => state.latticePosterTintEnabled);
    const posterTintUseCustomColor = useLatticeSettingsStore(state => state.latticePosterTintUseCustomColor);
    const posterTintColor = useLatticeSettingsStore(state => state.latticePosterTintColor);
    const posterTintIntensity = useLatticeSettingsStore(state => state.latticePosterTintIntensity);
    const tiles = useMemo(() => buildLatticeTiles({ queue, currentSong }), [currentSong, queue]);
    const handoffSession = useWallHandoffStore(state => state.session);
    const handoffRole = resolveWallHandoffRole(handoffSession, 'lattice');
    const handoffPhase = handoffSession?.phase;
    const handoffFlip = handoffSession?.mode === 'flip';
    // 墙面底色：进来时整段不画（资料库墙在下面），离开时开翻起不画（下面的资料库墙已经画好）。
    const surfaceOff = handoffFlip && (handoffRole === 'in' || handoffPhase !== 'waiting');
    // 颗粒与暗角：进来的 closing 里交给下面的资料库墙（两份叠着会压暗两遍），开翻起由这层画；离开时一直由这层画，
    // 只有下面是透光档（没有颗粒）时颗粒在开翻后淡掉。
    const overlaysOff = handoffFlip && handoffRole === 'in' && handoffPhase === 'closing';
    const grainOff = overlaysOff || (handoffFlip && handoffRole === 'out' && handoffPhase !== 'waiting' && handoffSession?.seeThrough === true);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // 别处已经用掉的按键（defaultPrevented）与正在打字的输入框（例如工具面板队列浮岛的歌单名输入）里不接 Ctrl+B。
            if (event.defaultPrevented
                || isTextEntryTarget(event.target)
                || event.repeat
                || event.key.toLowerCase() !== 'b'
                || !isPrimaryModifierPressed(event)
                || isSecondaryModifierPressed(event)
                || event.altKey
                || event.shiftKey
            ) return;

            event.preventDefault();
            onBack();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onBack]);

    // App rebuilds these on every render of its own, and the wall hands them to every poster on
    // screen. Given a permanent identity here they stop being a reason for those posters to render.
    const wall = useStableCallbacks({
        onPlay: (tile: LatticeTile) => onPlaySong(tile.song, queue),
        onTogglePlayback,
        onSeek,
        onOpenPlayer,
    });

    // Recomputed only when transport state actually moves, so the expanded chrome is the only
    // subscriber that re-renders on a pause, a resume or a duration update.
    const transport = useMemo<LatticeTransport>(
        () => ({ currentSong, playerState, currentTime, playbackDuration, canTogglePlayback }),
        [canTogglePlayback, currentSong, currentTime, playbackDuration, playerState],
    );

    return (
        <LatticeTransportContext.Provider value={transport}>
        <LatticePlaybackProvider actions={controls} currentSong={currentSong} queue={queue} lyrics={lyrics}
            currentTime={currentTime} duration={playbackDuration} onSeek={onSeek} isDaylight={isDaylight}>
        <LatticeLyricsProvider source={lyricSource} songKey={currentSong ? getPlaybackSongKey(currentSong) : ''}
            keywordColoringEnabled={lyricKeywordColoringEnabled}>
        <section
            className={`lattice-root lattice-queue-root ${isDaylight ? 'is-daylight' : ''} ${performanceMode ? 'is-performance' : ''} ${vignette ? 'has-vignette' : ''} ${lightsOn ? '' : 'is-lights-out'} ${posterTintEnabled ? 'has-poster-tint' : ''} ${posterTintUseCustomColor ? 'uses-custom-poster-tint' : ''} ${surfaceOff ? 'is-handoff-surface-off' : ''}`}
            data-wall-handoff={handoffRole ?? undefined}
            data-wall-handoff-phase={handoffPhase}
            data-wall-handoff-mode={handoffSession?.mode}
            data-wall-handoff-see-through={handoffSession?.seeThrough || undefined}
            data-wall-handoff-vignette={overlaysOff ? 'off' : undefined}
            data-wall-handoff-grain={grainOff ? 'off' : undefined}
            style={{
                '--lattice-poster-tint-color': posterTintColor,
                '--lattice-poster-tint-intensity': posterTintIntensity,
            } as CSSProperties}
            aria-label={t('home.latticeLabel')}
        >
            <PosterWall
                tiles={tiles}
                currentSong={currentSong}
                onPlay={wall.onPlay}
                onTogglePlayback={wall.onTogglePlayback}
                onSeek={wall.onSeek}
                onOpenPlayer={wall.onOpenPlayer}
                onBack={onBack}
            />
            <LatticeFocusButton isDaylight={isDaylight} onGoHome={onGoHome} />
            <WallBackButton label={t('home.latticeBack')} onBack={onBack} />
            {tiles.length === 0 && (
                <div className="lattice-empty">
                    <strong>{t('home.latticeEmptyTitle')}</strong>
                    <span>{t('home.latticeEmptyText')}</span>
                </div>
            )}
        </section>
        </LatticeLyricsProvider>
        </LatticePlaybackProvider>
        </LatticeTransportContext.Provider>
    );
}
