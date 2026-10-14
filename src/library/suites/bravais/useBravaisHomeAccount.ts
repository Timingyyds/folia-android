import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { LibraryAccountController, LibraryAccountSnapshot } from '../../core/contracts/account';
import type { LibraryHomeOnlineSource } from '../../core/contracts/homeModel';
import { useLibraryAccountProviders, useLibraryAccountSelector } from '../../core/bindings/useLibraryAccount';
import { canRunLogout, projectAccountSwitcherRows } from './bravaisAccountModel';
import type { BravaisHomeAccount } from './bravaisHomeModels';

// src/library/suites/bravais/useBravaisHomeAccount.ts
// 首页在线页签窄缝里平台切换的投影（B10，account-select / account-logout）：订阅账户 controller 的 provider 列表、
// 当前平台与登出进度（细粒度 selector，登录会话变化不让它重算），投影成 BravaisHomeAccount 交给首页层的缝。
// 选平台调 account.selectProvider（规则在 controller：能直接切的问确认、要登录的开登录会话）；登出只对此刻能登出的行
// （canLogoutProvider 且没有登出在途）。回调身份稳定（latest-ref），层描述只在显示的东西变了时换身份。

const selectLogout = (snapshot: LibraryAccountSnapshot) => snapshot.logout;

export const useBravaisHomeAccount = (account: LibraryAccountController, online: LibraryHomeOnlineSource): BravaisHomeAccount => {
    const { t } = useTranslation();
    const { providers, activeProviderId } = useLibraryAccountProviders(account);
    const logout = useLibraryAccountSelector(account, selectLogout);
    const rows = useMemo(
        () => projectAccountSwitcherRows({ providers, activeProviderId, logout, t }),
        [activeProviderId, logout, providers, t],
    );
    const latest = useRef({ account, rows });
    latest.current = { account, rows };

    const onSelect = useCallback((providerId: string) => {
        void latest.current.account.selectProvider(providerId);
    }, []);
    const onLogout = useCallback((providerId: string) => {
        const row = latest.current.rows.find(candidate => candidate.providerId === providerId);
        if (!row || !canRunLogout(row)) return;
        void latest.current.account.logout(providerId);
    }, []);

    const currentRow = rows.find(row => row.current);
    const detail = currentRow?.detail ?? '';
    const nickname = currentRow?.nickname ?? null;
    const avatarUrl = currentRow?.avatarUrl ?? null;
    const guest = online.accountView === 'guest';
    return useMemo<BravaisHomeAccount>(() => ({
        providerId: online.providerId,
        providerLabel: online.providerLabel,
        detail,
        nickname,
        avatarUrl,
        guest,
        connectLabel: t('libraryBravaisHome.connect'),
        title: t('home.onlineProvider'),
        toggleLabel: t('home.switchOnlineProvider'),
        rows,
        onSelect,
        onLogout,
    }), [avatarUrl, detail, guest, nickname, onLogout, onSelect, online.providerId, online.providerLabel, rows, t]);
};
