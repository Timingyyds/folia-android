# Folia for Android

> 🎵 **Folia 音乐播放器安卓版** —— 动态歌词、AI 主题生成、多音源聚合，为触屏设备深度打造的原生架构音乐播放器。

**作者：不出名的TiMing（[Timingyyds](https://github.com/Timingyyds)）**

---

## ✨ 功能总览

- **多音源聚合**：网易云 / 酷狗 / QQ 音乐 / 波点 / Navidrome，一站聚合
- **原生桥架构**：音源请求与扫码登录由安卓原生层（OkHttp + CookieManager）直接处理，登录即浏览器级体验
- **动态歌词**：逐字进度、翻译、纯音乐识别，中日文智能分词换行
- **AI 主题生成**：根据歌曲封面智能生成配套界面主题
- **本地音乐**：扫描设备音频进曲库，本地/在线统一管理
- **队列拼贴**：可缩放的海报墙队列，直觉化操作

## 🎵 安卓专属功能

- **媒体通知**：封面 / 歌名 / 歌手，进度条实时可拖，三按钮直接控制
- **后台播放不中断**：前台服务保活，退桌面、锁屏音乐不停
- **播放不被其他应用打断**：开关位于 播放动画设置 → 音频增益下方
- **原生扫码登录**：Cookie 由系统 CookieManager 原生管理，扫码授权即登录
- **全面屏适配**：刘海 / 挖孔设备打开即铺满整块屏幕
- **触摸优化**：沉浸式界面、空闲自动隐藏播放条

## 📥 安装

1. 打开本仓库的 [**Releases**](https://github.com/Timingyyds/folia-android/releases) 页面
2. 下载最新 APK 安装（需允许"安装未知来源应用"）
3. 首次启动在弹框中**允许发送通知**（媒体通知需要）

## 🔨 构建

```bash
npm install

$env:VITE_NETEASE_API_BASE='extension'
$env:VITE_QQ_API_BASE='extension'
$env:VITE_KUGOU_API_BASE='extension'

npm run build:capacitor
npx cap sync android
cd android && ./gradlew assembleDebug
```

要求：JDK 21、Android SDK（compileSdk 36）。

## 🧩 架构

```
WebView（React 界面）
   │  音源适配层（src/audioNative/）
   │  模拟扩展协议：网络请求 / Cookie / 存储
FoliaCorePlugin（Capacitor 原生插件）
   │  OkHttp 网络请求
   │  CookieManager 会话管理
   └── LocalAudioServer（本地音乐服务）
```

## 🙏 致谢

- 感谢 [folia-major](https://github.com/chthollyphile/folia-major) —— 本项目的上游，请同时支持原作者
- 感谢 [RemnantCloudGodofWar/folia-android](https://github.com/RemnantCloudGodofWar/folia-android) —— 借鉴了其中优秀的安卓优化实现
- 感谢 [whycfawa/folia-android](https://github.com/whycfawa/folia-android) —— 借鉴了其中优秀的优化实现
- 感谢 [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi)、[KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi)、[qq-music-api](https://github.com/jsososo/QQMusicApi)、[bodian-music-api](https://github.com/ZxwyWebSite/bodian-music-api) 等音源 API 项目
- 感谢所有为开源音乐生态贡献力量的开发者们

## 📄 免责声明

本项目仅供学习交流使用，音乐版权归原作者所有。
