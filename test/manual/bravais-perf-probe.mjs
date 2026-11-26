import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createProcessSampler, sampleByType } from './chromiumProcessMemory.mjs';

// test/manual/bravais-perf-probe.mjs

/**
 * 用一个有界面的 Chromium 跑 bravais 性能探针（dev/probes/bravais-perf，?probe=bravaisPerf&autorun=1）的整套矩阵，
 * 跑完把 JSON 写到磁盘、在终端打印结果表。每一轮进入「停稳」阶段时按进程采一次工作集（renderer / gpu-process），
 * 用来比较实色档卸载 visualizer（solid）与不卸载（solid-keep）的内存——performance.memory 只有 JS 堆，看不到 GPU。
 *
 * 为什么是脚本而不是手开浏览器：整套矩阵要几十分钟，页面必须一直在前台、而且只能有这一个探针页面
 * （两个页面同时跑绘光会争同一块 GPU，读数作废）。脚本自己开一个独立的 Chromium，不碰日常浏览器。
 *
 * 前置：另开一个终端跑 dev server，例如 `npm run dev`（3000）。
 *
 * 用法：
 *   npm run manual:bravais-perf
 *   npm run manual:bravais-perf -- --query "&repeats=3"
 *   npm run manual:bravais-perf -- --port 4177 --query "&items=500&looks=solid,solid-keep&scenarios=idle,pan"
 *   npm run manual:bravais-perf -- --channel chrome --out D:/perf/bravais.json
 *
 * --query 原样拼在探针 URL 后面（参数见 dev/probes/bravais-perf/README.md）。默认窗口最大化、用系统的 DPR
 * （贴近真实桌面）；--width / --height / --dpr 可以固定视口。不要最小化或遮住窗口：后台标签页的 rAF 会被节流。
 */

const parseArgs = () => {
    const args = process.argv.slice(2);
    const options = {
        port: '3000',
        host: '127.0.0.1',
        query: '',
        out: '',
        width: 0,
        height: 0,
        dpr: 0,
        channel: '',
        headed: true,
        memory: true,
    };
    for (let i = 0; i < args.length; i += 1) {
        const key = args[i];
        if (key === '--headless') { options.headed = false; continue; }
        if (key === '--no-memory') { options.memory = false; continue; }
        const value = args[i + 1];
        if (value === undefined || !key.startsWith('--')) continue;
        i += 1;
        switch (key) {
            case '--port': options.port = value; break;
            case '--host': options.host = value; break;
            case '--query': options.query = value.startsWith('&') || value === '' ? value : `&${value}`; break;
            case '--out': options.out = value; break;
            case '--width': options.width = Number(value); break;
            case '--height': options.height = Number(value); break;
            case '--dpr': options.dpr = Number(value); break;
            case '--channel': options.channel = value; break;
            default: console.warn(`[bravais-perf] 未知参数 ${key}`);
        }
    }
    return options;
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const median = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const options = parseArgs();
const userDataDir = mkdtempSync(path.join(tmpdir(), 'folia-bravais-perf-'));
const marker = path.basename(userDataDir);
const readRaw = createProcessSampler(marker);
const fixedViewport = options.width > 0 && options.height > 0;

const context = await chromium.launchPersistentContext(userDataDir, {
    headless: !options.headed,
    channel: options.channel || undefined,
    // --enable-precise-memory-info：performance.memory 不再按 100KB 量化、按时间缓存。
    args: ['--no-sandbox', '--enable-precise-memory-info', ...(fixedViewport ? [] : ['--start-maximized'])],
    viewport: fixedViewport ? { width: options.width, height: options.height } : null,
    deviceScaleFactor: fixedViewport && options.dpr > 0 ? options.dpr : undefined,
});

const page = context.pages()[0] ?? await context.newPage();
page.on('pageerror', error => console.error('[pageerror]', error.message));
page.on('console', (message) => {
    if (message.type() === 'error') console.error('[console.error]', message.text());
});

const url = `http://${options.host}:${options.port}/dev-probe.html?probe=bravaisPerf&autorun=1${options.query}`;
console.log(`[bravais-perf] ${url}`);
await page.goto(url);
await page.waitForFunction(() => Boolean(window.__bravaisPerfProbe), null, { timeout: 60_000 });

// 每轮进入「停稳」时采一次进程内存（PowerShell 采样本身要占一点 CPU，放在不计入主读数的停稳阶段）。
const memoryByJob = new Map();
let lastLabel = '';
let status = null;
const startedAt = Date.now();
for (;;) {
    status = await page.evaluate(() => window.__bravaisPerfProbe?.status() ?? null);
    if (!status) break;
    if (status.label !== lastLabel) {
        lastLabel = status.label;
        process.stdout.write(`\r[bravais-perf] ${status.done + 1}/${status.total} ${status.label}`.padEnd(110));
        if (options.memory && status.label.endsWith('· settle')) {
            const sample = sampleByType(readRaw);
            memoryByJob.set(status.done, sample);
        }
    }
    // 跑完（done）、停掉（stopped，例如窗口被切到后台）或出错：不忙了，标签也不再是「某一轮 · 阶段」。
    if (!status.busy && status.total > 0 && !status.label.includes('·')) break;
    await sleep(250);
}
process.stdout.write('\n');

const { results, table } = await page.evaluate(() => ({
    results: window.__bravaisPerfProbe.results(),
    table: window.__bravaisPerfProbe.table(),
}));

// 进程内存按组（条目数 × 场景 × 档位）取中位数，主要看 gpu-process 与 renderer。
const memoryRows = new Map();
results.forEach((result, index) => {
    const sample = memoryByJob.get(index);
    if (!sample) return;
    const job = result.job;
    const key = `${job.items}|${job.scenario}|${job.look}${job.look === 'partial' ? `·${job.windows}` : ''}${job.seamBlur ? '+blur' : ''}`;
    const row = memoryRows.get(key) ?? { gpu: [], renderer: [], total: [] };
    row.gpu.push(sample.byType['gpu-process'] ?? 0);
    row.renderer.push(sample.byType.renderer ?? 0);
    row.total.push(sample.total);
    memoryRows.set(key, row);
});
const memoryTable = [
    '| 条目 | 场景 | 档位 | gpu-process MB | renderer MB | 合计 MB |',
    '| --- | --- | --- | --- | --- | --- |',
    ...[...memoryRows.entries()].map(([key, row]) => {
        const [items, scenario, look] = key.split('|');
        return `| ${items} | ${scenario} | ${look} | ${median(row.gpu).toFixed(0)} | ${median(row.renderer).toFixed(0)} | ${median(row.total).toFixed(0)} |`;
    }),
].join('\n');

const meta = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    viewport: `${innerWidth}×${innerHeight}@${devicePixelRatio}`,
}));
const out = options.out || path.join(tmpdir(), `bravais-perf-${Date.now()}.json`);
writeFileSync(out, JSON.stringify({
    meta: { ...meta, url, minutes: (Date.now() - startedAt) / 60000, status },
    table,
    memoryTable,
    memoryByJob: Object.fromEntries(memoryByJob),
    results,
}, null, 2));

console.log(`\n${table}\n`);
if (memoryRows.size) console.log(`${memoryTable}\n`);
console.log(`[bravais-perf] ${results.length} 轮，${meta.viewport}，${meta.userAgent}`);
console.log(`[bravais-perf] JSON → ${out}`);

await context.close();
