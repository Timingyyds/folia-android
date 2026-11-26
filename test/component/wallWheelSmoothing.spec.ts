import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { buildServiceStubModule, LOCAL_MUSIC_SERVICE_ROUTE } from '../../dev/probes/homeBehavior/serviceStubModule';
import '../../dev/probes/homeBehavior/probeApi';

// test/component/wallWheelSmoothing.spec.ts
// 两面墙（Lattice 队列墙、bravais 墙）的滚轮：鼠标滚轮（像素模式的单轴大步长、或按行的 deltaMode = 1）平滑地追到目标，
// 逐帧采样相机——多帧单调趋近、最终正好到位，而不是一帧跳到位；触控板式的小增量当帧直接跟手；降低动效时一帧到位；
// bravais 有限拼贴（过滤）照常钳制在范围里。判别与参数在 src/components/wall/wallPanMotion.ts。

type Axis = 'x' | 'y';
type Sample = { x: number; y: number };

/** 在世界层上装一个逐帧采样（先采一次当前值），之后每帧记一次 transform 的平移，记满 frames 帧、或装了新的采样时停。 */
const startSampler = (world: Locator, frames = 72) => world.evaluate((node, total) => {
    const samples: Sample[] = [];
    const host = window as unknown as { __wheelSamples: Sample[] };
    host.__wheelSamples = samples;
    const read = () => {
        const matrix = new DOMMatrix(getComputedStyle(node).transform);
        samples.push({ x: matrix.m41, y: matrix.m42 });
    };
    read();
    const loop = () => {
        read();
        if (samples.length < total && host.__wheelSamples === samples) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
}, frames);

const readSamples = async (page: Page, frames = 72) => {
    await expect.poll(() => page.evaluate(() => (window as unknown as { __wheelSamples: Sample[] }).__wheelSamples.length), { timeout: 10_000 })
        .toBeGreaterThanOrEqual(frames);
    return page.evaluate(() => (window as unknown as { __wheelSamples: Sample[] }).__wheelSamples);
};

/** 平滑：沿 axis 单调走向 start + distance、最终到位，途中至少 minFrames 帧停在两端之间（不是一帧跳到位）。 */
const expectSmooth = (samples: Sample[], axis: Axis, distance: number, minFrames = 4) => {
    const values = samples.map(sample => sample[axis]);
    const start = values[0];
    const end = start + distance;
    const sign = Math.sign(distance);
    for (let index = 1; index < values.length; index++) {
        expect((values[index] - values[index - 1]) * sign).toBeGreaterThanOrEqual(-0.01);
    }
    const between = values.filter(value => (value - start) * sign > 1 && (end - value) * sign > 1);
    expect(between.length).toBeGreaterThanOrEqual(minFrames);
    expect(values[values.length - 1]).toBeCloseTo(end, 1);
};

const latticeWorld = (wall: Locator) => wall.locator('.lattice-world');
const latticeX = (wall: Locator) => latticeWorld(wall).evaluate(node => new DOMMatrix(getComputedStyle(node).transform).m41);

const mountLattice = async (mount: (id: string) => Promise<Locator>, page: Page) => {
    const wall = await mount('lattice');
    // 开场的海报落地波次放完。
    await page.waitForTimeout(1200);
    const box = (await wall.locator('.lattice-field').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    return wall;
};

test.describe('[lattice] wheel smoothing', () => {
    test('a mouse wheel notch (pixel deltas) glides over several frames and lands exactly', async ({ mount, page }) => {
        const wall = await mountLattice(mount, page);
        await startSampler(latticeWorld(wall));
        await page.mouse.wheel(120, 0);
        expectSmooth(await readSamples(page), 'x', -120);
    });

    test('line-mode wheel deltas glide too, and consecutive notches stack onto one target', async ({ mount, page }) => {
        const wall = await mountLattice(mount, page);
        await startSampler(latticeWorld(wall), 90);
        await wall.locator('.lattice-field').evaluate(node => {
            for (let notch = 0; notch < 3; notch++) {
                node.dispatchEvent(new WheelEvent('wheel', { deltaY: 3, deltaMode: 1, bubbles: true, cancelable: true }));
            }
        });
        expectSmooth(await readSamples(page, 90), 'y', -3 * 48);
    });

    test('trackpad-style small deltas still follow the fingers in the same frame', async ({ mount, page }) => {
        const wall = await mountLattice(mount, page);
        const before = await latticeX(wall);
        const positions = await wall.locator('.lattice-field').evaluate(node => {
            const world = node.querySelector('.lattice-world')!;
            const read = () => new DOMMatrix(getComputedStyle(world).transform).m41;
            return [6, 14, 22, 18].map(delta => {
                node.dispatchEvent(new WheelEvent('wheel', { deltaX: delta, bubbles: true, cancelable: true }));
                return read();
            });
        });
        expect(positions[0]).toBeCloseTo(before - 6, 4);
        expect(positions[1]).toBeCloseTo(before - 20, 4);
        expect(positions[2]).toBeCloseTo(before - 42, 4);
        expect(positions[3]).toBeCloseTo(before - 60, 4);
        await page.waitForTimeout(200);
        expect(await latticeX(wall)).toBeCloseTo(before - 60, 4);
    });

    test('reduced queue collage motion lands a wheel notch in one frame', async ({ mount, page }) => {
        await page.addInitScript(() => localStorage.setItem('reduce_motion_lattice', 'true'));
        const wall = await mountLattice(mount, page);
        const before = await latticeX(wall);
        const landed = await wall.locator('.lattice-field').evaluate(node => {
            node.dispatchEvent(new WheelEvent('wheel', { deltaX: 120, bubbles: true, cancelable: true }));
            return new DOMMatrix(getComputedStyle(node.querySelector('.lattice-world')!).transform).m41;
        });
        expect(landed).toBeCloseTo(before - 120, 4);
    });

    test('pressing on the wall stops a gliding wheel where it is', async ({ mount, page }) => {
        const wall = await mountLattice(mount, page);
        const before = await latticeX(wall);
        await page.mouse.wheel(400, 0);
        await page.waitForTimeout(50);
        await page.mouse.down();
        const stopped = await latticeX(wall);
        await page.waitForTimeout(300);
        await page.mouse.up();
        expect(stopped).toBeLessThan(before);
        expect(stopped).toBeGreaterThan(before - 400 + 1);
        expect(await latticeX(wall)).toBeCloseTo(stopped, 1);
    });
});

const stage = (page: Page) => page.locator('[data-library-stage="bravais"]');
const settled = (page: Page) => expect(stage(page)).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 10_000 });
const bravaisWorld = (page: Page) => page.locator('[data-bravais-half="left"]');
const bravaisY = (page: Page) => bravaisWorld(page).evaluate(node => new DOMMatrix(getComputedStyle(node).transform).m42);

const mountBravais = async (mount: (id: string) => Promise<unknown>, page: Page) => {
    await page.route(LOCAL_MUSIC_SERVICE_ROUTE, route => route.fulfill({ contentType: 'text/javascript', body: buildServiceStubModule() }));
    await mount('homeBehavior');
    await expect.poll(() => page.evaluate(() => window.__homeProbe?.ready() ?? false), { timeout: 30_000 }).toBe(true);
    await page.evaluate(() => window.__homeProbe!.setSuite('bravais'));
    await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:playlist', { timeout: 15_000 });
    await expect(page.locator('[data-library-card]').first()).toBeAttached();
    await settled(page);
    // 鼠标放在墙面上、缝的左边（缝不是墙的一部分，滚轮不经过它）。
    const point = await page.evaluate(() => {
        const field = document.querySelector('.bravais-field')!.getBoundingClientRect();
        const seamRect = document.querySelector('[data-bravais-seam]')?.getBoundingClientRect();
        const right = seamRect && seamRect.width > 1 ? seamRect.left : field.right;
        return { x: (field.left + right) / 2, y: field.top + field.height * 0.4 };
    });
    await page.mouse.move(point.x, point.y);
};

test.describe('[bravais] wheel smoothing', () => {
    test.beforeEach(async ({ mount, page }) => {
        await mountBravais(mount, page);
    });

    test('a mouse wheel notch glides the wall over several frames and lands exactly', async ({ page }) => {
        await startSampler(bravaisWorld(page));
        await page.mouse.wheel(0, 100);
        expectSmooth(await readSamples(page), 'y', -100);
    });

    test('line-mode wheel deltas glide as well', async ({ page }) => {
        await startSampler(bravaisWorld(page));
        await page.locator('.bravais-field').evaluate(node => {
            node.dispatchEvent(new WheelEvent('wheel', { deltaY: -3, deltaMode: 1, bubbles: true, cancelable: true }));
        });
        expectSmooth(await readSamples(page), 'y', 48);
    });

    test('trackpad-style small deltas follow in the same frame', async ({ page }) => {
        const before = await bravaisY(page);
        const positions = await page.locator('.bravais-field').evaluate(node => {
            const world = document.querySelector('[data-bravais-half="left"]')!;
            const read = () => new DOMMatrix(getComputedStyle(world).transform).m42;
            return [8, 16, 12].map(delta => {
                node.dispatchEvent(new WheelEvent('wheel', { deltaY: delta, bubbles: true, cancelable: true }));
                return read();
            });
        });
        expect(positions[0]).toBeCloseTo(before - 8, 3);
        expect(positions[1]).toBeCloseTo(before - 24, 3);
        expect(positions[2]).toBeCloseTo(before - 36, 3);
    });

    test('a filtered (finite) collage keeps the wheel clamped inside its range, and a reverse notch moves at once', async ({ page }) => {
        // 打开一张歌单，过滤出全部曲目（「Track」）：墙退化为有限拼贴，内容比一屏大，相机范围有余地。
        const slot = await page.evaluate(() => {
            const seamRect = document.querySelector('[data-bravais-seam]')?.getBoundingClientRect();
            const tiles = [...document.querySelectorAll<HTMLElement>('.bravais-tile[data-library-card^="card:playlist:"]')];
            const fits = (rect: DOMRect) => rect.left > 8 && rect.top > 8 && rect.right < window.innerWidth - 8 && rect.bottom < window.innerHeight - 140
                && (!seamRect || seamRect.width < 1 || rect.right < seamRect.left - 4 || rect.left > seamRect.right + 4);
            return tiles.find(tile => fits(tile.getBoundingClientRect()))?.dataset.bravaisSlot ?? null;
        });
        expect(slot).not.toBeNull();
        await page.locator(`[data-bravais-slot="${slot}"] article`).click();
        await expect.poll(() => page.evaluate(() => window.__homeProbe!.stack().length)).toBe(1);
        await expect(page.locator('.bravais-tile[data-library-card]')).toHaveCount(0);
        await settled(page);
        await expect.poll(() => page.evaluate(() => window.__homeProbe!.setQuery('track'))).toBe(true);
        await expect(page.locator('[data-bravais-mode]').first()).toHaveAttribute('data-bravais-mode', 'finite');
        await settled(page);
        await page.waitForTimeout(600);
        const resting = await bravaisY(page);
        // 往下连滚 40 格（4000px）：相机一路单调往下，到范围的边上停住，不会滚出有限拼贴。
        await startSampler(bravaisWorld(page), 100_000);
        for (let notch = 0; notch < 40; notch++) await page.mouse.wheel(0, 100);
        await page.waitForTimeout(800);
        const edge = await bravaisY(page);
        const pushed = await readSamples(page, 2);
        for (let index = 1; index < pushed.length; index++) expect(pushed[index].y).toBeLessThanOrEqual(pushed[index - 1].y + 0.01);
        expect(pushed[pushed.length - 1].y).toBeCloseTo(edge, 1);
        expect(edge).toBeLessThan(resting - 100);
        expect(edge).toBeGreaterThan(resting - 4000 + 100);
        await page.waitForTimeout(300);
        expect(await bravaisY(page)).toBeCloseTo(edge, 1);
        // 顶在边上多滚的不攒着：反向一格立刻平滑地离开边缘，正好一格。
        await startSampler(bravaisWorld(page), 60);
        await page.mouse.wheel(0, -100);
        expectSmooth(await readSamples(page, 60), 'y', 100);
    });
});

test.describe('[bravais] reduced motion wheel', () => {
    test('reduced motion lands a wheel notch in one frame', async ({ mount, page }) => {
        await page.addInitScript(() => localStorage.setItem('reduce_motion_lattice', 'true'));
        await mountBravais(mount, page);
        const before = await bravaisY(page);
        const landed = await page.locator('.bravais-field').evaluate(node => {
            node.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
            return new DOMMatrix(getComputedStyle(document.querySelector('[data-bravais-half="left"]')!).transform).m42;
        });
        expect(landed).toBeCloseTo(before - 100, 3);
    });
});
