import { describe, expect, it } from 'vitest';
import * as pixi from 'pixi.js';
import { showLineArtLayer, type LineArtLayer } from '@/components/visualizer/lumiere/lineart/lineArt';

// test/unit/visualizer/lumiere/lumiereLineArtAttach.test.ts
// 藏起来的线稿组从显示树上摘下、出现时再挂回：挂回后的叠放次序必须与一直挂着时一样（按镜头顺序）。

const layersOf = (count: number) => Array.from({ length: count }, () => ({ view: new pixi.Container() }) as unknown as LineArtLayer);

describe('showLineArtLayer', () => {
    it('藏起来的组摘下，挂回时按镜头顺序插回原位', () => {
        const holder = new pixi.Container();
        const layers = layersOf(4);
        layers.forEach(layer => holder.addChild(layer.view));

        [0, 1, 2, 3].forEach(index => showLineArtLayer(holder, layers, index, false));
        expect(holder.children).toHaveLength(0);

        // 乱序出现：后面的镜头先亮，前面的再插到它前面。
        showLineArtLayer(holder, layers, 2, true);
        showLineArtLayer(holder, layers, 0, true);
        showLineArtLayer(holder, layers, 3, true);
        showLineArtLayer(holder, layers, 1, true);
        expect(holder.children).toEqual(layers.map(layer => layer.view));

        showLineArtLayer(holder, layers, 1, false);
        expect(holder.children).toEqual([layers[0]!.view, layers[2]!.view, layers[3]!.view]);
    });

    it('状态没变时不动显示树', () => {
        const holder = new pixi.Container();
        const layers = layersOf(2);
        layers.forEach(layer => holder.addChild(layer.view));
        const before = [...holder.children];
        showLineArtLayer(holder, layers, 0, true);
        showLineArtLayer(holder, layers, 1, true);
        expect(holder.children).toEqual(before);
    });
});
