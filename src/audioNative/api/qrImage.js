import QRCodeCore from 'qrcode/lib/core/qrcode.js';

// src/nativeBridge/api/qrImage.js
// 扫码登录的二维码图在本地画。
//
// 以前三个平台的二维码都是把内容拼成 `api.qrserver.com/v1/create-qr-code?...` 丢给界面，由那个
// 第三方服务出图。实测反馈（0.7.17-android.124 的分步追踪）：网易云已经拿到 key，
// `ne:qr:create:start` → 8 秒后 `ne:qr:create:fallback`，回退成直连那个 URL 之后用户还是看不到码 ——
// 也就是这台设备上 `api.qrserver.com` 整个不通。它不是任何平台的一部分，一条网络策略就能让
// 所有扫码登录一起失效，所以这里改为本地编码：只依赖打包进来的 qrcode 内核算出模块矩阵，再拼成
// SVG data URL。没有网络请求，没有第三方依赖，也就不会再有「二维码加载不出来」。
//
// 用 SVG 而不是 canvas：同一份模块要在页面、扩展的 service worker 与 Node 单测里都能出图，
// 只有纯字符串这条路三者都走得通。

/** 二维码规范要求的最小静默区（模块数）。少了它，扫码识别率会明显下降。 */
const QUIET_ZONE_MODULES = 4;

/**
 * 编码一版二维码并渲染成 SVG 文本。`text` 太长（超过版本 40 的容量）时抛错，由调用方决定回退。
 */
export const buildQrSvg = (text) => {
    const symbol = QRCodeCore.create(String(text), { errorCorrectionLevel: 'M' });
    const { size, data } = symbol.modules;
    const side = size + QUIET_ZONE_MODULES * 2;
    const runs = [];
    for (let row = 0; row < size; row += 1) {
        let column = 0;
        while (column < size) {
            if (!data[row * size + column]) {
                column += 1;
                continue;
            }
            let end = column;
            while (end + 1 < size && data[row * size + end + 1]) end += 1;
            // 一行里连续的深色模块合成一条横线，路径比「一个模块一个矩形」短得多。
            const length = end - column + 1;
            runs.push(
                `M${column + QUIET_ZONE_MODULES} ${row + QUIET_ZONE_MODULES}`
                + `h${length}v1h-${length}z`,
            );
            column = end + 1;
        }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg"'
        + ` viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges">`
        + `<rect width="${side}" height="${side}" fill="#ffffff"/>`
        + `<path d="${runs.join('')}" fill="#000000"/>`
        + '</svg>';
};

/** 上面那份 SVG 的 data URL：界面直接把它当 `<img src>` 用，尺寸由 CSS 决定。 */
export const buildQrDataUrl = (text) => (
    `data:image/svg+xml;base64,${btoa(buildQrSvg(text))}`
);
