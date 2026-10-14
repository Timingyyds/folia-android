import React, { useMemo } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, CircleDot, ListPlus, Minus, Play, Plus, RefreshCw, Trash2, Undo2, X } from 'lucide-react';
import { List, type RowComponentProps } from 'react-window';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { BravaisLayer } from './bravaisLayer';
import type { BravaisDirectoryActionId, BravaisDirectoryPanel as BravaisDirectoryPanelModel, BravaisDirectoryRow } from './bravaisHomeModels';
import type { BravaisPanelActions } from './BravaisListPanel';
import BravaisSeamFilterField from './BravaisSeamFilterField';
import BravaisSeamFormView from './BravaisSeamFormView';
import BravaisSeamCrumbs from './BravaisSeamCrumbs';
import { BravaisSeamFlip, BravaisSeamFlipText } from './BravaisSeamFlip';
import { useBravaisReducedTransitions } from './bravaisMotion';
import { bravaisRevealMotion } from './bravaisSeamMotion';

// src/library/suites/bravais/BravaisDirectoryPanel.tsx
// 目录树面板（设计稿 §5「目录树 = GridMap 的批量模式」）：首页「本地」窄缝的 ▤ 打开，缝加宽成面板。顶上面包屑
// 「书库 › 目录」与折叠，下面是这一页的过滤输入位（缝自己的，directory-filter；与首页窄缝里的是同一个 query）、标题与「已选 / 共」、
// 全选框、可滚动的树（本地文件夹：展开 / 收起、三态与「仅本层」；专辑 / 歌手：平铺的勾选行），根节点行悬停时有
// 「重新扫描」「移除根」，被忽略的文件夹有「恢复」；底部是批量操作（播放 / 入队 / 建歌单 / 移除 / 清空选择），
// 建歌单与移除（含移除根）在底部翻成表单态 / 确认态。打开面板是导航（B7 的面板 history），关掉 = 退出批量模式。
// 底部在批量操作与表单之间翻一格（绕 X 轴，BravaisSeamFlip），结果提示淡入 / 淡出，「已选 / 共」变了翻进新的一行。

const ROW_HEIGHT = 48;

const ACTION_ICONS: Record<BravaisDirectoryActionId, React.ComponentType<{ 'aria-hidden'?: boolean }>> = {
    play: Play,
    enqueue: ListPlus,
    'create-playlist': Plus,
    remove: Trash2,
    clear: X,
};

type RowProps = { rows: readonly BravaisDirectoryRow[]; panel: BravaisDirectoryPanelModel };

const SelectionBox: React.FC<{ state: BravaisDirectoryRow['selection'] }> = ({ state }) => (
    <span className={`bravais-dir-check is-${state}`} aria-hidden>
        {state === 'all' && <Check />}
        {state === 'direct' && <CircleDot />}
        {state === 'partial' && <Minus />}
    </span>
);

const DirectoryRow = ({ index, style, rows, panel }: RowComponentProps<RowProps>): React.ReactElement | null => {
    const row = rows[index];
    if (!row) return null;
    const roots = panel.roots;
    return (
        <div style={style} className={`bravais-dir-row${row.ignored ? ' is-ignored' : ''}`} data-bravais-dir-row={row.key}>
            <button
                type="button"
                className="bravais-dir-toggle"
                style={{ marginLeft: Math.min(row.depth, 5) * 12 }}
                disabled={!row.expandable}
                aria-hidden={!row.expandable}
                tabIndex={row.expandable ? 0 : -1}
                onClick={() => panel.onToggleExpanded(row.key)}
            >
                {row.expandable ? (row.expanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />) : null}
            </button>
            <button
                type="button"
                role="checkbox"
                className="bravais-dir-select"
                aria-checked={row.selection === 'all' ? true : row.selection === 'none' ? false : 'mixed'}
                data-bravais-dir-selection={row.selection}
                disabled={!row.selectable}
                onClick={() => panel.onToggleRow(row.key)}
            >
                <SelectionBox state={row.selection} />
                <span className="bravais-dir-text">
                    <strong>{row.label}</strong>
                    <small>{row.detail}</small>
                </span>
            </button>
            {roots && (row.rootPath || row.ignoredPath) && (
                <span className="bravais-dir-ops">
                    {row.ignoredPath && (
                        <button type="button" className="bravais-seam-icon" data-bravais-dir-action="clear-ignore" disabled={roots.disabled}
                            aria-label={roots.clearIgnoreLabel} title={roots.clearIgnoreLabel} onClick={() => roots.clearIgnore(row.ignoredPath!)}>
                            <Undo2 aria-hidden />
                        </button>
                    )}
                    {row.rootPath && (
                        <>
                            <button type="button" className="bravais-seam-icon" data-bravais-dir-action="rescan-root" disabled={roots.disabled}
                                aria-label={roots.rescanLabel} title={roots.rescanLabel} onClick={() => roots.rescan(row.rootPath!)}>
                                <RefreshCw aria-hidden className={roots.busyPath === row.rootPath ? 'animate-spin' : undefined} />
                            </button>
                            <button type="button" className="bravais-seam-icon is-danger" data-bravais-dir-action="remove-root" disabled={roots.disabled}
                                aria-label={roots.removeLabel} title={roots.removeLabel} onClick={() => roots.remove(row.rootPath!)}>
                                <X aria-hidden />
                            </button>
                        </>
                    )}
                </span>
            )}
        </div>
    );
};

const BravaisDirectoryPanel: React.FC<{ layer: BravaisLayer; actions: BravaisPanelActions }> = ({ layer, actions }) => {
    const { t } = useTranslation();
    const panel = layer.home?.panel ?? null;
    const rowProps = useMemo<RowProps | null>(() => (panel ? { rows: panel.rows, panel } : null), [panel]);
    const reveal = bravaisRevealMotion(useBravaisReducedTransitions());
    if (!panel || !rowProps) return null;
    const selectAll = panel.selectAll;
    return (
        <div className="bravais-seam-panel is-directory" data-bravais-directory={layer.key}>
            <div className="bravais-seam-crumbs">
                <button type="button" className="bravais-seam-back" data-bravais-seam-action="close-directory" onClick={actions.close}
                    aria-label={t('libraryBravais.seamBack')} title={t('libraryBravais.seamBack')}>
                    <ChevronLeft aria-hidden />
                </button>
                <BravaisSeamCrumbs layer={layer} panelLabel={panel.crumb} onClosePanel={actions.close} />
                <button type="button" className="bravais-seam-level" data-bravais-seam-action="hide" onClick={actions.fold}>
                    {t('libraryBravais.seamFold')}
                </button>
            </div>
            {layer.seam.filter && <BravaisSeamFilterField filter={layer.seam.filter} variant="panel" />}
            <h2 className="bravais-panel-title" data-bravais-seam-title>{panel.title}</h2>
            <BravaisSeamFlipText as="div" flipKey={panel.summary} className="bravais-seam-meta" data-bravais-directory-summary>{panel.summary}</BravaisSeamFlipText>
            <button
                type="button"
                role="checkbox"
                className="bravais-dir-select is-all"
                aria-checked={selectAll.state === 'all' ? true : selectAll.state === 'none' ? false : 'mixed'}
                data-bravais-dir-select-all={selectAll.state}
                onClick={selectAll.toggle}
            >
                <SelectionBox state={selectAll.state} />
                <span className="bravais-dir-text"><strong>{selectAll.label}</strong></span>
            </button>
            <div className="bravais-panel-list" role="tree" aria-label={panel.title}>
                {panel.rows.length > 0 ? (
                    <List
                        rowCount={panel.rows.length}
                        rowHeight={ROW_HEIGHT}
                        rowComponent={DirectoryRow}
                        rowProps={rowProps}
                        overscanCount={6}
                        className="custom-scrollbar"
                        style={{ height: '100%', width: '100%' }}
                    />
                ) : <p className="bravais-form-message">{panel.emptyLabel}</p>}
            </div>
            <BravaisSeamFlip axis="x" flipKey={panel.form ? `form:${panel.form.formId}` : 'actions'}>
                {panel.form ? (
                    <div className="bravais-dir-form">
                        <BravaisSeamFormView form={panel.form} />
                    </div>
                ) : (
                    <div className="bravais-seam-actions is-directory">
                        {panel.actions.map(action => {
                            const Icon = ACTION_ICONS[action.id];
                            return (
                                <button
                                    key={action.id}
                                    type="button"
                                    className={`bravais-chrome-button${action.id === 'play' ? ' is-primary' : ''}${action.danger ? ' is-danger' : ''}`}
                                    data-bravais-dir-action={action.id}
                                    disabled={action.disabled}
                                    onClick={action.run}
                                >
                                    <Icon aria-hidden />{action.label}
                                </button>
                            );
                        })}
                    </div>
                )}
            </BravaisSeamFlip>
            <AnimatePresence initial={false}>
                {panel.notice && (
                    <motion.div key="notice" className={`bravais-seam-notice is-${panel.notice.tone}`} role="status"
                        data-bravais-seam-notice={panel.notice.tone} {...reveal}>
                        {panel.notice.text}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default BravaisDirectoryPanel;
