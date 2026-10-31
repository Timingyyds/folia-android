import { Captions, CloudRain, ListMusic, Sparkles, Store } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// src/components/modal/newFeaturesRelease.ts

type NewFeatureCard = {
    id: string;
    icon: LucideIcon;
};

type NewFeaturesRelease = {
    i18nKey: string;
    /** 重大更新：介绍上方显示「<代号> Update · 重大更新」标签；代号不翻译，文案在 help.majorUpdateLabel。
     *  servicePack：同一重大更新的热修复版，标签改成「<代号> Update SP<n> · 重大更新」，文案在 help.servicePackLabel。 */
    majorUpdate?: { codename: string; servicePack?: number };
    features: NewFeatureCard[];
};

// Defines the current release's cards; their localized text lives under i18nKey in every locale.
export const NEW_FEATURES_RELEASE: NewFeaturesRelease = {
    i18nKey: 'releaseNotes.v0_7_25',
    majorUpdate: { codename: 'Rainy', servicePack: 1 },
    features: [
        { id: 'nebbia', icon: CloudRain },
        { id: 'machi', icon: Store },
        { id: 'subtitleRows', icon: Captions },
        { id: 'remoteQueue', icon: ListMusic },
        { id: 'moreDetails', icon: Sparkles },
    ],
};

/** 这组更新说明对应的上游版本号（`releaseNotes.v0_7_22` → `0.7.22`），给版本更新弹窗的副标题用。
 *  fork 自己加的：上游只导出 NEW_FEATURES_RELEASE，这里从 i18nKey 反推版本号。 */
export const RELEASE_NOTES_VERSION = NEW_FEATURES_RELEASE.i18nKey
    .split('.')
    .pop()
    ?.replace(/^v/, '')
    .replace(/_/g, '.') ?? null;
