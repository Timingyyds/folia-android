import React from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useLibraryWallLookStore } from '../../../state/useLibraryWallLookStore';
import BravaisSettingsToggleRow from './BravaisSettingsToggleRow';

// src/ui/modal/settings/BravaisBackdropSettings.tsx
// 「Bravais 墙面」分组里「墙后的画面」两个开关（设计稿 §11「墙后的画面」）：透出的 visualizer 画不画歌词文字、加不加模糊。
// 只在墙或信息条有透光处时生效（stage 经 reportPlayerBackdrop 报给宿主），只影响首页墙后面，播放页照常。
// 默认都关：首页不花（与原来首页 visualizer 不画文字一致），模糊是一层全屏合成模糊，弱机 + 高刷时有开销，由用户打开。

type BravaisBackdropSettingsProps = {
    isDaylight: boolean;
    toggleOnColor?: string;
};

const BravaisBackdropSettings: React.FC<BravaisBackdropSettingsProps> = ({ isDaylight, toggleOnColor }) => {
    const { t } = useTranslation();
    const { lyrics, blur, setLyrics, setBlur } = useLibraryWallLookStore(useShallow(state => ({
        lyrics: state.backdropLyrics,
        blur: state.backdropBlur,
        setLyrics: state.setBackdropLyrics,
        setBlur: state.setBackdropBlur,
    })));
    return (
        <>
            <BravaisSettingsToggleRow
                label={t('options.bravaisBackdropLyrics')}
                description={t('options.bravaisBackdropLyricsDesc')}
                checked={lyrics}
                onChange={setLyrics}
                isDaylight={isDaylight}
                onColor={toggleOnColor}
                dataAttribute="data-bravais-backdrop-lyrics-toggle"
            />
            <BravaisSettingsToggleRow
                label={t('options.bravaisBackdropBlur')}
                description={t('options.bravaisBackdropBlurDesc')}
                checked={blur}
                onChange={setBlur}
                isDaylight={isDaylight}
                onColor={toggleOnColor}
                dataAttribute="data-bravais-backdrop-blur-toggle"
            />
        </>
    );
};

export default BravaisBackdropSettings;
