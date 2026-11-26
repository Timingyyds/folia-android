import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Image as ImageIcon, Loader2, RotateCcw, Trash2, Video } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Sheet } from '../../shared/Sheet';
import { Segmented } from '../../modal/settings/kit';
import { wallpaperCategories, type OnlineWallpaperItem, type WallpaperSource } from '../../../services/onlineWallpaper';
import { isOnlineWallpaperSupported, wallpaperThumbUrl, type WallpaperLibraryEntry } from '../../../services/onlineWallpaper/library';
import { useOnlineWallpaperStore } from '../../../stores/useOnlineWallpaperStore';
import { useVideoLayerSettingsStore } from '../../../stores/useVideoLayerSettingsStore';

// src/components/visualizer/videoLayer/OnlineWallpaperLibrary.tsx
// 播放页的视频层里打开的在线壁纸库：左边在线列表（下载），右边已下载（点一下换背景）。
// 下载走原生落盘，列表里的封面是站点缩略图，已下载列表则用本地 /wallpaper/ 地址。

interface OnlineWallpaperLibraryProps {
    isOpen: boolean;
    onClose: () => void;
}

const CARD_CLASS = 'group relative overflow-hidden rounded-xl border border-[var(--st-line)] bg-[var(--st-fill)] text-left transition-[border-color,transform] enabled:hover:border-[var(--st-accent)] enabled:active:scale-[0.99]';

const OnlineWallpaperLibrary: React.FC<OnlineWallpaperLibraryProps> = ({ isOpen, onClose }) => {
    const { t } = useTranslation();
    const {
        tab, source, category, items, hasMore, loading, loadingMore, error,
        downloaded, downloadedLoading, downloads, serverPort,
        setTab, setSource, setCategory, initialize, reload, loadMore, download, remove, apply, clearError,
    } = useOnlineWallpaperStore(useShallow(state => ({
        tab: state.tab,
        source: state.source,
        category: state.category,
        items: state.items,
        hasMore: state.hasMore,
        loading: state.loading,
        loadingMore: state.loadingMore,
        error: state.error,
        downloaded: state.downloaded,
        downloadedLoading: state.downloadedLoading,
        downloads: state.downloads,
        serverPort: state.serverPort,
        setTab: state.setTab,
        setSource: state.setSource,
        setCategory: state.setCategory,
        initialize: state.initialize,
        reload: state.reload,
        loadMore: state.loadMore,
        download: state.download,
        remove: state.remove,
        apply: state.apply,
        clearError: state.clearError,
    })));
    const activeId = useVideoLayerSettingsStore(state => state.onlineWallpaperId);
    const supported = isOnlineWallpaperSupported();

    useEffect(() => {
        if (isOpen) void initialize();
    }, [isOpen, initialize]);

    const downloadedById = useMemo(
        () => new Map(downloaded.map(entry => [entry.id, entry])),
        [downloaded],
    );
    const categories = useMemo(() => wallpaperCategories(source), [source]);

    const handleOnlineClick = (item: OnlineWallpaperItem) => {
        const stored = downloadedById.get(item.id);
        if (stored) {
            void apply(stored);
            return;
        }
        const current = downloads[item.id];
        // 正在下/排队的再点没有意义；失败的点击就是重试。
        if (current && current.status !== 'error') return;
        void download(item);
    };

    const handleApply = (entry: WallpaperLibraryEntry) => {
        void apply(entry);
    };

    const renderCard = (options: {
        key: string;
        thumbUrl: string;
        title: string;
        kind: 'video' | 'image';
        resolution?: string;
        active?: boolean;
        downloadedAlready?: boolean;
        download?: { status: string; progress: number };
        onClick: () => void;
        onRemove?: () => void;
    }) => (
        <div key={options.key} className={CARD_CLASS}>
            <button
                type="button"
                className="absolute inset-0 z-0"
                onClick={options.onClick}
                aria-label={options.title}
            />
            <div className="pointer-events-none relative">
                <div className="relative aspect-video w-full overflow-hidden bg-black/30">
                    <div className="absolute inset-0 grid place-items-center text-[color:var(--st-t2)]">
                        {options.kind === 'video' ? <Video size={20} /> : <ImageIcon size={20} />}
                    </div>
                    {options.thumbUrl && (
                        <img
                            src={options.thumbUrl}
                            alt=""
                            loading="lazy"
                            className="relative h-full w-full object-cover"
                            onError={event => { event.currentTarget.style.visibility = 'hidden'; }}
                        />
                    )}
                    <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] leading-4 text-white">
                        {options.kind === 'video' ? t('wallpaper.kindVideo') : t('wallpaper.kindImage')}
                    </span>
                    {(options.active || options.downloadedAlready) && (
                        <span className={`absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full ${options.active ? 'bg-[var(--st-accent)] text-[color:var(--st-on-accent)]' : 'bg-black/60 text-white'}`}>
                            <Check size={12} />
                        </span>
                    )}
                    {options.download && (
                        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/65 px-3 text-[11px] text-white">
                            {options.download.status === 'queued' ? (
                                <span>{t('wallpaper.queued')}</span>
                            ) : options.download.status === 'resolving' ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    <span>{t('wallpaper.resolving')}</span>
                                </>
                            ) : options.download.status === 'done' ? (
                                <>
                                    <Check size={16} />
                                    <span>{t('wallpaper.downloaded')}</span>
                                </>
                            ) : (
                                <>
                                    <span>{`${t('wallpaper.downloading')} ${Math.round(options.download.progress)}%`}</span>
                                    <span className="h-1 w-4/5 overflow-hidden rounded-full bg-white/25">
                                        <span
                                            className="block h-full rounded-full bg-[var(--st-accent)] transition-[width] duration-200"
                                            style={{ width: `${Math.max(2, Math.min(100, options.download.progress))}%` }}
                                        />
                                    </span>
                                </>
                            )}
                        </span>
                    )}
                </div>
                <div className="flex items-start gap-1 px-2 py-1.5">
                    <div className={`min-w-0 flex-1 ${options.onRemove ? 'pr-6' : ''}`}>
                        <div className="line-clamp-2 text-[11px] leading-4 text-[color:var(--st-t1)]">{options.title}</div>
                        {options.resolution && (
                            <div className="mt-0.5 text-[10px] text-[color:var(--st-t2)]">{options.resolution}</div>
                        )}
                    </div>
                </div>
            </div>
            {options.onRemove && (
                <button
                    type="button"
                    className="absolute right-1 top-[calc(100%-1.75rem)] z-10 grid h-6 w-6 place-items-center rounded text-[color:var(--st-t2)] hover:bg-[var(--st-fill2)] hover:text-[color:var(--st-err)]"
                    title={t('wallpaper.delete')}
                    onClick={(event) => { event.stopPropagation(); options.onRemove?.(); }}
                >
                    <Trash2 size={13} />
                </button>
            )}
        </div>
    );

    return (
        <Sheet
            isOpen={isOpen}
            onClose={onClose}
            size="l"
            title={t('wallpaper.libraryTitle')}
            subtitle={t('wallpaper.librarySubtitle')}
            body="fill"
            footerNote={supported ? t('wallpaper.storageNote') : t('wallpaper.unsupported')}
        >
            <div className="flex h-full min-h-0 flex-col gap-2">
                {!supported && (
                    <p className="rounded-lg bg-[var(--st-fill)] px-3 py-2 text-xs text-[color:var(--st-t2)]">
                        {t('wallpaper.unsupported')}
                    </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                    <Segmented
                        value={tab}
                        options={[
                            { value: 'online', label: t('wallpaper.tabOnline') },
                            { value: 'downloaded', label: `${t('wallpaper.tabDownloaded')}${downloaded.length ? ` (${downloaded.length})` : ''}` },
                        ]}
                        onChange={value => setTab(value as 'online' | 'downloaded')}
                    />
                    {tab === 'online' && (
                        <Segmented
                            value={source}
                            options={[
                                { value: 'moewalls', label: t('wallpaper.sourceMoewalls') },
                                { value: 'bizhihui', label: t('wallpaper.sourceBizhihui') },
                            ]}
                            onChange={value => setSource(value as WallpaperSource)}
                        />
                    )}
                    {tab === 'online' && (
                        <button
                            type="button"
                            className="ml-auto grid h-7 w-7 place-items-center rounded-lg text-[color:var(--st-t2)] hover:bg-[var(--st-fill)] hover:text-[color:var(--st-t1)]"
                            title={t('wallpaper.refresh')}
                            onClick={() => { clearError(); void reload(); }}
                            disabled={loading}
                        >
                            <RotateCcw size={14} className={loading ? 'animate-spin' : ''} />
                        </button>
                    )}
                </div>

                {tab === 'online' && (
                    <div className="st-scroll -mx-1 flex shrink-0 gap-1 overflow-x-auto px-1 pb-1">
                        {[{ slug: null as string | null, label: t('wallpaper.categoryAll') }, ...categories].map(entry => (
                            <button
                                key={entry.slug ?? 'all'}
                                type="button"
                                onClick={() => setCategory(entry.slug)}
                                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] transition-colors ${category === entry.slug ? 'bg-[var(--st-accent)] text-[color:var(--st-on-accent)]' : 'bg-[var(--st-fill)] text-[color:var(--st-t2)] hover:text-[color:var(--st-t1)]'}`}
                            >
                                {entry.label}
                            </button>
                        ))}
                    </div>
                )}

                {error && (
                    <button
                        type="button"
                        className="shrink-0 rounded-lg bg-[var(--st-fill)] px-3 py-2 text-left text-[11px] leading-4 text-[color:var(--st-err)]"
                        onClick={clearError}
                        title={t('wallpaper.dismissError')}
                    >
                        {error}
                    </button>
                )}

                <div className="st-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
                    {tab === 'online' ? (
                        loading ? (
                            <div className="grid h-full place-items-center text-xs text-[color:var(--st-t2)]">
                                <Loader2 size={20} className="animate-spin" />
                            </div>
                        ) : items.length === 0 ? (
                            <div className="grid h-full place-items-center px-6 text-center text-xs text-[color:var(--st-t2)]">
                                {t('wallpaper.empty')}
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                                    {items.map(item => {
                                        const stored = downloadedById.get(item.id);
                                        const download = downloads[item.id];
                                        return renderCard({
                                            key: item.id,
                                            // 站点查 Referer，直连的 <img> 一定空白：统一走本机代理。
                                            thumbUrl: wallpaperThumbUrl(serverPort, item.thumbUrl),
                                            title: item.title,
                                            kind: item.kind,
                                            resolution: item.resolution,
                                            downloadedAlready: Boolean(stored),
                                            active: stored ? stored.id === activeId : false,
                                            // 失败的不盖遮罩：卡片回到可点状态，再点一次就是重试。
                                            download: download && download.status !== 'error' ? download : undefined,
                                            onClick: () => handleOnlineClick(item),
                                        });
                                    })}
                                </div>
                                {hasMore && (
                                    <div className="flex justify-center py-3">
                                        <button
                                            type="button"
                                            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--st-fill)] px-3 py-1.5 text-[11px] text-[color:var(--st-t1)] enabled:hover:bg-[var(--st-fill2)] disabled:opacity-50"
                                            onClick={() => void loadMore()}
                                            disabled={loadingMore}
                                        >
                                            {loadingMore && <Loader2 size={12} className="animate-spin" />}
                                            {loadingMore ? t('wallpaper.loading') : t('wallpaper.loadMore')}
                                        </button>
                                    </div>
                                )}
                            </>
                        )
                    ) : downloadedLoading ? (
                        <div className="grid h-full place-items-center text-xs text-[color:var(--st-t2)]">
                            <Loader2 size={20} className="animate-spin" />
                        </div>
                    ) : downloaded.length === 0 ? (
                        <div className="grid h-full place-items-center px-6 text-center text-xs text-[color:var(--st-t2)]">
                            {t('wallpaper.emptyDownloaded')}
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                            {downloaded.map(entry => renderCard({
                                key: entry.id,
                                thumbUrl: entry.thumbUrl,
                                title: entry.title,
                                kind: entry.kind,
                                resolution: entry.size > 0 ? `${Math.max(1, Math.round(entry.size / 1048576))} MB` : undefined,
                                active: entry.id === activeId,
                                onClick: () => handleApply(entry),
                                onRemove: () => { void remove(entry); },
                            }))}
                        </div>
                    )}
                </div>
            </div>
        </Sheet>
    );
};

export default OnlineWallpaperLibrary;
