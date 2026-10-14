import i18n from '../../../i18n/config';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { getCachedCoverUrl, loadCachedOrFetchCover } from '../../../svc/coverCache';
import { getLocalSongs } from '../../../svc/db';
import { ensureLocalSongCoverAsset, getAudioFromLocalSong } from '../../../svc/localMusicService';
import { applyLocalLibraryEntityDisplay, buildUnifiedLocalSong } from '../../../svc/playbackAdapters';
import { buildNavidromeSourceRevision } from '../../../svc/playbackRecovery/sourceRevision';
import { getLocalLibraryCatalogSnapshot } from '../../../svc/localLibraryEntityRepository';
import { getNavidromeConfig, navidromeApi } from '../../../svc/navidromeService';
import {
    applyOnlineAudioSourceMetadata,
    loadOnlineSongAudioSource,
    loadOnlineSongLyrics,
} from '../../../svc/onlinePlayback';
import type { ThemeCacheSongKey } from '../../../svc/themeCache';
import type { LyricData, LocalSong, SongResult, StatusMessage } from '../../../types';
import type { NavidromeSong } from '../../../types/navidrome';
import { hydrateNavidromeLyricPayload, resolvePreferredNavidromeLyrics } from '../../../lib/appNavidromeLyrics';
import { hasRenderableLyrics } from '../../../lib/appPlaybackHelpers';
import {
    isLocalPlaybackSong,
    isNavidromePlaybackSong,
    isSamePlaybackSong,
    replacePlaybackSongInQueue,
} from '../../../lib/appPlaybackGuards';
import { getLocalCoverAssetUrl } from '../../../svc/localCoverAssetUrl';
import { isPureMusicLyricText } from '../../../lib/lyrics/pureMusic';
import { migrateLyricDataRenderHints } from '../../../lib/lyrics/renderHints';
import { resolveLocalSongLyrics } from '../../../lib/lyrics/localSongLyrics';
import { loadOnlineLyricsState, resolveOnlineLyrics } from '../../../lib/onlineLyricsState';
import type { AudioQualityPreference, MediaId } from '../../../types/onlineMusic';
import { omni } from '../../../svc/onlineMusic/omni';
import { getCachedSongCoverUrl, getSongCacheWithLegacyMigration } from '../../../svc/onlineMusic/resourceCache';
import { getSongCoverUrl } from '../../../svc/onlineMusic/songMetadata';
import { useOnlineProviderAccountStore } from '../../../state/useOnlineProviderAccountStore';
import { setStatusMessage as setStatusMsg } from '../../../state/useStatusMessageStore';
import { setActiveLocalLyricsSource, setAudioSrc, setCachedCoverUrl, setCurrentSong } from '../../../state/usePlaybackStore';
import { useLyricSettingsStore } from '../../../state/useLyricSettingsStore';

// src/ui/app/playback/restorePlaybackSource.ts
// Rehydrates playable audio and lyrics for a remembered song without reusing stale blob URLs.

type SetState<T> = Dispatch<SetStateAction<T>>;

type RestorePlaybackSourceParams = {
    audioQuality: AudioQualityPreference;
    userId?: MediaId;
    blobUrlRef: MutableRefObject<string | null>;
    currentOnlineAudioUrlFetchedAtRef: MutableRefObject<number | null>;
    setPlayQueue?: SetState<SongResult[]>;
    setLyrics: (nextLyrics: LyricData | null) => void;
    restoreCachedThemeForSong?: (songId: ThemeCacheSongKey | SongResult, options?: {
        allowLastUsedFallback?: boolean;
        preserveCurrentOnMiss?: boolean;
    }) => Promise<unknown>;
    persistLastPlaybackCache?: (song: SongResult | null, queue: SongResult[]) => Promise<void>;
    queue?: SongResult[];
};

const replaceBlobUrl = (
    blobUrlRef: MutableRefObject<string | null>,
    nextBlobUrl: string,
) => {
    if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
    }
    blobUrlRef.current = nextBlobUrl;
};

export const restorePlaybackSourceForSong = async (
    song: SongResult,
    {
        audioQuality,
        userId,
        blobUrlRef,
        currentOnlineAudioUrlFetchedAtRef,
        setPlayQueue,
        setLyrics,
        restoreCachedThemeForSong,
        persistLastPlaybackCache,
        queue,
    }: RestorePlaybackSourceParams,
) => {
    await restoreCachedThemeForSong?.(song, {
        allowLastUsedFallback: true,
        preserveCurrentOnMiss: false,
    });

    setCachedCoverUrl(await getCachedSongCoverUrl(song));

    if (isNavidromePlaybackSong(song)) {
        const navidromeSongToRestore = (song as unknown as SongResult & { navidromeData?: NavidromeSong }).navidromeData;
        const config = getNavidromeConfig();
        const navidromeId = navidromeSongToRestore?.navidromeData?.id;

        if (!navidromeSongToRestore || !config || !navidromeId) {
            console.warn('[restorePlaybackSourceForSong] Navidrome song could not be restored');
            return false;
        }

        currentOnlineAudioUrlFetchedAtRef.current = null;
        const serverSong = await navidromeApi.getSong(config, navidromeId);
        if (serverSong?.replayGain) {
            navidromeSongToRestore.navidromeData.replayGain = serverSong.replayGain;
        }
        const restoredStreamUrl = navidromeApi.getStreamUrl(config, navidromeId);
        setAudioSrc(restoredStreamUrl);
        const restoredCoverUrl = getSongCoverUrl(song) || navidromeSongToRestore.navidromeData.coverArtUrl;
        if (restoredCoverUrl) {
            setCachedCoverUrl(restoredCoverUrl);
        }

        if (navidromeSongToRestore.lyricsSource === 'online' && navidromeSongToRestore.matchedLyrics) {
            setLyrics(navidromeSongToRestore.matchedLyrics);
        } else {
            await hydrateNavidromeLyricPayload(config, navidromeSongToRestore);
            const restoredLyrics = await resolvePreferredNavidromeLyrics(navidromeSongToRestore);
            if (hasRenderableLyrics(restoredLyrics)) {
                navidromeSongToRestore.lyricsSource = 'navi';
            }
            setLyrics(restoredLyrics);
        }

        const restoredCarrier = { ...song, navidromeData: navidromeSongToRestore } as SongResult;
        // Recomputed rather than carried over from the persisted object: without a revision every
        // representation lookup misses, and a restored session re-transcodes what is already cached.
        const restoredSong = {
            ...restoredCarrier,
            playbackSourceRevision: buildNavidromeSourceRevision(restoredCarrier, restoredStreamUrl),
        } as SongResult;
        setCurrentSong(restoredSong);
        void persistLastPlaybackCache?.(restoredSong, queue && queue.length > 0 ? queue : [restoredSong]);
        return true;
    }

    const legacyLocalData = (song as SongResult & { localData?: LocalSong }).localData;
    if (isLocalPlaybackSong(song) || legacyLocalData?.id) {
        const localSongId = isLocalPlaybackSong(song) ? song.localRef.songId : legacyLocalData?.id;
        let songToRestore: LocalSong | undefined;
        const songs = await getLocalSongs();

        if (localSongId) {
            songToRestore = songs.find(candidate => candidate.id === localSongId);
        }

        if (!songToRestore) {
            songToRestore = songs.find(candidate =>
                (candidate.title || candidate.fileName) === song.name &&
                Math.abs(candidate.duration - song.durationMs) < 1000,
            );
        }

        if (!songToRestore) {
            console.warn('[restorePlaybackSourceForSong] Could not find local song in library');
            setStatusMsg({
                type: 'info',
                text: i18n.t('status.localSongNotInLibrary'),
            });
            return false;
        }

        const blobUrl = await getAudioFromLocalSong(songToRestore);
        if (!blobUrl) {
            console.warn('[restorePlaybackSourceForSong] Local song file not accessible - needs resync');
            setStatusMsg({
                type: 'info',
                text: i18n.t('status.localFileReauthorize'),
            });
            return false;
        }

        songToRestore = await ensureLocalSongCoverAsset(songToRestore);
        const localCoverUrl = getLocalCoverAssetUrl(songToRestore.localCoverAssetId, 1024);
        const catalog = await getLocalLibraryCatalogSnapshot();
        const restoredSong = applyLocalLibraryEntityDisplay(buildUnifiedLocalSong({
            localSong: songToRestore,
            matchedSong: null,
            coverUrl: songToRestore.useOnlineCover
                ? songToRestore.onlineMetadata?.coverUrl || localCoverUrl
                : localCoverUrl,
            preferOnlineMetadata: false,
        }), catalog);
        setCurrentSong(restoredSong);
        replaceBlobUrl(blobUrlRef, blobUrl);
        currentOnlineAudioUrlFetchedAtRef.current = null;
        setAudioSrc(blobUrl);

        const resolvedLyrics = await resolveLocalSongLyrics(
            songToRestore,
            useLyricSettingsStore.getState().localLyricsPriority,
        );
        setLyrics(resolvedLyrics.lyrics);
        setActiveLocalLyricsSource(resolvedLyrics.source);

        const cacheKey = `cover_local_${songToRestore.id}`;
        const cachedCoverUrl = songToRestore.useOnlineCover
            ? await getCachedCoverUrl(cacheKey)
            : null;
        if (cachedCoverUrl) setCachedCoverUrl(cachedCoverUrl);
        else if (songToRestore.useOnlineCover && songToRestore.onlineMetadata?.coverUrl) {
            setCachedCoverUrl(await loadCachedOrFetchCover(cacheKey, songToRestore.onlineMetadata.coverUrl));
        } else if (localCoverUrl) {
            setCachedCoverUrl(localCoverUrl);
        } else {
            setCachedCoverUrl(null);
        }
        const restoredQueue = replacePlaybackSongInQueue(queue || [restoredSong], restoredSong);
        void persistLastPlaybackCache?.(restoredSong, restoredQueue);
        return true;
    }

    const onlineLyricsState = await loadOnlineLyricsState(song);
    if (onlineLyricsState) {
        setCurrentSong(prev => {
            if (!prev || !isSamePlaybackSong(prev, song)) return prev;
            return { ...prev, onlineLyricsState };
        });
    }

    if (!omni.canPlaySong(song)) {
        setStatusMsg({ type: 'error', text: i18n.t('status.playbackFailed') });
        return false;
    }

    const audioResult = await loadOnlineSongAudioSource(song, audioQuality, null);
    if (audioResult.kind === 'unavailable') {
        setStatusMsg({ type: 'error', text: i18n.t(audioResult.reason === 'preview-only' ? 'status.songPreviewOnly'
            : audioResult.reason === 'auth-required' ? 'status.loginExpired' : 'status.playbackFailed') });
        return false;
    }

    if (audioResult.blobUrl) {
        replaceBlobUrl(blobUrlRef, audioResult.blobUrl);
        currentOnlineAudioUrlFetchedAtRef.current = null;
    } else {
        currentOnlineAudioUrlFetchedAtRef.current = Date.now();
    }
    setAudioSrc(audioResult.audioSrc);

    const restoredSong = applyOnlineAudioSourceMetadata(song, audioResult.replayGain);
    if (restoredSong.replayGain) {
        setCurrentSong(prev => {
            if (!prev || !isSamePlaybackSong(prev, song)) return prev;
            return { ...prev, replayGain: restoredSong.replayGain };
        });
        const restoredQueue = replacePlaybackSongInQueue(queue || [restoredSong], restoredSong);
        setPlayQueue?.(restoredQueue);
        void persistLastPlaybackCache?.(restoredSong, restoredQueue);
    }

    const cachedLyrics = await getSongCacheWithLegacyMigration<LyricData>('lyric', song, migrateLyricDataRenderHints);
    const restoredPreferredLyrics = resolveOnlineLyrics(onlineLyricsState, cachedLyrics);
    const restoredLyricText = restoredPreferredLyrics?.lines.map(line => line.fullText).join('\n') ?? '';
    const restoredIsPureMusicNotice = Boolean(restoredPreferredLyrics) && isPureMusicLyricText(restoredLyricText);
    if (restoredPreferredLyrics && !restoredIsPureMusicNotice) {
        setCurrentSong(prev => {
            if (!prev || !isSamePlaybackSong(prev, song)) return prev;
            return {
                ...prev,
                isPureMusic: onlineLyricsState?.lyricsSource === 'online' && typeof onlineLyricsState.matchedIsPureMusic === 'boolean'
                    ? onlineLyricsState.matchedIsPureMusic
                    : isPureMusicLyricText(restoredLyricText),
            };
        });
        setLyrics(restoredPreferredLyrics);
        return true;
    }

    // A restored pure-music notice is often only a provider placeholder. Do not clear the
    // lyric panel and stop here: route it through the normal lyric pipeline so the regular
    // provider fetch and automatic best-match can replace the placeholder with real lyrics.
    const songProviderId = song.sourceRef?.kind === 'online' ? song.sourceRef.providerId : null;
    const effectiveUserId = songProviderId
        ? (useOnlineProviderAccountStore.getState().accounts[songProviderId]?.user?.id ?? userId)
        : userId;
    setLyrics(null);
    await loadOnlineSongLyrics(song, null, effectiveUserId, {
        isCurrent: () => true,
        onLyrics: setLyrics,
        onPureMusicChange: isPureMusic => {
            setCurrentSong(prev => {
                if (!prev || !isSamePlaybackSong(prev, song)) return prev;
                return { ...prev, isPureMusic };
            });
        },
        onStateChange: state => {
            setCurrentSong(prev => {
                if (!prev || !isSamePlaybackSong(prev, song)) return prev;
                return { ...prev, onlineLyricsState: state ?? undefined };
            });
        },
        onDone: () => undefined,
    });
    return true;
};
