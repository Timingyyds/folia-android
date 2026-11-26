import { expect, test, type Page } from '@playwright/test';
import { installBaseState, localImportFixture, mockNeteaseApi, openApp } from './helpers/appFixtures';

// test/ui/bravaisCollectionFilter.spec.ts
// bravais 的当前页过滤在真实 App 里的接缝（设计稿 §7.6「过滤：缝里的输入位」）：墙上直接打字由命令面板的分发交给缝里
// 自己的输入位（命令面板的 ownInput 那一支，组件探针里没有命令面板，只能在完整应用里验）——不是命令面板的内联框；
// 过滤让墙退化为有限拼贴、输入位里按 ↓ 把键盘焦点交给墙上的 rank 0（过滤词保留）、墙上的 Esc 阶梯先清键盘焦点再清
// 过滤词。命令面板的路径仍在：filter-view（Ctrl/Cmd+F）在 bravais 上是浮层，读写同一个 query，`--play` 照常可用。
// 首页也一样：`s` 不再打开命令面板（它是过滤字符），`/` 是搜索在线平台，Ctrl/Cmd+K 照常打开命令面板。

const paletteFilterBox = (page: Page) => page.getByTestId('command-palette-filter');
const palettePanel = (page: Page) => page.getByTestId('command-palette-panel');
const rendererSwitch = (page: Page) => page.getByTestId('dev-library-renderer-switch');
const collection = (page: Page) => page.locator('[data-library-surface="collection"][data-library-renderer="bravais"]');
const stage = (page: Page) => page.locator('[data-library-stage="bravais"]');
const seamInput = (page: Page) => stage(page).locator('[data-bravais-seam] [data-bravais-filter-input]');

/** 网格首页导入本地曲库。 */
const importLocal = async (page: Page) => {
    await installBaseState(page, { neteaseMode: 'guest', localImportFixture });
    await mockNeteaseApi(page, 'guest');
    await openApp(page);
    await page.getByRole('button', { name: 'Folder' }).last().click();
    await page.getByRole('button', { name: 'Import Folder' }).last().click();
    await expect(page.getByText('All Songs').first()).toBeVisible();
};

/** 打开「全部歌曲」，再用开发浮层把打开着的集合换到 bravais。 */
const openAllSongsInBravais = async (page: Page) => {
    await importLocal(page);
    await page.getByRole('heading', { name: 'All Songs' }).first().click();
    await expect(page.getByText('Midnight Train').first()).toBeVisible();
    await rendererSwitch(page).locator('[data-renderer="bravais"]').click();
    await expect(collection(page)).toHaveCount(1);
    await expect(page.locator('.bravais-tile[data-library-entry]').first()).toBeAttached();
};

/** 注册比首屏晚一拍：反复敲到缝里的输入位真的拿到焦点（没被接住的按键什么都不做）。 */
const typeUntilSeamInputFocused = async (page: Page, key: string) => {
    await expect.poll(async () => {
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press(key);
        return seamInput(page).evaluate(element => element === document.activeElement).catch(() => false);
    }).toBe(true);
};

const playbackSongName = (page: Page) => page.evaluate(async () => {
    const storeModulePath = '/src/stores/usePlaybackStore.ts';
    const { usePlaybackStore } = await import(/* @vite-ignore */ storeModulePath);
    return (usePlaybackStore.getState().currentSong?.name ?? null) as string | null;
});

test('typing on the wall goes into the seam input, narrows the wall to a finite collage, and arrow down hands the keyboard to rank 0', async ({ page }) => {
    await openAllSongsInBravais(page);
    await expect(collection(page)).toHaveAttribute('data-bravais-mode', 'infinite');

    await typeUntilSeamInputFocused(page, 'm');
    await page.keyboard.type('idnight');
    await expect(seamInput(page)).toHaveValue('midnight');
    // 缝自己的输入位，不是命令面板的框。
    await expect(paletteFilterBox(page)).toHaveCount(0);
    await expect(palettePanel(page)).toHaveCount(0);
    await expect(collection(page)).toHaveAttribute('data-bravais-mode', 'finite');
    // 有限拼贴不重复：全部歌曲里只有一首 Midnight Train。
    await expect.poll(() => page.locator('.bravais-tile[data-library-entry]').count()).toBe(1);

    await page.keyboard.press('ArrowDown');
    await expect(seamInput(page)).not.toBeFocused();
    const focused = page.locator('.bravais-tile[data-bravais-focused]');
    await expect(focused).toHaveCount(1);
    await expect(focused.locator('strong')).toHaveAttribute('aria-label', 'Midnight Train');
    await expect(collection(page)).toHaveAttribute('data-bravais-mode', 'finite');
    await expect(seamInput(page)).toHaveValue('midnight');

    // 墙上的 Esc 阶梯：先清键盘焦点，再清过滤词（翻回无限拼贴），不离开集合。
    await page.keyboard.press('Escape');
    await expect(page.locator('.bravais-tile[data-bravais-focused]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(collection(page)).toHaveAttribute('data-bravais-mode', 'infinite');
    await expect(seamInput(page)).toHaveValue('');
    await expect(collection(page)).toHaveCount(1);
});

test('the command palette filter still acts on the same query, with --play', async ({ page }) => {
    await openAllSongsInBravais(page);
    // 列表里的 filter-view / Ctrl+F：bravais 没给锚点，命令面板用自己的浮层；写的是同一个浏览会话 query。
    const openPaletteFilter = () => expect.poll(async () => {
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press('Control+f');
        return palettePanel(page).count();
    }).toBeGreaterThan(0);
    await openPaletteFilter();
    const paletteInput = palettePanel(page).getByRole('combobox');
    await paletteInput.fill('train');
    await expect(seamInput(page)).toHaveValue('train');
    await expect(collection(page)).toHaveAttribute('data-bravais-mode', 'finite');
    // 命令面板里的 Esc：清空过滤词并关上。
    await paletteInput.press('Escape');
    await expect(seamInput(page)).toHaveValue('');
    await expect(collection(page)).toHaveAttribute('data-bravais-mode', 'infinite');
    // `--play` 只在命令面板的过滤里有：播放过滤出来的那些，过滤词本身留着。
    await openPaletteFilter();
    await paletteInput.fill('train --play');
    await paletteInput.press('Enter');
    await expect.poll(() => playbackSongName(page)).toBe('Midnight Train');
    await expect(seamInput(page)).toHaveValue('train');
});

test('on the bravais home `s` is a filter character, `/` searches online, and Ctrl+K still opens the palette', async ({ page }) => {
    await importLocal(page);
    await rendererSwitch(page).locator('[data-renderer="bravais"]').click();
    await expect(stage(page)).toHaveAttribute('data-bravais-layer', /^home:/);

    await typeUntilSeamInputFocused(page, 's');
    await expect(seamInput(page)).toHaveValue('s');
    await expect(palettePanel(page)).toHaveCount(0);
    await expect(paletteFilterBox(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(seamInput(page)).toHaveCount(0);

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('/');
    await expect(stage(page).locator('[data-bravais-seam]')).toHaveAttribute('data-bravais-seam', 'search');
    await expect(stage(page).locator('[data-bravais-input-kind="search"] input')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(stage(page).locator('[data-bravais-seam]')).toHaveAttribute('data-bravais-seam', 'home');

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Control+k');
    await expect(palettePanel(page)).toBeVisible();
});
