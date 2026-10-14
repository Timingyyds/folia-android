import React from 'react';
import type { LibraryActionId, LibraryCollectionSurfaceProps } from '../../../core/contracts/suite';
import { useGridMorphPlan } from '../transitions/useGridMorphPlan';
import { useGridStayPlayback } from '../shared/useGridStayPlayback';
import GridView from './GridView';

// src/library/suites/grid/collection/GridCollectionSurface.tsx
// 网格的集合 surface：把宿主交给任何 suite 的同一份输入（core/contracts/suite 的 LibraryCollectionSurfaceProps）
// 接到 GridView 的旧 props 上。网格专属的部分在这里补：移形换影的入场计划（自己从转场 store 读）。
// 变更动作（删歌、订阅、改名……）经变更控制器（mutations）；标题、副标题的取法原样搬自 GridViewOverlayHost。
// fb3：「留在原处」时卡片的播放经 useGridStayPlayback（正在播放的那首切换暂停 / 继续，卡片按播放状态画）。

const GridCollectionSurface: React.FC<LibraryCollectionSurfaceProps> = ({
    collection,
    resource,
    playback,
    mutations,
    localSongs,
    theme,
    isDaylight,
    isInteractive,
    onStatusMessage,
    declaredActions,
    onBack,
    onDone,
    onOpenAlbum,
    onOpenArtist,
}) => {
    const morphPlan = useGridMorphPlan();
    const stayPlayback = useGridStayPlayback(playback.playTrack, playback);
    // 卡片上的专辑 / 歌手链接只在网格声明了 open-album / open-artist 时出现（声明 ∩ 曲目上能解析出的目录引用）。
    const declares = (action: LibraryActionId) => declaredActions.actions.includes(action);
    const subtitle = (collection as any).creator?.nickname || (collection as any).artists?.[0]?.name || collection.description || '';

    return (
        <GridView
            title={collection.name}
            subtitle={subtitle}
            collection={collection}
            mode="tracks"
            onBack={onBack}
            onDone={onDone}
            onSelectTrack={stayPlayback.selectTrack}
            trackPlaybackMark={stayPlayback.markFor}
            onAddTrackToQueue={playback.enqueueTrack}
            onPlayAll={playback.playAll}
            onAddAllToQueue={playback.enqueueAll}
            onSelectAlbum={declares('open-album') ? onOpenAlbum : undefined}
            onSelectArtist={declares('open-artist') ? onOpenArtist : undefined}
            onStatusMessage={onStatusMessage}
            resource={resource}
            mutations={mutations}
            localSongs={localSongs}
            theme={theme}
            isDaylight={isDaylight}
            isInteractive={isInteractive}
            morphPlan={morphPlan}
            declaredActions={declaredActions}
        />
    );
};

export default GridCollectionSurface;
