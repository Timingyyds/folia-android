import React from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { UserGuideFeatureCard } from './UserGuideFeatureCard';
import { NEW_FEATURES_RELEASE } from './newFeaturesRelease';

export type NewFeaturesIntroProps = {
    isDaylight: boolean;
    classes: {
        textPrimary: string;
        textSecondary: string;
        tipCardBg: string;
        iconTileBg: string;
        cardBg: string;
    };
};

// 在这里编辑当前版本的新功能介绍
// 修改这里的介绍的同时，需要修改 src\components\modal\userGuideContent.ts 中的 USER_GUIDE_AUTO_OPEN_VERSION 到下一个发布版本号
export const NewFeaturesIntro: React.FC<NewFeaturesIntroProps> = ({ isDaylight, classes }) => {
    const { t } = useTranslation();
    const { textPrimary, textSecondary, tipCardBg, iconTileBg, cardBg } = classes;
    const featureCardClasses = { iconTileBg, cardBg, textPrimary, textSecondary };
    const majorUpdate = NEW_FEATURES_RELEASE.majorUpdate;

    return (
        <div className="flex flex-col">
            {majorUpdate && (
                <span
                    data-testid="release-major-update"
                    className={`mb-3 inline-flex items-center gap-1.5 self-start rounded-full border px-3 py-1 text-xs font-semibold ${isDaylight
                        ? 'border-violet-200 bg-violet-50 text-violet-700'
                        : 'border-violet-400/20 bg-violet-500/10 text-violet-300'}`}
                >
                    <Sparkles size={13} aria-hidden="true" />
                    {t('help.majorUpdateLabel', { codename: majorUpdate.codename })}
                </span>
            )}
            <p className={`p-5 rounded-2xl text-sm leading-relaxed ${tipCardBg} ${textSecondary}`}>
                {t(`${NEW_FEATURES_RELEASE.i18nKey}.intro`)}
            </p>

            <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3 pb-2">
                {NEW_FEATURES_RELEASE.features.map((feature) => (
                    <UserGuideFeatureCard
                        key={feature.id}
                        {...featureCardClasses}
                        icon={feature.icon}
                        iconClassName={isDaylight ? feature.daylightIconClassName : feature.darkIconClassName}
                        title={t(`${NEW_FEATURES_RELEASE.i18nKey}.${feature.id}.title`)}
                        description={t(`${NEW_FEATURES_RELEASE.i18nKey}.${feature.id}.description`)}
                    />
                ))}
            </div>
        </div>
    );
};
