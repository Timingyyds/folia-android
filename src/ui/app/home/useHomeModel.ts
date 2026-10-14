import { useMemo } from 'react';
import { usePlaybackStore } from '../../../state/usePlaybackStore';
import { useLibraryStore } from '../../../state/useLibraryStore';
import { useStableCallbacks } from '../../../hooks/useStableCallbacks';
import { buildHomeModel, type HomeModelDeps, type HomeViewModel } from './buildHomeModel';

// src/ui/app/home/useHomeModel.ts

/**
 * The Home model with the three ambient values already filled in. All three are store reads that
 * App.tsx used to perform only to hand them back here.
 */
export const useHomeModel = (deps: HomeModelDeps): HomeViewModel => {
    const currentSong = usePlaybackStore(state => state.currentSong);
    const activePlaybackContext = usePlaybackStore(state => state.activePlaybackContext);
    const navidromeEnabled = useLibraryStore(state => state.navidromeEnabled);
    // fb3：应用的 togglePlay 随播放状态换身份；不稳定化的话每次暂停 / 继续都会重建整个首页模型（与下游所有 surface 的 props）。
    const { togglePlayback } = useStableCallbacks({ togglePlayback: deps.togglePlayback });

    return useMemo(() => buildHomeModel({
        ...deps,
        togglePlayback,
        currentSong,
        activePlaybackContext,
        navidromeEnabled,
        // Spread rather than `deps`: the caller passes an object literal, so depending on the object
        // would rebuild this every render. The key set is fixed by the call site.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [...Object.entries(deps).filter(([key]) => key !== 'togglePlayback').map(([, value]) => value), togglePlayback, currentSong, activePlaybackContext, navidromeEnabled]);
};
