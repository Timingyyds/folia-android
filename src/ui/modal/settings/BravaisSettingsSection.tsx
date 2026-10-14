import React from 'react';
import { LayoutGrid } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { Theme } from '../../../types';
import { useIsBravaisLibraryActive } from '../../../library/app/bravaisLibraryActive';
import { useLibraryWallLookStore } from '../../../state/useLibraryWallLookStore';
import { SettingsAnchor } from './navigation/SettingsAnchorContext';
import SettingsSectionHeading from './navigation/SettingsSectionHeading';
import LibraryWallLookSettings from './LibraryWallLookSettings';
import BravaisSettingsToggleRow from './BravaisSettingsToggleRow';
import BravaisSeamSettings from './BravaisSeamSettings';
import BravaisBackdropSettings from './BravaisBackdropSettings';

// src/ui/modal/settings/BravaisSettingsSection.tsx
// 界面设置里的「Bravais 墙面」分组（用户要求：bravais 独有的设置都整理到这里）：透光档位、每块窗数（部分透明时）、
// 集合叠页边、信息条的材质（始终透明 / 实色预设，BravaisSeamSettings）与墙后的画面（歌词 / 模糊，BravaisBackdropSettings）。
// 挂在「资料库界面」（suite 选择，不是 bravais 独有的设置，留在原处）的下面。
// 与透光设置原来的惯例一致：只在生效 suite 是 bravais 时渲染（useIsBravaisLibraryActive，命令面板与侧栏目录用同一个
// isBravaisLibraryActive），别的 suite 下整组不出现——那时这些设置不起作用，显示出来只会让人以为能调 grid 的样子。
// 导入导出：透光与窗数不进（用户决定，见 useLibraryWallLookStore），叠页边、信息条材质、墙后画面进外观配置（没有用户
// 例外，按规则）。

type BravaisSettingsSectionProps = {
    isDaylight: boolean;
    settingsCardClass: string;
    theme?: Theme;
};

const BravaisSettingsSection: React.FC<BravaisSettingsSectionProps> = ({ isDaylight, settingsCardClass, theme }) => {
    const { t } = useTranslation();
    const isBravaisActive = useIsBravaisLibraryActive();
    const { stackEdges, setStackEdges } = useLibraryWallLookStore(useShallow(state => ({
        stackEdges: state.collectionStackEdges,
        setStackEdges: state.setCollectionStackEdges,
    })));

    if (!isBravaisActive) return null;

    const accentColor = theme?.accentColor || (isDaylight ? '#3b82f6' : '#60a5fa');
    const toggleOnColor = theme?.secondaryColor;

    return (
        <SettingsAnchor anchorId="bravaisSettings" label={t('options.bravaisSettings')}>
            <SettingsSectionHeading icon={LayoutGrid} label={t('options.bravaisSettings')} />
            <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`} data-bravais-settings="">
                <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.bravaisSettingsDesc')}
                </div>
                <LibraryWallLookSettings isDaylight={isDaylight} accentColor={accentColor} />
                <BravaisSettingsToggleRow
                    label={t('options.bravaisStackEdges')}
                    description={t('options.bravaisStackEdgesDesc')}
                    checked={stackEdges}
                    onChange={setStackEdges}
                    isDaylight={isDaylight}
                    onColor={toggleOnColor}
                    dataAttribute="data-bravais-stack-edges-toggle"
                />
                <BravaisSeamSettings isDaylight={isDaylight} accentColor={accentColor} toggleOnColor={toggleOnColor} />
                <BravaisBackdropSettings isDaylight={isDaylight} toggleOnColor={toggleOnColor} />
            </div>
        </SettingsAnchor>
    );
};

export default BravaisSettingsSection;
