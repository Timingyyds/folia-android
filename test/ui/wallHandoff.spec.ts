import { expect, test, type Page } from '@playwright/test';
import { installBaseState, localImportFixture, mockNeteaseApi, openApp, svgDataUrl } from './helpers/appFixtures';

// test/ui/wallHandoff.spec.ts
// 翻牌交接（设计稿 §7「进入队列」：资料库墙 bravais ↔ Lattice）在真实应用里的接缝：
// - 进 / 出 Lattice 时两面墙确有重叠期（各自根节点的 data-wall-handoff = out / in），结束后只剩一面；
// - 右下角工具按钮是 App 的 dock 里同一个节点，整个交接期间不重建、不挪位置；
// - 降低动态效果时是短淡入淡出交叉（mode = fade），没有合缝 / 翻牌阶段；
// - 透光档下 visualizer：进 Lattice 时窗关上（closing 结束）之前一直挂着、之后卸载；回来时窗打开（opening）之前已经挂上；
//   实色档下整个交接都不挂；
// - grid 下进出 Lattice 不走交接（没有任何 data-wall-handoff），Lattice 照旧整层淡出；
// - 工具面板上方队列浮岛的开合偏好（useLatticeSettingsStore）两面墙共用：交接前后照旧展开；Lattice 的 go-home 翻牌回到 #home。
// installBaseState 默认把所有动效面降级（截图基线要静止画面）；要看翻牌的用例把 lattice 与 collectionMorph 两面放开。
// 每一帧的状态由页面里的 rAF 采样器记下来（交接只有一秒多，轮询会漏掉中间的阶段）。

test.use({ screenshot: 'only-on-failure' });

type Look = 'solid' | 'partial';

type Sample = {
    t: number;
    stage: number;
    lattice: number;
    homeRole: string | null;
    homePhase: string | null;
    homeMode: string | null;
    latticeRole: string | null;
    latticePhase: string | null;
    visualizer: boolean;
    toolsSame: boolean | null;
    toolsRect: { x: number; y: number; width: number; height: number } | null;
    posters: number;
};

const stage = (page: Page) => page.locator('[data-library-stage="bravais"]');
const latticeRoot = (page: Page) => page.locator('.lattice-queue-root');

const boot = async (page: Page, { suite, look = null, motion }: { suite: 'bravais' | 'grid'; look?: Look | null; motion: 'full' | 'reduced' }) => {
    await installBaseState(page, { neteaseMode: 'guest' });
    await page.addInitScript(([suiteId, wallLook, fullMotion]) => {
        localStorage.setItem('library_suite', suiteId as string);
        if (wallLook) localStorage.setItem('library_wall_look', wallLook as string);
        // 信息条始终透明 2026-10-09 起默认开；这里的用例按「实色墙 = 实色缝」写，显式关掉。
        localStorage.setItem('library_wall_seam_clear', 'false');
        if (fullMotion) {
            localStorage.removeItem('reduce_motion_lattice');
            localStorage.removeItem('reduce_motion_collectionMorph');
        }
    }, [suite, look, motion === 'full'] as const);
    await mockNeteaseApi(page, 'guest');
    await openApp(page);
};

/** 队列里放 24 首（带封面），第一首在播：Lattice 有海报，进 Lattice 时正在播放那首展开。 */
const seedQueue = (page: Page) => page.evaluate(async (covers) => {
    const path = '/src/stores/usePlaybackStore.ts';
    const { usePlaybackStore } = await import(/* @vite-ignore */ path);
    const queue = covers.map((coverUrl, index) => ({
        id: 5000 + index,
        name: `Handoff Track ${index + 1}`,
        artists: [{ id: 1, name: 'Handoff Artist' }],
        album: { id: 1, name: 'Handoff Album', coverUrl },
        durationMs: 180_000,
    }));
    usePlaybackStore.setState({ playQueue: queue, currentSong: queue[0] });
}, Array.from({ length: 24 }, (_, index) => svgDataUrl(String(index + 1), `hsl(${(index * 37) % 360} 60% 42%)`)));

const setView = (page: Page, view: 'home' | 'lattice') => page.evaluate(async (next) => {
    const path = '/src/stores/useAppViewStore.ts';
    const { useAppViewStore } = await import(/* @vite-ignore */ path);
    useAppViewStore.getState().setView(next);
}, view);

const bravaisSettled = async (page: Page) => {
    await expect(stage(page)).toHaveAttribute('data-bravais-layer', /^home:/, { timeout: 20_000 });
    await expect(page.locator('.bravais-tile').first()).toBeAttached();
    await expect(stage(page)).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 15_000 });
};

/** 开始逐帧采样（记下此刻的工具按钮节点，之后每帧比对是不是同一个）。 */
const startSampling = (page: Page) => page.evaluate(() => {
    const w = window as unknown as { __handoffSamples: unknown[]; __handoffStop: boolean; __handoffTools: Element | null };
    w.__handoffSamples = [];
    w.__handoffStop = false;
    w.__handoffTools = document.querySelector('.lattice-tools');
    const t0 = performance.now();
    const tick = () => {
        const stageNode = document.querySelector('[data-library-stage="bravais"]');
        const latticeNode = document.querySelector('.lattice-queue-root');
        const tools = document.querySelector('.lattice-tools');
        const rect = tools?.getBoundingClientRect();
        w.__handoffSamples.push({
            t: performance.now() - t0,
            stage: document.querySelectorAll('[data-library-stage="bravais"]').length,
            lattice: document.querySelectorAll('.lattice-queue-root').length,
            homeRole: stageNode?.getAttribute('data-wall-handoff') ?? null,
            homePhase: stageNode?.getAttribute('data-wall-handoff-phase') ?? null,
            homeMode: stageNode?.getAttribute('data-wall-handoff-mode') ?? null,
            latticeRole: latticeNode?.getAttribute('data-wall-handoff') ?? null,
            latticePhase: latticeNode?.getAttribute('data-wall-handoff-phase') ?? null,
            visualizer: (document.querySelector('[data-testid="player-visual-surface"]')?.childElementCount ?? 0) > 0,
            toolsSame: tools ? tools === w.__handoffTools : null,
            toolsRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
            posters: document.querySelectorAll('.lattice-poster').length,
        });
        if (!w.__handoffStop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
});

const stopSampling = (page: Page) => page.evaluate(() => {
    const w = window as unknown as { __handoffSamples: Sample[]; __handoffStop: boolean };
    w.__handoffStop = true;
    return w.__handoffSamples;
});

const expectToolsSteady = (samples: Sample[], before: Sample['toolsRect']) => {
    const withTools = samples.filter(sample => sample.toolsSame !== null);
    expect(withTools.length).toBe(samples.length);
    expect(withTools.every(sample => sample.toolsSame)).toBe(true);
    for (const sample of withTools) {
        expect(Math.abs(sample.toolsRect!.x - before!.x)).toBeLessThan(0.5);
        expect(Math.abs(sample.toolsRect!.y - before!.y)).toBeLessThan(0.5);
    }
};

const toolsRect = (page: Page) => page.locator('.lattice-tools').evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
});

test('[bravais] entering and leaving Lattice flips one wall into the other, with one tools button throughout', async ({ page }) => {
    await boot(page, { suite: 'bravais', look: 'solid', motion: 'full' });
    await seedQueue(page);
    await bravaisSettled(page);
    await expect(page.locator('.lattice-tools')).toHaveCount(1);
    const before = await toolsRect(page);

    // 进 Lattice。
    await startSampling(page);
    await setView(page, 'lattice');
    await expect(stage(page)).toHaveCount(0, { timeout: 10_000 });
    await expect(latticeRoot(page)).not.toHaveAttribute('data-wall-handoff', /.*/);
    let samples = await stopSampling(page);
    const overlapIn = samples.filter(sample => sample.homeRole === 'out' && sample.latticeRole === 'in');
    expect(overlapIn.length).toBeGreaterThan(0);
    expect(new Set(samples.map(sample => sample.homePhase))).toEqual(new Set(['closing', 'flipping', null]));
    expect(samples.every(sample => sample.homeMode === null || sample.homeMode === 'flip')).toBe(true);
    // 合缝的那一段 Lattice 已经挂着、海报侧立着等；翻完只剩 Lattice。
    expect(overlapIn.some(sample => sample.homePhase === 'closing' && sample.posters > 0)).toBe(true);
    const last = samples[samples.length - 1];
    expect(last).toMatchObject({ stage: 0, lattice: 1, latticeRole: null });
    expectToolsSteady(samples, before);
    await expect(page.locator('.lattice-tools')).toHaveCount(1);
    await expect(page.locator('.lattice-poster.is-expanded')).toHaveCount(1);

    // 出 Lattice。
    await startSampling(page);
    await setView(page, 'home');
    await expect(latticeRoot(page)).toHaveCount(0, { timeout: 10_000 });
    await expect(stage(page)).not.toHaveAttribute('data-wall-handoff', /.*/, { timeout: 10_000 });
    samples = await stopSampling(page);
    const overlapOut = samples.filter(sample => sample.homeRole === 'in' && sample.latticeRole === 'out');
    expect(overlapOut.length).toBeGreaterThan(0);
    expect(overlapOut.some(sample => sample.homePhase === 'flipping')).toBe(true);
    // Lattice 在翻完时卸载（AnimatePresence 的零时长退场要一两帧），缝张开（opening）的其余时间只剩资料库墙。
    const opening = samples.filter(sample => sample.homePhase === 'opening');
    expect(opening.length).toBeGreaterThan(0);
    expect(opening.filter(sample => sample.lattice > 0).every(sample => sample.t - opening[0].t < 120)).toBe(true);
    expect(opening[opening.length - 1].lattice).toBe(0);
    expect(samples[samples.length - 1]).toMatchObject({ stage: 1, lattice: 0, homeRole: null });
    expectToolsSteady(samples, before);
    await bravaisSettled(page);
});

test('[bravais] the tools panel goes to Lattice through the host entry: the same flip handoff and the same tools button', async ({ page }) => {
    await boot(page, { suite: 'bravais', look: 'solid', motion: 'full' });
    await seedQueue(page);
    await bravaisSettled(page);
    const before = await toolsRect(page);

    // 工具面板顶部「前往 Lattice」：宿主的 onOpenLattice（首页工具格「队列拼贴」同一个入口），面板先收起。
    await page.getByRole('button', { name: 'Wall tools', exact: true }).click();
    const lattice = page.getByRole('menu', { name: 'Wall tools', exact: true }).locator('[data-wall-tools-quick="open-lattice"]');
    await expect(lattice).toHaveAccessibleName('Go to Lattice');
    await startSampling(page);
    await lattice.click();
    await expect(stage(page)).toHaveCount(0, { timeout: 10_000 });
    await expect(latticeRoot(page)).not.toHaveAttribute('data-wall-handoff', /.*/);
    const samples = await stopSampling(page);
    expect(samples.filter(sample => sample.homeRole === 'out' && sample.latticeRole === 'in').length).toBeGreaterThan(0);
    expect(new Set(samples.map(sample => sample.homePhase))).toEqual(new Set(['closing', 'flipping', null]));
    expectToolsSteady(samples, before);
    await expect(page.getByRole('menu', { name: 'Wall tools', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => window.location.hash)).toBe('#lattice');
});

test('[bravais] with reduced motion the walls cross-fade instead of flipping', async ({ page }) => {
    await boot(page, { suite: 'bravais', look: 'solid', motion: 'reduced' });
    await seedQueue(page);
    await bravaisSettled(page);

    await startSampling(page);
    await setView(page, 'lattice');
    await expect(stage(page)).toHaveCount(0, { timeout: 10_000 });
    let samples = await stopSampling(page);
    let overlap = samples.filter(sample => sample.homeRole === 'out' && sample.latticeRole === 'in');
    expect(overlap.length).toBeGreaterThan(0);
    // 没有合缝、没有翻牌：等 Lattice 画出来（closing）之后整层淡入（flipping 这一段就是 0.18s 的交叉）。
    expect(overlap.every(sample => sample.homeMode === 'fade')).toBe(true);
    const crossFade = overlap.filter(sample => sample.homePhase === 'flipping');
    expect(crossFade.length).toBeGreaterThan(0);
    expect(crossFade[crossFade.length - 1].t - crossFade[0].t).toBeLessThan(450);
    expect(await page.locator('.lattice-poster').first().evaluate(node => getComputedStyle(node).transform)).not.toContain('matrix3d');

    await startSampling(page);
    await setView(page, 'home');
    await expect(latticeRoot(page)).toHaveCount(0, { timeout: 10_000 });
    await expect(stage(page)).not.toHaveAttribute('data-wall-handoff', /.*/, { timeout: 10_000 });
    samples = await stopSampling(page);
    overlap = samples.filter(sample => sample.homeRole === 'in' && sample.latticeRole === 'out');
    expect(overlap.length).toBeGreaterThan(0);
    expect(samples.every(sample => sample.homeMode === null || sample.homeMode === 'fade')).toBe(true);
    expect(samples.some(sample => sample.homePhase === 'opening')).toBe(false);
});

test('[bravais] a see-through wall keeps the visualizer until its windows close, and has it back before they open', async ({ page }) => {
    await boot(page, { suite: 'bravais', look: 'partial', motion: 'full' });
    await seedQueue(page);
    await bravaisSettled(page);
    await expect.poll(() => page.getByTestId('player-visual-surface').evaluate(node => node.childElementCount > 0)).toBe(true);

    await startSampling(page);
    await setView(page, 'lattice');
    await expect(stage(page)).toHaveCount(0, { timeout: 10_000 });
    await page.waitForTimeout(100);
    let samples = await stopSampling(page);
    const closing = samples.filter(sample => sample.homePhase === 'closing');
    expect(closing.length).toBeGreaterThan(0);
    expect(closing.every(sample => sample.visualizer)).toBe(true);
    // 开翻之后（窗已经关上）卸载，翻完更不挂。
    expect(samples.filter(sample => sample.homePhase === 'flipping').some(sample => !sample.visualizer)).toBe(true);
    expect(samples[samples.length - 1].visualizer).toBe(false);

    await startSampling(page);
    await setView(page, 'home');
    await expect(stage(page)).not.toHaveAttribute('data-wall-handoff', /.*/, { timeout: 10_000 });
    samples = await stopSampling(page);
    const opening = samples.filter(sample => sample.homePhase === 'opening');
    expect(opening.length).toBeGreaterThan(0);
    expect(opening.every(sample => sample.visualizer)).toBe(true);
    expect(samples.filter(sample => sample.homePhase === 'flipping').every(sample => sample.visualizer)).toBe(true);
    expect(samples[samples.length - 1].visualizer).toBe(true);
});

test('[bravais] a solid wall never brings the visualizer up during a handoff', async ({ page }) => {
    await boot(page, { suite: 'bravais', look: 'solid', motion: 'full' });
    await seedQueue(page);
    await bravaisSettled(page);
    await expect.poll(() => page.getByTestId('player-visual-surface').evaluate(node => node.childElementCount > 0)).toBe(false);

    await startSampling(page);
    await setView(page, 'lattice');
    await expect(stage(page)).toHaveCount(0, { timeout: 10_000 });
    await setView(page, 'home');
    await expect(latticeRoot(page)).toHaveCount(0, { timeout: 10_000 });
    await expect(stage(page)).not.toHaveAttribute('data-wall-handoff', /.*/, { timeout: 10_000 });
    await page.waitForTimeout(400);
    const samples = await stopSampling(page);
    expect(samples.some(sample => sample.homeRole !== null)).toBe(true);
    expect(samples.every(sample => !sample.visualizer)).toBe(true);
});

test('[grid] entering and leaving Lattice keeps the old fade and never starts a handoff', async ({ page }) => {
    await boot(page, { suite: 'grid', motion: 'full' });
    await seedQueue(page);
    await expect(page.getByRole('button', { name: 'Playlists', exact: true })).toBeVisible();
    await expect(stage(page)).toHaveCount(0);

    await startSampling(page);
    await setView(page, 'lattice');
    await expect(latticeRoot(page)).toHaveCount(1);
    await expect(page.locator('.lattice-poster').first()).toBeVisible();
    await page.waitForTimeout(400);
    await setView(page, 'home');
    // Lattice 照旧整层淡出 0.62s：切回首页 0.2s 后它还在，透明度在往下走。
    await page.waitForTimeout(200);
    const fading = await page.locator('[data-wall-handoff-layer="lattice"]').evaluate(node => Number(getComputedStyle(node).opacity));
    expect(fading).toBeGreaterThan(0);
    expect(fading).toBeLessThan(0.98);
    await expect(latticeRoot(page)).toHaveCount(0, { timeout: 5_000 });
    const samples = await stopSampling(page);
    expect(samples.every(sample => sample.homeRole === null && sample.latticeRole === null)).toBe(true);
    expect(await page.locator('[data-wall-handoff]').count()).toBe(0);
});

test('[bravais] entering Lattice from the playing focus card lands Lattice\'s open poster on that card', async ({ page }) => {
    await installBaseState(page, { neteaseMode: 'guest', localImportFixture });
    await page.addInitScript(() => {
        localStorage.setItem('playback_entry_view', 'stay');
        localStorage.setItem('playback_entry_view_chosen', 'true');
        localStorage.removeItem('reduce_motion_lattice');
        localStorage.removeItem('reduce_motion_collectionMorph');
    });
    await mockNeteaseApi(page, 'guest');
    await openApp(page);
    await page.getByRole('button', { name: 'Folder' }).last().click();
    await page.getByRole('button', { name: 'Import Folder' }).last().click();
    await expect(page.getByText('All Songs').first()).toBeVisible();
    await page.getByRole('heading', { name: 'All Songs' }).first().click();
    await expect(page.getByText('Midnight Train').first()).toBeVisible();
    await page.getByTestId('dev-library-renderer-switch').locator('[data-renderer="bravais"]').click();
    await expect(page.locator('.bravais-tile[data-library-entry]').first()).toBeAttached();
    await expect(stage(page)).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 15_000 });

    // 屏幕中部的一首：点开聚焦卡、立即播放（留在原处），再把「播放后进入的视图」换成 Lattice。
    const slot = await page.evaluate(() => {
        const seamRect = document.querySelector('[data-bravais-seam]')?.getBoundingClientRect();
        const fits = (rect: DOMRect) => rect.left > 200 && rect.top > 120
            && rect.right < window.innerWidth - 200 && rect.bottom < window.innerHeight - 200
            && (!seamRect || seamRect.width < 1 || rect.right < seamRect.left - 4 || rect.left > seamRect.right + 4);
        return [...document.querySelectorAll<HTMLElement>('.bravais-tile[data-library-entry]')]
            .find(element => fits(element.getBoundingClientRect()))?.dataset.bravaisSlot ?? null;
    });
    expect(slot).not.toBeNull();
    await page.locator(`[data-bravais-slot="${slot}"] article`).click();
    const card = page.locator('[data-bravais-expanded]');
    await expect(card).toHaveCount(1);
    await card.locator('[data-bravais-action="play"]').click();
    // 播放是异步的（本地文件）：等它真的开始了再改设置，免得「播放后进入的视图」读到新值、直接跳去 Lattice。
    await expect.poll(() => page.evaluate(async () => {
        const path = '/src/stores/usePlaybackStore.ts';
        const { usePlaybackStore } = await import(/* @vite-ignore */ path);
        return (usePlaybackStore.getState().currentSong?.name ?? null) as string | null;
    })).toBe('Midnight Train');
    await page.waitForTimeout(500);
    await page.evaluate(async () => {
        const path = '/src/stores/usePlaybackEntryViewStore.ts';
        const { usePlaybackEntryViewStore } = await import(/* @vite-ignore */ path);
        usePlaybackEntryViewStore.getState().setPlaybackEntryView('lattice');
    });
    await expect(card.locator('[data-bravais-action="enter"]')).toHaveAccessibleName('Open Lattice');
    await expect(stage(page)).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 15_000 });
    await page.waitForTimeout(700);

    // 合缝之后（两半墙靠拢，卡片会挪）首页墙报上来的那张卡（会话的 align.card），就是 Lattice 展开的海报要落的位置。
    await page.evaluate(async () => {
        const path = '/src/stores/useWallHandoffStore.ts';
        const { useWallHandoffStore } = await import(/* @vite-ignore */ path);
        const w = window as unknown as { __handoffAlign: unknown };
        w.__handoffAlign = null;
        useWallHandoffStore.subscribe((state: { session: { align: unknown } | null }) => {
            if (state.session?.align) w.__handoffAlign = state.session.align;
        });
    });
    await card.locator('[data-bravais-action="enter"]').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __handoffAlign: unknown }).__handoffAlign !== null)).toBe(true);
    const align = await page.evaluate(() => (window as unknown as {
        __handoffAlign: { card: { x: number; y: number; width: number; height: number } | null };
    }).__handoffAlign);
    expect(align.card).not.toBeNull();
    const homeCard = align.card!;
    await expect(stage(page)).toHaveCount(0, { timeout: 10_000 });
    const poster = page.locator('.lattice-poster.is-expanded');
    await expect(poster).toHaveCount(1);
    // 海报的展开弹簧放完再量（它的 transform 里没有翻牌的透视之后就是落定的样子）。
    await expect.poll(() => poster.evaluate(node => node.style.transform.includes('perspective'))).toBe(false);
    await page.waitForTimeout(400);
    const latticeCard = await poster.evaluate(node => {
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    for (const side of ['x', 'y', 'width', 'height'] as const) {
        expect(Math.abs(latticeCard[side] - homeCard[side]), side).toBeLessThan(2);
    }
});

test('[bravais] the queue island stays open across the handoff, and the Lattice go-home flips back to #home', async ({ page }) => {
    await boot(page, { suite: 'bravais', look: 'solid', motion: 'full' });
    await seedQueue(page);
    await bravaisSettled(page);
    // 同一颗按钮，名字随墙变（资料库墙「Wall tools」、Lattice「Lattice tools」）。
    const tools = page.getByRole('button', { name: /^(Wall|Lattice) tools$/ });
    const panel = page.getByRole('menu', { name: /^(Wall|Lattice) tools$/ });
    const island = page.getByRole('region', { name: 'Play queue', exact: true });

    // 资料库墙上展开浮岛，再收起面板（偏好记着展开）。
    await tools.click();
    await panel.locator('[data-wall-tools-quick="queue"]').click();
    await expect(island).toBeVisible();
    await tools.click();
    await expect(island).toHaveCount(0);

    // 进 Lattice：同一颗按钮，打开面板时浮岛照旧展开。
    await setView(page, 'lattice');
    await expect(stage(page)).toHaveCount(0, { timeout: 10_000 });
    await expect(latticeRoot(page)).not.toHaveAttribute('data-wall-handoff', /.*/);
    await tools.click();
    await expect(island).toBeVisible();
    await expect(panel.locator('[data-wall-tools-quick="queue"]')).toHaveAttribute('aria-expanded', 'true');
    await expect(island.locator('.lattice-tools-island-heading')).toHaveText('Play queue · 24 songs');

    // Lattice 的「回到主页」：翻牌回资料库墙，hash 回到 #home；面板收起，偏好仍是展开。
    await panel.locator('[data-wall-tools-quick="go-home"]').click();
    await expect(latticeRoot(page)).toHaveCount(0, { timeout: 10_000 });
    await expect(stage(page)).not.toHaveAttribute('data-wall-handoff', /.*/, { timeout: 10_000 });
    expect(await page.evaluate(() => window.location.hash)).toBe('#home');
    await bravaisSettled(page);
    await tools.click();
    await expect(island).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('wall_tools_queue_island_open'))).toBe('true');
});
