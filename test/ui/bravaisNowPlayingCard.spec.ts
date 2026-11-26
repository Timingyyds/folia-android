import { expect, test, type Page } from '@playwright/test';
import { installBaseState, mockNeteaseApi, openApp } from './helpers/appFixtures';

// test/ui/bravaisNowPlayingCard.spec.ts
// 左下角的正在播放卡片（NowPlayingToast）：首页默认不显示（「在首页显示」开关管网格），但资料库界面是 bravais 时，
// 墙与 Lattice 同类，卡片在墙上常在、不看那个开关（2026-10-10）。

const seedSong = (page: Page) => page.evaluate(async () => {
    const path = '/src/stores/usePlaybackStore.ts';
    const { usePlaybackStore } = await import(/* @vite-ignore */ path);
    const song = { id: 9001, name: 'Card Track One', artists: [{ id: 1, name: 'Card Artist' }], album: { id: 1, name: 'Card Album' }, durationMs: 180_000 };
    usePlaybackStore.setState({ playQueue: [song], currentSong: song });
});

const boot = async (page: Page, suite: 'grid' | 'bravais') => {
    await installBaseState(page, { neteaseMode: 'guest' });
    await page.addInitScript((id) => {
        localStorage.setItem('library_suite', id);
        localStorage.setItem('stage_track_pill_mode', 'always');
        localStorage.removeItem('stage_track_pill_on_home');
    }, suite);
    await mockNeteaseApi(page, 'guest');
    await openApp(page);
};

test('the bravais wall carries the now playing card without the home opt-in; the grid home does not', async ({ page }) => {
    await boot(page, 'bravais');
    await expect(page.locator('[data-library-stage="bravais"]')).toBeAttached({ timeout: 20_000 });
    await seedSong(page);
    await expect(page.getByText('Card Track One')).toBeVisible();

    await boot(page, 'grid');
    await expect(page.locator('[data-library-stage="bravais"]')).toHaveCount(0);
    await seedSong(page);
    await page.waitForTimeout(800);
    await expect(page.getByText('Card Track One')).toHaveCount(0);
});
