// src/svc/nativeWindowSurface.ts
// 把「应用主题底色」推给原生窗口 / WebView。
//
// 为什么需要：挖孔屏、异形屏、以及把 App 塞进兼容窗口的机型，屏幕顶部会存在一条
// **不属于页面内容**的带子（挖孔本身、或系统给窗口留的 letterbox）。那条带子画的是
// **原生窗口底色**，而它此前是写死的近黑——styles.xml 的 windowBackground 和
// capacitor.config.json 的 backgroundColor 都是 #09090b。深色主题下看不出来，
// 浅色主题下就是顶部一条黑带（2026-10-31 用户报的「顶部有一条空带/黑带」）。
//
// 跟着主题走之后，那条带子至少和界面同色；真正让内容铺满由原生侧的
// PhoneFitCutout（layoutInDisplayCutoutMode=ALWAYS）负责，两者互补。

type NativeWindowSurfacePlugin = {
    setWindowSurfaceColor: (options: {
        windowColor: string;
        webViewColor?: string;
    }) => Promise<unknown>;
};

/** 原生插件句柄；网页版没有原生桥时返回 null。 */
const nativeWindowSurfacePlugin = (): NativeWindowSurfacePlugin | null => {
    if (typeof window === 'undefined') return null;
    const capacitor = (window as unknown as {
        Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> };
    }).Capacitor;
    if (!capacitor?.isNativePlatform?.()) return null;
    const plugin = capacitor.Plugins?.FoliaNative as NativeWindowSurfacePlugin | undefined;
    return plugin && typeof plugin.setWindowSurfaceColor === 'function' ? plugin : null;
};

// 同一组颜色只推一次：主题色不变时不要把每次渲染都变成一次原生调用。
let lastWindowColor = '';
let lastWebViewColor: string | null = null;

/**
 * @param windowColor 原生窗口底色（`#RRGGBB`），必给。
 * @param webViewColor WebView 底色；页面**不透明**时才给。播放页那种透明背景不要给，
 *        否则会把「透明」刷成实色，透出底下的东西就没了。
 */
export const applyNativeWindowSurface = (windowColor: string, webViewColor?: string): void => {
    const plugin = nativeWindowSurfacePlugin();
    if (!plugin || !windowColor) return;
    const nextWebViewColor = webViewColor ?? null;
    if (windowColor === lastWindowColor && nextWebViewColor === lastWebViewColor) return;
    lastWindowColor = windowColor;
    lastWebViewColor = nextWebViewColor;
    void plugin
        .setWindowSurfaceColor({
            windowColor,
            ...(nextWebViewColor ? { webViewColor: nextWebViewColor } : {}),
        })
        .catch(() => {
            // 原生侧拒绝（没有 Activity 等）：不改就好，下一次主题变化会再试。
            lastWindowColor = '';
            lastWebViewColor = null;
        });
};