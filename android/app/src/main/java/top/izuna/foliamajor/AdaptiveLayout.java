package top.izuna.foliamajor;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

/**
 * 「自适应屏幕分辨率」开关的实现。
 *
 * 原生行为（关闭）就是 Capacitor 默认的那套：系统栏各占各的位置，WebView 只拿剩余区域。
 * 打开后进入沉浸式全屏：WebView 铺满整块屏幕，状态栏和导航栏隐藏，需要时从边缘划出。
 *
 * 注意：如果设备把 App 强行限制在 16:9 的兼容窗口里（厂商的「应用显示比例」设置），
 * 窗口本身就不占满屏幕，任何应用内代码都改不了，只能在系统设置里关掉兼容模式。
 */
final class AdaptiveLayout {
    private static final String PREFS_NAME = "folia_native_prefs";
    private static final String KEY_ADAPTIVE_LAYOUT = "adaptive_layout";
    private static final String TAG = "FoliaAdaptiveLayout";

    private AdaptiveLayout() {
    }

    static boolean isEnabled(Context context) {
        return prefs(context).getBoolean(KEY_ADAPTIVE_LAYOUT, false);
    }

    static void setEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(KEY_ADAPTIVE_LAYOUT, enabled).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    /** 返回是否成功应用；失败时调用方可以决定是否把开关回滚，避免启动即崩的循环。 */
    static boolean apply(Activity activity, WebView webView, boolean enabled) {
        if (activity == null) return false;
        try {
            Window window = activity.getWindow();
            View decor = window.getDecorView();
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decor);

            // targetSdk 35+ 已经强制 edge-to-edge，这里唯一还需要做的就是系统栏的显隐。
            // 再次声明 decor 布局策略，避免启动阶段被系统栏重新插入 inset。
            WindowCompat.setDecorFitsSystemWindows(window, !enabled);
            if (enabled) {
                controller.hide(WindowInsetsCompat.Type.systemBars());
                controller.setSystemBarsBehavior(
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
            } else {
                controller.show(WindowInsetsCompat.Type.systemBars());
                controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_DEFAULT);
            }

            // 尺寸变化后需要一次重新测量，否则 WebView 会保留上一次的布局。
            decor.post(() -> {
                try {
                    if (webView != null) {
                        webView.requestLayout();
                    }
                } catch (Throwable error) {
                    Log.w(TAG, "relayout failed", error);
                }
            });
            return true;
        } catch (Throwable error) {
            // 系统栏显隐失败不该让整个 App 挂掉，记日志并保持原样即可。
            Log.w(TAG, "apply adaptive layout failed (enabled=" + enabled + ")", error);
            return false;
        }
    }
}
