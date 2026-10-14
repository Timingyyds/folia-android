import React, { useEffect, useRef } from 'react';
import { Blinds, Check, CornerDownLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../../types';
import type { CommandPaletteMatch } from '../types';
import { readLibraryWallPick } from './libraryWallLookSurface';

// src/ui/command-palette/surfaces/LibraryWallPickerSurfaceView.tsx
// bravais 透光两个 picker（档位、每块窗数）共用的列表：与资料库界面 picker 同一个外形（标题栏 + 默认样式的行），
// 打勾的是当前值。行上的 data-library-wall-pick 是取值（solid / partial / clear 或 1–6）。

type LibraryWallPickerSurfaceViewProps = {
    matches: CommandPaletteMatch[];
    activeIndex: number;
    setActiveIndex: (index: number) => void;
    executeMatch: (index: number) => Promise<boolean>;
    isDaylight: boolean;
    isExecuting: boolean;
    theme: Theme;
    headerTitle: string;
    selectedValue: string;
    selectedLabel: string;
};

const LibraryWallPickerSurfaceView: React.FC<LibraryWallPickerSurfaceViewProps> = ({
    matches,
    activeIndex,
    setActiveIndex,
    executeMatch,
    isDaylight,
    isExecuting,
    theme,
    headerTitle,
    selectedValue,
    selectedLabel,
}) => {
    const { t } = useTranslation();
    const activeRowRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        activeRowRef.current?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex]);

    if (matches.length === 0) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center opacity-50">
                <Blinds size={26} />
                <div className="text-sm">{t('commandPalette.empty', 'No matching command')}</div>
            </div>
        );
    }

    const itemActiveBg = isDaylight ? 'bg-black/10' : 'bg-white/10';
    const itemIdleBg = isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/5';

    return (
        <div>
            <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium opacity-60">
                <Blinds size={14} />
                <span>{headerTitle}</span>
                <span className="ml-auto min-w-0 truncate">
                    {t('commandPalette.pickerCurrent', { defaultValue: 'Current: {{mode}}', mode: selectedLabel })}
                </span>
            </div>
            {matches.map((match, index) => {
                const isActive = index === activeIndex;
                const value = readLibraryWallPick(match.command.id);
                const isSelected = value === selectedValue;
                return (
                    <button
                        key={match.command.id}
                        ref={isActive ? activeRowRef : undefined}
                        type="button"
                        data-library-wall-pick={value}
                        data-picker-active={isActive ? 'true' : 'false'}
                        data-picker-selected={isSelected ? 'true' : 'false'}
                        disabled={isExecuting}
                        onMouseEnter={() => {
                            if (!isExecuting) setActiveIndex(index);
                        }}
                        onClick={() => {
                            if (!isExecuting) {
                                setActiveIndex(index);
                                void executeMatch(index);
                            }
                        }}
                        className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors disabled:pointer-events-none disabled:opacity-50 ${
                            isActive ? itemActiveBg : itemIdleBg
                        }`}
                    >
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{match.command.title}</span>
                            <span className="mt-0.5 block truncate text-xs opacity-50">{match.command.description}</span>
                        </span>
                        {isSelected && <Check size={16} className="shrink-0" style={{ color: theme.accentColor }} />}
                        {isActive && (
                            <span className="hidden shrink-0 items-center gap-1 text-xs opacity-45 sm:flex">
                                <CornerDownLeft size={13} />
                                {t('commandPalette.run', 'Run')}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
};

export default LibraryWallPickerSurfaceView;
