import React from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useLibraryWallLookStore } from '../../../state/useLibraryWallLookStore';
import {
    LIBRARY_WALL_SEAM_STYLE_LABEL_KEYS,
    LIBRARY_WALL_SEAM_STYLE_LOOKS,
    LIBRARY_WALL_SEAM_STYLES,
} from '../../../lib/libraryWallSeamStyle';
import BravaisSettingsToggleRow from './BravaisSettingsToggleRow';

// src/ui/modal/settings/BravaisSeamSettings.tsx
// 「Bravais 墙面」分组里信息条（缝）的材质（设计稿 §5「缝的材质」）：「始终透明」开关与实色模式的预设（8 个色样的单选）。
// 两者互斥：透明开着时预设整组禁用（值保留，关掉透明后照旧生效），下面写明原因。色样用 lib/libraryWallSeamStyle
// 的同一份材质字符串画（与墙上的缝同一份），文字色按预设的墨色规则（印刷系固定墨色，其余是主题主色）。
// 进外观配置导入导出（见 useLibraryWallLookStore 的说明）。

type BravaisSeamSettingsProps = {
    isDaylight: boolean;
    accentColor: string;
    toggleOnColor?: string;
};

const BravaisSeamSettings: React.FC<BravaisSeamSettingsProps> = ({ isDaylight, accentColor, toggleOnColor }) => {
    const { t } = useTranslation();
    const { seamClear, seamStyle, setSeamClear, setSeamStyle } = useLibraryWallLookStore(useShallow(state => ({
        seamClear: state.seamClear,
        seamStyle: state.seamStyle,
        setSeamClear: state.setSeamClear,
        setSeamStyle: state.setSeamStyle,
    })));
    const idleBorder = isDaylight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';

    return (
        <>
            <BravaisSettingsToggleRow
                label={t('options.bravaisSeamClear')}
                description={t('options.bravaisSeamClearDesc')}
                checked={seamClear}
                onChange={setSeamClear}
                isDaylight={isDaylight}
                onColor={toggleOnColor}
                dataAttribute="data-bravais-seam-clear-toggle"
            />
            <div className="space-y-2 border-t pt-4" style={{ borderColor: idleBorder }} data-bravais-seam-style-settings="">
                <div className="space-y-1">
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {t('options.bravaisSeamStyle')}
                    </div>
                    <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                        {seamClear ? t('options.bravaisSeamStyleDisabled') : t('options.bravaisSeamStyleDesc')}
                    </div>
                </div>
                <div
                    className={`grid grid-cols-4 gap-2 transition-opacity ${seamClear ? 'opacity-40' : ''}`}
                    role="radiogroup"
                    aria-label={t('options.bravaisSeamStyle')}
                    aria-disabled={seamClear || undefined}
                >
                    {LIBRARY_WALL_SEAM_STYLES.map(style => {
                        const isSelected = style === seamStyle;
                        const look = LIBRARY_WALL_SEAM_STYLE_LOOKS[style];
                        return (
                            <button
                                key={style}
                                type="button"
                                role="radio"
                                aria-checked={isSelected}
                                disabled={seamClear}
                                data-bravais-seam-style-option={style}
                                onClick={() => setSeamStyle(style)}
                                className="rounded-xl border p-1.5 text-left transition-colors disabled:cursor-not-allowed"
                                style={{ borderColor: isSelected ? accentColor : idleBorder, color: 'var(--text-primary)' }}
                            >
                                <span
                                    aria-hidden="true"
                                    className="flex h-12 items-center justify-center rounded-lg text-base font-extrabold"
                                    style={{ background: look.surface, color: look.ink ?? 'var(--text-primary)' }}
                                    data-bravais-seam-swatch={style}
                                >
                                    {t('options.bravaisSeamSwatchGlyph')}
                                </span>
                                <span className="mt-1 block truncate text-[11px] font-medium">{t(LIBRARY_WALL_SEAM_STYLE_LABEL_KEYS[style])}</span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </>
    );
};

export default BravaisSeamSettings;
