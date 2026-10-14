import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Copy, ExternalLink, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { discordIconUrl, openDiscordInvite } from './discordCommunity';
import { QQ_COMMUNITY_GROUP_NUMBER } from './qqCommunity';
import { copyTextToClipboard } from '../../lib/clipboard';

// src/ui/shared/JoinCommunityButton.tsx
// 帮助页的「加入社区」：一颗胶囊，点开向上弹出两个去处——Discord（打开邀请链接）与 QQ 自助交流群（复制群号）。

const COPIED_FEEDBACK_MS = 1800;

export const JoinCommunityButton: React.FC = () => {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const [qqCopied, setQqCopied] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // 开着时：点外面关；Escape 只关菜单——在捕获阶段拦下，免得设置弹窗（window 上的 keydown）跟着关掉。
    useEffect(() => {
        if (!isOpen) return undefined;
        const closeOnOutsideClick = (event: MouseEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            setIsOpen(false);
        };
        document.addEventListener('mousedown', closeOnOutsideClick);
        window.addEventListener('keydown', closeOnEscape, true);
        return () => {
            document.removeEventListener('mousedown', closeOnOutsideClick);
            window.removeEventListener('keydown', closeOnEscape, true);
        };
    }, [isOpen]);

    useEffect(() => {
        if (!qqCopied) return undefined;
        const timer = window.setTimeout(() => setQqCopied(false), COPIED_FEEDBACK_MS);
        return () => window.clearTimeout(timer);
    }, [qqCopied]);

    const joinDiscord = () => {
        setIsOpen(false);
        openDiscordInvite();
    };

    // QQ 群没有能直接打开的入群链接：复制群号，菜单留着让这一项显示「群号已复制」。
    const copyQqGroup = async () => {
        try {
            await copyTextToClipboard(QQ_COMMUNITY_GROUP_NUMBER);
            setQqCopied(true);
        } catch (error) {
            console.error('Failed to copy the QQ group number:', error);
            setQqCopied(false);
        }
    };

    return (
        <div ref={containerRef} className="relative">
            {/* 一排单色胶囊里唯一带颜色的那颗，靠色彩而不是体积被看见。 */}
            <button
                type="button"
                onClick={() => setIsOpen(current => !current)}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                className="px-6 py-2 bg-[#5865F2]/15 hover:bg-[#5865F2]/25 ring-1 ring-inset ring-[#5865F2]/30 transition-colors rounded-full text-sm font-medium flex items-center gap-2"
                style={{ color: 'var(--text-primary)' }}
            >
                <Users size={16} aria-hidden />
                {t('help.joinCommunity')}
                <ChevronDown size={14} aria-hidden className={`opacity-60 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        // 水平居中交给 framer 的 x：它写 transform，会盖掉 Tailwind 的 translate 类。
                        initial={{ opacity: 0, x: '-50%', y: 6, scale: 0.96 }}
                        animate={{ opacity: 1, x: '-50%', y: 0, scale: 1 }}
                        exit={{ opacity: 0, x: '-50%', y: 6, scale: 0.96 }}
                        transition={{ duration: 0.16, ease: 'easeOut' }}
                        role="menu"
                        aria-label={t('help.joinCommunity')}
                        className="absolute bottom-full left-1/2 z-20 mb-2 w-64 rounded-2xl border p-1.5 shadow-xl backdrop-blur-2xl theme-glass-panel"
                        style={{ color: 'var(--text-primary)' }}
                    >
                        <CommunityMenuItem
                            icon={<img src={discordIconUrl} alt="" aria-hidden className="h-[18px] w-[18px] rounded-[5px]" />}
                            label={t('help.communityDiscord')}
                            hint={t('help.communityDiscordHint')}
                            trailing={<ExternalLink size={14} aria-hidden className="opacity-50" />}
                            onClick={joinDiscord}
                        />
                        <CommunityMenuItem
                            icon={qqCopied ? <Check size={18} aria-hidden className="text-emerald-500" /> : <Users size={18} aria-hidden />}
                            label={t('help.communityQq')}
                            hint={qqCopied
                                ? t('help.qqGroupNumberCopied')
                                : t('help.communityQqHint', { number: QQ_COMMUNITY_GROUP_NUMBER })}
                            trailing={qqCopied ? null : <Copy size={14} aria-hidden className="opacity-50" />}
                            onClick={() => void copyQqGroup()}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

const CommunityMenuItem: React.FC<{
    icon: React.ReactNode;
    label: string;
    hint: string;
    trailing: React.ReactNode;
    onClick: () => void;
}> = ({ icon, label, hint, trailing, onClick }) => (
    <button
        type="button"
        role="menuitem"
        onClick={onClick}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/10"
    >
        <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">{icon}</span>
        <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{label}</span>
            <span className="block text-xs opacity-60">{hint}</span>
        </span>
        {trailing}
    </button>
);
