import { execFileSync } from 'node:child_process';

// test/manual/chromiumProcessMemory.mjs

/**
 * 按进程采样一棵 Chromium 进程树的工作集，按 --type= 分类（renderer / gpu-process / browser / utility…）。
 * 从 visualizer-memory-probe.mjs 抽出来给多个手动台架共用（bravais-perf-probe.mjs 也用它比较实色档卸载 visualizer
 * 前后的 GPU 进程内存）。
 *
 * 为什么按进程而不是只看 JS 堆：canvas backing store、合成层和 GPU 资源不会完整反映在 performance.memory /
 * Runtime.getHeapUsage 里。这里的数字只能缩小范围（更像 renderer、gpu-process 还是 browser），不能单独证明分配源。
 */

/**
 * 按 user-data-dir 的唯一名字（marker）圈出这次启动的整棵 Chromium 进程树，
 * 避免把机器上其它 Chrome 也算进来。返回一个函数，每次调用读一遍原始的 `字节|类型` 行。
 */
export const createProcessSampler = (marker) => {
    if (process.platform === 'win32') {
        const script = `Get-CimInstance Win32_Process`
            + ` | Where-Object { $_.CommandLine -like '*${marker}*' }`
            + ` | ForEach-Object {`
            + ` $m = [regex]::Match($_.CommandLine, '--type=([a-zA-Z-]+)');`
            + ` $t = if ($m.Success) { $m.Groups[1].Value } else { 'browser' };`
            + ` '{0}|{1}' -f $_.WorkingSetSize, $t }`;
        return () => execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
    }

    return () => {
        const out = execFileSync('ps', ['-eo', 'rss=,args='], { encoding: 'utf8' });
        return out
            .split('\n')
            .filter(line => line.includes(marker))
            .map(line => {
                const rssKb = Number(line.trim().split(/\s+/)[0]);
                const type = /--type=([a-zA-Z-]+)/.exec(line)?.[1] ?? 'browser';
                return `${rssKb * 1024}|${type}`;
            })
            .join('\n');
    };
};

/** 读一次并按类型汇总（MB）。 */
export const sampleByType = (readRaw) => {
    const byType = {};
    let total = 0;
    for (const line of readRaw().trim().split(/\r?\n/)) {
        if (!line) continue;
        const [bytes, type] = line.split('|');
        const mb = Number(bytes) / 1048576;
        if (!Number.isFinite(mb)) continue;
        byType[type || 'browser'] = (byType[type || 'browser'] ?? 0) + mb;
        total += mb;
    }
    return { total, byType };
};
