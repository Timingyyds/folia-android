import { BLOCK_COLS } from '../../../ui/wall/blockTemplates';
import { getPitch } from '../../../ui/wall/layout';
import { createWallReflowCurve } from '../../../ui/wall/wallReflowMotion';
import { BRAVAIS_METRICS } from './bravaisConstants';

// src/library/suites/bravais/bravaisReflowMotion.ts
// 聚焦卡块内让位的缓动与时长：和 Lattice 展开海报同一条弹簧（ui/wall/wallReflowMotion，2026-10-08 起；之前是
// 带回弹的 cubic-bezier(0.2, 0.9, 0.25, 1.08)、500ms），不过冲；时长取弹簧把整块宽度的位移走到静止的时刻。
// 2026-10-09 起让位不再是外框上的 CSS 过渡，由 useBravaisReflowDriver 按这条缓动逐帧写外框与透光底板（同一帧，
// 不会错开）。

/** 让位曲线：Lattice 的让位弹簧，以一整块的宽度（块内任何位移都不超过它）为准采样。 */
const REFLOW_CURVE = createWallReflowCurve(BLOCK_COLS * getPitch(BRAVAIS_METRICS) - BRAVAIS_METRICS.gap);
/** 聚焦卡块内让位的时长（毫秒）。 */
export const BRAVAIS_REFLOW_MS = REFLOW_CURVE.durationMs;
/** 让位的缓动（归一化进度 → 归一化位移，单调、不过冲）。 */
export const bravaisReflowEase = REFLOW_CURVE.ease;
