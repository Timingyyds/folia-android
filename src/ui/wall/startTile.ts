// src/ui/wall/startTile.ts

import { getBlockCapacity, getBlockReservedMask } from './blockReservedSlots';
import { SLOTS_PER_BLOCK } from './blockTemplates';
import { getLatticeGeometry } from './layout';

// The infinite wall and its start tile. Content repeats over a landscape period of whole blocks
// (same FIELD_ASPECT rule as the Lattice cell); inside a block, content takes the non-reserved
// slots in slot order. A wrap offset rotates the sequence so the tile the user clicked - the start
// tile - shows item 0. The offset belongs to the layer, so flipping to a finite mode and back
// restores exactly the same wall.

export type WrapPeriod = {
    blocksPerRow: number;
    blockRows: number;
    /** Content slots per block after reserved ones. */
    perBlock: number;
};

type SlotAddress = { column: number; row: number; slotIndex: number };

// getLatticeGeometry is used for its block counts only; pixel sizes do not matter here.
const UNIT_METRICS = { cellSize: 1, gap: 0 };

const mod = (value: number, size: number) => ((value % size) + size) % size;

export const getWrapPeriod = (itemCount: number, reservedPerBlock = 0): WrapPeriod => {
    const perBlock = getBlockCapacity(reservedPerBlock);
    const blocks = Math.max(1, Math.ceil(Math.max(0, itemCount) / perBlock));
    const geometry = getLatticeGeometry(blocks * SLOTS_PER_BLOCK, UNIT_METRICS);
    return { blocksPerRow: geometry.blocksPerRow, blockRows: geometry.blockRows, perBlock };
};

/**
 * Position of a slot in the repeating sequence before the wrap offset, or null for a reserved slot
 * (and for an empty layer). Every period holds every item at least once.
 */
export const getWrapIndex = (slot: SlotAddress, itemCount: number, reservedPerBlock = 0): number | null => {
    if (itemCount <= 0) return null;
    const mask = getBlockReservedMask(slot.column, slot.row, reservedPerBlock);
    if (mask[slot.slotIndex]) return null;
    let within = 0;
    for (let index = 0; index < slot.slotIndex; index += 1) if (!mask[index]) within += 1;

    const period = getWrapPeriod(itemCount, reservedPerBlock);
    const blockInPeriod = mod(slot.row, period.blockRows) * period.blocksPerRow + mod(slot.column, period.blocksPerRow);
    return (blockInPeriod * period.perBlock + within) % itemCount;
};

/** Offset that makes `startSlot` show item 0; 0 when there is no usable start slot. */
export const getStartWrapOffset = (
    startSlot: SlotAddress | null | undefined,
    itemCount: number,
    reservedPerBlock = 0,
): number => {
    if (!startSlot) return 0;
    const index = getWrapIndex(startSlot, itemCount, reservedPerBlock);
    return index === null ? 0 : mod(-index, itemCount);
};

/** Item index an infinite-mode slot shows, or null when it is reserved / the layer is empty. */
export const getInfiniteSlotItem = (
    slot: SlotAddress,
    itemCount: number,
    wrapOffset: number,
    reservedPerBlock = 0,
): number | null => {
    const index = getWrapIndex(slot, itemCount, reservedPerBlock);
    return index === null ? null : mod(index + wrapOffset, itemCount);
};
