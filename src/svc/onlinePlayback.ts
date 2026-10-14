import { LyricData, OnlineLyricsState, ReplayGainInfo, SongResult } from '../types';
import { saveToCache } from './db';
import { PrefetchedSongData, isUrlValid, updatePrefetchedAudioUrl } from './prefetchService';
import { isPureMusicLyricText } from '../lib/lyrics/pureMusic';
import { migrateLyricDataRenderHints } from '../lib/lyrics/renderHints';
import { loadOnlineLyricsState, markOnlineLyricsPureMusic, resolveOnlineLyrics, resolveOnlineLyricsPureMusic, saveOnlineLyricsState } from '../lib/onlineLyricsState';
import { autoMatchBestLyric } from '../lib/lyrics/autoMatchBestLyric';
import { createSafeObjectUrl } from '../lib/blobGuards';
import type { AudioQualityPreference, MediaId } from '../types/onlineMusic';
import { OnlineProviderError, type ProviderErrorCode } from '../types/onlineMusic';
import { omni } from './onlineMusic/omni';
import { getSongResourceCacheKey } from './onlineMusic/resourceKeys';
import { getCachedSongAudioBlob, getCachedSongReplayGain, getSongCacheWithLegacyMigration } from './onlineMusic/resourceCache';
import { toSafePlaybackUrl } from '../lib/appPlaybackHelpers';
import { getProviderSongMetadata } from './onlineMusic/songMetadata';
import { useLyricSettingsStore } from '../state/useLyricSettingsStore';
import { saveLyricCacheSongMetadata } from './lyricExport/lyricCacheMetadata';
import { describeLyricsShape, noteLyricsDiagnostic } from '../lib/lyricsDiagnostics';

export async function loadOnlineSongAudioSource(
    song: SongResult,
    audioQuality: AudioQualityPreference,
    prefetched: PrefetchedSongData | null
): Promise<
    | { kind: 'ok'; audioSrc: string; blobUrl?: string; replayGain?: ReplayGainInfo }
    | { kind: 'unavailable'; reason?: ProviderErrorCode }
> {
    const cachedAudioBlob = await getCachedSongAudioBlob(song);
    if (cachedAudioBlob) {
        const blobUrl = createSafeObjectUrl(cachedAudioBlob);
        if (blobUrl) {
            // Nothing on this path ever asks the provider again, so the stored gain is the only
            // one a cached track can have. Without it every cached track reaches the fader at 0dB.
            let replayGain = song.replayGain ?? prefetched?.replayGain;
            if (!replayGain) {
                replayGain = await getCachedSongReplayGain(song);
                if (replayGain) console.log(`[Cache] ReplayGain recovered for "${song.name}" from the store, not the provider`);
            }
            return { kind: 'ok', audioSrc: blobUrl, blobUrl, replayGain };
        }
    }

    if (prefetched?.audioUrl && prefetched.audioUrl !== 'CACHED_IN_DB' && isUrlValid(prefetched.audioUrlFetchedAt)) {
        return {
            kind: 'ok',
            audioSrc: prefetched.audioUrl,
            replayGain: song.replayGain ?? prefetched.replayGain,
        };
    }

    let source = null;
    try {
        source = await omni.getAudioSource(song, audioQuality);
    } catch (error) {
        console.warn('[OnlinePlayback] Provider audio source is temporarily unavailable', error);
        return { kind: 'unavailable', ...(error instanceof OnlineProviderError ? { reason: error.code } : {}) };
    }
    const url = toSafePlaybackUrl(source?.url);
    if (!url) {
        return { kind: 'unavailable' };
    }

    const replayGain = applyOnlineAudioSourceMetadata(song, source?.replayGain).replayGain;
    updatePrefetchedAudioUrl(song, url, audioQuality, replayGain);
    return { kind: 'ok', audioSrc: url, replayGain };
}

export const applyOnlineAudioSourceMetadata = (
    song: SongResult,
    replayGain?: ReplayGainInfo,
): SongResult => replayGain
    ? { ...song, replayGain: { ...song.replayGain, ...replayGain } }
    : song;

export async function loadOnlineSongLyrics(
    song: SongResult,
    prefetched: PrefetchedSongData | null,
    userId: MediaId | null | undefined,
    callbacks: {
        isCurrent: () => boolean;
        onLyrics: (lyrics: LyricData | null) => void;
        onPureMusicChange?: (isPureMusic: boolean) => void;
        onStateChange?: (state: OnlineLyricsState | null) => void;
        onAutoMatchStart?: () => void;
        onDone: () => void;
    }
): Promise<void> {
    const { isCurrent, onLyrics, onPureMusicChange, onStateChange, onAutoMatchStart, onDone } = callbacks;
    const lyricCacheKey = getSongResourceCacheKey('lyric', song);
    const onlineLyricsState = await loadOnlineLyricsState(song);
  const initialSettingsLyricSettings = useLyricSettingsStore.getState();
    noteLyricsDiagnostic('load:start', song, {
        cacheKey: lyricCacheKey,
        hasPrefetchedLyrics: Boolean(prefetched?.lyrics),
        hasPrefetchedRaw: Boolean(prefetched?.lyricRaw),
        hasOverride: Boolean(onlineLyricsState?.hasOnlineOverride),
        autoUseBest: initialSettingsLyricSettings.autoUseBestLyric,
    });

    if (!isCurrent()) return;
    onStateChange?.(onlineLyricsState);

    const cachedLyrics = await getSongCacheWithLegacyMigration<LyricData>('lyric', song, migrateLyricDataRenderHints);
    if (!isCurrent()) return;
    const preferredCachedLyrics = resolveOnlineLyrics(onlineLyricsState, cachedLyrics);
    const hasAuthoritativeLyricsSelection = onlineLyricsState?.lyricsSource === 'imported'
        || Boolean(onlineLyricsState?.hasOnlineOverride);
    if (preferredCachedLyrics && (hasAuthoritativeLyricsSelection || !initialSettingsLyricSettings.autoUseBestLyric)) {
        const cachedText = preferredCachedLyrics.lines.map(line => line.fullText).join('\n');
        noteLyricsDiagnostic('cache-hit', song, describeLyricsShape(preferredCachedLyrics));
        onPureMusicChange?.(resolveOnlineLyricsPureMusic(onlineLyricsState, cachedText));
        onLyrics(preferredCachedLyrics);
        onDone();
        return;
    }

    if (prefetched?.lyricRaw?.isPureMusic && !prefetched.lyrics
        && (hasAuthoritativeLyricsSelection || !initialSettingsLyricSettings.autoUseBestLyric)) {
        noteLyricsDiagnostic('pure-music', song, { source: 'prefetched-raw' });
        onPureMusicChange?.(true);
        onLyrics(null);
        onDone();
        return;
    }

    if (prefetched?.lyrics) {
        const preferredPrefetchedLyrics = resolveOnlineLyrics(onlineLyricsState, prefetched.lyrics);
        const effectiveLyrics = preferredPrefetchedLyrics ?? prefetched.lyrics;

  const settingsLyricSettings = useLyricSettingsStore.getState();
        const shouldAutoMatch = settingsLyricSettings.autoUseBestLyric && !onlineLyricsState?.hasOnlineOverride;

        if (!shouldAutoMatch) {
            const effectiveText = effectiveLyrics?.lines.map(line => line.fullText).join('\n') ?? '';
            onPureMusicChange?.(
                onlineLyricsState?.lyricsSource === 'online' && typeof onlineLyricsState.matchedIsPureMusic === 'boolean'
                    ? onlineLyricsState.matchedIsPureMusic
                    : (prefetched.lyricRaw?.isPureMusic || isPureMusicLyricText(effectiveText) || isPureMusicLyricText(prefetched.lyricRaw?.mainLrc))
            );
            noteLyricsDiagnostic('prefetch-hit', song, describeLyricsShape(effectiveLyrics));
            onLyrics(effectiveLyrics);
            saveToCache(lyricCacheKey, prefetched.lyrics);
            saveLyricCacheSongMetadata(song);
            onDone();
            return;
        }
    }

    const processed = prefetched?.lyrics
        ? {
            mainLrc: prefetched.lyricRaw?.mainLrc ?? null,
            yrcLrc: prefetched.lyricRaw?.yrcLrc ?? null,
            transLrc: prefetched.lyricRaw?.transLrc ?? null,
            isPureMusic: prefetched.lyricRaw?.isPureMusic ?? false,
            lyrics: prefetched.lyrics,
            chorusRanges: [],
          }
        : await (async () => {
            noteLyricsDiagnostic('provider:request', song, { userId: userId == null ? 'missing' : 'present' });
            const result = await omni.getLyrics(song, { userId });
            return {
                mainLrc: result.mainText ?? null,
                yrcLrc: result.wordByWordText ?? null,
                transLrc: result.translationText ?? null,
                isPureMusic: result.isPureMusic,
                lyrics: result.lyrics,
                chorusRanges: result.chorusRanges || [],
            };
        })();
    const parsedLyrics = processed.lyrics;
    noteLyricsDiagnostic('provider:result', song, {
        mainLrcChars: processed.mainLrc?.length ?? 0,
        yrcChars: processed.yrcLrc?.length ?? 0,
        translationChars: processed.transLrc?.length ?? 0,
        pureMusic: processed.isPureMusic,
        ...describeLyricsShape(parsedLyrics),
    });

    if (!isCurrent()) return;

    let resolvedLyrics = resolveOnlineLyrics(onlineLyricsState, parsedLyrics);
    let finalState = onlineLyricsState;

  const settingsLyricSettings = useLyricSettingsStore.getState();
    const shouldAutoMatch = settingsLyricSettings.autoUseBestLyric && !onlineLyricsState?.hasOnlineOverride;

    if (shouldAutoMatch) {
        // The lyrics in hand are already displayable, so hand them over and report done BEFORE the
        // search below. `onDone` is what releases the audio: playback waits on it, and this search
        // asks every provider for a better lyric file - seconds when it finds none, which is
        // exactly what an instrumental interlude does. Holding the audio for an OPTIONAL upgrade
        // is what turned a song change into several seconds of silence, and with blended changes
        // the outgoing track has already ended by then, so the silence is all the listener gets.
        // A better match, if one turns up, replaces these below.
        if (resolvedLyrics) {
            noteLyricsDiagnostic('apply:before-auto-match', song, describeLyricsShape(resolvedLyrics));
            onLyrics(resolvedLyrics);
        }
        onDone();

        try {
            onAutoMatchStart?.();
            noteLyricsDiagnostic('auto-match:start', song);
            const metadata = getProviderSongMetadata(song);
            const artistName = metadata.artists.map(a => a.name).join(', ');
            const bestMatch = await autoMatchBestLyric(song.name, artistName, metadata.durationMs, {
                album: metadata.album?.name,
                preferredSource: settingsLyricSettings.preferredAlternativeLyricSource,
                providerCandidate: song.sourceRef?.kind === 'online'
                    && (song.sourceRef.providerId === 'netease' || song.sourceRef.providerId === 'kugou' || song.sourceRef.providerId === 'qq')
                    ? {
                        providerId: song.sourceRef.providerId as 'netease' | 'kugou' | 'qq',
                        song,
                        lyricsResult: {
                            lyrics: parsedLyrics,
                            mainText: processed.mainLrc,
                            wordByWordText: processed.yrcLrc,
                            translationText: processed.transLrc,
                            isPureMusic: processed.isPureMusic,
                            chorusRanges: processed.chorusRanges,
                        },
                    }
                    : undefined
            });
            const ownProviderId = song.sourceRef?.kind === 'online' ? song.sourceRef.providerId : null;
            if (bestMatch && 'lyrics' in bestMatch && bestMatch.source !== ownProviderId) {
                const overrideState: OnlineLyricsState = {
                    lyricsSource: 'online',
                    matchedSongId: bestMatch.id,
                    hasOnlineOverride: true,
                    onlineOverrideLyrics: bestMatch.lyrics,
                    matchedLyricsSource: bestMatch.source,
                    matchedLyricsProviderPlatform: bestMatch.matchedLyricsProviderPlatform,
                };
                await saveOnlineLyricsState(song, overrideState);
                resolvedLyrics = bestMatch.lyrics;
                finalState = overrideState;
                noteLyricsDiagnostic('auto-match:hit', song, {
                    source: bestMatch.source,
                    ...describeLyricsShape(bestMatch.lyrics),
                });
                onStateChange?.(overrideState);
            } else if (bestMatch?.isPureMusic) {
                // Checked against `true`, not with `in`: a MATCH object also carries
                // `isPureMusic: false`, so `'isPureMusic' in bestMatch` was true for it too - and
                // a best match from the track's own provider (which fails the branch above) then
                // landed here and had its perfectly good lyrics thrown away as instrumental.
                const pureMusic = markOnlineLyricsPureMusic(onlineLyricsState);
                await saveOnlineLyricsState(song, pureMusic);
                resolvedLyrics = null;
                finalState = pureMusic;
                noteLyricsDiagnostic('auto-match:pure-music', song, { source: bestMatch.source || 'unknown' });
                onStateChange?.(pureMusic);
            } else {
                noteLyricsDiagnostic('auto-match:miss', song);
            }
        } catch (error) {
            noteLyricsDiagnostic('auto-match:error', song, {
                message: error instanceof Error ? error.message : String(error),
            });
            console.warn('[OnlinePlayback] Failed to auto-match best lyric:', error);
        }
    }

    if (!isCurrent()) return;

    const resolvedText = resolvedLyrics?.lines.map(line => line.fullText).join('\n') ?? '';
    onPureMusicChange?.(
        finalState?.lyricsSource === 'online' && typeof finalState.matchedIsPureMusic === 'boolean'
            ? finalState.matchedIsPureMusic
            : (resolvedLyrics ? isPureMusicLyricText(resolvedText) : processed.isPureMusic)
    );

    if (!resolvedLyrics) {
        noteLyricsDiagnostic('apply:null', song, { reason: 'no-resolved-lyrics', pureMusic: processed.isPureMusic });
        onLyrics(null);
        onDone();
        return;
    }

    noteLyricsDiagnostic('apply:lyrics', song, describeLyricsShape(resolvedLyrics));
    onLyrics(resolvedLyrics);
    saveToCache(lyricCacheKey, resolvedLyrics);
    saveLyricCacheSongMetadata(song);
    onDone();
}
