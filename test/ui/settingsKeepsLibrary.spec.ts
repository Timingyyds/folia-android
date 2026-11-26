import { expect, test, type Page } from '@playwright/test';
import { installBaseState, mockNeteaseApi, openApp } from './helpers/appFixtures';

// test/ui/settingsKeepsLibrary.spec.ts
// 设置弹窗盖在资料库首页上时资料库原地留着（2026-10-09，用户要求）：
// - 首页外壳、当前 suite 的 surface / stage 都挂着，并且在设置的半透明遮罩下面照常显示（不淡出、不 visibility: hidden）；
// - 只是不可交互：首页层不接指针，墙 / 网格的按键让给设置；
// - 关掉设置后原样回来：同一个 DOM 节点、没有重新请求首页数据；网格的当前卡不变；bravais 的墙没有重新入场
//   （stage 根节点从没挂上 data-bravais-settling），相机与聚焦的磁贴原地不变，实色墙下的 visualizer 整个过程都不挂。
// 首页层的显示 / 交互规则在 buildHomeSurfacePresentation，visualizer 的遮挡规则在 playerVisualizerMount（单测各有覆盖）。

test.use({ screenshot: 'only-on-failure' });

const homeLayer = (page: Page) => page.locator('[data-wall-handoff-layer="home"]');
const settingsDialog = (page: Page) => page.locator('[data-ponder-page-scope="settings-page"]');
const stage = (page: Page) => page.locator('[data-library-stage="bravais"]');
const focusedTitle = (page: Page) => page.locator('[data-grid3d-slider] + div h3');
/** visualizer 挂着没有：它是播放页视觉层里唯一的子树。 */
const visualizerMounted = (page: Page) => page.getByTestId('player-visual-surface').evaluate(element => element.childElementCount > 0);

const boot = async (page: Page, suite: 'bravais' | 'grid') => {
    // 保留真实的 matchMedia：设置弹窗的宽版布局按 (min-width: 768px) 分支。
    await installBaseState(page, { neteaseMode: 'logged-in', preserveNativeMediaQueries: true });
    await page.addInitScript((suiteId) => {
        localStorage.setItem('library_suite', suiteId);
        if (suiteId === 'bravais') {
            localStorage.setItem('library_wall_look', 'solid');
            // 信息条始终透明默认开（2026-10-09）；这条看的是「实色墙 = 实色缝」下 visualizer 不重挂，显式关掉。
            localStorage.setItem('library_wall_seam_clear', 'false');
        }
        // 打开设置弹窗要这两个桥接方法（与 bravaisSettingsGroup 同一份最小桥）。
        Object.assign((window as Window & { electron?: Record<string, unknown> }).electron ?? {}, {
            getSettings: async () => ({}),
            getCacheDirectory: async () => ({ path: '', isDefault: true }),
        });
    }, suite);
    await mockNeteaseApi(page, 'logged-in');
    await openApp(page);
};

/** 记下首页数据请求（mock 的网易接口）：设置开关前后数一遍，不应该多。 */
const countHomeRequests = (page: Page) => {
    const urls: string[] = [];
    page.on('request', (request) => {
        if (request.url().includes('__mock_netease__')) urls.push(request.url());
    });
    return urls;
};

const setSettingsOpen = (page: Page, open: boolean) => page.evaluate(async (next) => {
    const path = '/src/stores/useSettingsModalStore.ts';
    const { useSettingsModalStore } = await import(/* @vite-ignore */ path);
    if (next) useSettingsModalStore.getState().openSettings('options');
    else useSettingsModalStore.getState().closeSettings();
}, open);

/** 首页层此刻的显示状态：显示着（visibility 与整层 opacity）、接不接指针。 */
const homeLayerState = (page: Page) => homeLayer(page).evaluate((layer) => {
    const fade = layer.firstElementChild as HTMLElement;
    return {
        visibility: getComputedStyle(layer).visibility,
        display: getComputedStyle(layer).display,
        pointerEvents: getComputedStyle(layer).pointerEvents,
        opacity: Number(getComputedStyle(fade).opacity),
    };
});

/**
 * 逐帧记下设置开关期间首页有没有动过：首页层的 opacity 最小值、stage 根节点有没有挂过 data-bravais-settling、
 * visualizer 有没有挂上过、被标记的节点是不是一直在文档里。
 */
const startSampling = (page: Page, selector: string) => page.evaluate((markSelector) => {
    const w = window as unknown as { __keepSamples: { minOpacity: number; settling: boolean; visualizer: boolean; detached: boolean }; __keepStop: boolean; __keepNode: Element | null };
    w.__keepNode = document.querySelector(markSelector);
    w.__keepStop = false;
    w.__keepSamples = { minOpacity: 1, settling: false, visualizer: false, detached: false };
    const tick = () => {
        if (w.__keepStop) return;
        const layer = document.querySelector('[data-wall-handoff-layer="home"]');
        const fade = layer?.firstElementChild as HTMLElement | null | undefined;
        if (fade) w.__keepSamples.minOpacity = Math.min(w.__keepSamples.minOpacity, Number(getComputedStyle(fade).opacity));
        if (document.querySelector('[data-library-stage][data-bravais-settling]')) w.__keepSamples.settling = true;
        if ((document.querySelector('[data-testid="player-visual-surface"]')?.childElementCount ?? 0) > 0) w.__keepSamples.visualizer = true;
        if (!w.__keepNode || !document.contains(w.__keepNode) || document.querySelector(markSelector) !== w.__keepNode) w.__keepSamples.detached = true;
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}, selector);

const stopSampling = (page: Page) => page.evaluate(() => {
    const w = window as unknown as { __keepSamples: unknown; __keepStop: boolean };
    w.__keepStop = true;
    return w.__keepSamples as { minOpacity: number; settling: boolean; visualizer: boolean; detached: boolean };
});

test('the grid home stays mounted and visible under the settings dialog and comes back untouched', async ({ page }) => {
    await boot(page, 'grid');
    await expect(focusedTitle(page)).toHaveText('Daily Mix');
    // 换到第二张卡：关掉设置后应该还停在这张。
    await page.locator('[data-grid3d-index="1"]').click();
    await expect(focusedTitle(page)).not.toHaveText('Daily Mix');
    await page.waitForTimeout(500);
    const title = (await focusedTitle(page).textContent()) ?? '';
    const requests = countHomeRequests(page);
    await startSampling(page, '[data-grid3d-slider]');

    await setSettingsOpen(page, true);
    await expect(settingsDialog(page)).toBeVisible();
    // 遮罩下面照常显示，只是不接指针。
    await page.waitForTimeout(600);
    expect(await homeLayerState(page)).toEqual({ visibility: 'visible', display: 'block', pointerEvents: 'none', opacity: 1 });
    await expect(page.locator('[data-grid3d-slider]')).toBeVisible();
    // 键盘让给设置：方向键不换卡。
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    await expect(focusedTitle(page)).toHaveText(title);

    await setSettingsOpen(page, false);
    await expect(settingsDialog(page)).toHaveCount(0);
    await page.waitForTimeout(600);
    const samples = await stopSampling(page);
    expect(samples.detached).toBe(false);
    expect(samples.minOpacity).toBe(1);
    expect(await homeLayerState(page)).toEqual({ visibility: 'visible', display: 'block', pointerEvents: 'auto', opacity: 1 });
    await expect(focusedTitle(page)).toHaveText(title);
    expect(requests).toEqual([]);
});

test('the bravais wall stays mounted under the settings dialog: no re-entry, same camera and focus, no visualizer', async ({ page }) => {
    await boot(page, 'bravais');
    await expect(stage(page)).toHaveAttribute('data-bravais-layer', /^home:/, { timeout: 20_000 });
    await expect(page.locator('.bravais-tile').first()).toBeAttached();
    await expect(stage(page)).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 15_000 });
    await expect(stage(page)).toHaveAttribute('data-bravais-look', 'solid');
    await expect.poll(() => visualizerMounted(page)).toBe(false);

    // 挪一下相机、用键盘聚焦一块磁贴：关掉设置后它们都该原地不变。
    await page.mouse.move(720, 560);
    await page.mouse.down();
    await page.mouse.move(640, 520, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => {
        await page.keyboard.press('ArrowRight');
        return page.locator('.bravais-tile[data-bravais-focused]').count();
    }).toBe(1);
    await expect(stage(page)).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 15_000 });
    await page.waitForTimeout(800);
    const camera = () => page.locator('[data-bravais-half="left"]').evaluate(node => (node as HTMLElement).style.transform);
    const focusedSlot = () => page.locator('.bravais-tile[data-bravais-focused]').getAttribute('data-bravais-slot');
    const cameraBefore = await camera();
    const slotBefore = await focusedSlot();
    expect(slotBefore).not.toBeNull();
    const requests = countHomeRequests(page);
    await startSampling(page, '[data-library-stage="bravais"]');

    await setSettingsOpen(page, true);
    await expect(settingsDialog(page)).toBeVisible();
    await page.waitForTimeout(600);
    expect(await homeLayerState(page)).toEqual({ visibility: 'visible', display: 'block', pointerEvents: 'none', opacity: 1 });
    await expect(stage(page)).toBeVisible();
    // 不可交互：stage 不再是 active，墙的按键让给设置。
    await expect(stage(page)).not.toHaveAttribute('data-bravais-active', /.*/);
    await page.keyboard.press('ArrowRight');
    expect(await focusedSlot()).toBe(slotBefore);

    await setSettingsOpen(page, false);
    await expect(settingsDialog(page)).toHaveCount(0);
    await expect(stage(page)).toHaveAttribute('data-bravais-active', 'true');
    await page.waitForTimeout(800);
    const samples = await stopSampling(page);
    expect(samples).toEqual({ minOpacity: 1, settling: false, visualizer: false, detached: false });
    expect(await camera()).toBe(cameraBefore);
    expect(await focusedSlot()).toBe(slotBefore);
    expect(requests).toEqual([]);
});
