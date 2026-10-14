import React from 'react';

// src/library/suites/bravais/BravaisProviderAvatar.tsx
// fb8（用户实测：首页窄缝的账户入口与平台列表改成 grid 切换器的「图标 / 头像 + 名称」）：已登录的账户显示头像，
// 没有头像时退回平台徽章。徽章与 grid 的切换器（OnlineProviderSwitcher 的 AVATAR_BADGE_BY_PROVIDER）是同一套：
// 纯色圆底 + 一个字（网易云「云」、酷狗「K」、QQ「Q」、波点「波」），其余平台（Folium mod 音源）取名称首字、灰底。
// suite 之间不互相 import，所以这里按 grid 的表抄一份（颜色是 grid 用的 Tailwind 600 档）；两边改时一起改。

const PROVIDER_BADGES: Record<string, { label: string; color: string }> = {
    netease: { label: '云', color: '#dc2626' },
    kugou: { label: 'K', color: '#2563eb' },
    qq: { label: 'Q', color: '#16a34a' },
    bodian: { label: '波', color: '#0d9488' },
};

const FALLBACK_BADGE_COLOR = '#52525b';

/** 平台徽章：内置平台用固定的字与颜色，其余取名称首字。 */
export const resolveBravaisProviderBadge = (providerId: string, name: string) => (
    PROVIDER_BADGES[providerId] ?? { label: Array.from(name)[0] ?? '', color: FALLBACK_BADGE_COLOR }
);

/** 网页版把 http 的头像换成 https（与 grid 的切换器一致，避免混合内容被拦）；桌面版原样。 */
const resolveAvatarSrc = (url: string) => (typeof window !== 'undefined' && window.electron ? url : url.replace(/^http:/, 'https:'));

/**
 * 头像或平台徽章（圆形，尺寸由 className 定）。装饰性的：可访问名由外面的按钮给，这里 aria-hidden。
 * `data-bravais-account-avatar` 标出画的是哪一种（image / badge），用例按它判断。
 */
const BravaisProviderAvatar: React.FC<{ providerId: string; name: string; avatarUrl: string | null; className?: string }> = ({
    providerId,
    name,
    avatarUrl,
    className,
}) => {
    if (avatarUrl) {
        return <img className={`bravais-account-avatar${className ? ` ${className}` : ''}`} src={resolveAvatarSrc(avatarUrl)} alt="" aria-hidden
            draggable={false} data-bravais-account-avatar="image" />;
    }
    const badge = resolveBravaisProviderBadge(providerId, name);
    return (
        <span className={`bravais-account-avatar is-badge${className ? ` ${className}` : ''}`} style={{ backgroundColor: badge.color }} aria-hidden
            data-bravais-account-avatar="badge">
            {badge.label}
        </span>
    );
};

export default BravaisProviderAvatar;
