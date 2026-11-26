import { expect, test, type Page } from '@playwright/test';
import { installBaseState, localImportFixture, mockNeteaseApi, openApp } from './helpers/appFixtures';

// test/ui/bravaisPanelFold.spec.ts
// bravais 列表面板的 history 记录与 N1 折叠紧邻往返在真实 App 里共存（真实 useAppNavigation、浏览器历史与历史日志）：
// 面板开着时在聚焦卡上点上一层（歌手）——要连面板记录一起退回歌手那一层，而不是只关掉面板、留在专辑；浏览器历史
// 不变长，之后的浏览器后退沿完整路径退回。组件探针的假宿主没有历史记录，这一条只能在完整应用里验。
// B8 起歌手页也由 bravais 渲染：专辑从歌手墙上的专辑磁贴打开，折回落在 bravais 的歌手页上。

const rendererSwitch = (page: Page) => page.getByTestId('dev-library-renderer-switch');
const bravaisCollection = (page: Page) => page.locator('[data-library-surface="collection"][data-library-renderer="bravais"]');
const bravaisArtist = (page: Page) => page.locator('[data-library-surface="artist"][data-library-renderer="bravais"]');
const historyState = (page: Page) => page.evaluate(() => {
    const state = window.history.state as {
        view?: string;
        bravaisPanel?: string;
        collection?: { stack: Array<{ name: string }> } | null;
    } | null;
    return {
        view: state?.view ?? null,
        panel: state?.bravaisPanel ?? null,
        stack: (state?.collection?.stack ?? []).map(entry => entry.name),
        length: window.history.length,
    };
});

/** 导入本地曲库、打开「全部歌曲」，用开发浮层换到 bravais（之后打开的集合与歌手页也由 bravais 渲染）。 */
const openAllSongsInBravais = async (page: Page) => {
    await installBaseState(page, { neteaseMode: 'guest', localImportFixture });
    await mockNeteaseApi(page, 'guest');
    await openApp(page);
    await page.getByRole('button', { name: 'Folder' }).last().click();
    await page.getByRole('button', { name: 'Import Folder' }).last().click();
    await expect(page.getByText('All Songs').first()).toBeVisible();
    await page.getByRole('heading', { name: 'All Songs' }).first().click();
    await expect(page.getByText('Midnight Train').first()).toBeVisible();
    await rendererSwitch(page).locator('[data-renderer="bravais"]').click();
    await expect(bravaisCollection(page)).toHaveCount(1);
    await expect(page.locator('.bravais-tile[data-library-entry]').first()).toBeAttached();
};

/** 等墙上的翻牌放完（翻牌期间聚焦卡会被收起）。 */
const waitForWall = (page: Page) => expect(page.locator('[data-library-stage="bravais"][data-bravais-settling]')).toHaveCount(0);

test('with the list panel open, opening the layer right below folds back past the panel record', async ({ page }) => {
    await openAllSongsInBravais(page);
    await waitForWall(page);

    // 全部歌曲：方向键落到离缝最近的一张，Enter 展开聚焦卡，点上面的歌手（bravais 的歌手页）。
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await page.locator('[data-bravais-focus-card]').getByRole('button', { name: 'Test Artist', exact: true }).click();
    await expect(bravaisArtist(page)).toHaveCount(1);
    await expect(page.locator('[data-library-stage="bravais"] [data-bravais-seam-title]')).toHaveText('Test Artist');
    await expect.poll(async () => (await historyState(page)).stack).toEqual(['All Songs', 'Test Artist']);

    // 歌手墙上点专辑磁贴：bravais 的专辑页。
    await waitForWall(page);
    await page.locator('.bravais-tile[data-bravais-kind="album"]').filter({ hasText: 'Fixture Album' }).first()
        .locator('article').dispatchEvent('click');
    await expect(bravaisCollection(page)).toHaveCount(1);
    await expect.poll(async () => (await historyState(page)).stack).toEqual(['All Songs', 'Test Artist', 'Fixture Album']);
    await waitForWall(page);

    // 打开列表面板：压一条带标记的记录。
    await page.locator('[data-bravais-seam-action="list"]').click();
    await expect(page.locator('[data-bravais-list]')).toBeVisible();
    const withPanel = await historyState(page);
    expect(withPanel.panel).not.toBeNull();
    expect(withPanel.stack).toEqual(['All Songs', 'Test Artist', 'Fixture Album']);

    // 列表定位到那首歌，聚焦卡上点歌手（正好是上一层）：折成一次返回，连面板记录一起退。
    await page.locator('[data-bravais-list-row]').first().click();
    const card = page.locator('[data-bravais-focus-card]');
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Test Artist', exact: true }).click();

    await expect.poll(async () => (await historyState(page)).stack).toEqual(['All Songs', 'Test Artist']);
    await expect(bravaisArtist(page)).toHaveCount(1);
    await expect(page.locator('[data-bravais-list]')).toHaveCount(0);
    const folded = await historyState(page);
    expect(folded).toMatchObject({ view: 'home', panel: null });
    // 没有压新记录：退回去的是已有的那条。
    expect(folded.length).toBe(withPanel.length);

    // 浏览器后退沿完整路径：歌手之前是全部歌曲。
    await page.waitForTimeout(600);
    await page.goBack();
    await expect.poll(async () => (await historyState(page)).stack).toEqual(['All Songs']);
    await expect(bravaisCollection(page)).toHaveCount(1);
});
