import { Buffer } from 'buffer';
import { installGlobalVisualizerFrameRateLimiter } from './lib/frameRateLimiter';
import { installConsoleLogCapture } from './lib/consoleLogBuffer';
import { installCrashDiagnostics } from './lib/crashDiagnostics';
import { installChunkLoadRecovery } from './lib/chunkLoadRecovery';
import { installDebugModule } from './svc/debug/debugModule';
import { installMemorySampleFeed } from './svc/debug/memorySamples';
import { installFrameTimingDiagnostics } from './lib/frameTimingDiagnostics';
import { installAudioNativeCore } from './svc/audioNativeInstaller';
import { installAndroidPhoneFitPreference } from './svc/androidPhoneLayout';
import { installKeepScreenOnPreference } from './svc/androidKeepScreenOn';
// import { installCoverSizeAudit } from './svc/debug/coverSizeSamples';
// @ts-ignore
globalThis.Buffer = Buffer;
// First, so the debug overlay's console tab has the startup lines too - they are where a failure
// to reach a library or restore a session shows up.
installConsoleLogCapture();
installCrashDiagnostics();
// 覆盖安装时旧 index.html 可能引用已被替换掉的 chunk：先装恢复器，再让 React 启动。
installChunkLoadRecovery();
// Right after it, so the startup lines reach the runtime log file too and not only the in-memory
// buffer. Both no-op off Electron. See svc/debug/debugModule.ts.
installDebugModule();
installMemorySampleFeed();
// 帧耗时 / 长任务采样，供设置里的「复制诊断数据」判断卡顿是渲染开销还是设备性能。
installFrameTimingDiagnostics();
// Cover size audit, left wired but switched off: it answered whether the provider CDNs honour the
// size in a cover URL - they do - and that is not a question worth re-asking every session. The
// collector and its panel are still in the tree, and `?probe=coverSizeAudit` still reaches them.
// To bring the tab back, uncomment this line and the four sites in DevDebugOverlay.tsx. It was dev
// only even then: a packaged build has nothing to do with the answer, so it should not pay the
// observer or the rows it retains.
// if (import.meta.env.DEV) installCoverSizeAudit();
installGlobalVisualizerFrameRateLimiter();
installAndroidPhoneFitPreference();
// 屏幕常亮：启动时套用保存的开关状态（安卓走原生窗口标志）。
installKeepScreenOnPreference();
void installAudioNativeCore();

void import('./bootstrap');
