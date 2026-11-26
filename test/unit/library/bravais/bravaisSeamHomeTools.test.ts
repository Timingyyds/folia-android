import { describe, expect, it } from 'vitest';
import type { BravaisHomeTool, BravaisHomeToolId } from '@/library/suites/bravais/bravaisHomeModels';
import { splitHomeTools } from '@/library/suites/bravais/BravaisSeamHomeTools';

// test/unit/library/bravais/bravaisSeamHomeTools.test.ts
// fb3：首页窄缝的工具格固定四格（搜索、设置、队列、「⋯」），其余进「⋯」——本页签的在前、app 级的在后。

const tool = (id: BravaisHomeToolId): BravaisHomeTool => ({ id, label: id, run: () => undefined });
const ids = (tools: readonly BravaisHomeTool[]) => tools.map(entry => entry.id);

describe('splitHomeTools', () => {
    it('keeps the stage (when offered), search, settings and queue in the dock in that order and moves the rest into the menu', () => {
        // useBravaisHomeChrome / BravaisHomeDirectory 给的顺序：搜索、本页签的、app 级的（队列、播放页、舞台、设置）。
        const split = splitHomeTools(['search', 'directory', 'manage-hidden', 'queue', 'player', 'stage', 'settings'].map(id => tool(id as BravaisHomeToolId)));
        // fb11：舞台模式开着（有 stage 这个工具）时舞台入口排在工具格最前（单独一行），不在「⋯」里。
        expect(ids(split.dock)).toEqual(['stage', 'search', 'settings', 'queue']);
        expect(ids(split.page)).toEqual(['directory', 'manage-hidden']);
        expect(ids(split.app)).toEqual(['player']);
    });

    it('puts the Navidrome refresh with the page items and leaves out tools the host does not offer', () => {
        const split = splitHomeTools(['search', 'refresh-navidrome', 'player'].map(id => tool(id as BravaisHomeToolId)));
        expect(ids(split.dock)).toEqual(['search']);
        expect(ids(split.page)).toEqual(['refresh-navidrome']);
        expect(ids(split.app)).toEqual(['player']);
    });
});
