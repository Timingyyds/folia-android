# 第三方组件与许可说明

本仓库是 [chthollyphile/folia-major](https://github.com/chthollyphile/folia-major) 的非官方 Android 移植 fork，
整体以 **AGPL-3.0** 发布，完整许可原文见 [LICENSE](LICENSE)。

下面列出本仓库直接包含、或随构建产物（APK / Web 包）一起分发的第三方组件。
这些许可（MIT / BSD / ISC / Apache-2.0 / AGPL-3.0）都与 AGPL-3.0 兼容，
各自仍遵循其原始许可，署名与许可声明一并保留。

## 1. 仓库内直接包含的第三方代码

| 位置 | 组件 | 许可 | 说明 |
|---|---|---|---|
| `src/nativeBridge/vendor/crypto-es.mjs` | crypto-es（crypto-js 的 ESM 分支） | MIT | 文件内已保留完整的 MIT 许可原文与版权声明 |
| `src/nativeBridge/vendor/node-forge.mjs` | node-forge 的转发垫片 | BSD-3-Clause / MIT | 仅数百字节的 `require` 转发，不包含 node-forge 实现本体 |

## 2. 接口契约与算法参考的开源项目

`src/nativeBridge/api/` 下的平台桥接代码由本 fork 编写整理，接口契约、加密参数与签名算法参考了以下项目：

- [chthollyphile/folia-major](https://github.com/chthollyphile/folia-major) — AGPL-3.0（本 fork 的上游）
- [MakcRe/KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi) — MIT
- [yakult-green-tea/qq-music-api](https://github.com/yakult-green-tea/qq-music-api) — MIT
- [NeteaseCloudMusicApiEnhanced/api-enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced) — MIT

## 3. 运行期 npm 依赖

| 包 | 许可 |
|---|---|
| `@capacitor/android`、`@capacitor/browser`、`@capacitor/core`、`@capacitor/splash-screen`、`@capacitor/status-bar` | MIT |
| `@google/genai` | Apache-2.0 |
| `@neteasecloudmusicapienhanced/api` | MIT |
| `@xhayper/discord-rpc` | ISC |
| `@yakult-green-tea/qq-music-api` | MIT |
| `axios`、`electron-store`、`electron-updater`、`fflate`、`file-type`、`koffi`、`kugoumusicapi`、`music-metadata`、`onnxruntime-node`、`ws` | MIT |
| `bodian-music-api` | AGPL-3.0 |
| `busboy` | MIT |

完整的依赖树与锁定版本见 `package-lock.json`；每个包的许可原文随其 npm 包或上游仓库提供。

## 4. 内容与平台声明

App 中播放、展示的在线音乐音频、歌词、专辑封面等内容的版权属于各自权利人，
**不在本仓库的开源许可范围内**。本仓库只包含播放器与接口调用的实现代码。

请尊重数字版权，并在条件允许时通过官方平台支持正版音乐。

## 5. 与上游的关系

本 fork 与上游作者无关，也不代表上游项目的立场或观点。
上游 README 中「仅供个人学习、技术交流与非营利测试使用，请勿用于商业盈利用途」的声明同样适用于本 fork。
