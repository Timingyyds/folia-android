import { describe, expect, it } from 'vitest';
import { BRAVAIS_REFLOW_MS, bravaisReflowEase as ease } from '@/library/suites/bravais/bravaisReflowMotion';
import { wallReflowSettleMs } from '@/components/wall/wallReflowMotion';

// test/unit/library/bravais/bravaisReflowMotion.test.ts
// 聚焦卡块内让位的过渡参数：Lattice 的让位弹簧，时长按一整块的位移算；不过冲（透光底板在过渡期间按起止的外接矩形
// 挖洞，靠的就是这一点）。

describe('reflow timing', () => {
    it('lasts as long as the Lattice spring takes to settle a move across a whole block, and never overshoots', () => {
        // 12 列 × (128 + 8) − 8 = 1624 世界单位。
        expect(BRAVAIS_REFLOW_MS).toBe(wallReflowSettleMs(1624));
        expect(BRAVAIS_REFLOW_MS).toBeGreaterThan(600);
        expect(BRAVAIS_REFLOW_MS).toBeLessThan(700);
        let previous = 0;
        for (let step = 0; step <= 200; step += 1) {
            const value = ease(step / 200);
            expect(value).toBeGreaterThanOrEqual(previous);
            expect(value).toBeLessThanOrEqual(1);
            previous = value;
        }
    });
});
