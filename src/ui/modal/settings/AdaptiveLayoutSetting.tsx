import React, { useEffect, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SettingsSectionHeading from './navigation/SettingsSectionHeading';

// src/ui/modal/settings/AdaptiveLayoutSetting.tsx
// 「自适应屏幕分辨率」：关闭＝跟随系统原生布局（系统栏各占其位），
// 打开＝沉浸式全屏，WebView 铺满整屏、系统栏隐藏。
// 只有安卓容器才有这个开关，桌面和网页版不渲染。

type AdaptiveLayoutPlugin = {
    getAdaptiveLayout: () => Promise<{ enabled?: boolean }>;
    setAdaptiveLayout: (options: { enabled: boolean }) => Promise<{ enabled?: boolean }>;
};

const isAndroidNativeRuntime = (): boolean => (
    typeof window !== 'undefined'
    && (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.() === 'android'
);

const getPlugin = (): AdaptiveLayoutPlugin | null => {
    if (typeof window === 'undefined') return null;
    const capacitor = (window as unknown as {
        Capacitor?: { Plugins?: { FoliaNative?: AdaptiveLayoutPlugin } };
    }).Capacitor;
    const plugin = capacitor?.Plugins?.FoliaNative;
    return plugin && typeof plugin.setAdaptiveLayout === 'function' ? plugin : null;
};

type AdaptiveLayoutSettingProps = {
    isDaylight: boolean;
    settingsCardClass: string;
    theme?: { secondaryColor?: string } | null;
};

const AdaptiveLayoutSetting: React.FC<AdaptiveLayoutSettingProps> = ({
    isDaylight,
    settingsCardClass,
    theme,
}) => {
    const { t } = useTranslation();
    const [available, setAvailable] = useState(false);
    const [enabled, setEnabled] = useState(false);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!isAndroidNativeRuntime()) return;
        const plugin = getPlugin();
        if (!plugin) return;
        setAvailable(true);
        let cancelled = false;
        void plugin.getAdaptiveLayout()
            .then(result => {
                if (!cancelled) setEnabled(result?.enabled === true);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, []);

    if (!available) return null;

    const toggle = async () => {
        if (busy) return;
        const plugin = getPlugin();
        if (!plugin) return;
        const next = !enabled;
        setBusy(true);
        // 先落 UI：系统栏的显隐由原生侧执行，这里只跟随它的结果。
        try {
            const result = await plugin.setAdaptiveLayout({ enabled: next });
            setEnabled(result?.enabled === true);
        } catch (error) {
            console.warn('[AdaptiveLayout] failed to apply', error);
        } finally {
            setBusy(false);
        }
    };

    const toggleOffBackgroundClass = isDaylight ? 'bg-zinc-200' : 'bg-[#2A2D35]';

    return (
        <div className="space-y-4">
            <SettingsSectionHeading icon={Maximize2} label={t('options.adaptiveDisplay')} />
            <div className={`p-4 rounded-xl border ${settingsCardClass}`}>
                <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('options.adaptiveDisplay')}
                        </div>
                        <div className="text-xs opacity-50 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.adaptiveDisplayDesc')}
                        </div>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        aria-label={t('options.adaptiveDisplay')}
                        disabled={busy}
                        onClick={() => void toggle()}
                        className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 disabled:opacity-50 ${!enabled ? toggleOffBackgroundClass : ''}`}
                        style={{ backgroundColor: enabled ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                    >
                        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AdaptiveLayoutSetting;
