import { expect, test, type Page } from '@playwright/test';
import { installBaseState, mockNeteaseApi, openApp } from './helpers/appFixtures';
import { APP_VERSION, GUIDE_VERSION_STORAGE_KEY } from '../helpers/appState';

// test/ui/startupOnboarding.spec.ts
// 首启引导的两页提问（2026-10-10）：第 1 页选资料库界面（只有 Grid / Bravais，测试构建里可用的 TUI 不出现），
// 第 2 页是原来的「播放后进入的视图」。覆盖：前进 / 后退不丢选择、点下即写进现有存储（`library_suite` 与
// `playback_entry_view`）、关闭后记为已回答（关掉时把生效的界面记成选择）；新安装由启动顺序自动弹出。
// 「资料库界面」那一页每个安装都问一次（自己的标记 `library_suite_prompt_seen`，不看版本——发版说明的版本号每版都变）：
// 回答过旧版单页提问、这一版的启动顺序也走完了的安装，同样会被问一次，只有这一页。基础状态把它种成问过，用例按需去掉。

/** 与 useStartupExperienceGate 的 LAST_SEEN_RELEASE_NOTES_VERSION_STORAGE_KEY 一致。 */
const RELEASE_NOTES_SEEN_KEY = 'folia_last_seen_guide_version';

const prompt = (page: Page) => page.getByTestId('playback-entry-view-prompt');
const suiteCard = (page: Page, id: string) => prompt(page).locator(`[data-onboarding-library-suite="${id}"]`);
const entryCard = (page: Page, id: string) => prompt(page).locator(`[data-playback-entry-view="${id}"]`);
const storageOf = (page: Page, key: string) => page.evaluate(storageKey => localStorage.getItem(storageKey), key);

const requestPrompt = (page: Page) => page.evaluate(async () => {
    const modulePath = '/src/stores/usePlaybackEntryViewStore.ts';
    const { requestPlaybackEntryViewPrompt } = await import(/* @vite-ignore */ modulePath);
    return requestPlaybackEntryViewPrompt({ withLibrarySuite: true }) as boolean;
});

/** 这个构建会不会自动跑启动顺序（USER_GUIDE_AUTO_OPEN_VERSION 是当前版本时才跑）。 */
const runsStartupSequence = (page: Page) => page.evaluate(async (appVersion) => {
    const modulePath = '/src/components/modal/userGuideContent.ts';
    const { USER_GUIDE_AUTO_OPEN_VERSION } = await import(/* @vite-ignore */ modulePath);
    return USER_GUIDE_AUTO_OPEN_VERSION === appVersion;
}, APP_VERSION);

/** 起应用；`seed` 在基础状态之后再改 localStorage（基础状态把思索引导记成当前版本已看过，启动顺序因此不动）。 */
const boot = async (page: Page, seed?: (keys: { guideKey: string; releaseKey: string; appVersion: string }) => void) => {
    await installBaseState(page, { neteaseMode: 'guest' });
    if (seed) {
        await page.addInitScript(seed, { guideKey: GUIDE_VERSION_STORAGE_KEY, releaseKey: RELEASE_NOTES_SEEN_KEY, appVersion: APP_VERSION });
    }
    await mockNeteaseApi(page, 'guest');
    await openApp(page);
};

test('the two-page prompt moves back and forth and writes each pick as it is made', async ({ page }) => {
    // 基础状态里这一版的启动顺序已经走完；只去掉「问过界面」的标记，提问照样弹出（不看版本），两页都在（播放视图也没答过）。
    await boot(page, () => localStorage.removeItem('library_suite_prompt_seen'));

    // 第 1 页：资料库界面，只有 Grid 与 Bravais；测试构建的初始选择钉在 grid，所以 Grid 是选中的。
    await expect(prompt(page)).toHaveAttribute('data-onboarding-page', 'library-suite');
    await expect(prompt(page).locator('[data-onboarding-step]')).toHaveAttribute('data-onboarding-step', '1');
    await expect(prompt(page).locator('[data-onboarding-library-suite]')).toHaveCount(2);
    await expect(suiteCard(page, 'tui')).toHaveCount(0);
    await expect(suiteCard(page, 'grid')).toHaveAttribute('aria-pressed', 'true');
    await expect(suiteCard(page, 'grid')).toContainText('Grid');
    await expect(suiteCard(page, 'grid')).toContainText('Classic');
    await expect(suiteCard(page, 'bravais')).toContainText('Infinite');
    await expect(page.getByTestId('playback-entry-view-prompt-back')).toHaveCount(0);

    await suiteCard(page, 'bravais').click();
    await expect(suiteCard(page, 'bravais')).toHaveAttribute('aria-pressed', 'true');
    await expect(suiteCard(page, 'grid')).toHaveAttribute('aria-pressed', 'false');
    expect(await storageOf(page, 'library_suite')).toBe('bravais');
    await expect(page.locator('[data-library-stage="bravais"]')).toBeAttached();

    // 第 2 页：播放后进入的视图。
    await page.getByTestId('playback-entry-view-prompt-next').click();
    await expect(prompt(page)).toHaveAttribute('data-onboarding-page', 'playback-entry-view');
    await expect(prompt(page).locator('[data-onboarding-step]')).toHaveAttribute('data-onboarding-step', '2');
    await expect(prompt(page).locator('[data-playback-entry-view]')).toHaveCount(3);
    await expect(entryCard(page, 'player')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('playback-entry-view-prompt-next')).toHaveCount(0);
    await entryCard(page, 'lattice').click();
    await expect(entryCard(page, 'lattice')).toHaveAttribute('aria-pressed', 'true');
    expect(await storageOf(page, 'playback_entry_view')).toBe('lattice');

    // 后退再前进：两页的选择都还在。
    await page.getByTestId('playback-entry-view-prompt-back').click();
    await expect(prompt(page)).toHaveAttribute('data-onboarding-page', 'library-suite');
    await expect(suiteCard(page, 'bravais')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('playback-entry-view-prompt-next').click();
    await expect(entryCard(page, 'lattice')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('playback-entry-view-prompt-confirm').click();
    await expect(prompt(page)).toHaveCount(0);
    expect(await storageOf(page, 'playback_entry_view_chosen')).toBe('true');
    expect(await storageOf(page, 'library_suite_prompt_seen')).toBe('true');
    expect(await storageOf(page, 'library_suite')).toBe('bravais');
    expect(await storageOf(page, 'playback_entry_view')).toBe('lattice');
    // 回答过就不再打开。
    expect(await requestPrompt(page)).toBe(false);
});

test('a fresh install is asked after the release notes, and the sequence moves on to Ponder', async ({ page }) => {
    await boot(page, ({ guideKey, releaseKey, appVersion }) => {
        localStorage.removeItem(guideKey);
        localStorage.removeItem('library_suite_prompt_seen');
        localStorage.setItem(releaseKey, appVersion);
    });
    test.skip(!(await runsStartupSequence(page)), 'this build does not run the startup sequence');

    await expect(prompt(page)).toBeVisible();
    await expect(prompt(page)).toHaveAttribute('data-onboarding-page', 'library-suite');
    // 背景点掉也算回答过：两项都有可用的默认值。
    await prompt(page).locator('..').click({ position: { x: 8, y: 550 } });
    await expect(prompt(page)).toHaveCount(0);
    expect(await storageOf(page, 'playback_entry_view_chosen')).toBe('true');
    // 没点过卡片也算选了：关掉时把生效的界面（测试构建钉在 grid）记下来，之后改初始选择不会把人带走。
    expect(await storageOf(page, 'library_suite')).toBe('grid');
    await expect(page.getByTestId('ponder-onboarding')).toBeVisible();
});

test('an install that answered the old single-page prompt is asked for the library interface once, whatever the release', async ({ page }) => {
    await boot(page, () => {
        // 「播放后进入的视图」早就答过、这一版的启动顺序也走完了（基础状态）——但从没见过资料库界面那一页。
        localStorage.removeItem('library_suite_prompt_seen');
        localStorage.setItem('playback_entry_view', 'stay');
        localStorage.setItem('playback_entry_view_chosen', 'true');
    });

    // 只有资料库界面这一页：没有步数点、没有「下一步」，直接确认。
    await expect(prompt(page)).toBeVisible();
    await expect(prompt(page)).toHaveAttribute('data-onboarding-page', 'library-suite');
    await expect(prompt(page).locator('[data-onboarding-step]')).toHaveCount(0);
    await expect(page.getByTestId('playback-entry-view-prompt-next')).toHaveCount(0);
    await page.getByTestId('playback-entry-view-prompt-confirm').click();
    await expect(prompt(page)).toHaveCount(0);
    expect(await storageOf(page, 'library_suite_prompt_seen')).toBe('true');
    expect(await storageOf(page, 'library_suite')).toBe('grid');
    expect(await storageOf(page, 'playback_entry_view')).toBe('stay');
    await expect(page.getByTestId('ponder-onboarding')).toHaveCount(0);
    expect(await requestPrompt(page)).toBe(false);
});
