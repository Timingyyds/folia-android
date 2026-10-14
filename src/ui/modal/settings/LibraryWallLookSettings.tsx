import React from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useLibraryWallLookStore } from '../../../state/useLibraryWallLookStore';
import {
    LIBRARY_WALL_LOOKS,
    LIBRARY_WALL_WINDOW_COUNTS,
    libraryWallWindowSharePercent,
    type LibraryWallLook,
} from '../../../lib/libraryWallLook';

// src/ui/modal/settings/LibraryWallLookSettings.tsx
// 界面设置「Bravais 墙面」分组（BravaisSettingsSection）里的透光设置：三选一的档位，部分透明时再出现 1–6 档的每块窗数
// （标注占块的百分比）。只在生效 suite 是 bravais 时出现——门控在外层分组（与命令面板同一个 isBravaisLibraryActive）。
// 不进外观配置的导入导出（见 useLibraryWallLookStore 的说明）。

const LOOK_LABEL_KEYS: Record<LibraryWallLook, { label: string; description: string }> = {
    solid: { label: 'options.libraryWallLookSolid', description: 'options.libraryWallLookSolidDesc' },
    partial: { label: 'options.libraryWallLookPartial', description: 'options.libraryWallLookPartialDesc' },
    clear: { label: 'options.libraryWallLookClear', description: 'options.libraryWallLookClearDesc' },
};

type LibraryWallLookSettingsProps = {
    isDaylight: boolean;
    accentColor: string;
};

const LibraryWallLookSettings: React.FC<LibraryWallLookSettingsProps> = ({ isDaylight, accentColor }) => {
    const { t } = useTranslation();
    const { look, windowsPerBlock, setLook, setWindowsPerBlock } = useLibraryWallLookStore(useShallow(state => ({
        look: state.look,
        windowsPerBlock: state.windowsPerBlock,
        setLook: state.setLook,
        setWindowsPerBlock: state.setWindowsPerBlock,
    })));

    const idleBorder = isDaylight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';
    const frameClass = (isSelected: boolean) => (isSelected
        ? (isDaylight ? 'bg-white shadow-md' : 'bg-white/[0.07]')
        : (isDaylight ? 'bg-zinc-50 hover:bg-white' : 'bg-white/[0.03] hover:bg-white/[0.06]'));

    return (
        <div className="space-y-4 border-t pt-4" style={{ borderColor: idleBorder }} data-library-wall-look-settings="">
            <div className="space-y-1">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('options.libraryWallLook')}
                </div>
                <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.libraryWallLookDesc')}
                </div>
            </div>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('options.libraryWallLook')}>
                {LIBRARY_WALL_LOOKS.map(option => {
                    const isSelected = option === look;
                    return (
                        <button
                            key={option}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            data-library-wall-look={option}
                            onClick={() => setLook(option)}
                            className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${frameClass(isSelected)}`}
                            style={{ color: 'var(--text-primary)', borderColor: isSelected ? accentColor : idleBorder }}
                        >
                            <span className="block text-sm font-medium">{t(LOOK_LABEL_KEYS[option].label)}</span>
                            <span className="mt-0.5 block text-[11px] opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                {t(LOOK_LABEL_KEYS[option].description)}
                            </span>
                        </button>
                    );
                })}
            </div>
            {look === 'partial' && (
                <div className="space-y-2">
                    <div className="space-y-1">
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('options.libraryWallWindows')}
                        </div>
                        <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.libraryWallWindowsDesc')}
                        </div>
                    </div>
                    <div className="grid grid-cols-6 gap-1.5" role="radiogroup" aria-label={t('options.libraryWallWindows')}>
                        {LIBRARY_WALL_WINDOW_COUNTS.map(count => {
                            const isSelected = count === windowsPerBlock;
                            const percent = libraryWallWindowSharePercent(count);
                            return (
                                <button
                                    key={count}
                                    type="button"
                                    role="radio"
                                    aria-checked={isSelected}
                                    aria-label={t('options.libraryWallWindowsOption', { count, percent })}
                                    data-library-wall-windows={count}
                                    onClick={() => setWindowsPerBlock(count)}
                                    className={`rounded-lg border px-1 py-1.5 text-center transition-colors ${frameClass(isSelected)}`}
                                    style={{ color: 'var(--text-primary)', borderColor: isSelected ? accentColor : idleBorder }}
                                >
                                    <span className="block text-sm font-medium tabular-nums">{count}</span>
                                    <span className="block text-[10px] opacity-50 tabular-nums">{percent}%</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default LibraryWallLookSettings;
