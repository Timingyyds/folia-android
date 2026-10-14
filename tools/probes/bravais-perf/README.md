# bravais 性能探针（`?probe=bravaisPerf`）

真实的 `BravaisStage`（与宿主 `GridViewOverlayHost` 给的 props 同形）+ 合成的集合 / 首页层描述（走 surface 用的
同一套投影），底下可选挂一个真实 visualizer（默认绘光 full，`showText: false`，与真实首页一致）。按任务矩阵一轮一轮地跑：
每轮重新挂 stage（量首屏）→ 预热 → 运动 → 停稳，记帧间隔、长动画帧、块底板的重画与新挂、磁贴渲染与 stage 的 React 提交。
（B12b 起透光底板按块画：每个已挂载的 12×8 块一张内联 SVG，在世界层里、磁贴之下，随相机平移；不再有全屏遮罩底板。）

它测的是真实 stage；`folia-veil-probe` 里的 `bravaisVeil` 台架测的是简化墙（只用来比较底板的几种写法）。

## 打开

| 场景 | 做法 |
| --- | --- |
| 开发机 / 测试机的浏览器 | `npm run dev`，打开 `http://localhost:3000/dev-probe.html?probe=bravaisPerf`（或 `npm run dev:probe` 后在索引页点它）。空闲时是一份可拖动、可点的预览，面板上可切条目数 / 档位 / 窗数 / 层 |
| 一条命令跑整套矩阵 | dev server 开着时 `npm run manual:bravais-perf -- --query "&repeats=3"`：脚本自己开一个有界面的 Chromium（窗口最大化、系统 DPR），跑完把 JSON 写到临时目录并打印结果表；每轮「停稳」时按进程采一次工作集（gpu-process / renderer），用来比较实色档卸载 visualizer 前后的内存。参数见 `test/manual/bravais-perf-probe.mjs` 文件头 |
| Electron（开发构建） | `npm run dev:electron`（Electron + vite 3000，自动开 DevTools），在 DevTools Console 执行 `location.href = 'http://localhost:3000/dev-probe.html?probe=bravaisPerf&autorun=1&repeats=3'`。跑完 `copy(window.__bravaisPerfProbe.table())` 拿 Markdown 表，或点面板上的「导出 JSON」。回应用：`location.href = 'http://localhost:3000/'` |
| Electron 正式包 | **探针打不开**：正式包从 `dist/index.html`（file://）加载，`dev-probe.html` 不在 `vite.config.ts` 的 `build.rollupOptions.input` 里，而且 `countRender` 在生产构建里是空函数（磁贴渲染计数全是 0）。正式包里量的是**真实首页**：见下面「正式包里量真实首页」 |

Electron 开发构建与正式包用的是同一个 Chromium、同一组 GPU 开关（`electron/main.cjs` 顶部的 `appendSwitch`），合成与 GPU 的成本一致；
差别是 React 开发版的 JS 开销更高、探针页面开着 StrictMode。所以探针里看**相对差异**（档位之间、有无 visualizer），绝对帧时间以正式包为准。

**开发版 React 的额外开销随条目数涨**：React 19 开发版在每次提交后给变了的 props 做差异记录（`logComponentRender`，
给 Performance 面板的组件轨道用），层描述里 5000 项的 `items` 也会被遍历——本机 5000 首换页签的 50–120ms 长帧主要是它，
500 首没有。正式构建没有这段。所以 500 与 5000 的差异在探针里会被放大，以正式包的真实首页为准。

**只开一个探针页面**：两个页面同时跑绘光会争同一块 GPU，读数作废（订正文档里遇到过）。页面要保持前台、窗口不要最小化或被完全遮住
（后台标签页的 rAF 会被节流；探针检测到切后台会停下，已完成的结果保留）。

## URL 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `items` | `500,5000` | 条目数（集合层曲目数；`tab` 场景是每个页签的卡片数） |
| `looks` | `solid,solid-keep,partial,clear` | 透光档。`solid` 照真实应用：stage 报遮挡后卸载 visualizer；`solid-keep` 是对照组：实色但 visualizer 仍挂着 |
| `windows` | `1,3,6` | 部分透明的每块窗数（只对 `partial` 生效） |
| `scenarios` | `idle,pan,flip,expand,tab` | 另有 `drift`（小范围拖动，回归用）。见下表 |
| `blur` | `0` | 缝的亚克力 blur：`0,1` 两组都跑（只对透明档生效；与 `bravais.css` 的 `has-seam-blur` 同一条规则） |
| `repeats` | `1` | 重复次数；重复之间轮换档位顺序 |
| `seconds` / `warmup` / `settle` | `6` / `2500` / `1200` | 运动秒数、预热与停稳毫秒 |
| `vis` | `lumiere` | `none` 不挂 visualizer；也可以是别的模式（`pendolo`、`sonnet`…） |
| `quality` | `full` | 绘光画质 `full` / `balanced` / `low` |
| `text` | `0` | `1` 让 visualizer 渲染歌词（播放页条件，比首页重） |
| `fps` | `off` | 全局 visualizer 帧率限制 `60` / `90` / `120`（`utils/frameRateLimiter`，与设置里的帧率限制同一个开关；它会限住整页的 rAF，探针的采样用原生 rAF） |
| `autorun` | — | `1`：封面生成完就跑整套矩阵 |

场景：

| 场景 | 层 | 动作 |
| --- | --- | --- |
| `idle` | 集合 | 不动 |
| `pan` | 集合 | 经真实滚轮处理的大范围往返平移（x 一个来回 ±2.2 屏、y 两个来回 ±1.6 屏），跨越大量块边界：重新裁剪、加挂磁贴与新块的底板（已挂的块底板不重画） |
| `drift` | 集合 | 同一条轨迹缩到 ±110 / ±70px，停在已裁剪的范围里：只该写两个世界层的 transform（底板随之平移） |
| `flip` | 集合 | 每 1.5s 进 / 出一次有限态过滤（每 7 首留 1 首，`planCount` 仍是全量），从缝的两侧边缘整面翻 |
| `expand` | 集合 | 每 0.9s 点另一个块里的一张曲目磁贴：新块让位重排（只有这一块的底板逐帧重画）、旧块瞬时归位（重画一次） |
| `tab` | 首页 | 每 1.3s 换一次页签（歌单 ↔ 专辑）：整墙出场 → 入场 |

## 读数

结果表每行是同一组（条目数 × 场景 × 档位）各次重复的中位数；JSON 里有每一轮的完整读数。

| 字段 | 含义 |
| --- | --- |
| fps / p95 / p99 / >33ms | 运动阶段的 rAF 间隔。基准是 `1000 / 刷新率`（120Hz = 8.3ms）。rAF 间隔反映主线程与合成器交付帧的节奏，**不是 GPU 耗时** |
| LoAF | 长动画帧（>50ms 的一帧）数量 |
| 底板重画 | 已挂块底板的 `<path d>` 被改写的次数（MutationObserver；含聚焦卡让位期间的逐帧重画）。JSON 里另有重画过的块数 `plateRedrawBlocks` 与其中不是展开 / 收起聚焦卡那几块的 `strayPlateRedraws`（应为 0） |
| 新挂底板 | 运动阶段新挂进 DOM 的块底板（重新裁剪带进来的块） |
| 磁贴渲染 | `BravaisTile` 函数体执行次数（StrictMode 下挂载 / 更新各算两次） |
| stage 提交 | stage 子树的 React 提交次数（`React.Profiler`） |
| 动画磁贴峰值 | 一次触发里在动的磁贴数（翻牌上限 400；JSON 里 `maxOffscreen` 是其中落在翻牌范围之外的） |
| 首块 ms / 首屏长任务 ms | 挂 stage 到第一张有内容的磁贴出现；预热阶段最长的长任务 / 长动画帧 |
| JS 堆 MB | `performance.memory.usedJSHeapSize`（Chromium 才有；GPU 纹理不在里面） |
| visualizer | 运动结束时墙下有没有 visualizer 的 canvas（`挂着的轮数/总轮数`；实色档应为 0） |

`manual:bravais-perf` 另打印一张进程内存表（每轮停稳时采样的 gpu-process / renderer 工作集中位数）。

## 换机实测（B12，合并前，用户执行）

目标机器：**低性能 + 高刷新率**（集显 / 老独显 + 120Hz 以上），最好就是当年 Grid3D 全屏 blur 出过 GPU 过载的那类。

### 0. 准备

- 拉取分支、`npm ci`；记下 CPU / GPU 型号、屏幕分辨率、缩放、刷新率（Windows：设置 → 显示 → 高级显示）。
- 关掉其它占 GPU 的程序（浏览器视频、游戏、录屏）；接电源、电源模式「最佳性能」。
- 只开一个探针页面 / 一个 Folia 窗口。

### 1. 探针矩阵（浏览器，约 30 分钟）

```
npm run dev
npm run manual:bravais-perf -- --query "&repeats=3"
```

再跑三组补充（各约 5–10 分钟）：

```
# 缝要不要 blur：两个透明档 × blur 开 / 关
npm run manual:bravais-perf -- --query "&looks=partial,clear&windows=3&blur=0,1&scenarios=idle,pan,flip&repeats=3"
# 帧率限制：60fps 上限下的同一组
npm run manual:bravais-perf -- --query "&looks=solid,partial,clear&windows=3&scenarios=idle,pan,flip&fps=60&repeats=3"
# 实色档卸载 visualizer 前后：内存 / 帧时间（看打印的进程内存表）
npm run manual:bravais-perf -- --query "&items=500&looks=solid,solid-keep&scenarios=idle,pan&repeats=5"
```

跑的同时开着任务管理器（见第 3 步）。把输出的 JSON 路径与终端里的两张表一起发回来。

### 2. Electron 真实首页（正式包）

1. 托盘 → 退出 Folia（单实例锁：已有实例时带参数启动会直接交给旧实例）。
2. 带远程调试端口启动正式包：快捷方式「属性 → 目标」末尾加 ` --remote-debugging-port=9222`，或命令行
   `"<安装目录>\Folia.exe" --remote-debugging-port=9222`。
3. Chrome 打开 `chrome://inspect` → Configure 加 `localhost:9222` → 在 Folia 主窗口下点 inspect，得到 DevTools。
4. 设置 → 界面设置 → 资料库界面选 bravais；放一首歌（visualizer 选绘光、画质与平时一致），回首页。
5. 每种条件下，在 Console 粘贴下面的帧计，回车后 10 秒内一直做同一个动作（大范围拖动墙面 / 反复开关过滤 / 换页签），
   记下 `console.table` 的结果与同一时段任务管理器里的 GPU 占用：
   - 透光三档（命令面板「透光」或执行键 `p`），部分透明下每块 1 / 3 / 6 窗；
   - 动作：静止、拖动、翻牌（集合页过滤进出）、换页签（F6）；
   - 对照：同一台机器上 grid 首页（设置里换回 grid；首页全屏 4px blur）与 Lattice（实色、visualizer 卸载）。

```js
// 帧计：10 秒 rAF 间隔 + 长动画帧。帧率限制开着时也量原生 rAF。
(async (seconds = 10) => {
  const gaps = []; const loafs = [];
  const observer = new PerformanceObserver(list => list.getEntries().forEach(entry => loafs.push(entry.duration)));
  try { observer.observe({ type: 'long-animation-frame' }); } catch {}
  const raf = (window.__foliaNativeRequestAnimationFrame ?? window.requestAnimationFrame).bind(window);
  let last = performance.now(); const end = last + seconds * 1000;
  await new Promise(done => raf(function tick(now) { gaps.push(now - last); last = now; if (now < end) raf(tick); else done(); }));
  observer.disconnect();
  const sorted = [...gaps].sort((a, b) => a - b); const q = p => sorted[Math.floor((sorted.length - 1) * p)];
  console.table({ fps: gaps.length * 1000 / gaps.reduce((a, b) => a + b, 0), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: sorted.at(-1), over33: gaps.filter(g => g > 33.4).length, loaf: loafs.length });
})(10);
```

### 3. 要看的 GPU 指标

- **任务管理器 → 性能 → GPU**：「3D」引擎利用率（静止时与拖动时各看一眼），专用 / 共享 GPU 内存。
- **任务管理器 → 详细信息**：右键表头加「GPU」「GPU 引擎」「专用 GPU 内存」列，看 Folia（或探针的 Chromium）里
  `--type=gpu-process` 那个进程的占用。
- **DevTools → Performance** 录 10 秒拖动：Frames 轨道里的 dropped / partially presented frames、GPU 轨道的忙碌占比。
- **DevTools → Rendering → Frame Rendering Stats**：屏幕上的帧率、GPU 光栅化与 GPU 内存。
- macOS：活动监视器 → 窗口 → GPU 历史记录。

rAF 间隔看不到 GPU 过载的全部：GPU 满载时帧会被合成器丢掉或延迟呈现，任务管理器的 3D 利用率与 Performance 面板的
dropped frames 才是判断「GPU 过载」的依据。

### 4. 要决定的四件事（决定交用户）

| 决定 | 看什么 | 参考判据（建议，不是承诺） |
| --- | --- | --- |
| 缝要不要 blur | `blur=0,1` 两组在 partial / clear 下的 GPU 3D 占用与 p95 | 开 blur 后 3D 占用明显上升（例如 +10 个百分点以上）或 p95 超过一帧半，就不 blur（用较浓的主题色纸条，即现状） |
| 透光是否接静态模式 / 帧率限制 | partial / clear 在 `fps=off` 与 `fps=60` 下的 GPU 占用、>33ms 帧；静态模式用户的预期 | `fps=off` 时 3D 占用接近饱和而 `fps=60` 时回落：透光照常、交给帧率限制；静态模式开着时退到实色（或窗里只显示静态光晕）只是一行判断，成本低 |
| ~~部分透明是否保留默认~~（已定：2026-10-08 用户改为默认实色，不再待实测） | partial·3 与 solid、与 grid 首页（全屏 blur）的帧时间和 GPU 占用之差 | — |
| 是否需要连续掉帧自动降级 | 最慢一档（clear 或 partial·6）在 pan / flip 下的 >33ms 帧占比与 fps | 低端机上 >33ms 帧超过运动帧的约 5%，或 fps 低于刷新率的 80%：考虑「连续 N 秒掉帧 → 退到实色并提示」；否则不做 |

## 回归护栏

`test/component/bravaisPerf.spec.ts` 挂同一个探针（`vis: 'none'`）钉结构不变量：首屏磁贴数与条目数无关、整面翻牌不超过
400 张且屏外只换不翻、小范围拖动块底板不重画 / 磁贴不重渲染 / stage 不提交、大范围拖动只渲染新进来的磁贴并且只新挂块底板、
聚焦放大只重画放大 / 收起的那几块、换页签不重画块底板。时间类只比 500 与 5000 首的差并兜宽天花板。它们是回归护栏，不是性能标准。
