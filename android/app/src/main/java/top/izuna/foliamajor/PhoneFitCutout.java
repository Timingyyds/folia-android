package top.izuna.foliamajor;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Rect;
import android.os.Build;
import android.util.Log;
import android.view.DisplayCutout;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;

/**
 * 适配手机厂商的屏幕顶部显示（挖孔 / 刘海 / 曲面），让界面真正铺满整块屏幕。
 *
 * 只开 cutout 模式不够，实测（0.7.15-android.46 诊断）会出现：
 *   screen=2800  decor=2800  content=2696  safeInset.top=104
 * 窗口已经铺满，但内容视图被系统 inset 顶下来一条，黑边就是它。
 *
 * 所以这里做完整的一套：
 * 1. layoutInDisplayCutoutMode = shortEdges，允许窗口覆盖挖孔；
 * 2. FLAG_LAYOUT_NO_LIMITS + setDecorFitsSystemWindows(false)，不再为系统栏留位；
 * 3. 状态栏/导航栏透明并隐藏；
 * 4. 给内容根视图挂 inset 监听，把系统栏 inset 从 padding 里清掉（第 4 步才是黑边的直接原因）。
 *
 * 这套适配不跟「手机适配」开关绑定：挖孔是设备固有特征。布局仍由应用内的安全区变量避让。
 */
final class PhoneFitCutout {
    private static final String TAG = "FoliaPhoneFitCutout";
    private static final String INSET_LISTENER_TAG = "folia-cutout-inset-listener";
    private static final String DECOR_PADDING_GUARD_TAG = "folia-cutout-decor-padding-guard";

    private PhoneFitCutout() {
    }

    /** 应用完整的铺满屏幕策略；启动、回前台、获焦、开关变化时都会调用。 */
    static boolean apply(Activity activity) {
        if (activity == null) {
            return false;
        }
        try {
            Window window = activity.getWindow();
            if (window == null) {
                return false;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                WindowManager.LayoutParams attributes = window.getAttributes();
                attributes.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                window.setAttributes(attributes);
            }
            // 不再为系统栏留位。
            WindowCompat.setDecorFitsSystemWindows(window, false);
            window.addFlags(WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                | WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS
                | WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
            // 系统栏透明，避免顶部出现一条不透明色带。
            window.setStatusBarColor(Color.TRANSPARENT);
            window.setNavigationBarColor(Color.TRANSPARENT);
            // 直接隐藏系统栏；从边缘划入时临时显示。
            WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, window.getDecorView());
            controller.hide(WindowInsetsCompat.Type.systemBars());
            controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            );

            View decor = window.getDecorView();
            if (decor != null) {
                decor.setBackgroundColor(0xFF09090B);
                // 部分 ROM 会把 inset 写进 decor 的 padding，清掉它窗口才真的铺到顶。
                decor.setPadding(0, 0, 0, 0);
            }
            applyEdgeToEdge(decor, window);
            return true;
        } catch (Throwable error) {
            Log.w(TAG, "apply cutout mode failed", error);
            return false;
        }
    }

    /**
     * 清掉内容根视图上的系统栏 inset。
     *
     * 实测 content 比 screen 少一条 safeInset.top，就是这里垫出来的：系统把「状态栏/挖孔」
     * 的 inset 落成了根视图 padding。主动消费掉 systemBars 的 inset 并清空 padding，内容才会
     * 真的延伸到顶部。监听器常驻，重新布局或系统栏临时划出后再回来也不会反弹。
     */
    @SuppressWarnings("deprecation")
    private static void applyEdgeToEdge(View decor, Window window) {
        if (decor == null) {
            return;
        }
        // ① decor 自己会被系统垫 top padding（实测 104px，等于挖孔 safeInset.top）。
        //    这里既清一次，也挂布局监听：系统每次重新布局回填时立刻压回 0。
        clearDecorPadding(decor);
        installDecorPaddingGuard(decor);
        // ② 同步改写 decor 收到的 insets：把 systemBars 归零，系统就不会再按 inset 垫 padding。
        installDecorInsetListener(decor);
        View root = decor;
        if (decor instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) decor;
            if (group.getChildCount() > 0) {
                // decor 的第一个子节点就是承载 Capacitor/WebView 的内容根。
                root = group.getChildAt(0);
            }
        }
        final View contentRoot = root;
        if (contentRoot == null) {
            return;
        }
        contentRoot.setTag(INSET_LISTENER_TAG.hashCode(), Boolean.TRUE);
        ViewCompat.setOnApplyWindowInsetsListener(contentRoot, (view, insets) -> {
            // 清掉容器链上的 inset padding：黑边就是它垫出来的。
            clearInsetPadding(view, 3);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                // 返回消费掉 systemBars 的 inset，避免系统再垫回来。
                return new WindowInsetsCompat.Builder(insets)
                    .setInsets(
                        WindowInsetsCompat.Type.systemBars(),
                        androidx.core.graphics.Insets.NONE
                    )
                    .build();
            }
            return insets;
        });
        // 监听器只在 inset 变化时触发；挂上后再主动清一次，启动首帧就不会先闪一条。
        clearInsetPadding(contentRoot, 3);
        ViewCompat.requestApplyInsets(contentRoot);
    }

    /**
     * 清掉 inset 顶下来的 padding。
     *
     * 只处理顶部几层容器与 WebView，不动具体内容控件自己的 padding：这一层是系统/宿主垫 inset
     * 的位置，而卡片、按钮的内边距埋得更深，清多了会破坏布局。
     *
     * @param depth 还能往下走几层；decor → content → layout 三层足够覆盖宿主垫 inset 的位置。
     */
    private static void clearInsetPadding(View view, int depth) {
        if (view == null || depth < 0) {
            return;
        }
        if (view instanceof ViewGroup || view instanceof WebView) {
            view.setPadding(0, 0, 0, 0);
        }
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int index = 0; index < group.getChildCount(); index += 1) {
                clearInsetPadding(group.getChildAt(index), depth - 1);
            }
        }
    }

    /** decor 自身被系统垫的 top padding；实测正好等于挖孔 safeInset.top。 */
    private static boolean hasDecorPadding(View decor) {
        return decor.getPaddingTop() != 0
            || decor.getPaddingBottom() != 0
            || decor.getPaddingLeft() != 0
            || decor.getPaddingRight() != 0;
    }

    private static void clearDecorPadding(View decor) {
        if (decor != null && hasDecorPadding(decor)) {
            decor.setPadding(0, 0, 0, 0);
        }
    }

    /**
     * 系统每次重新布局都会把 cutout/状态栏的 inset 重新写成 decor 的 padding，
     * 一次性清掉会被立刻回填。挂布局监听，在每次布局发生时压回 0。
     *
     * 只在确实有 padding 时才写，避免监听器自己触发新的布局形成死循环。
     */
    private static void installDecorPaddingGuard(final View decor) {
        if (decor == null || decor.getTag(DECOR_PADDING_GUARD_TAG.hashCode()) != null) {
            return;
        }
        decor.setTag(DECOR_PADDING_GUARD_TAG.hashCode(), Boolean.TRUE);
        decor.getViewTreeObserver().addOnGlobalLayoutListener(() -> clearDecorPadding(decor));
    }

    /**
     * 改写 decor 收到的 window insets，把 systemBars 归零。
     *
     * 这是比「事后清 padding」更根上的做法：系统拿不到 systemBars 的 inset，就不会再按它
     * 垫 padding。两者一起用，兼容那些不走 setOnApplyWindowInsetsListener 的 ROM。
     */
    @SuppressWarnings("deprecation")
    private static void installDecorInsetListener(final View decor) {
        if (decor == null) {
            return;
        }
        ViewCompat.setOnApplyWindowInsetsListener(decor, (view, insets) -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                return new WindowInsetsCompat.Builder(insets)
                    .setInsets(
                        WindowInsetsCompat.Type.systemBars(),
                        androidx.core.graphics.Insets.NONE
                    )
                    .build();
            }
            return insets;
        });
        ViewCompat.requestApplyInsets(decor);
    }

    /** 挖孔现场，供诊断报告导出。字段固定为英文。 */
    static JSONObject describe(Activity activity) {
        JSONObject result = new JSONObject();
        try {
            result.put("sdk", Build.VERSION.SDK_INT);
            View decor = activity == null || activity.getWindow() == null
                ? null
                : activity.getWindow().getDecorView();
            if (decor == null) {
                result.put("available", false);
                return result;
            }
            result.put("available", true);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                result.put(
                    "layoutInDisplayCutoutMode",
                    activity.getWindow().getAttributes().layoutInDisplayCutoutMode
                );
                WindowInsets insets = decor.getRootWindowInsets();
                DisplayCutout cutout = insets == null ? null : insets.getDisplayCutout();
                result.put("hasCutout", cutout != null);
                if (cutout != null) {
                    result.put(
                        "safeInsets",
                        rect(cutout.getSafeInsetLeft(), cutout.getSafeInsetTop(),
                            cutout.getSafeInsetRight(), cutout.getSafeInsetBottom())
                    );
                    JSONArray rects = new JSONArray();
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        List<Rect> bounding = cutout.getBoundingRects();
                        if (bounding != null) {
                            for (Rect rect : bounding) {
                                rects.put(rect(rect.left, rect.top, rect.right, rect.bottom));
                            }
                        }
                    }
                    result.put("boundingRects", rects);
                }
            }
            // 高度对比：decor 与 WebView 的差值就是还残留的顶部/底部空白。
            android.util.DisplayMetrics metrics = activity.getResources().getDisplayMetrics();
            result.put("screenHeightPx", metrics.heightPixels);
            result.put("decorHeightPx", decor.getHeight());
            View content = decor.findViewById(android.R.id.content);
            result.put("contentHeightPx", content == null ? -1 : content.getHeight());
            WebView webView = findWebView(decor);
            if (webView != null) {
                result.put("webViewHeightPx", webView.getHeight());
                result.put("webViewPaddingTopPx", webView.getPaddingTop());
            }
            if (content != null) {
                result.put("contentPaddingTopPx", content.getPaddingTop());
            }
            result.put(
                "decorPaddingTopPx",
                decor.getPaddingTop()
            );
            android.graphics.Rect windowFrame = new android.graphics.Rect();
            decor.getWindowVisibleDisplayFrame(windowFrame);
            result.put("visibleFrame", rect(windowFrame.left, windowFrame.top, windowFrame.right, windowFrame.bottom));
        } catch (Throwable error) {
            Log.w(TAG, "describe cutout failed", error);
        }
        return result;
    }

    /** 递归找到 WebView，用于诊断它的高度/padding 是否被 inset 顶下来。 */
    private static WebView findWebView(View view) {
        if (view instanceof WebView) {
            return (WebView) view;
        }
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int index = 0; index < group.getChildCount(); index += 1) {
                WebView found = findWebView(group.getChildAt(index));
                if (found != null) {
                    return found;
                }
            }
        }
        return null;
    }

    private static JSONObject rect(int left, int top, int right, int bottom) throws Exception {
        JSONObject rect = new JSONObject();
        rect.put("left", left);
        rect.put("top", top);
        rect.put("right", right);
        rect.put("bottom", bottom);
        return rect;
    }
}
