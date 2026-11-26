package top.izuna.foliamajor;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

/**
 * Folia Android 全屏沉浸容器：
 * - 真全屏（状态栏/导航栏全隐藏，IMMERSIVE_STICKY + WindowInsetsController 双通道）；
 * - 刘海屏 / 挖孔屏适配（API 30+ ALWAYS，低版本 SHORT_EDGES）；
 * - WebView：混合内容放行 + 75% 等比缩放（wideViewPort + overviewMode + initialScale）；
 * - 注册 FoliaBridge（网络层扩展）与 FoliaNative（本地音乐 MediaStore/SAF + LocalAudioServer）。
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 调试包开放 WebView 远程调试（Chrome DevTools / CDP），便于在真机上直接排查界面与网络问题。
        boolean debuggable = (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (debuggable) {
            android.webkit.WebView.setWebContentsDebuggingEnabled(true);
        }
        registerPlugin(FoliaBridgePlugin.class);
        registerPlugin(FoliaCorePlugin.class);
        // 锁屏 / 通知栏的歌词通道：Web 层把整条时间轴交过来，由 ColorOsLyricBridge 写进
        // MediaMetadata["lyricInfo"]。这条线以前只有原生半边，Web 层从没调用过。
        registerPlugin(top.izuna.foliamajor.coloros.FoliaColorOsLyricsPlugin.class);
        super.onCreate(savedInstanceState);
        // 应用在前台时保持屏幕常亮：FLAG_KEEP_SCREEN_ON 只作用于本窗口，
        // 切到后台或锁屏后系统会自动忽略它，不需要额外监听生命周期去清。
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        Bridge bridge = getBridge();
        if (bridge != null && bridge.getWebView() != null) {
            // 换掉 WebView 的文件选择器：图片输入框不再进系统相册选择器（「仅可访问所选的照片和视频」），
            // 改由 SAF 打开完整文件管理器，不需要任何相册/存储权限。
            bridge.getWebView().setWebChromeClient(new SafFileChooserClient(bridge));
            WebSettings ws = bridge.getWebView().getSettings();
            ws.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
            ws.setUseWideViewPort(true);
            ws.setLoadWithOverviewMode(true);
            ws.setSupportZoom(false);
            ws.setBuiltInZoomControls(false);
            bridge.getWebView().setInitialScale(75);
        }
        applyFullscreen();
        applyCutoutMode();
        // 挖孔/刘海适配是设备固有特征，不跟「手机适配」开关绑定：启动就铺一次，
        // 否则在那些把状态栏高度垫成窗口顶部内边距的机型上，页面顶部会空出一条刘海高的带子。
        PhoneFitCutout.apply(this);
        getWindow().getDecorView().postDelayed(this::applyFullscreen, 500);
        getWindow().getDecorView().postDelayed(this::applyCutoutMode, 500);
        getWindow().getDecorView().postDelayed(() -> PhoneFitCutout.apply(this), 500);
        getWindow().getDecorView().setOnSystemUiVisibilityChangeListener(visibility -> {
            if ((visibility & View.SYSTEM_UI_FLAG_FULLSCREEN) == 0) applyFullscreen();
        });
        // 返回键 / 全面屏返回手势先交给 WebView：JS 那边的层（弹窗、搜索、播放页、集合栈）退一层，
        // 真的回到主界面时由 JS 调 exitApp。emitBackPressed() 返回 false 说明 JS 还没装监听，
        // 这时才走系统默认（结束 Activity）。
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (FoliaCorePlugin.emitBackPressed()) return;
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
            }
        });
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applyFullscreen();
            applyCutoutMode();
            // 回前台、系统栏临时划出后再回来时，有的 ROM 会把 inset 重新垫回内容根，
            // 这里再铺一次，顶部那条刘海高的空带就不会反弹。
            PhoneFitCutout.apply(this);
            logCutoutSnapshot();
        }
    }

    /** 顶部/底部还残留多少空白：一条日志，方便用户报「不全屏」时直接看出是窗口还是内容被顶下来。 */
    private void logCutoutSnapshot() {
        try {
            org.json.JSONObject cutout = PhoneFitCutout.describe(this);
            android.util.Log.i("FoliaFullscreen", "cutout " + cutout);
        } catch (Throwable error) {
            android.util.Log.w("FoliaFullscreen", "describe failed", error);
        }
    }

    private void applyFullscreen() {
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            android.view.WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(android.view.WindowInsets.Type.statusBars() | android.view.WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        }
    }

    private void applyCutoutMode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attributes = getWindow().getAttributes();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                attributes.layoutInDisplayCutoutMode =
                        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
            } else {
                attributes.layoutInDisplayCutoutMode =
                        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            }
            getWindow().setAttributes(attributes);
        }
    }
}
