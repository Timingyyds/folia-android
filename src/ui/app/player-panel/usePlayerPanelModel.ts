import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DAYLIGHT_THEME, DEFAULT_THEME } from '../../../svc/baseThemes';
import { resolveSongLiked } from '../../../lib/resolveSongLiked';
import { getOnlineProviderIdForSong } from '../../../lib/appPlaybackGuards';
import { useAppViewStore } from '../../../state/useAppViewStore';
import { useAppChromeStore } from '../../../state/useAppChromeStore';
import { useLibraryStore } from '../../../state/useLibraryStore';
import { useThemeSettingsStore } from '../../../state/useThemeSettingsStore';
import { useAudioSettingsStore } from '../../../state/useAudioSettingsStore';
import { useVisualizerSettingsStore } from '../../../state/useVisualizerSettingsStore';
import { usePlayerChromeSettingsStore } from '../../../state/usePlayerChromeSettingsStore';
import { useAndroidLayoutSettingsStore } from '../../../state/useAndroidLayoutSettingsStore';
import { useImmersiveChromeStore } from '../../../state/useImmersiveChromeStore';
import { useOnlineProviderAccountStore } from '../../../state/useOnlineProviderAccountStore';
import { selectDisplayCoverUrl, selectDisplayLyrics, usePlaybackStore } from '../../../state/usePlaybackStore';
import type { LocalSong, SongResult } from '../../../types';
import type { LocalLibraryCatalogSnapshot } from '../../../hooks/useLocalLibraryCatalog';
import type { CollectionNavigationOrigin } from '../../../state/useCollectionNavigationStore';
import type { GridViewCollectionDescriptor } from '../home/gridViewCollectionAdapters';
import { createCopySongInfoSuccessHandler } from '../dialogs/createCopySongInfoSuccessHandler';
import { createPlayerPanelCollectionEntries } from './createPlayerPanelCollectionEntries';
import { buildPlayerPanelModel, type PlayerPanelDeps, type PlayerPanelViewModel } from './buildPlayerPanelModel';

// src/ui/app/player-panel/usePlayerPanelModel.ts

/** What the ambient half still needs from App.tsx to be derived here rather than there. */
type PlayerPanelModelInputs = PlayerPanelDeps & {
    /** Liked-state sources: local files answer from disk, the rest from the provider's set. */
    isLocalSongLiked: (song: SongResult) => boolean;
    likedSongIds: Set<string | number>;
    /** Chrome flag computed by buildPlayerViewFlags; combined with the runtime hidden state here. */
    shouldHidePlayerRightPanelButton: boolean;
    localSongs: LocalSong[];
    localLibraryCatalog: LocalLibraryCatalogSnapshot;
    navigateToCollection: (
        collection: GridViewCollectionDescriptor,
        origin: CollectionNavigationOrigin,
    ) => void;
};

/**
 * The player panel model with its 28 ambient values filled in here instead of in App.tsx.
 *
 * This is the block that made the "add one field, edit five places" problem concrete: it was 277
 * lines of App.tsx, ~140 of which were the four collection-entry closures now living in
 * createPlayerPanelCollectionEntries.ts.
 */
export const usePlayerPanelModel = ({
    isLocalSongLiked,
    likedSongIds,
    shouldHidePlayerRightPanelButton,
    localSongs,
    localLibraryCatalog,
    navigateToCollection,
    ...deps
}: PlayerPanelModelInputs): PlayerPanelViewModel => {
    const { t } = useTranslation();
    const isPanelOpen = useAppViewStore(state => state.isPanelOpen);
    const panelTab = useAppViewStore(state => state.panelTab);
    const isPlayerChromeHidden = useAppChromeStore(state => state.isPlayerChromeHidden);
    // 全沉浸模式只在播放视图生效：隐藏右侧齿轮/面板按钮，浏览歌单/歌曲界面不受影响。
    const immersiveModeEnabled = useAndroidLayoutSettingsStore(state => state.immersiveModeEnabled);
    const immersiveChromeHidden = useImmersiveChromeStore(state => state.immersiveChromeHidden);
    const currentView = useAppViewStore(state => state.view);
    // 触摸唤回时 immersiveChromeHidden 变为 false，播放控件与右侧面板按钮一起回来。
    const immersivePlayerChromeHidden = immersiveModeEnabled && currentView === 'player' && immersiveChromeHidden;
    const isPanelGuideHotspotActive = useAppChromeStore(state => state.isPlayerPanelGuideHotspotActive);
    const starredNavidromeSongIds = useLibraryStore(state => state.starredNavidromeSongIds);
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const useCoverColorBg = useThemeSettingsStore(state => state.useCoverColorBg);
    const volume = useAudioSettingsStore(state => state.volume);
    const isMuted = useAudioSettingsStore(state => state.isMuted);
    const audioQuality = useAudioSettingsStore(state => state.audioQuality);
    const visualizerMode = useVisualizerSettingsStore(state => state.visualizerMode);
    const transparentPlayerBackground = usePlayerChromeSettingsStore(state => state.transparentPlayerBackground);
    const showOpenPanelCloseButton = usePlayerChromeSettingsStore(state => state.showOpenPanelCloseButton);
    const currentSong = usePlaybackStore(state => state.currentSong);
    const playerState = usePlaybackStore(state => state.playerState);
    const isFmMode = usePlaybackStore(state => state.isFmMode);
    const replayGainMode = usePlaybackStore(state => state.replayGainMode);
    const lyricTimelineOffsetMs = usePlaybackStore(state => state.lyricTimelineOffsetMs);
    const activePlaybackContext = usePlaybackStore(state => state.activePlaybackContext);
    const displayCoverUrl = usePlaybackStore(selectDisplayCoverUrl);
    const displayLyrics = usePlaybackStore(selectDisplayLyrics);

    // 冗余但保留的订阅：`omni.isSongLiked` 走 getState 读账号 store，读不到变化。今天 App 已经
    // 通过 useOnlineProviderPlatform 订阅了整张 accounts 表，所以这里其实总会被重渲染带到；
    // 万一哪天那条链断了，这一行仍能保证收藏成功后心形当场更新。取值没有用处。
    const currentSongProviderId = getOnlineProviderIdForSong(currentSong);
    useOnlineProviderAccountStore(state => (
        currentSongProviderId ? state.accounts[currentSongProviderId]?.likedSongIds : undefined
    ));

    // Recomputed every render, never memoised. `isLocalSongLiked` arrives through
    // useStableActionSurface, so its identity is permanent (see the warning in
    // useStableCallbacks.ts) and a memo keyed on it answers with the first render's value forever:
    // favouriting a local song left this heart dark while the bottom bar's inline copy updated.
    const isLiked = resolveSongLiked(currentSong, { isLocalSongLiked, starredNavidromeSongIds, likedSongIds });

    const collectionEntries = useMemo(() => createPlayerPanelCollectionEntries({
        currentSong,
        displaySong: deps.currentSong,
        localSongs,
        localLibraryCatalog,
        navigateToCollection,
        t,
    }), [currentSong, deps.currentSong, localSongs, localLibraryCatalog, navigateToCollection, t]);

    const handleCopySongInfoSuccess = useMemo(() => createCopySongInfoSuccessHandler({ t }), [t]);

    return useMemo(() => buildPlayerPanelModel({
        ...deps,
        ...collectionEntries,
        isPanelOpen,
        panelTab,
        coverUrl: displayCoverUrl,
        isLiked,
        hasLyrics: Boolean(displayLyrics),
        defaultTheme: DEFAULT_THEME,
        daylightTheme: DAYLIGHT_THEME,
        visualizerMode,
        transparentPlayerBackground,
        onlineLyricsState: currentSong?.onlineLyricsState ?? null,
        lyricTimelineOffsetMs,
        replayGainMode,
        isFmMode,
        playerState,
        volume,
        isMuted,
        showOpenPanelCloseButton,
        isPanelGuideHotspotActive,
        hideToggleButton: isPlayerChromeHidden || shouldHidePlayerRightPanelButton || immersivePlayerChromeHidden,
        activePlaybackContext,
        audioQuality,
        useCoverColorBg,
        isDaylight,
        handleCopySongInfoSuccess,
        // Spread rather than `deps`: the caller passes an object literal, so depending on the object
        // would rebuild this every render. The key set is fixed by the call site.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [
        ...Object.values(deps),
        collectionEntries,
        isPanelOpen,
        panelTab,
        displayCoverUrl,
        isLiked,
        displayLyrics,
        visualizerMode,
        transparentPlayerBackground,
        currentSong,
        lyricTimelineOffsetMs,
        replayGainMode,
        isFmMode,
        playerState,
        volume,
        isMuted,
        showOpenPanelCloseButton,
        isPanelGuideHotspotActive,
        immersivePlayerChromeHidden,
        isPlayerChromeHidden,
        shouldHidePlayerRightPanelButton,
        activePlaybackContext,
        audioQuality,
        useCoverColorBg,
        isDaylight,
        handleCopySongInfoSuccess,
    ]);
};
