import React from 'react';

// src/ui/modal/playback-entry-view/OnboardingChoiceCards.tsx
// 首启引导里「一张示意图 + 标题 + 一行说明」的选项卡片。两页（资料库界面、播放后进入的视图）与设置页的
// 「播放后进入的视图」共用这一份，卡片的边框、底色、选中态才不会各写各的、慢慢走样。

export type OnboardingChoiceArt = React.FC<{ accentColor: string; className?: string }>;

export type OnboardingChoiceCard<Value extends string> = {
    value: Value;
    art: OnboardingChoiceArt;
    title: string;
    /** 标题旁的小标签（例如「经典」「无限」），可选。 */
    tag?: string;
    description: string;
};

type OnboardingChoiceCardsProps<Value extends string> = {
    cards: ReadonlyArray<OnboardingChoiceCard<Value>>;
    value: Value | null;
    onChange: (value: Value) => void;
    isDaylight: boolean;
    accentColor: string;
    /** 每张卡片上带的 data 属性名（值是选项本身），测试与样式按它定位，例如 `data-playback-entry-view`。 */
    dataAttribute: `data-${string}`;
    /** 栅格列数的类名；三张卡片是 `grid-cols-2 sm:grid-cols-3`，两张是 `grid-cols-2`。 */
    gridClassName?: string;
};

export const OnboardingChoiceCards = <Value extends string>({
    cards,
    value,
    onChange,
    isDaylight,
    accentColor,
    dataAttribute,
    gridClassName = 'grid-cols-2 sm:grid-cols-3',
}: OnboardingChoiceCardsProps<Value>) => (
    <div className={`grid ${gridClassName} gap-3`}>
        {cards.map(({ value: optionValue, art: Art, title, tag, description }) => {
            const isSelected = value === optionValue;
            const frameClass = isSelected
                ? (isDaylight ? 'bg-white shadow-md' : 'bg-white/[0.07]')
                : (isDaylight ? 'bg-zinc-50 hover:bg-white' : 'bg-white/[0.03] hover:bg-white/[0.06]');

            return (
                <button
                    key={optionValue}
                    type="button"
                    onClick={() => onChange(optionValue)}
                    aria-pressed={isSelected}
                    {...{ [dataAttribute]: optionValue }}
                    className={`text-left rounded-2xl border p-3 transition-colors ${frameClass}`}
                    style={{
                        borderColor: isSelected
                            ? accentColor
                            : (isDaylight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'),
                    }}
                >
                    <Art
                        accentColor={accentColor}
                        className={`w-full h-auto rounded-lg ${isDaylight ? 'text-zinc-900' : 'text-zinc-100'}`}
                    />
                    <div className="mt-3 flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        <span>{title}</span>
                        {tag && (
                            <span
                                className="rounded-full border px-1.5 py-px text-[10px] font-normal leading-4 opacity-70"
                                style={{ borderColor: isSelected ? accentColor : 'currentColor', color: isSelected ? accentColor : undefined }}
                            >
                                {tag}
                            </span>
                        )}
                    </div>
                    <div className="mt-1 text-[11px] leading-relaxed opacity-60" style={{ color: 'var(--text-secondary)' }}>
                        {description}
                    </div>
                </button>
            );
        })}
    </div>
);
