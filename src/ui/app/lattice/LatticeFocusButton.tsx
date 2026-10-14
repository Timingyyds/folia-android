import { Crosshair, Focus, House } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLatticeControlsStore } from '../../../state/useLatticeControlsStore';
import { useLatticeSettingsStore } from '../../../state/useLatticeSettingsStore';
import { PRIMARY_MODIFIER_LABEL } from '../../../lib/platform';
import WallToolsButton from '../../wall/WallToolsButton';
import type { WallToolsEntry, WallToolsQuickAction } from '../../wall/WallToolsRows';

// src/ui/app/lattice/LatticeFocusButton.tsx
// A compact Lattice-only utility panel. It borrows UnifiedPanel's anchored glass surface without
// bringing its cover, tabs or player-only state into the poster wall.
// 实测反馈 1 起按钮、面板、灯光 / 叠色开关、帮助的外壳都在共享的 ui/wall/WallToolsButton（bravais 也用）；
// 洗牌、主题、队列、播放器四格与音量也由 wall 从 App 的墙面工具宿主组装（与 bravais 同一套结构）。
// 这里只给 Lattice 自己的三样：locate（聚焦当前歌曲，可访问名不变）、destination（主页：总是回首页）、
// entries（「墙面」与切歌自动聚焦），以及帮助内容。队列编辑原先是一行「队列命令」，现在由快捷排的队列格承担。
export default function LatticeFocusButton({ isDaylight, onGoHome }: { isDaylight: boolean; onGoHome?: () => void }) {
    const { t } = useTranslation();
    const focusCurrentSong = useLatticeControlsStore(state => state.focusCurrentSong);
    const autoFocusOnSongChange = useLatticeSettingsStore(state => state.autoFocusOnSongChange);
    const handleToggleAutoFocusOnSongChange = useLatticeSettingsStore(state => state.handleToggleAutoFocusOnSongChange);

    const locate: WallToolsQuickAction = {
        id: 'locate-playing',
        icon: Crosshair,
        label: t('home.latticeFocusCurrent'),
        kbd: ': + C',
        disabled: !focusCurrentSong,
        onSelect: () => focusCurrentSong?.(),
    };

    const destination: WallToolsQuickAction | undefined = onGoHome ? {
        id: 'go-home',
        icon: House,
        label: t('wallTools.goHome'),
        onSelect: onGoHome,
    } : undefined;

    const entries: WallToolsEntry[] = [
        { kind: 'heading', id: 'wall', label: t('wallTools.wallSection') },
        {
            kind: 'toggle',
            id: 'auto-focus',
            icon: Focus,
            label: t('home.latticeAutoFocusOnSongChange'),
            checked: autoFocusOnSongChange,
            onToggle: handleToggleAutoFocusOnSongChange,
        },
    ];

    return (
        <WallToolsButton
            idPrefix="lattice-tools"
            label={t('home.latticeTools')}
            isDaylight={isDaylight}
            locate={locate}
            destination={destination}
            entries={entries}
            help={(
                <>
                    <li>
                        <span>{t('home.latticeHelpPoster')}</span>
                        <span className="lattice-tools-help-key"><kbd>ESC</kbd>{t('home.latticeHelpReturn')}</span>
                    </li>
                    <li><span>{t('home.latticeHelpMove')}</span></li>
                    <li>
                        <span>{t('home.latticeHelpCommands')}</span>
                        <kbd>S</kbd>
                    </li>
                    <li>
                        <span>{t('home.latticeHelpOpen')}</span>
                        <kbd>{PRIMARY_MODIFIER_LABEL} + B</kbd>
                    </li>
                </>
            )}
        />
    );
}
