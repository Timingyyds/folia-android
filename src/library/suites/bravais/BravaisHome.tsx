import React, { useCallback } from 'react';
import type { LibraryHomeSurfaceProps } from '../../core/contracts/suite';
import type { LibraryHomeTabKey } from '../../core/contracts/homeModel';
import { isOnlineHomeTab } from '../../core/model/homeSources';
import { useLibraryHomeSources } from '../../core/bindings/useLibraryHomeSources';
import { useLibraryHomeOnline } from '../../core/bindings/useLibraryHomeOnline';
import { useLibraryHomeActions } from '../../core/bindings/useLibraryHomeActions';
import { useLibraryHomeDirectory } from '../../core/bindings/useLibraryHomeDirectory';
import { useLibraryHomeTabsRegistration } from '../../core/bindings/useLibraryHomeSurfaceRegistration';
import { setBravaisSearchOpen } from './bravaisHomeUiStore';
import { useBravaisHomeChrome } from './useBravaisHomeChrome';
import { BravaisHomeLocal, BravaisHomeNavidrome, BravaisHomeOnline } from './BravaisHomeSources';

// src/library/suites/bravais/BravaisHome.tsx
// 首页 surface（B9，设计稿 §10.5）：五个页签（歌单 / 电台 / 专辑 / 本地 / Navidrome）都铺墙。与 TUI、网格用同一套首页
// 绑定（来源与页签、在线列表、首页资源与动作都来自 core，换 suite 不重新请求），按当前来源挂一个来源组件
// （BravaisHomeSources），它把当前页签 / section 的卡片投影成首页层推进 stage store；这里自己只渲染一个不可见的锚点。
// 切页签 = 换首页层（`home:<页签>`）：stage 整墙出场 → 入场；本地四行、Navidrome 的 section 是缝里的二级切换，不换层。
// 页签条交给首页 surface 句柄（useLibraryHomeTabsRegistration），命令面板的「打开歌单 / 本地…」写的是同一个页签。

const BravaisHome: React.FC<LibraryHomeSurfaceProps> = (props) => {
    const {
        account,
        user,
        playlists,
        cloudPlaylist,
        navidromeEnabled,
        localMusicState,
        setLocalMusicState,
        homeResources,
        directoryActions,
        onOpenGridView,
        isInteractive,
        declaredActions,
    } = props;
    const sources = useLibraryHomeSources({ account, user, playlists, cloudPlaylist, navidromeEnabled });
    const { tab, setTab, tabs, online } = sources;
    const onlineList = useLibraryHomeOnline(homeResources, sources);
    const { scanPercent, snapshot: actionState } = useLibraryHomeActions(homeResources.actions);
    const { directoryKey, hiddenScope } = useLibraryHomeDirectory({
        tab,
        providerId: online.providerId,
        localRow: localMusicState.activeRow,
    });

    const selectTab = useCallback((key: LibraryHomeTabKey) => {
        const target = tabs.find(candidate => candidate.key === key);
        if (!target || target.disabledReason) return false;
        setBravaisSearchOpen(false);
        setTab(key);
        return true;
    }, [setTab, tabs]);
    useLibraryHomeTabsRegistration({ getState: () => ({ active: tab, tabs }), setTab: selectTab });

    const chrome = useBravaisHomeChrome({
        tab,
        tabs,
        selectTab,
        scanPercent,
        scanning: Boolean(actionState.scan?.active),
        props,
    });
    const tabLabel = (key: LibraryHomeTabKey) => tabs.find(candidate => candidate.key === key)?.label ?? key;
    const common = {
        chrome,
        directoryKey,
        hiddenScope,
        declaredActions,
        isInteractive,
        homeActions: homeResources.actions,
        onOpenGridView,
    };

    return (
        <div
            data-library-home="bravais"
            data-library-surface="home"
            data-ponder-page-scope="bravais-wall"
            aria-hidden
            className="pointer-events-none absolute inset-0"
        >
            {isOnlineHomeTab(tab) ? (
                <BravaisHomeOnline {...common} tab={tab} online={online} list={onlineList} account={account} />
            ) : tab === 'local' ? (
                <BravaisHomeLocal
                    {...common}
                    meta={tabLabel('local')}
                    localSongs={props.localSongs}
                    localPlaylists={props.localPlaylists}
                    catalog={props.localLibraryCatalog}
                    activeRow={localMusicState.activeRow}
                    setActiveRow={row => setLocalMusicState(previous => ({ ...previous, activeRow: row }))}
                    treesResource={homeResources.localDirectoryTrees}
                    directoryActions={directoryActions}
                />
            ) : (
                <BravaisHomeNavidrome {...common} meta={tabLabel('navidrome')} overview={homeResources.navidromeOverview} />
            )}
        </div>
    );
};

export default BravaisHome;
