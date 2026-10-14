import React from 'react';
import { Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SettingsSectionHeading from './navigation/SettingsSectionHeading';
import { useAndroidLayoutSettingsStore } from '../../../state/useAndroidLayoutSettingsStore';

// Android-only compact layout switch. It deliberately lives next to, but separate from, the
// native fullscreen switch so upstream layout breakpoints remain untouched when it is off.

type AndroidPhoneFitSettingProps = {
    isDaylight: boolean;
    settingsCardClass: string;
    theme?: { secondaryColor?: string } | null;
};

const isAndroidNativeRuntime = (): boolean => (
    typeof window !== 'undefined'
    && (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.() === 'android'
);

const AndroidPhoneFitSetting: React.FC<AndroidPhoneFitSettingProps> = ({
    isDaylight,
    settingsCardClass,
    theme,
}) => {
    const { t } = useTranslation();
    const enabled = useAndroidLayoutSettingsStore(state => state.phoneFitEnabled);
    const orientation = useAndroidLayoutSettingsStore(state => state.phoneFitOrientation);
    const setEnabled = useAndroidLayoutSettingsStore(state => state.setPhoneFitEnabled);
    const setOrientation = useAndroidLayoutSettingsStore(state => state.setPhoneFitOrientation);

    if (!isAndroidNativeRuntime()) return null;

    const toggleOffBackgroundClass = isDaylight ? 'bg-zinc-200' : 'bg-[#2A2D35]';

    return (
        <div className="space-y-4">
            <SettingsSectionHeading icon={Smartphone} label={t('options.phoneFit')} />
            <div className={`p-4 rounded-xl border ${settingsCardClass}`}>
                <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('options.phoneFit')}
                        </div>
                        <div className="text-xs opacity-50 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.phoneFitDesc')}
                        </div>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        aria-label={t('options.phoneFit')}
                        onClick={() => setEnabled(!enabled)}
                        className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${!enabled ? toggleOffBackgroundClass : ''}`}
                        style={{ backgroundColor: enabled ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                    >
                        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                </div>

                {enabled && (
                    <div className={`mt-4 pt-4 border-t flex items-center justify-between gap-4 ${isDaylight ? 'border-black/5' : 'border-white/10'}`}>
                        <div className="space-y-1 min-w-0">
                            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                {t('options.orientationFit')}
                            </div>
                            <div className="text-xs opacity-50 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.orientationFitDesc')}
                            </div>
                            <div className="text-[11px] font-semibold opacity-70" style={{ color: 'var(--text-secondary)' }}>
                                {orientation === 'landscape' ? t('options.orientationLandscape') : t('options.orientationPortrait')}
                            </div>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={orientation === 'landscape'}
                            aria-label={t('options.orientationFit')}
                            onClick={() => setOrientation(orientation === 'landscape' ? 'portrait' : 'landscape')}
                            className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${orientation !== 'landscape' ? toggleOffBackgroundClass : ''}`}
                            style={{ backgroundColor: orientation === 'landscape' ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                        >
                            <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${orientation === 'landscape' ? 'translate-x-6' : 'translate-x-0'}`} />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AndroidPhoneFitSetting;
