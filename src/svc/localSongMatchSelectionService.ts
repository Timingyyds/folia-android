import type { AmllDbPlatform, LocalSong, LyricData, LyricProviderSource } from '../types';
import type { LocalLibraryAssignmentOrigin } from '../types/localLibrary';
import type { OnlineMetadataCandidate } from './onlineMetadataSearchService';
import { cacheLocalSongOnlineCover, removeCachedCover } from './coverCache';
import { sourceProvidesSongMetadata } from '../lib/lyrics/matchResult';
import { applyMatchedMetadata, restoreImportedMetadata } from './localLibraryCatalogService';

// src/svc/localSongMatchSelectionService.ts
// Applies GridView metadata matches and Player lyric matches through one selection contract.

export type LocalSongMetadataSelection = 'online' | 'imported' | 'keep';
export type LocalSongCoverSelection = 'online' | 'embedded' | 'keep';
export type LocalSongLyricsSelection = 'online' | 'local' | 'embedded' | 'automatic' | 'keep';

export interface LocalSongOnlineLyricsSelection {
  lyrics: LyricData;
  songId: number | string;
  source: LyricProviderSource;
  providerPlatform?: AmllDbPlatform;
  isPureMusic: boolean;
}

export interface ApplyLocalSongMatchSelectionInput {
  songId: string;
  candidate?: OnlineMetadataCandidate;
  metadata: LocalSongMetadataSelection;
  cover: LocalSongCoverSelection;
  lyrics: LocalSongLyricsSelection;
  onlineLyrics?: LocalSongOnlineLyricsSelection;
  setNoAutoMatch?: boolean;
  /** true = 标记为纯音乐（不再自动匹配歌词），false = 取消标记；不传则不动。优先于 lyrics 的选择。 */
  setPureMusicMark?: boolean;
  lyricsFailed?: boolean;
  matchMode?: 'automatic' | 'manual';
  protectOrigins?: LocalLibraryAssignmentOrigin[];
}

export interface ApplyLocalSongMatchSelectionResult {
  coverAttempted: boolean;
  coverCached: boolean;
  lyricsApplied: boolean;
  partialLyricsFailure: boolean;
}

// 歌词匹配弹窗确认时，按来源和开关决定元数据与封面怎么处理。
// 不提供元数据的来源（AMLL）只写歌词：不传候选，元数据和封面保持原样，
// 否则别名会被当成多位歌手写进本地库，没有封面的候选还会清掉已缓存的在线封面。
export const resolveLyricMatchMetadataSelection = (
  source: LyricProviderSource,
  candidate: OnlineMetadataCandidate,
  toggles: { useOnlineMetadata: boolean; useOnlineCover: boolean },
): Pick<ApplyLocalSongMatchSelectionInput, 'candidate' | 'metadata' | 'cover'> => {
  if (!sourceProvidesSongMetadata(source)) {
    return { candidate: undefined, metadata: 'keep', cover: 'keep' };
  }
  return {
    candidate,
    metadata: toggles.useOnlineMetadata ? 'online' : 'imported',
    cover: toggles.useOnlineCover && candidate.coverUrl ? 'online' : 'embedded',
  };
};

const buildSongPatch = (input: ApplyLocalSongMatchSelectionInput) => {
  const patch: Partial<LocalSong> = {};
  if (input.setNoAutoMatch !== undefined) patch.noAutoMatch = input.setNoAutoMatch;
  if (input.cover === 'online') {
    patch.useOnlineCover = Boolean(input.candidate?.coverUrl);
    if (input.candidate?.coverUrl && input.metadata === 'imported') {
      patch.onlineMetadata = {
        source: input.candidate.source,
        songId: input.candidate.songId,
        albumId: input.candidate.album?.id,
        title: input.candidate.title,
        artists: input.candidate.artists,
        album: input.candidate.album,
        coverUrl: input.candidate.coverUrl,
        matchMode: 'manual',
        matchedAt: Date.now(),
      };
    }
  }
  if (input.cover === 'embedded') patch.useOnlineCover = false;
  if (input.lyrics === 'online' && input.onlineLyrics) {
    patch.matchedLyrics = input.onlineLyrics.lyrics;
    patch.matchedIsPureMusic = input.onlineLyrics.isPureMusic;
    patch.matchedLyricsSongId = input.onlineLyrics.songId;
    patch.matchedLyricsSource = input.onlineLyrics.source;
    patch.matchedLyricsProviderPlatform = input.onlineLyrics.providerPlatform;
    patch.lyricsSource = 'online';
    patch.hasManualLyricSelection = true;
    // 手动选了在线歌词，就不再是用户标记的纯音乐。
    patch.markedPureMusic = undefined;
  } else if (input.lyrics === 'local' || input.lyrics === 'embedded') {
    patch.lyricsSource = input.lyrics;
    patch.hasManualLyricSelection = true;
  } else if (input.lyrics === 'automatic') {
    patch.lyricsSource = undefined;
    patch.hasManualLyricSelection = false;
  }
  if (input.setPureMusicMark === true) {
    // 纯音乐标记复用已有的「在线判定为纯音乐」：播放时歌词为空、isPureMusic、导出跳过、自动匹配跳过都现成。
    // lyricsSource 钉在 online，否则按优先级会改用本地 / 内嵌歌词；hasManualLyricSelection 防止旧记录刷新逻辑重新匹配。
    patch.markedPureMusic = true;
    patch.matchedIsPureMusic = true;
    patch.matchedLyrics = undefined;
    patch.matchedLyricsSongId = undefined;
    patch.matchedLyricsSource = undefined;
    patch.matchedLyricsProviderPlatform = undefined;
    patch.lyricsSource = 'online';
    patch.hasManualLyricSelection = true;
  } else if (input.setPureMusicMark === false) {
    // 取消标记回到自动：没有在线歌词也没有纯音乐判定，下次播放会照常自动匹配。
    patch.markedPureMusic = undefined;
    patch.matchedIsPureMusic = undefined;
    patch.lyricsSource = undefined;
    patch.hasManualLyricSelection = false;
  }
  return patch;
};

export const applyLocalSongMatchSelection = async (
  input: ApplyLocalSongMatchSelectionInput,
): Promise<ApplyLocalSongMatchSelectionResult> => {
  const candidateMetadata = input.candidate ? {
    source: input.candidate.source,
    songId: input.candidate.songId,
    title: input.candidate.title,
    artists: input.candidate.artists.length > 0 ? input.candidate.artists : undefined,
    album: input.candidate.album,
    coverUrl: input.candidate.coverUrl,
  } : {};
  const songPatch = buildSongPatch(input);

  if (input.metadata === 'online' && input.candidate) {
    await applyMatchedMetadata(input.songId, candidateMetadata, {
      songPatch,
      assignmentOrigin: input.matchMode === 'automatic' ? 'auto-match' : 'manual-match',
      protectOrigins: input.protectOrigins,
    });
  } else if (input.metadata === 'imported') {
    await restoreImportedMetadata(input.songId, songPatch);
  } else {
    await applyMatchedMetadata(input.songId, candidateMetadata, { lyricsOnly: true, songPatch });
  }

  const coverAttempted = input.cover === 'online' && Boolean(input.candidate?.coverUrl);
  const coverCached = coverAttempted && input.candidate?.coverUrl
    ? await cacheLocalSongOnlineCover(input.songId, input.candidate.coverUrl)
    : false;
  if (input.cover === 'embedded') await removeCachedCover(`cover_local_${input.songId}`);

  return {
    coverAttempted,
    coverCached,
    lyricsApplied: input.lyrics !== 'online' || Boolean(input.onlineLyrics) || input.setPureMusicMark === true,
    partialLyricsFailure: Boolean(input.lyricsFailed && !input.onlineLyrics),
  };
};

// 两个歌词匹配窗口与命令面板共用：只改纯音乐标记，元数据、封面和其他歌词选择都不动。
export const setLocalSongPureMusicMark = async (songId: string, marked: boolean): Promise<void> => {
  await applyLocalSongMatchSelection({
    songId,
    metadata: 'keep',
    cover: 'keep',
    lyrics: 'keep',
    setPureMusicMark: marked,
  });
};
