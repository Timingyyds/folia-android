import { OnlineProviderError } from '../../../types/onlineMusic';
import type { ProviderErrorCode } from '../../../types/onlineMusic';
import { spotifyAndroidAvailable, runSpotifyAndroidOperation } from './spotifyAndroid';

// src/services/onlineMusic/spotify/spotifyTransport.ts
// The IPC boundary to electron/spotify/spotifyApiBridge.cjs. The Spotify token stays in the main
// process; a query is named here and sent there, and its answer comes back as Spotify gave it.

export type SpotifyOperation =
    | 'login_start' | 'login_check' | 'login_cancel' | 'login_open' | 'login_status' | 'logout'
    | 'query' | 'radio' | 'lyrics' | 'audio' | 'audio_kept' | 'audio_keep' | 'audio_probe' | 'library' | 'playlist_edit' | 'playlist_create'
    | 'playback_mode' | 'soloist_state' | 'soloist_pick' | 'soloist_key' | 'soloist_restart' | 'soloist_open'
    | 'soloist_play' | 'soloist_pause' | 'soloist_resume' | 'soloist_seek' | 'soloist_volume' | 'soloist_status'
    | 'soloist_repeat';
// The queries the main process sends for the renderer (`RENDERER_QUERIES` in the bridge).
export type SpotifyQuery =
    | 'home' | 'homeSection' | 'browsePage' | 'queryWhatsNewFeed' | 'libraryV3' | 'fetchLibraryTracks' | 'fetchPlaylist'
    | 'getAlbum' | 'queryArtistOverview' | 'queryArtistDiscographyAll' | 'searchTracks' | 'getTrack' | 'areEntitiesInLibrary';
export type SpotifyParams = Record<string, unknown>;
// `reason`: the desktop side's own word for why a sign-in failed, where it has one.
export type SpotifyBridgeResult =
    | { ok: true; data: unknown }
    | { ok: false; error: { code: ProviderErrorCode; message: string; reason?: string } };

export interface SpotifyWireLoginStart { key: string; expiresInMs: number }
/** The playlist Spotify keeps of the songs like one song. */
export interface SpotifyWireRadio { uri: string }
/** The app's own URL for a track's audio, and the file Spotify chose for it ("OGG_VORBIS_320"). */
export interface SpotifyWireAudio { url: string; format: string }
/** The playlist that was made. */
export interface SpotifyWireMadePlaylist { uri: string }
export interface SpotifyWireLyrics { timed: boolean; lines: Array<{ startMs: number; words: string }> }

// 手机端没有 Electron 主进程，但 WebView 里能直接做同一套事（见 spotifyAndroid.ts）。
export const getSpotifyTransportAvailability = () => (
    typeof window !== 'undefined' && typeof window.electron?.spotifyRequest === 'function'
        ? { configured: true } as const
        : spotifyAndroidAvailable()
            ? { configured: true } as const
            : { configured: false, reason: 'not-configured' } as const
);

export async function requestSpotify<T = unknown>(operation: SpotifyOperation, params: SpotifyParams = {}): Promise<T> {
    if (!getSpotifyTransportAvailability().configured) {
        throw new OnlineProviderError('unavailable', 'Spotify requires the desktop app', 'spotify');
    }
    const named = operation === 'query' ? `${operation} ${String(params.name)}` : operation;
    // Android：没有主进程可问，就在 WebView 里就地做（OAuth PKCE + pathfinder）。
    if (typeof window.electron?.spotifyRequest !== 'function') {
        const startedAt = Date.now();
        try {
            return await runSpotifyAndroidOperation(operation, params) as T;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[Spotify] ${named} failed after ${Date.now() - startedAt}ms: ${message}`);
            if (error instanceof OnlineProviderError) throw error;
            throw new OnlineProviderError('unavailable', `Spotify request failed: ${message}`, 'spotify');
        }
    }
    const startedAt = Date.now();
    let result: SpotifyBridgeResult;
    try { result = await window.electron!.spotifyRequest(operation, params); }
    catch {
        console.warn(`[Spotify] ${named} did not reach the desktop app`);
        throw new OnlineProviderError('network', 'Spotify desktop request failed', 'spotify');
    }
    if (!result.ok) {
        console.warn(`[Spotify] ${named} failed after ${Date.now() - startedAt}ms: ${result.error.code} (${result.error.message ?? ''})`);
        // The reason goes with the error as its cause (spotifyLoginFailure.ts reads it there).
        throw new OnlineProviderError(result.error.code, result.error.message, 'spotify', result.error.reason);
    }
    return result.data as T;
}

// One of Spotify's named queries, answered with the `data` of its reply.
export const querySpotify = <T = unknown>(name: SpotifyQuery, variables: Record<string, unknown> = {}): Promise<T> => (
    requestSpotify<T>('query', { name, variables })
);
