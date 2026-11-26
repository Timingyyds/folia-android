import { expect, test, type Page } from '@playwright/test';
import { installBaseState, mockNeteaseApi, openApp } from './helpers/appFixtures';

// test/ui/bravaisVisualizerMount.spec.ts
// bravais 透光档与播放页 visualizer 的挂载（B6b③，plan「实色档卸载 visualizer」的验证）：
// - 没存过档位时默认实色，首页停稳后 visualizer 卸载；
// - 实色档停在首页时 DOM 里没有 visualizer（canvas 也没有）；
// - 切到部分透明后 visualizer 重新挂上；
// - 从实色首页回播放页 visualizer 正常出现；
// - 打开设置弹窗时 visualizer 仍不挂（2026-10-09 起设置盖着时首页照常显示在半透明遮罩下面，透出的是实色墙）；
// - grid 首页照旧挂着 visualizer（TUI 与切换的完整回归在 libraryRendererSwitch）；
// - 左上角隐藏式返回在首页根层只在有歌时出现，点它回播放页后 visualizer 挂上（没有歌时播放页是空的，深色主题下就是「黑屏」）。
// - 2026-10-09：「信息条始终透明」时缝也是透光处——实色墙 + 透明缝不卸载 visualizer，关掉透明后照旧卸载；
// - 墙后画面的模糊：有透光处时 visualizer 那一层加 CSS 模糊，回播放页撤掉；歌词开关经同一个通道报给 App。
// 遮挡由 bravais 的 stage 在 effect 里报告，App 在首页完全显示 300ms 后才卸载，所以断言一律轮询。

test.use({ screenshot: 'only-on-failure' });

const surface = (page: Page) => page.getByTestId('player-visual-surface');
/** visualizer 挂着没有：它是播放页视觉层里唯一的子树。 */
const visualizerMounted = (page: Page) => surface(page).evaluate(element => element.childElementCount > 0);

/**
 * `look` 为 null 时不种透光档位，走 store 的默认档（实色）。信息条始终透明 2026-10-09 起默认开（实色墙 + 透明缝不卸载
 * visualizer），所以验证「实色档卸载」的用例显式种 `seamClear: false`；`seamClear: null` 不种、走默认。
 */
const bootHome = async (page: Page, suite: 'bravais' | 'grid', look: 'solid' | 'partial' | null, { seamClear = false }: { seamClear?: boolean | null } = {}) => {
    await installBaseState(page, { neteaseMode: 'guest' });
    await page.addInitScript(([suiteId, wallLook, clearSeam]) => {
        localStorage.setItem('library_suite', suiteId as string);
        if (wallLook) localStorage.setItem('library_wall_look', wallLook as string);
        if (clearSeam !== null) localStorage.setItem('library_wall_seam_clear', String(clearSeam));
        // 打开设置弹窗要这两个桥接方法（与 homeCardPosition 同一份最小桥）。
        Object.assign((window as Window & { electron?: Record<string, unknown> }).electron ?? {}, {
            getSettings: async () => ({}),
            getCacheDirectory: async () => ({ path: '', isDefault: true }),
        });
    }, [suite, look, seamClear] as const);
    await mockNeteaseApi(page, 'guest');
    await openApp(page);
};

const setWallLook = (page: Page, look: 'solid' | 'partial' | 'clear') => page.evaluate(async (next) => {
    const path = '/src/stores/useLibraryWallLookStore.ts';
    const { useLibraryWallLookStore } = await import(path);
    useLibraryWallLookStore.getState().setLook(next);
}, look);

const patchWallLook = (page: Page, patch: Record<string, unknown>) => page.evaluate(async (next) => {
    const path = '/src/stores/useLibraryWallLookStore.ts';
    const { useLibraryWallLookStore } = await import(/* @vite-ignore */ path);
    useLibraryWallLookStore.setState(next);
}, patch);

const reportedBackdrop = (page: Page) => page.evaluate(async () => {
    const path = '/src/stores/useLibraryPlayerOcclusionStore.ts';
    const { selectLibraryPlayerBackdrop, useLibraryPlayerOcclusionStore } = await import(/* @vite-ignore */ path);
    return { ...selectLibraryPlayerBackdrop(useLibraryPlayerOcclusionStore.getState()) };
});

const setView = (page: Page, view: 'home' | 'player') => page.evaluate(async (next) => {
    const path = '/src/stores/useAppViewStore.ts';
    const { useAppViewStore } = await import(path);
    useAppViewStore.getState().setView(next);
}, view);

test('with nothing stored the bravais home is a solid wall with a see-through info strip, so the visualizer stays', async ({ page }) => {
    await bootHome(page, 'bravais', null, { seamClear: null });
    const stage = page.locator('[data-library-stage="bravais"]');
    await expect(stage).toHaveAttribute('data-bravais-look', 'solid');
    // 信息条始终透明默认开（用户定，2026-10-09）：缝是透光处，visualizer 不卸载。
    await expect(stage).toHaveClass(/\bhas-clear-seam\b/);
    await page.waitForTimeout(800);
    expect(await visualizerMounted(page)).toBe(true);
    expect(await page.evaluate(() => [localStorage.getItem('library_wall_look'), localStorage.getItem('library_wall_seam_clear')])).toEqual([null, null]);
});

test('with only the info strip made solid, the default solid wall unmounts the visualizer', async ({ page }) => {
    await bootHome(page, 'bravais', null);
    await expect(page.locator('[data-library-stage="bravais"]')).toHaveAttribute('data-bravais-look', 'solid');
    await expect.poll(() => visualizerMounted(page)).toBe(false);
    await expect(surface(page).locator('canvas')).toHaveCount(0);
});

test('the solid bravais home unmounts the visualizer; see-through looks and the player bring it back, settings do not', async ({ page }) => {
    await bootHome(page, 'bravais', 'solid');
    await expect(page.locator('[data-library-stage="bravais"]')).toHaveAttribute('data-bravais-look', 'solid');
    await expect.poll(() => visualizerMounted(page)).toBe(false);
    await expect(surface(page).locator('canvas')).toHaveCount(0);

    // 部分透明：窗里要看得到 visualizer，立即重挂。
    await setWallLook(page, 'partial');
    await expect(page.locator('[data-library-stage="bravais"]')).toHaveAttribute('data-bravais-look', 'partial');
    await expect.poll(() => visualizerMounted(page)).toBe(true);

    // 回到实色：首页完全显示且 stage 报遮挡后再卸载。
    await setWallLook(page, 'solid');
    await expect.poll(() => visualizerMounted(page)).toBe(false);

    // 从实色首页去播放页：立即挂上。
    await setView(page, 'player');
    await expect.poll(() => visualizerMounted(page)).toBe(true);
    await setView(page, 'home');
    await expect(page.locator('[data-library-stage="bravais"]')).toHaveAttribute('data-bravais-look', 'solid');
    await expect.poll(() => visualizerMounted(page)).toBe(false);

    // 设置弹窗盖住首页：首页照常显示在遮罩下面，透出的是实色墙，visualizer 不重新挂上。
    await page.evaluate(async () => {
        const path = '/src/stores/useSettingsModalStore.ts';
        const { useSettingsModalStore } = await import(path);
        useSettingsModalStore.getState().openSettings('options');
    });
    await expect(page.locator('[data-ponder-page-scope="settings-page"]')).toBeVisible();
    await expect(page.locator('[data-library-stage="bravais"]')).toBeVisible();
    await page.waitForTimeout(600);
    expect(await visualizerMounted(page)).toBe(false);
    // 设置里换到部分透明：窗里要看得到 visualizer，设置开着也立即挂上。
    await setWallLook(page, 'partial');
    await expect.poll(() => visualizerMounted(page)).toBe(true);
});

test('the grid home keeps the visualizer mounted whatever the bravais look preference says', async ({ page }) => {
    await bootHome(page, 'grid', 'solid');
    await expect(page.getByRole('button', { name: 'Playlists', exact: true })).toBeVisible();
    await expect(page.locator('[data-library-stage="bravais"]')).toHaveCount(0);
    await page.waitForTimeout(600);
    expect(await visualizerMounted(page)).toBe(true);
});

// 用户实测「首页点左上角返回回到黑屏」：那是没有歌时的空播放页（visualizer 照常挂上，只是没有可画的东西），不是挂载链路的问题。
// 现在首页根层没有歌时不画这颗按钮；有歌时它回到播放页，实色档卸载过的 visualizer 立即重新挂上。
test('the bravais back button at the home root only shows with a song and brings the visualizer back on the player', async ({ page }) => {
    await bootHome(page, 'bravais', 'solid');
    const stage = page.locator('[data-library-stage="bravais"]');
    await expect(stage).toHaveAttribute('data-bravais-look', 'solid');
    await expect(stage).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 15_000 });
    await expect.poll(() => visualizerMounted(page)).toBe(false);
    const back = stage.locator('.lattice-back');
    await expect(back).toHaveCount(0);

    await page.evaluate(async () => {
        const path = '/src/stores/usePlaybackStore.ts';
        const { usePlaybackStore } = await import(/* @vite-ignore */ path);
        const song = { id: 5001, name: 'Back Seed', artists: [{ id: 1, name: 'Seed Artist' }], album: { id: 1, name: 'Seed Album' }, durationMs: 180_000 };
        usePlaybackStore.setState({ playQueue: [song], currentSong: song });
    });
    await expect(back).toHaveAccessibleName('Back to the player');
    await page.mouse.move(700, 500);
    await page.mouse.move(60, 60);
    await expect(back).toHaveClass(/\bis-revealed\b/);
    await back.click();
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#player');
    await expect.poll(() => visualizerMounted(page)).toBe(true);
});

test('a see-through info strip keeps the visualizer mounted under the solid wall', async ({ page }) => {
    await bootHome(page, 'bravais', 'solid');
    const stage = page.locator('[data-library-stage="bravais"]');
    await expect(stage).toHaveAttribute('data-bravais-look', 'solid');
    await expect.poll(() => visualizerMounted(page)).toBe(false);

    // 透明的缝：实色墙不再完全遮挡，visualizer 立即挂回、并且停稳后也不卸载。
    await patchWallLook(page, { seamClear: true });
    await expect(stage).toHaveClass(/\bhas-clear-seam\b/);
    await expect.poll(() => visualizerMounted(page)).toBe(true);
    await page.waitForTimeout(900);
    expect(await visualizerMounted(page)).toBe(true);
    // 缝的纸是半透明的纱，根节点不画墙面。
    const alpha = await stage.locator('.bravais-seam').evaluate((node) => {
        const numbers = (getComputedStyle(node).backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
        return numbers[3] ?? 1;
    });
    expect(alpha).toBeLessThan(1);
    expect(await stage.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');

    // 关掉透明：回到完全遮挡，visualizer 停稳后卸载。
    await patchWallLook(page, { seamClear: false });
    await expect.poll(() => visualizerMounted(page)).toBe(false);
});

test('the backdrop blur and lyrics reach the visualizer only while the wall lets it through', async ({ page }) => {
    await bootHome(page, 'bravais', 'partial');
    const stage = page.locator('[data-library-stage="bravais"]');
    await expect(stage).toHaveAttribute('data-bravais-look', 'partial');
    await expect.poll(() => visualizerMounted(page)).toBe(true);
    await expect(surface(page)).not.toHaveAttribute('data-library-backdrop-blur', /.*/);
    expect(await reportedBackdrop(page)).toEqual({ lyrics: false, blur: false });

    await patchWallLook(page, { backdropBlur: true, backdropLyrics: true });
    await expect(surface(page)).toHaveAttribute('data-library-backdrop-blur', 'true');
    await expect.poll(() => surface(page).evaluate(node => getComputedStyle(node).filter)).toBe('blur(24px)');
    await expect.poll(() => reportedBackdrop(page)).toEqual({ lyrics: true, blur: true });

    // 播放页不受影响：模糊撤掉。
    await setView(page, 'player');
    await expect(surface(page)).not.toHaveAttribute('data-library-backdrop-blur', /.*/);
    await expect.poll(() => surface(page).evaluate(node => getComputedStyle(node).filter)).toBe('none');
    await setView(page, 'home');
    await expect(surface(page)).toHaveAttribute('data-library-backdrop-blur', 'true');

    // 墙回到实色（缝也不透明）：没有透光处，开关不再报 true，visualizer 卸载。
    await setWallLook(page, 'solid');
    await expect.poll(() => reportedBackdrop(page)).toEqual({ lyrics: false, blur: false });
    await expect(surface(page)).not.toHaveAttribute('data-library-backdrop-blur', /.*/);
    await expect.poll(() => visualizerMounted(page)).toBe(false);
});
