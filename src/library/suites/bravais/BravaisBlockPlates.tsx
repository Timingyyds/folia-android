import React, { memo } from 'react';
import { countRender } from '../../../dev/renderCount';
import type { PlateBlock } from './bravaisBlockPlate';

// src/library/suites/bravais/BravaisBlockPlates.tsx
// 一个块的实色底板（设计稿 §11）：内联 SVG，实色、evenodd 路径（外框减去窗洞），放在世界层里、磁贴之下。
// 只在路径或外框变了时渲染（countRender('BravaisBlockPlate') 记的就是重画次数）；聚焦卡让位期间路径由
// useBravaisReflowDriver 与磁贴同一帧逐帧直接写，挂着 data-bravais-plate-live。

type BravaisBlockPlateProps = Pick<PlateBlock, 'x' | 'y' | 'width' | 'height' | 'd'> & {
    blockKey: string;
    holeCount: number;
};

const round = (value: number) => Math.round(value * 100) / 100;

function BravaisBlockPlate({ blockKey, x, y, width, height, d, holeCount }: BravaisBlockPlateProps) {
    countRender('BravaisBlockPlate');
    const w = round(width);
    const h = round(height);
    return (
        <svg
            className="bravais-block-plate"
            data-bravais-plate-block={blockKey}
            data-bravais-plate-holes={holeCount}
            width={w}
            height={h}
            viewBox={`0 0 ${w} ${h}`}
            style={{ transform: `translate(${round(x)}px, ${round(y)}px)` }}
            aria-hidden="true"
            focusable="false"
        >
            <path d={d} fillRule="evenodd" />
        </svg>
    );
}

const MemoPlate = memo(BravaisBlockPlate);

/** 一半世界层里的全部块底板（画在磁贴之前，所以在磁贴之下）。 */
const BravaisBlockPlates: React.FC<{ blocks: readonly PlateBlock[] }> = ({ blocks }) => (
    <>
        {blocks.map(block => (
            <MemoPlate
                key={block.key}
                blockKey={block.key}
                x={block.x}
                y={block.y}
                width={block.width}
                height={block.height}
                d={block.d}
                holeCount={block.holes.length}
            />
        ))}
    </>
);

export default BravaisBlockPlates;
