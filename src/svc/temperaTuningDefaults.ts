// src/svc/temperaTuningDefaults.ts
//
// 凝彩的默认参数在桌面端和安卓端并不完全一样。
//
// 上游把「后处理纹理压缩」留给填充率吃紧的机器：不压缩时整条后处理链（颗粒、对比度、
// 网点、RGB 色差、暗角、透镜扭曲）都在 `textureResolution`（默认 1.5）的纹理上跑，
// 每个全屏 pass 的像素量随视口面积增长。手机 GPU 的填充率撑不住这条链，凝彩会明显掉帧，
// 而没有后处理的其它可视化不受影响——这正是「只有凝彩卡」的来源。
//
// 这里在安卓上把压缩打开：后处理在 1x 纹理上算完再拉伸到画布，网点与细字的锐度略降，
// 换来整条链的填充率。桌面端保持上游默认。

import { isCapacitorAndroid } from '../platform/runtime';
import { DEFAULT_TEMPERA_TUNING, type TemperaTuning } from '../types';

/** 后处理纹理压缩的默认值：安卓上打开，其它运行时跟随上游默认。 */
export const temperaPostProcessCompressionDefault = (): boolean =>
    DEFAULT_TEMPERA_TUNING.postProcessTextureCompression || isCapacitorAndroid();

/** 凝彩参数的完整默认值，按平台调整过。 */
export const resolveTemperaTuningDefaults = (): TemperaTuning => ({
    ...DEFAULT_TEMPERA_TUNING,
    postProcessTextureCompression: temperaPostProcessCompressionDefault(),
});
