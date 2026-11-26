import { describe, expect, it } from 'vitest';
import { buildPerfJobs, describeLook, readPerfDefaults } from '../../../../dev/probes/bravais-perf/perfConfig';
import { aggregateResults, formatPerfTable, median, summarizePhase, type PerfResult } from '../../../../dev/probes/bravais-perf/perfStats';

// test/unit/library/bravais/bravaisPerfProbe.test.ts
// bravais 性能探针（dev/probes/bravais-perf）的参数与汇总规则：换机实测靠手敲 URL 参数跑矩阵，参数解析与任务展开
// 错了，跑半小时得到的是另一组东西。

describe('bravais perf probe config', () => {
    it('defaults to the full matrix: 500 / 5000 × five scenarios × six look variants', () => {
        const defaults = readPerfDefaults('');
        expect(defaults.items).toEqual([500, 5000]);
        expect(defaults.scenarios).toEqual(['idle', 'pan', 'flip', 'expand', 'tab']);
        expect(defaults.visualizer).toBe('lumiere');
        expect(defaults.showText).toBe(false);
        expect(defaults.fpsCap).toBe('off');
        // solid、solid-keep、partial·1/3/6、clear
        expect(buildPerfJobs(defaults)).toHaveLength(2 * 5 * 6);
    });

    it('parses the URL parameters and drops what it does not know', () => {
        const defaults = readPerfDefaults('?items=500&looks=partial,clear,bogus&windows=0,3,9&scenarios=drift,nope&blur=0,1&repeats=3&seconds=4&vis=none&quality=low&text=1&fps=60');
        expect(defaults.items).toEqual([500]);
        expect(defaults.looks).toEqual(['partial', 'clear']);
        expect(defaults.windows).toEqual([3, 6]);
        expect(defaults.scenarios).toEqual(['drift']);
        expect(defaults.seamBlur).toEqual([false, true]);
        expect(defaults).toMatchObject({ repeats: 3, seconds: 4, visualizer: 'none', quality: 'low', showText: true, fpsCap: 60 });
        expect(readPerfDefaults('?fps=75&quality=ultra&repeats=-1').fpsCap).toBe('off');
    });

    it('only varies windows for partial and blur for the see-through looks, rotating the order per repeat', () => {
        const jobs = buildPerfJobs({ ...readPerfDefaults(''), items: [500], scenarios: ['idle'], seamBlur: [false, true], windows: [1, 6], repeats: 2 });
        const firstRound = jobs.filter(job => job.repeat === 1).map(describeLook);
        expect(firstRound).toEqual(['solid', 'solid-keep', 'partial·1', 'partial·6', 'partial·1+blur', 'partial·6+blur', 'clear', 'clear+blur']);
        const secondRound = jobs.filter(job => job.repeat === 2).map(describeLook);
        expect(secondRound[0]).toBe('solid-keep');
        expect([...secondRound].sort()).toEqual([...firstRound].sort());
    });
});

describe('bravais perf probe stats', () => {
    it('summarizes frame gaps and long animation frames', () => {
        const phase = summarizePhase([8, 8, 8, 40, 25], [{ duration: 60, blocking: 10 }, { duration: 80, blocking: 30 }]);
        expect(phase.frames).toBe(5);
        expect(phase.fps).toBeCloseTo(5000 / 89);
        expect(phase.max).toBe(40);
        expect(phase.over20).toBe(2);
        expect(phase.over33).toBe(1);
        expect(phase).toMatchObject({ loafCount: 2, loafBlockingMs: 40, loafMaxMs: 80 });
    });

    it('groups repeats and takes medians', () => {
        expect(median([3, 1, 2])).toBe(2);
        expect(median([4, 1, 2, 3])).toBe(2.5);
        const job = buildPerfJobs({ ...readPerfDefaults('?vis=none'), items: [500], looks: ['partial'], windows: [3], scenarios: ['pan'], repeats: 3 });
        const results = job.map((entry, index) => ({
            job: entry,
            mount: { firstTileMs: 10 * (index + 1), worstFrameMs: 0, longTaskMaxMs: 0, loafMaxMs: 0, tiles: 60 },
            motion: summarizePhase([8, 8 + index], []),
            settle: summarizePhase([8], []),
            counts: { tileRenders: index, plateRedraws: index * 2, plateRedrawBlocks: index, strayPlateRedraws: 0, platesAdded: 1, stageCommits: 1, stageCommitMs: 1, tilesAdded: 0 },
            animation: { triggers: 0, peakAnimated: 0, maxOffscreen: 0 },
            tiles: { peak: 60, windows: 15 },
            memory: null,
            visualizerMounted: false,
            viewport: '1×1@1',
        } satisfies PerfResult));
        const rows = aggregateResults(results);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ items: 500, scenario: 'pan', look: 'partial·3', runs: 3, firstTileMs: 20, plateRedraws: 2, platesAdded: 1, heapMB: null, visualizer: 'none' });
        expect(formatPerfTable(rows).split('\n')).toHaveLength(3);
    });
});
