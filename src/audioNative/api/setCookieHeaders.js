/**
 * 读取响应里的 Set-Cookie。
 *
 * `Set-Cookie` 是浏览器禁止暴露给 JS 的响应头（Fetch 规范里的 forbidden response-header name），
 * 安卓桥构造 Response 时写进去也会被静默丢掉。原生侧因此把同一批值镜像到 `x-folia-set-cookie`
 * （见 src/services/nativeAndroidBridge.ts），这里把三处来源合并：
 *   - 浏览器 / 扩展能用的 `headers.getSetCookie()`；
 *   - 扩展页面里能直接读到的 `Set-Cookie`；
 *   - 安卓桥的镜像头。
 *
 * 少了这条通路，扫码登录只能从 cookie 罐里回捞 qrsig / p_skey，而罐里可能是上一次会话留下的旧值 ——
 * 表现就是新建的二维码第一次轮询就「已失效」。
 */

export const SET_COOKIE_MIRROR_HEADER = 'x-folia-set-cookie';

/** 原始 Set-Cookie 头值（可能一条里含多个 cookie，调用方负责拆分）。 */
export function readRawSetCookies(resp) {
  const list = [];
  const headers = resp && resp.headers;
  if (!headers) return list;
  try {
    if (typeof headers.getSetCookie === 'function') {
      const values = headers.getSetCookie();
      if (Array.isArray(values)) list.push(...values.filter(Boolean).map(String));
    }
  } catch (_) {}
  try {
    const single = headers.get('Set-Cookie');
    if (single) list.push(String(single));
  } catch (_) {}
  try {
    const mirrored = headers.get(SET_COOKIE_MIRROR_HEADER);
    if (mirrored) list.push(String(mirrored));
  } catch (_) {}
  return list;
}
