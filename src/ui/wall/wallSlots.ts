// src/ui/wall/wallSlots.ts

import {
    BLOCK_COLS,
    BLOCK_ROWS,
    SLOTS_PER_BLOCK,
    getBlockReflow,
    getBlockTemplate,
    type BlockSlot,
} from './blockTemplates';
import { getPitch, overlaps, type Bounds, type WallMetrics } from './layout';

// Fixed-world slots: every block is addressed by absolute block coordinates and keeps its template
// no matter what content is on it, so a slot is a stable identity that content flips onto. Unlike
// the Lattice queue wall there is no repeating cell here; the block field itself never wraps.

export type WallSlot = {
    /** `${column},${row},${slotIndex}` - stable across layers, filters and focus reflows. */
    key: string;
    column: number;
    row: number;
    slotIndex: number;
    x: number;
    y: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
    /** Footprint in grid cells (cols x rows). */
    area: number;
};

export type BlockRange = { from: number; to: number };

export const wallSlotKey = (column: number, row: number, slotIndex: number) => `${column},${row},${slotIndex}`;

export const getBlockSize = (metrics: WallMetrics) => {
    const pitch = getPitch(metrics);
    return { width: BLOCK_COLS * pitch, height: BLOCK_ROWS * pitch };
};

const toWallSlot = (
    column: number,
    row: number,
    slotIndex: number,
    rect: BlockSlot,
    metrics: WallMetrics,
): WallSlot => {
    const pitch = getPitch(metrics);
    const x = column * BLOCK_COLS * pitch + rect.x * pitch;
    const y = row * BLOCK_ROWS * pitch + rect.y * pitch;
    const width = rect.cols * pitch - metrics.gap;
    const height = rect.rows * pitch - metrics.gap;
    return {
        key: wallSlotKey(column, row, slotIndex),
        column,
        row,
        slotIndex,
        x,
        y,
        width,
        height,
        centerX: x + width / 2,
        centerY: y + height / 2,
        area: rect.cols * rect.rows,
    };
};

export const getBlockSlots = (column: number, row: number, metrics: WallMetrics): WallSlot[] => (
    getBlockTemplate(column, row).map((rect, slotIndex) => toWallSlot(column, row, slotIndex, rect, metrics))
);

export const getWallSlot = (
    column: number,
    row: number,
    slotIndex: number,
    metrics: WallMetrics,
): WallSlot | null => {
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= SLOTS_PER_BLOCK) return null;
    return toWallSlot(column, row, slotIndex, getBlockTemplate(column, row)[slotIndex], metrics);
};

export const parseWallSlotKey = (key: string) => {
    const parts = key.split(',').map(Number);
    if (parts.length !== 3 || parts.some(part => !Number.isInteger(part))) return null;
    return { column: parts[0], row: parts[1], slotIndex: parts[2] };
};

/** Every slot of every block in a block rectangle; `to` is exclusive. Row-major, slot order inside a block. */
export const collectBlockRangeSlots = (
    columns: BlockRange,
    rows: BlockRange,
    metrics: WallMetrics,
): WallSlot[] => {
    const result: WallSlot[] = [];
    for (let row = rows.from; row < rows.to; row += 1) {
        for (let column = columns.from; column < columns.to; column += 1) {
            result.push(...getBlockSlots(column, row, metrics));
        }
    }
    return result;
};

/** Slots overlapping a world rect, capped so a zoomed-out view cannot stall a frame. */
export const collectWallSlots = (bounds: Bounds, metrics: WallMetrics, limit = Number.POSITIVE_INFINITY): WallSlot[] => {
    const block = getBlockSize(metrics);
    const result: WallSlot[] = [];
    const fromColumn = Math.floor(bounds.left / block.width);
    const toColumn = Math.floor(bounds.right / block.width);
    const fromRow = Math.floor(bounds.top / block.height);
    const toRow = Math.floor(bounds.bottom / block.height);
    for (let row = fromRow; row <= toRow; row += 1) {
        for (let column = fromColumn; column <= toColumn; column += 1) {
            for (const slot of getBlockSlots(column, row, metrics)) {
                const slotBounds = { left: slot.x, right: slot.x + slot.width, top: slot.y, bottom: slot.y + slot.height };
                if (!overlaps(slotBounds, bounds)) continue;
                result.push(slot);
                if (result.length >= limit) return result;
            }
        }
    }
    return result;
};

/**
 * The twelve slots of one block while `focusedSlot` is expanded to the 6x6 gear. Keys and slot
 * indices are unchanged - only rects move - so anything keyed by slot identity (content, reserved
 * slots) rides along with the reflow, and nothing outside the block moves.
 */
export const layoutFocusedBlock = (
    column: number,
    row: number,
    focusedSlot: number,
    metrics: WallMetrics,
): WallSlot[] | null => {
    const reflow = getBlockReflow(column, row, focusedSlot);
    if (!reflow) return null;
    return reflow.map((rect, slotIndex) => toWallSlot(column, row, slotIndex, rect, metrics));
};
