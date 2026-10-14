import type { CommandPaletteContext } from '../../command-palette/types';
import type { LyricStaffPolicy } from '../../../lib/lyrics/staffCreditsPolicy';
import type { ThemeGenerationSource } from '../../../svc/themePreferences';
import { useAudioSettingsStore } from '../../../state/useAudioSettingsStore';
import { useAutomixSettingsStore } from '../../../state/useAutomixSettingsStore';
import { useDesktopSettingsStore } from '../../../state/useDesktopSettingsStore';
import { useLocalLibrarySettingsStore } from '../../../state/useLocalLibrarySettingsStore';
import { isLocalLibraryAutoScanSupported } from '../../../svc/localLibraryAutoScan';
import { isNeteaseScrobbleReady } from '../../../svc/onlineMusic/playbackReportGate';
import { useLyricSettingsStore } from '../../../state/useLyricSettingsStore';
import { useGridViewSettingsStore } from '../../../state/useGridViewSettingsStore';
import { useLatticeSettingsStore } from '../../../state/useLatticeSettingsStore';
import { useMotionSettingsStore } from '../../../state/useMotionSettingsStore';
import { usePlaybackEntryViewStore } from '../../../state/usePlaybackEntryViewStore';
import { hasLibrarySuiteChoice } from '../../../library/registry';
import { chooseLibrarySuite, getActiveLibrarySuiteId, listLibrarySuiteOptions } from '../../../library/app/librarySuiteChoice';
import { isBravaisLibraryActive } from '../../../library/app/bravaisLibraryActive';
import { useLibraryWallLookStore } from '../../../state/useLibraryWallLookStore';
import { usePonderStore } from '../../../state/usePonderStore';
import { useHomeLayoutSettingsStore } from '../../../state/useHomeLayoutSettingsStore';
import { usePlayerChromeSettingsStore } from '../../../state/usePlayerChromeSettingsStore';
import { useSettingsModalStore } from '../../../state/useSettingsModalStore';
import { useStageSettingsStore } from '../../../state/useStageSettingsStore';
import { useSleepTimerStore } from '../../../state/useSleepTimerStore';
import { useTypographySettingsStore } from '../../../state/useTypographySettingsStore';
import { useThemeQuickEditorStore } from '../../../state/useThemeQuickEditorStore';
import { usePlayerBottomBarLayoutStore } from '../../../state/usePlayerBottomBarLayoutStore';
import type { SongResult } from '../../../types';
import { cycleSubtitleContentMode } from '../../../lib/lyrics/alternateText';

// src/ui/app/command-palette-context/buildSettingsCommandContext.ts
// The `settings` namespace of the palette context.
//
// Reads the domain stores itself rather than being handed ~46 value+setter pairs by App.tsx.
// The toggles call the stores' own handleToggle* — the builder used to re-implement each flip as
// `() => setX(!x)`, which is what forced App.tsx to pass both halves of every boolean.

/** The few members that genuinely live in App.tsx rather than in a store. */
export type SettingsCommandContextDeps = {
    currentSong: SongResult | null;
    /** Wraps the Electron transparent-window handoff, not just the stored boolean. */
    toggleTransparentBackground: () => void;
    toggleDaylightMode: () => void;
    /** Both compose handleSaveLyricFilterPattern; neither is a plain store setter. */
    cycleLyricStaffPolicy: () => void;
    cycleLyricStaffAbsorbMode: () => void;
    canGenerateAITheme: boolean;
    isGeneratingTheme: boolean;
    generateAITheme: () => void;
    themeGenerationSource: ThemeGenerationSource;
    setThemeGenerationSource: (source: ThemeGenerationSource) => void;
    voiceInputPauseSupported: boolean;
    /** A getter: the answer changes when a model download finishes, with nothing re-rendering. */
    canUseTransitionPerformance: () => boolean;
};

export const buildSettingsCommandContext = (
    deps: SettingsCommandContextDeps,
): CommandPaletteContext['settings'] => {
    const typography = useTypographySettingsStore.getState();
    const chrome = usePlayerChromeSettingsStore.getState();
    const desktop = useDesktopSettingsStore.getState();
    const audio = useAudioSettingsStore.getState();
    const automix = useAutomixSettingsStore.getState();
    const sleepTimer = useSleepTimerStore.getState();
    const modal = useSettingsModalStore.getState();
    const themeQuickEditor = useThemeQuickEditorStore.getState();
    const lattice = useLatticeSettingsStore.getState();
    const entryView = usePlaybackEntryViewStore.getState();
    const ponder = usePonderStore.getState();

    return {
        openSettings: modal.openSettings,
        setAppLanguagePreference: modal.handleSetAppLanguagePreference,
        toggleTransparentBackground: deps.toggleTransparentBackground,
        toggleDaylightMode: deps.toggleDaylightMode,
        toggleBottomSubtitleOverlay: () => typography.handleToggleHidePlayerTranslationSubtitle(
            !useTypographySettingsStore.getState().hidePlayerTranslationSubtitle,
        ),
        subtitleContentMode: typography.subtitleContentMode,
        cycleSubtitleContentMode: () => typography.handleSetSubtitleContentMode(
            cycleSubtitleContentMode(useTypographySettingsStore.getState().subtitleContentMode),
        ),
        toggleSubtitleOverlayBackground: () => typography.handleToggleSubtitleOverlayBackground(
            !useTypographySettingsStore.getState().subtitleOverlayBackground,
        ),
        playbackEntryView: entryView.playbackEntryView,
        setPlaybackEntryView: entryView.setPlaybackEntryView,
        librarySuiteOptions: listLibrarySuiteOptions,
        activeLibrarySuite: getActiveLibrarySuiteId,
        canChooseLibrarySuite: hasLibrarySuiteChoice,
        chooseLibrarySuite,
        // bravais 的透光偏好：与设置分区同一个谓词；值与 setter 都现读 store（面板开着时也会变）。
        isLibraryWallLookAvailable: isBravaisLibraryActive,
        libraryWallLook: () => useLibraryWallLookStore.getState().look,
        setLibraryWallLook: look => useLibraryWallLookStore.getState().setLook(look),
        libraryWallWindowsPerBlock: () => useLibraryWallLookStore.getState().windowsPerBlock,
        setLibraryWallWindowsPerBlock: windowsPerBlock => useLibraryWallLookStore.getState().setWindowsPerBlock(windowsPerBlock),
        toggleLibraryWallStackEdges: () => {
            const wall = useLibraryWallLookStore.getState();
            wall.setCollectionStackEdges(!wall.collectionStackEdges);
        },
        libraryWallSeamClear: () => useLibraryWallLookStore.getState().seamClear,
        toggleLibraryWallSeamClear: () => {
            const wall = useLibraryWallLookStore.getState();
            wall.setSeamClear(!wall.seamClear);
        },
        libraryWallSeamStyle: () => useLibraryWallLookStore.getState().seamStyle,
        setLibraryWallSeamStyle: style => useLibraryWallLookStore.getState().setSeamStyle(style),
        toggleLibraryWallBackdropLyrics: () => {
            const wall = useLibraryWallLookStore.getState();
            wall.setBackdropLyrics(!wall.backdropLyrics);
        },
        toggleLibraryWallBackdropBlur: () => {
            const wall = useLibraryWallLookStore.getState();
            wall.setBackdropBlur(!wall.backdropBlur);
        },
        ponderHintVisibility: ponder.ponderHintVisibility,
        setPonderHintVisibility: ponder.setPonderHintVisibility,
        togglePonderTouchButton: () => {
            const state = usePonderStore.getState();
            state.setShowPonderTouchButton(!state.showPonderTouchButton);
        },
        toggleRememberHomeCardPosition: () => {
            const home = useHomeLayoutSettingsStore.getState();
            home.handleToggleRememberHomeCardPosition(!home.rememberHomeCardPosition);
        },
        startPlayerBottomBarPositioning: usePlayerBottomBarLayoutStore.getState().requestPositioning,
        canStartPlayerBottomBarPositioning: Boolean(deps.currentSong) && !chrome.hidePlayerProgressBar,
        toggleAlwaysShowPlayerBackButton: () => chrome.handleToggleAlwaysShowPlayerBackButton(
            !usePlayerChromeSettingsStore.getState().alwaysShowPlayerBackButton,
        ),
        toggleGridViewFullBleedCover: () => useGridViewSettingsStore.getState().handleToggleGridViewFullBleedCover(
            !useGridViewSettingsStore.getState().gridViewFullBleedCover,
        ),
        toggleGridViewSquareCards: () => useGridViewSettingsStore.getState().handleToggleGridViewSquareCards(
            !useGridViewSettingsStore.getState().gridViewSquareCards,
        ),
        canUseGridViewSquareCards: () => useGridViewSettingsStore.getState().gridViewFullBleedCover,
        toggleLatticeVignette: () => useLatticeSettingsStore.getState().handleToggleLatticeVignette(
            !useLatticeSettingsStore.getState().latticeVignette,
        ),
        toggleReduceLatticeMotion: () => {
            const motion = useMotionSettingsStore.getState();
            motion.handleToggleReducedMotionSurface('lattice', !motion.reducedMotionSurfaces.lattice);
        },
        toggleFollowSystemReducedMotion: () => {
            const motion = useMotionSettingsStore.getState();
            motion.handleToggleFollowSystemReducedMotion(!motion.followSystemReducedMotion);
        },
        toggleLatticeAutoFocusOnSongChange: () => useLatticeSettingsStore.getState().handleToggleAutoFocusOnSongChange(
            !useLatticeSettingsStore.getState().autoFocusOnSongChange,
        ),
        latticePosterTintEnabled: lattice.latticePosterTintEnabled,
        latticePosterTintUseCustomColor: lattice.latticePosterTintUseCustomColor,
        latticePosterTintColor: lattice.latticePosterTintColor,
        latticePosterTintIntensity: lattice.latticePosterTintIntensity,
        setLatticePosterTintEnabled: lattice.handleToggleLatticePosterTint,
        setLatticePosterTintUseCustomColor: lattice.handleToggleLatticePosterTintCustomColor,
        setLatticePosterTintColor: lattice.handleSetLatticePosterTintColor,
        setLatticePosterTintIntensity: lattice.handleSetLatticePosterTintIntensity,
        toggleAlwaysShowTrackSwitchButtons: () => chrome.handleToggleAlwaysShowTrackSwitchButtons(
            !usePlayerChromeSettingsStore.getState().alwaysShowTrackSwitchButtons,
        ),
        toggleAlwaysShowMainWindowTitlebar: () => chrome.handleToggleAlwaysShowMainWindowTitlebar(
            !usePlayerChromeSettingsStore.getState().alwaysShowMainWindowTitlebar,
        ),
        toggleHideFullscreenButton: () => chrome.handleToggleHideFullscreenButton(
            !usePlayerChromeSettingsStore.getState().hideFullscreenButton,
        ),
        toggleNativeMacFullscreenButton: () => chrome.handleToggleNativeMacFullscreenButton(
            !usePlayerChromeSettingsStore.getState().useNativeMacFullscreenButton,
        ),
        toggleAutoHideCursorWithPlayerChrome: () => chrome.handleToggleAutoHideCursorWithPlayerChrome(
            !usePlayerChromeSettingsStore.getState().autoHideCursorWithPlayerChrome,
        ),
        toggleAutoPlayOnLaunch: () => audio.handleToggleAutoPlayOnLaunch(
            !useAudioSettingsStore.getState().autoPlayOnLaunch,
        ),
        toggleTranscodeFallback: () => audio.handleToggleTranscodeFallback(
            !useAudioSettingsStore.getState().enableTranscodeFallback,
        ),
        togglePlaybackFade: () => audio.handleTogglePlaybackFade(
            !useAudioSettingsStore.getState().playbackFadeEnabled,
        ),
        canAutoScanLocalLibrary: isLocalLibraryAutoScanSupported,
        toggleLocalLibraryAutoScan: () => useLocalLibrarySettingsStore.getState().toggleAutoScan(),
        canReportNeteasePlayback: isNeteaseScrobbleReady,
        toggleNeteaseScrobble: () => audio.handleToggleNeteaseScrobble(
            !useAudioSettingsStore.getState().neteaseScrobbleEnabled,
        ),
        voiceInputPauseSupported: deps.voiceInputPauseSupported,
        modSystemEnabled: desktop.modSystemEnabled,
        toggleVoiceInputPause: () => desktop.handleToggleVoiceInputPause(
            !useDesktopSettingsStore.getState().voiceInputPauseEnabled,
        ),
        togglePreventDisplaySleepDuringPlayback: () => desktop.handleTogglePreventDisplaySleepDuringPlayback(
            !useDesktopSettingsStore.getState().preventDisplaySleepDuringPlayback,
        ),
        toggleWallpaperMode: () => desktop.handleToggleWallpaperMode(
            !useDesktopSettingsStore.getState().wallpaperMode,
        ),
        toggleCloseToTray: () => desktop.handleToggleCloseToTray(
            !useDesktopSettingsStore.getState().closeToTray,
        ),
        toggleHideRemoteControlTitlebar: () => desktop.handleToggleHideRemoteControlTitlebar(
            !useDesktopSettingsStore.getState().hideRemoteControlTitlebar,
        ),
        unlockRemoteControl: () => desktop.handleToggleRemoteControlClickThrough(false),
        toggleObsKeepMainWindowAnimation: () => useStageSettingsStore.getState().handleToggleObsKeepMainWindowAnimation(
            !useStageSettingsStore.getState().obsKeepMainWindowAnimation,
        ),
        toggleWallpaperMacAutohideDock: () => desktop.handleToggleWallpaperMacAutohideDock(
            !useDesktopSettingsStore.getState().wallpaperMacAutohideDock,
        ),
        sleepTimerEnabled: sleepTimer.sleepTimerEnabled,
        setSleepTimerEnabled: sleepTimer.handleToggleSleepTimer,
        sleepTimerHours: sleepTimer.sleepTimerHours,
        setSleepTimerHours: sleepTimer.handleSetSleepTimerHours,
        sleepTimerMinutes: sleepTimer.sleepTimerMinutes,
        setSleepTimerMinutes: sleepTimer.handleSetSleepTimerMinutes,
        sleepTimerDeadlineMs: sleepTimer.sleepTimerDeadlineMs,
        canGenerateAITheme: deps.canGenerateAITheme,
        isGeneratingTheme: deps.isGeneratingTheme,
        generateAITheme: deps.generateAITheme,
        openThemeQuickEditor: themeQuickEditor.openEditor,
        canOpenThemeQuickEditor: themeQuickEditor.canOpenEditor,
        themeGenerationSource: deps.themeGenerationSource,
        setThemeGenerationSource: deps.setThemeGenerationSource,
        lyricStaffPolicy: useLyricSettingsStore.getState().lyricStaffPolicy,
        cycleLyricStaffPolicy: deps.cycleLyricStaffPolicy,
        lyricStaffAbsorbMode: useLyricSettingsStore.getState().lyricStaffAbsorbMode,
        cycleLyricStaffAbsorbMode: deps.cycleLyricStaffAbsorbMode,
        automixEnabled: automix.automixEnabled,
        transitionMode: automix.transitionMode,
        transitionPerformance: automix.transitionPerformance,
        toggleAutomix: () => automix.handleToggleAutomix(!useAutomixSettingsStore.getState().automixEnabled),
        setTransitionMode: automix.handleSetTransitionMode,
        toggleTransitionPerformance: () => automix.handleToggleTransitionPerformance(
            !useAutomixSettingsStore.getState().transitionPerformance,
        ),
        canUseTransitionPerformance: deps.canUseTransitionPerformance,
    };
};
