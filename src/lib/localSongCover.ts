import type { LocalSong } from '../types';

// src/lib/localSongCover.ts
// Detects the canonical content-addressed local cover reference.

export const hasLocalSongCover = (song: LocalSong): boolean => (
  Boolean(song.localCoverAssetId)
);
