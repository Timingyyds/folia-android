import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { LatticeViewArt, PlayerViewArt, StayViewArt } from './playbackEntryViewArt';
import { OnboardingChoiceCards, type OnboardingChoiceArt, type OnboardingChoiceCard } from './OnboardingChoiceCards';
import type { PlaybackEntryView } from '../../../state/usePlaybackEntryViewStore';

// src/ui/modal/playback-entry-view/PlaybackEntryViewOptions.tsx
// The picture-and-text cards for choosing where playback opens (fb3 added the third, 留在原处).
//
// Shared by the one-time prompt and the settings section so the two cannot drift: the prompt is
// most people's only look at this choice, and the settings copy has to describe the same thing.
// The card itself is OnboardingChoiceCards, which the prompt's library-suite page uses too.

type PlaybackEntryViewOptionsProps = {
    value: PlaybackEntryView;
    onChange: (view: PlaybackEntryView) => void;
    isDaylight: boolean;
    accentColor: string;
};

const OPTIONS: Array<{ value: PlaybackEntryView; art: OnboardingChoiceArt; i18nKey: string }> = [
    { value: 'player', art: PlayerViewArt, i18nKey: 'player' },
    { value: 'lattice', art: LatticeViewArt, i18nKey: 'lattice' },
    { value: 'stay', art: StayViewArt, i18nKey: 'stay' },
];

export const PlaybackEntryViewOptions: React.FC<PlaybackEntryViewOptionsProps> = ({
    value,
    onChange,
    isDaylight,
    accentColor,
}) => {
    const { t } = useTranslation();
    const cards = useMemo<OnboardingChoiceCard<PlaybackEntryView>[]>(() => OPTIONS.map(({ value: optionValue, art, i18nKey }) => ({
        value: optionValue,
        art,
        title: t(`playbackEntryView.${i18nKey}.title`),
        description: t(`playbackEntryView.${i18nKey}.description`),
    })), [t]);

    return (
        <OnboardingChoiceCards
            cards={cards}
            value={value}
            onChange={onChange}
            isDaylight={isDaylight}
            accentColor={accentColor}
            dataAttribute="data-playback-entry-view"
        />
    );
};
