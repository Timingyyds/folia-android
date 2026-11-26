# Folia Android

Folia 音乐播放器的 Android 移植版（非官方），当前版本 **2.3.6**（versionCode 2306，应用 id `ti.folia.ming`）。

上游 Folia 面向桌面端 / Web，这个仓库是把它搬到手机上的成果：界面仍是同一套 React + Vite 前端，
原生侧用 Capacitor 补上 Android 才能做的事——后台播放、媒体通知、本地曲库读写、横屏适配、ColorOS 状态栏歌词等。

> 仓库只含源码。**不含签名密钥、账号凭据**；想自己出包需要本地生成签名（见「构建」）。

---

## 这个移植版做了什么

- **横屏沉浸式界面**：`AdaptiveLayout` / `PhoneLayoutOrientation` / `PhoneFitCutout` 负责横屏布局、挖孔与刘海避让
- **后台播放**：`FoliaPlaybackService`（前台 Service + MediaSession），锁屏与通知栏可控
- **本地音频服务**：`LocalAudioServer` 起一个本地 HTTP 服务，让 WebView 直接播本地文件，绕开 `file://` 与 CORS 限制
- **原生桥**：`FoliaBridgePlugin` / `FoliaCorePlugin` 暴露给前端的 Capacitor 插件，网易云 / QQ 音乐 / 酷狗的请求走 WebView 内原生桥（无需另起外部 API 服务）
- **状态栏歌词**：`coloros/ColorOsLyricBridge` 适配 ColorOS 的实时活动/灵动岛歌词
- **SAF 文件选择**：`SafFileChooserClient` 走系统文件选择器导入本地音乐与封面
- **崩溃诊断**：`CrashDiagnostics` 收集并本地留存崩溃信息，方便在手机上定位问题

## 源码结构

| 路径 | 内容 |
|---|---|
| `src/` | 前端主体：`components/`（界面）、`stores/`（状态）、`services/`（音源、缓存、音效、AI、本地曲库）、`library/`、`audioNative/`（各平台音源实现）、`i18n/`、`workers/` |
| `android/app/src/main/java/top/izuna/foliamajor/` | Android 原生壳与 Capacitor 插件 |
| `api/`、`api-ts/` | Node 侧接口与 TS 声明（Vercel 部署用） |
| `electron/` | 桌面端入口（同仓库保留） |
| `dev/` | 开发期工具：代码地图、lint、契约检查 |
| `packages/`、`shared/` | 内部公用包 |
| `docs/` | 协议、部署、各音源实现说明 |

技术栈：React + TypeScript + Vite + Tailwind，状态用自研 store，
WebView 侧通过 Capacitor 与原生通信；Node >= 24。

## 构建

```bash
# 前端产物
npm install
npm run build

# 同步进 Android 工程
npx cap sync android

# 出包
cd android && ./gradlew assembleDebug   # 或 assembleRelease
```

要求：JDK 17+、Android SDK（`compileSdk`/`targetSdk` 见 `android/variables.gradle`，minSdk 24），首次构建需联网拉 Gradle 依赖。

签名不在仓库里。`android/app/build.gradle` 会读 `android/app/folia-debug.keystore`，
自己生成一张放进去即可（或改成你自己的 signingConfig）：

```bash
keytool -genkeypair -v -keystore android/app/folia-debug.keystore \
  -alias folia-debug -keyalg RSA -keysize 2048 -validity 10000
```

## 说明

- 这是个人移植，非官方仓库；上游版权归原作者，LICENSE 见 [LICENSE](./LICENSE)。
- 各音乐平台的音源接口由其对应上游项目维护，登录凭据只存在本地。
