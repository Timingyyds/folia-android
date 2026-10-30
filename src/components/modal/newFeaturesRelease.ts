import { Droplets, Languages, ListFilter, Sparkles, Volume2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// src/components/modal/newFeaturesRelease.ts

type NewFeatureCard = {
    id: string;
    icon: LucideIcon;
};

type NewFeaturesRelease = {
    i18nKey: string;
    /** 重大更新：介绍上方显示「<代号> Update · 重大更新」标签；代号不翻译，文案在 help.majorUpdateLabel。 */
    majorUpdate?: { codename: string };
    features: NewFeatureCard[];
};

// Defines the current release's cards; their localized text lives under i18nKey in every locale.
// 桌面专属的两项（全局快捷键、AI 服务商与模型）不在手机端展示。
export const NEW_FEATURES_RELEASE: NewFeaturesRelease = {
    i18nKey: 'releaseNotes.v0_7_23',
    features: [
        { id: 'smartBalance', icon: Volume2 },
        { id: 'lyricFilter', icon: ListFilter },
        { id: 'temperaInk', icon: Droplets },
        { id: 'vietnamese', icon: Languages },
        { id: 'moreDetails', icon: Sparkles },
    ],
};

/** 这组更新说明对应的上游版本号（`releaseNotes.v0_7_22` → `0.7.22`），给版本更新弹窗的副标题用。 */
export const RELEASE_NOTES_VERSION = NEW_FEATURES_RELEASE.i18nKey
    .split('.')
    .pop()
    ?.replace(/^v/, '')
    .replace(/_/g, '.') ?? null;
