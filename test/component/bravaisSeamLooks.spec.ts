import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

// test/component/bravaisSeamLooks.spec.ts
// 信息条（缝）的材质（2026-10-09，设计稿 §5「缝的材质」），挂 bravaisKinds 探针（真实 BravaisStage）：
// - 实色模式的 8 个预设：根节点的 data-bravais-seam-style 与材质变量（主题纸色不写变量），缝与边缘标签换背景；
//   文字色规则——印刷系固定墨色（白纸 #141414 / 黑纸 #f3f1ec，缝里的主题变量一并换掉），其余沿用主题主色；
//   三套主题下每个预设的正文对比度 ≥ 4.5；
// - 与叠色 / 熄灯两层共存：预设只换纸与墨，::before / ::after 照旧（叠色 e、熄灯 60%）；
// - 「始终透明」：缝是半透明的纱（不画实色纸）、预设不生效（不写材质变量，值保留），按窗处理（不染、熄灯只压内容）；
//   实色墙下 stage 报「不遮挡」，墙后画面的歌词 / 模糊只在透着时报 true，模糊时纱更淡；墙的透光档不影响预设。

const stage = (page: Page) => page.locator('[data-library-stage="bravais"]');
const seam = (page: Page) => page.locator('.bravais-seam');
const settled = (page: Page) => expect(stage(page)).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 10_000 });

type SeamStyle = 'paper' | 'white' | 'black' | 'frost' | 'dots' | 'hatch' | 'contour' | 'check';
const STYLES: SeamStyle[] = ['paper', 'white', 'black', 'frost', 'dots', 'hatch', 'contour', 'check'];
type KindsProps = {
    theme?: 'midnight' | 'daylight' | 'vivid';
    look?: 'solid' | 'partial' | 'clear';
    lights?: 'on' | 'off';
    tint?: 'on' | 'off';
    seam?: SeamStyle;
    clearSeam?: 'on' | 'off';
    lyrics?: 'on' | 'off';
    blur?: 'on' | 'off';
    current?: string;
};
/** 探针三套主题的底色（与 BravaisKindsProbe 的 THEMES 一致）。 */
const THEME_BG: Record<NonNullable<KindsProps['theme']>, [number, number, number]> = {
    midnight: [0x09, 0x09, 0x0b],
    daylight: [0xf5, 0xf5, 0xf4],
    vivid: [0x0b, 0x0a, 0x0c],
};

const mountKinds = async (mount: (story: string, props?: Record<string, unknown>) => Promise<unknown>, page: Page, props: KindsProps = {}) => {
    await mount('bravaisKinds', { current: 'none', ...props });
    await expect.poll(() => page.evaluate(() => window.__bravaisKindsProbe?.ready() ?? false), { timeout: 30_000 }).toBe(true);
    await settled(page);
    await page.mouse.move(2, 600);
};

/** color(srgb r g b / a) 或 rgb(a)() → [r, g, b, a]（0–1）。 */
const channels = (color: string): number[] => {
    const numbers = (color.match(/[\d.]+/g) ?? []).map(Number);
    if (color.startsWith('color(')) return [numbers[0], numbers[1], numbers[2], numbers[3] ?? 1];
    return [numbers[0] / 255, numbers[1] / 255, numbers[2] / 255, numbers[3] ?? 1];
};
const linear = (value: number) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const relativeLuminance = ([r, g, b]: number[]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
/** 把带 alpha 的颜色压到给定底色上。 */
const over = (color: number[], base: number[]) => {
    const alpha = color[3] ?? 1;
    return [0, 1, 2].map(index => color[index] * alpha + base[index] * (1 - alpha));
};
const contrast = (a: number[], b: number[]) => {
    const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
};

const computed = (locator: Locator, ...properties: string[]) => locator.evaluate((node, names) => {
    const style = getComputedStyle(node);
    return Object.fromEntries(names.map(name => [name, style.getPropertyValue(name)]));
}, properties);
const pseudo = (locator: Locator, element: '::before' | '::after') => locator.evaluate((node, which) => {
    const style = getComputedStyle(node, which);
    return { opacity: Number(style.opacity), background: style.backgroundColor };
}, element);
const setWallLook = (page: Page, patch: Record<string, unknown>) => page.evaluate(async (next) => {
    const path = '/src/stores/useLibraryWallLookStore.ts';
    const module = await import(/* @vite-ignore */ path) as { useLibraryWallLookStore: { setState: (value: Record<string, unknown>) => void } };
    module.useLibraryWallLookStore.setState(next);
}, patch);
const reports = (page: Page) => page.evaluate(() => window.__bravaisKindsProbe!.reports());

test.describe('[bravais-only] info strip looks', () => {
    test('every preset paints the strip and the edge label, with theme ink or fixed print ink', async ({ mount, page }) => {
        await mountKinds(mount, page, { theme: 'midnight' });
        await expect(stage(page)).toHaveAttribute('data-bravais-seam-style', 'paper');
        // 主题纸色：不写材质变量，背景就是主题纸色（不透明、没有图案）。
        expect(await stage(page).evaluate(node => node.style.getPropertyValue('--bravais-seam-surface'))).toBe('');
        const paper = await computed(seam(page), 'background-image', 'background-color', 'color');
        expect(paper['background-image']).toBe('none');
        expect(channels(paper['background-color'])[3]).toBe(1);
        expect(paper.color).toBe('rgb(244, 244, 245)');

        for (const style of STYLES.filter(value => value !== 'paper')) {
            await setWallLook(page, { seamStyle: style });
            await expect(stage(page)).toHaveAttribute('data-bravais-seam-style', style);
            const look = await computed(seam(page), 'background-image', 'color', '--text-primary', '--text-accent');
            // 白 / 黑印刷与磨砂、四种图案都有图案层（细线、纸纹、渐变）。
            expect(look['background-image'], style).not.toBe('none');
            if (style === 'white') {
                expect(look.color).toBe('rgb(20, 20, 20)');
                expect(look['--text-accent'].trim()).toBe('#141414');
            } else if (style === 'black') {
                expect(look.color).toBe('rgb(243, 241, 236)');
                expect(look['--text-accent'].trim()).toBe('#f3f1ec');
            } else {
                expect(look.color, style).toBe('rgb(244, 244, 245)');
            }
        }
        // 边缘标签同一种材质。
        expect(await page.locator('.bravais-seam-tab').evaluate(node => getComputedStyle(node).backgroundImage)).not.toBe('none');
    });

    for (const theme of ['midnight', 'daylight', 'vivid'] as const) {
        test(`every preset keeps the strip's text readable in the ${theme} theme`, async ({ mount, page }) => {
            await mountKinds(mount, page, { theme });
            for (const style of STYLES) {
                await setWallLook(page, { seamStyle: style });
                await expect(stage(page)).toHaveAttribute('data-bravais-seam-style', style);
                const look = await computed(seam(page), 'background-color', 'color');
                const paper = over(channels(look['background-color']), THEME_BG[theme].map(value => value / 255));
                const ink = channels(look.color);
                expect(contrast(ink, paper), `${theme} ${style}`).toBeGreaterThanOrEqual(4.5);
            }
        });
    }

    test('the presets keep the tint and lights-out layers on top', async ({ mount, page }) => {
        await mountKinds(mount, page, { seam: 'white', tint: 'on' });
        await expect(stage(page)).toHaveAttribute('data-bravais-seam-style', 'white');
        // 叠色照旧：内容之上 0.35，纸上补齐到 e（0.5）。
        await expect.poll(async () => (await pseudo(seam(page), '::after')).opacity).toBeCloseTo(0.35, 2);
        expect((await pseudo(seam(page), '::before')).opacity).toBeCloseTo(1 - 0.5 / 0.65, 2);

        await setWallLook(page, { seamStyle: 'dots' });
        await page.evaluate(async () => {
            const path = '/src/stores/useLatticeSettingsStore.ts';
            const module = await import(/* @vite-ignore */ path) as { useLatticeSettingsStore: { setState: (value: Record<string, unknown>) => void } };
            module.useLatticeSettingsStore.setState({ latticeLightsOn: false });
        });
        // 熄灯：整条压 60% 黑，叠色归零。
        await expect.poll(async () => (await pseudo(seam(page), '::after')).opacity).toBeCloseTo(0.6, 2);
        expect((await pseudo(seam(page), '::after')).background).toBe('rgb(0, 0, 0)');
        expect((await pseudo(seam(page), '::before')).opacity).toBe(0);
    });

    test('the wall transparency does not change a preset; theme paper keeps its see-through veil', async ({ mount, page }) => {
        await mountKinds(mount, page, { look: 'clear', seam: 'black' });
        await expect(stage(page)).toHaveAttribute('data-bravais-look', 'clear');
        expect(channels((await computed(seam(page), 'background-color'))['background-color'])[3]).toBe(1);
        await setWallLook(page, { seamStyle: 'paper' });
        await expect(stage(page)).toHaveAttribute('data-bravais-seam-style', 'paper');
        // 主题纸色在透光档下是现状的 80% 半透明纸。
        expect(channels((await computed(seam(page), 'background-color'))['background-color'])[3]).toBeCloseTo(0.8, 2);
    });

    test('a clear strip shows the player through a veil, overrides the preset and stops the solid wall occluding', async ({ mount, page }) => {
        await mountKinds(mount, page, { seam: 'white', clearSeam: 'on', tint: 'on', lyrics: 'on', blur: 'off' });
        await expect(stage(page)).toHaveClass(/\bhas-clear-seam\b/);
        await expect(stage(page)).toHaveClass(/\bis-backdrop-open\b/);
        await expect(stage(page)).toHaveAttribute('data-bravais-look', 'solid');
        await expect(stage(page)).toHaveAttribute('data-bravais-seam-style', 'clear');
        // 互斥：预设不写材质变量、文字仍是主题主色。
        expect(await stage(page).evaluate(node => node.style.getPropertyValue('--bravais-seam-surface'))).toBe('');
        const veil = await computed(seam(page), 'background-color', 'color');
        expect(channels(veil['background-color'])[3]).toBeCloseTo(0.64, 2);
        expect(veil.color).toBe('rgb(244, 244, 245)');
        // 根节点不画墙面（块底板铺墙），缝的开口下面透出去。
        expect(await stage(page).evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
        await expect(page.locator('.bravais-block-plate').first()).toBeAttached();
        // 按窗处理：不染。
        await expect.poll(async () => (await pseudo(seam(page), '::after')).opacity).toBe(0);
        expect((await pseudo(seam(page), '::before')).opacity).toBe(0);

        // 实色墙 + 透明缝：报不遮挡；歌词照设置报，模糊没开。
        await expect.poll(() => reports(page)).toEqual({ occludes: false, backdrop: { lyrics: true, blur: false } });

        // 开模糊：报 blur，纱更淡（50%）。
        await setWallLook(page, { backdropBlur: true });
        await expect(stage(page)).toHaveClass(/\bhas-backdrop-blur\b/);
        await expect.poll(async () => channels((await computed(seam(page), 'background-color'))['background-color'])[3]).toBeCloseTo(0.5, 2);
        await expect.poll(() => reports(page)).toEqual({ occludes: false, backdrop: { lyrics: true, blur: true } });

        // 关掉透明：实色墙重新完全遮挡，墙后画面的开关不再报 true，预设回来。
        await setWallLook(page, { seamClear: false });
        await expect(stage(page)).toHaveAttribute('data-bravais-seam-style', 'white');
        await expect(stage(page)).not.toHaveClass(/\bis-backdrop-open\b/);
        await expect.poll(() => reports(page)).toEqual({ occludes: true, backdrop: { lyrics: false, blur: false } });
        expect((await computed(seam(page), 'color')).color).toBe('rgb(20, 20, 20)');
        await expect(page.locator('.bravais-block-plate')).toHaveCount(0);
    });

    test('a clear strip only fades its content when the lights go out', async ({ mount, page }) => {
        await mountKinds(mount, page, { clearSeam: 'on', lights: 'off', theme: 'daylight' });
        await expect(stage(page)).toHaveClass(/\bis-lights-out\b/);
        await expect.poll(() => seam(page).locator('.bravais-seam-body').evaluate(node => Number(getComputedStyle(node).opacity))).toBeCloseTo(0.4, 2);
        expect((await pseudo(seam(page), '::after')).opacity).toBe(0);
    });
});
