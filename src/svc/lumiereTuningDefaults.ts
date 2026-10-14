// src/svc/lumiereTuningDefaults.ts
//
// 绘光的默认参数在桌面端和安卓端并不完全一样。
//
// 绘光的默认画质是 `full`：图形组（光场着色器、烟雾 fbm、整条 bloom 降采样链）与画布同分辨率，
// 而画布分辨率本身又被钳在 `devicePixelRatio` 2 —— 手机上这是最贵的组合。
//
// 上游已经写好 balanced / low 两档：只降图形组的像素，文字组、画框和片尾卡仍按满分辨率光栅化，
// 所以歌词保持清晰，降的只是低频的柔光与烟雾。但默认没有选它。这里在安卓上默认降到 balanced，
// 桌面端保持上游默认。

import { isCapacitorAndroid } from '../platform/runtime';
import {
    DEFAULT_LUMIERE_TUNING,
    type LumiereRenderQuality,
    type LumiereTuning,
} from '../types';

/** 绘光画质的默认值：安卓上降到 balanced，其它运行时跟随上游默认。 */
export const lumiereRenderQualityDefault = (): LumiereRenderQuality =>
    isCapacitorAndroid() ? 'balanced' : DEFAULT_LUMIERE_TUNING.renderQuality;

/** 绘光参数的完整默认值，按平台调整过。 */
export const resolveLumiereTuningDefaults = (): LumiereTuning => ({
    ...DEFAULT_LUMIERE_TUNING,
    renderQuality: lumiereRenderQualityDefault(),
});
