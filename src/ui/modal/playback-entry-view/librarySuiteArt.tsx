import React, { useId } from 'react';
import { FRAME_PROPS, type ArtProps } from './playbackEntryViewArt';

// src/ui/modal/playback-entry-view/librarySuiteArt.tsx
// 首启引导第一页（资料库界面）的两张示意图：网格（经典）与 bravais（无限）。
// 和 playbackEntryViewArt 同一套画法：160×100 的框、`currentColor` 画结构、主题强调色只给选中 / 正在播放的那一块，
// 两页的卡片因此一眼看得出是同一组。

const GRID_COLUMNS = 4;
const GRID_ROWS = 2;
const GRID_CARD_WIDTH = 28;
const GRID_CARD_HEIGHT = 20;
const GRID_GAP_X = 8;
const GRID_ROW_STEP = 34;
const GRID_LEFT = (160 - (GRID_COLUMNS * GRID_CARD_WIDTH + (GRID_COLUMNS - 1) * GRID_GAP_X)) / 2;
const GRID_TOP = 26;
const GRID_PLAYING_INDEX = 1;

/** 网格：上面一条搜索栏，下面整齐的封面卡片，每张卡下一行标题——熟悉的卡片网格。 */
export const GridSuiteArt: React.FC<ArtProps> = ({ accentColor, className }) => (
    <svg viewBox="0 0 160 100" className={className} role="presentation" aria-hidden="true">
        <rect {...FRAME_PROPS} />
        <rect x={GRID_LEFT} y="11" width="58" height="7" rx="3.5" fill="currentColor" fillOpacity="0.22" />
        <rect x={160 - GRID_LEFT - 22} y="11" width="22" height="7" rx="3.5" fill="currentColor" fillOpacity="0.12" />
        {Array.from({ length: GRID_COLUMNS * GRID_ROWS }).map((_, index) => {
            const column = index % GRID_COLUMNS;
            const row = Math.floor(index / GRID_COLUMNS);
            const x = GRID_LEFT + column * (GRID_CARD_WIDTH + GRID_GAP_X);
            const y = GRID_TOP + row * GRID_ROW_STEP;
            const isPlaying = index === GRID_PLAYING_INDEX;
            return (
                <g key={index}>
                    <rect
                        x={x}
                        y={y}
                        width={GRID_CARD_WIDTH}
                        height={GRID_CARD_HEIGHT}
                        rx="4"
                        fill={isPlaying ? accentColor : 'currentColor'}
                        fillOpacity={isPlaying ? 0.85 : 0.16}
                    />
                    <rect x={x} y={y + GRID_CARD_HEIGHT + 4} width={GRID_CARD_WIDTH - 8} height="3" rx="1.5" fill="currentColor" fillOpacity="0.22" />
                </g>
            );
        })}
    </svg>
);

const WALL_CELL = 15;
const WALL_STEP = 18;
const WALL_LEFT = -8;
const WALL_TOP = -6;
const WALL_COLUMNS = 10;
const WALL_ROWS = 7;
/** 墙裂开的那道缝所在的列：缝里放这一层的信息，墙在缝两侧继续铺。 */
const WALL_SEAM_COLUMN = 6;
/** 2×2 的大磁贴（左上角所在的格）；第一块是聚焦着的那首，贴着缝。 */
const WALL_BIG_TILES: ReadonlyArray<readonly [number, number]> = [[4, 2], [1, 1], [7, 0], [7, 4], [0, 4]];

const isCoveredByBigTile = (column: number, row: number) => WALL_BIG_TILES.some(([c, r]) => (
    column >= c && column <= c + 1 && row >= r && row <= r + 1 && !(column === c && row === r)
));

/**
 * bravais：一整面磁贴墙，大小磁贴交错、四边都铺出框外（墙没有尽头），中间裂开一道缝放这一层的信息，
 * 聚焦的那块贴着缝。
 */
export const BravaisSuiteArt: React.FC<ArtProps> = ({ accentColor, className }) => {
    const clipId = `bravais-art-${useId().replace(/:/g, '')}`;
    const seamX = WALL_LEFT + WALL_SEAM_COLUMN * WALL_STEP;

    return (
        <svg viewBox="0 0 160 100" className={className} role="presentation" aria-hidden="true">
            <defs>
                <clipPath id={clipId}>
                    <rect x="2" y="2" width="156" height="96" rx="9" />
                </clipPath>
            </defs>
            <g clipPath={`url(#${clipId})`}>
                {Array.from({ length: WALL_COLUMNS * WALL_ROWS }).map((_, index) => {
                    const column = index % WALL_COLUMNS;
                    const row = Math.floor(index / WALL_COLUMNS);
                    if (column === WALL_SEAM_COLUMN || isCoveredByBigTile(column, row)) return null;
                    const bigIndex = WALL_BIG_TILES.findIndex(([c, r]) => c === column && r === row);
                    const size = bigIndex >= 0 ? WALL_CELL * 2 + (WALL_STEP - WALL_CELL) : WALL_CELL;
                    const isFocused = bigIndex === 0;
                    return (
                        <rect
                            key={index}
                            x={WALL_LEFT + column * WALL_STEP}
                            y={WALL_TOP + row * WALL_STEP}
                            width={size}
                            height={size}
                            rx="3"
                            fill={isFocused ? accentColor : 'currentColor'}
                            fillOpacity={isFocused ? 0.88 : ((column * 3 + row) % 5 === 0 ? 0.08 : 0.16)}
                        />
                    );
                })}
                <rect x={seamX + 2} y="30" width="11" height="3" rx="1.5" fill="currentColor" fillOpacity="0.35" />
                <rect x={seamX + 2} y="37" width="8" height="3" rx="1.5" fill="currentColor" fillOpacity="0.22" />
                <rect x={seamX + 2} y="44" width="10" height="3" rx="1.5" fill={accentColor} fillOpacity="0.8" />
                <rect x={seamX + 2} y="51" width="7" height="3" rx="1.5" fill="currentColor" fillOpacity="0.22" />
            </g>
            <rect {...FRAME_PROPS} />
        </svg>
    );
};
