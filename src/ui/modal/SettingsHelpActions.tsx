import React, { useState } from 'react';
import { Check, ClipboardCopy, FileDown, Lightbulb, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
    canDeleteExportedDiagnostics,
    deleteExportedDiagnostics,
    exportDiagnosticReport,
} from '../../svc/exportDiagnosticReport';

// src/ui/modal/SettingsHelpActions.tsx

type SettingsHelpActionsProps = {
    onOpenReleaseNotes: () => void;
    onOpenPonder: () => void;
    buildDiagnostics: () => Promise<string>;
};

type CopyState = 'idle' | 'working' | 'copied' | 'failed';
type ExportState = 'idle' | 'working' | 'shared' | 'downloaded' | 'failed';
type DeleteState = 'idle' | 'working' | 'done' | 'empty' | 'failed';

const SettingsHelpActions: React.FC<SettingsHelpActionsProps> = ({
    onOpenReleaseNotes,
    onOpenPonder,
    buildDiagnostics,
}) => {
    const { t } = useTranslation();
    const [copyState, setCopyState] = useState<CopyState>('idle');
    const [exportState, setExportState] = useState<ExportState>('idle');
    const [deleteState, setDeleteState] = useState<DeleteState>('idle');
    const [deletedCount, setDeletedCount] = useState(0);
    const [canDeleteDiagnostics] = useState(() => canDeleteExportedDiagnostics());

    const handleCopyDiagnostics = async () => {
        setCopyState('working');
        try {
            const report = await buildDiagnostics();
            await navigator.clipboard.writeText(report);
            setCopyState('copied');
        } catch (error) {
            console.warn('[Settings] diagnostics:copy-failed', error);
            setCopyState('failed');
        }
    };

    const handleExportDiagnostics = async () => {
        setExportState('working');
        try {
            const report = await buildDiagnostics();
            const result = await exportDiagnosticReport(report, t('help.exportDiagnostics'));
            // 用户在系统面板里取消不算失败，回到空闲状态即可。
            setExportState(result === 'cancelled' ? 'idle' : result);
        } catch (error) {
            console.warn('[Settings] diagnostics:export-failed', error);
            setExportState('failed');
        }
    };

    const handleDeleteDiagnostics = async () => {
        setDeleteState('working');
        try {
            const count = await deleteExportedDiagnostics();
            setDeletedCount(count);
            setDeleteState(count > 0 ? 'done' : 'empty');
        } catch (error) {
            console.warn('[Settings] diagnostics:delete-failed', error);
            setDeleteState('failed');
        }
    };

    const CopyIcon = copyState === 'working' ? Loader2 : copyState === 'copied' ? Check : ClipboardCopy;
    const ExportIcon = exportState === 'working'
        ? Loader2
        : exportState === 'shared' || exportState === 'downloaded'
            ? Check
            : FileDown;
    const DeleteIcon = deleteState === 'working' ? Loader2 : deleteState === 'done' ? Check : Trash2;

    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
                type="button"
                data-testid="help-release-notes"
                onClick={onOpenReleaseNotes}
                className="flex items-center gap-3 rounded-2xl bg-white/5 p-4 text-left transition-colors hover:bg-white/10"
                style={{ color: 'var(--text-primary)' }}
            >
                <Sparkles size={19} className="shrink-0 opacity-75" aria-hidden="true" />
                <span>
                    <span className="block text-sm font-semibold">{t('help.releaseNotes')}</span>
                    <span className="mt-0.5 block text-xs opacity-55">{t('help.releaseNotesDescription')}</span>
                </span>
            </button>
            <button
                type="button"
                data-testid="help-page-ponder"
                onClick={onOpenPonder}
                className="flex items-center gap-3 rounded-2xl bg-white/5 p-4 text-left transition-colors hover:bg-white/10"
                style={{ color: 'var(--text-primary)' }}
            >
                <Lightbulb size={19} className="shrink-0 opacity-75" aria-hidden="true" />
                <span>
                    <span className="block text-sm font-semibold">{t('help.ponder')}</span>
                    <span className="mt-0.5 block text-xs opacity-55">{t('help.ponderDescription')}</span>
                </span>
            </button>
            <button
                type="button"
                data-testid="help-copy-diagnostics"
                onClick={() => void handleCopyDiagnostics()}
                disabled={copyState === 'working'}
                className="flex items-center gap-3 rounded-2xl bg-white/5 p-4 text-left transition-colors hover:bg-white/10 disabled:opacity-50 disabled:cursor-default sm:col-span-2"
                style={{ color: 'var(--text-primary)' }}
            >
                <CopyIcon
                    size={19}
                    className={`shrink-0 opacity-75 ${copyState === 'working' ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                />
                <span>
                    <span className="block text-sm font-semibold">
                        {copyState === 'copied'
                            ? t('help.copyDiagnosticsCopied')
                            : copyState === 'failed'
                                ? t('help.copyDiagnosticsFailed')
                                : t('help.copyDiagnostics')}
                    </span>
                    <span className="mt-0.5 block text-xs opacity-55">{t('help.copyDiagnosticsDescription')}</span>
                </span>
            </button>
            <button
                type="button"
                data-testid="help-export-diagnostics"
                onClick={() => void handleExportDiagnostics()}
                disabled={exportState === 'working'}
                className={`flex items-center gap-3 rounded-2xl bg-white/5 p-4 text-left transition-colors hover:bg-white/10 disabled:opacity-50 disabled:cursor-default ${canDeleteDiagnostics ? '' : 'sm:col-span-2'}`}
                style={{ color: 'var(--text-primary)' }}
            >
                <ExportIcon
                    size={19}
                    className={`shrink-0 opacity-75 ${exportState === 'working' ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                />
                <span>
                    <span className="block text-sm font-semibold">
                        {exportState === 'shared'
                            ? t('help.exportDiagnosticsShared')
                            : exportState === 'downloaded'
                                ? t('help.exportDiagnosticsDownloaded')
                                : exportState === 'failed'
                                    ? t('help.exportDiagnosticsFailed')
                                    : t('help.exportDiagnostics')}
                    </span>
                    <span className="mt-0.5 block text-xs opacity-55">{t('help.exportDiagnosticsDescription')}</span>
                </span>
            </button>
            {canDeleteDiagnostics ? (
                <button
                    type="button"
                    data-testid="help-delete-diagnostics"
                    onClick={() => void handleDeleteDiagnostics()}
                    disabled={deleteState === 'working'}
                    className="flex items-center gap-3 rounded-2xl bg-white/5 p-4 text-left transition-colors hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-default"
                    style={{ color: 'var(--text-primary)' }}
                >
                    <DeleteIcon
                        size={19}
                        className={`shrink-0 opacity-75 ${deleteState === 'working' ? 'animate-spin' : ''}`}
                        aria-hidden="true"
                    />
                    <span>
                        <span className="block text-sm font-semibold">
                            {deleteState === 'done'
                                ? t('help.deleteDiagnosticsDone', { count: deletedCount })
                                : deleteState === 'empty'
                                    ? t('help.deleteDiagnosticsEmpty')
                                    : deleteState === 'failed'
                                        ? t('help.deleteDiagnosticsFailed')
                                        : t('help.deleteDiagnostics')}
                        </span>
                        <span className="mt-0.5 block text-xs opacity-55">{t('help.deleteDiagnosticsDescription')}</span>
                    </span>
                </button>
            ) : null}
        </div>
    );
};

export default SettingsHelpActions;
