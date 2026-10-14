package top.izuna.foliamajor;

import android.content.ComponentCallbacks2;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.SystemClock;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

import java.io.File;

public class MainActivity extends BridgeActivity {
    private long lastWebViewRecoveryAt = 0L;
    /**
     * How many renderer rebuilds we run back to back before giving up.
     *
     * The old policy was "recreate once, then finish()": a second renderer death inside 15 seconds
     * closed the activity, and that is exactly what a user reports as 闪退 (the app vanishes).
     * A renderer death is the system reclaiming a sandboxed process — surfacing it in the same
     * activity is the normal, recoverable path for Chromium on Android, so rebuild a few times
     * before treating the page as unloadable. The crash trail records every death either way.
     */
    private static final int MAX_BACK_TO_BACK_RENDERER_RECOVERIES = 3;
    private static final long RENDERER_RECOVERY_WINDOW_MS = 60_000L;
    private static final String WEBVIEW_UPDATE_PREFS = "folia_webview_update";
    private static final String WEBVIEW_UPDATE_KEY = "last_cleared_update_time";
    private int rendererRecoveries = 0;
    private long lastUserLeaveRecordAt = 0L;
    private long lastTrimMemoryRecordAt = 0L;
    private int lastTrimMemoryLevel = Integer.MIN_VALUE;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        CrashDiagnostics.install(getApplicationContext());
        clearWebViewCachesAfterAppUpdate();
        registerPlugin(FoliaCorePlugin.class);
        registerPlugin(top.izuna.foliamajor.coloros.FoliaColorOsLyricsPlugin.class);
        super.onCreate(savedInstanceState);
        CrashDiagnostics.recordText(
            getApplicationContext(),
            "activity-lifecycle",
            "main",
            "create",
            "restoredState=" + (savedInstanceState != null),
            "onCreate"
        );
        installWebViewRendererGuard();
        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                // Let the WebView close its own settings/effects layer first; only a Back with
                // nothing left to close exits the activity.
                if (FoliaCorePlugin.emitBackPressed()) return;
                CrashDiagnostics.recordText(
                    getApplicationContext(),
                    "activity-lifecycle",
                    "main",
                    "back-finish",
                    "Back had no open layer; finishing activity",
                    "OnBackPressedCallback"
                );
                finish();
            }
        });
        PhoneLayoutOrientation.apply(this);
        PhoneFitCutout.apply(this);
        restoreAdaptiveLayout(webView);
        // 启动时窗口焦点和系统栏状态还会变一次，只应用一遍会被后面的 inset 恢复覆盖。
        webView.postDelayed(() -> restoreAdaptiveLayout(webView), 500);
        webView.postDelayed(() -> restoreAdaptiveLayout(webView), 1500);
        webView.postDelayed(() -> PhoneFitCutout.apply(this), 500);
        webView.postDelayed(() -> PhoneFitCutout.apply(this), 1500);
    }

    /**
     * The PWA service worker caches index.html and every hashed asset. After an APK update the
     * cached index.html can reference chunks that no longer exist in the new package, and that
     * first launch has to run the old JS before the new bundle can repair anything. Clear only
     * WebView's HTTP / service-worker / code caches once per install so the first launch reads the
     * fresh index.html from the APK. Cookies, localStorage and IndexedDB are deliberately kept.
     */
    private void clearWebViewCachesAfterAppUpdate() {
        long updateTime;
        try {
            updateTime = getPackageManager().getPackageInfo(getPackageName(), 0).lastUpdateTime;
        } catch (Exception error) {
            CrashDiagnostics.recordText(
                getApplicationContext(),
                "webview-cache-cleanup",
                "main",
                "package-info-error",
                error.getClass().getSimpleName() + ": " + error.getMessage(),
                "Could not read lastUpdateTime"
            );
            return;
        }

        SharedPreferences preferences = getSharedPreferences(WEBVIEW_UPDATE_PREFS, MODE_PRIVATE);
        if (preferences.getLong(WEBVIEW_UPDATE_KEY, -1L) == updateTime) return;
        preferences.edit().putLong(WEBVIEW_UPDATE_KEY, updateTime).apply();

        File webViewRoot = new File(getDataDir(), "app_webview/Default");
        String[] cachePaths = {
            "HTTP Cache",
            "Code Cache",
            "GPUCache",
            "DawnGraphiteCache",
            "DawnWebGPUCache",
            "Service Worker",
            "Cache",
        };
        for (String path : cachePaths) deleteQuietly(new File(webViewRoot, path));
    }

    private static void deleteQuietly(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) deleteQuietly(child);
        }
        // Failure is non-fatal: the JS-side recovery still handles a stale chunk reference.
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }

    /**
     * A dead WebView renderer kills the Android process when the client returns false, so we take
     * the callback, record why it ended, and rebuild the activity. Repeated deaths still end the
     * app, but only after several rebuilds inside a minute: closing on the second one turned a
     * recoverable renderer kill into the app disappearing mid-use.
     */
    private void installWebViewRendererGuard() {
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                boolean didCrash = detail != null && detail.didCrash();
                int priority = detail == null ? -1 : detail.rendererPriorityAtExit();
                CrashDiagnostics.recordText(
                    getApplicationContext(),
                    "webview-renderer-gone",
                    "renderer",
                    didCrash ? "renderer-crash" : "renderer-killed",
                    "didCrash=" + didCrash + " priorityAtExit=" + priority,
                    "Capacitor WebView renderer process ended"
                );

                long now = SystemClock.elapsedRealtime();
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    // A quiet minute means the previous rebuild held: start counting again.
                    if (now - lastWebViewRecoveryAt > RENDERER_RECOVERY_WINDOW_MS) rendererRecoveries = 0;
                    lastWebViewRecoveryAt = now;
                    rendererRecoveries += 1;
                    if (rendererRecoveries > MAX_BACK_TO_BACK_RENDERER_RECOVERIES) {
                        // Still dying after several rebuilds: better to stop than to loop forever.
                        // The crash trail above already says what the renderer reported.
                        CrashDiagnostics.recordText(
                            getApplicationContext(),
                            "webview-renderer-gone",
                            "renderer",
                            "renderer-give-up",
                            "rendererRecoveries=" + rendererRecoveries
                                + " windowMs=" + RENDERER_RECOVERY_WINDOW_MS,
                            "finish after repeated renderer deaths"
                        );
                        finish();
                        return;
                    }
                    if (view != null) view.destroy();
                    CrashDiagnostics.recordText(
                        getApplicationContext(),
                        "webview-renderer-guard",
                        "main",
                        "recreate",
                        "attempt=" + rendererRecoveries + " didCrash=" + didCrash,
                        "rebuilding activity after renderer death"
                    );
                    recreate();
                });
                return true;
            }
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        if (getBridge() != null) {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                webView.postDelayed(() -> restoreAdaptiveLayout(webView), 100);
            }
        }
        PhoneFitCutout.apply(this);
    }

    @Override
    protected void onUserLeaveHint() {
        long now = SystemClock.elapsedRealtime();
        if (now - lastUserLeaveRecordAt < 3000L) {
            super.onUserLeaveHint();
            return;
        }
        lastUserLeaveRecordAt = now;
        CrashDiagnostics.recordText(
            getApplicationContext(),
            "activity-lifecycle",
            "main",
            "user-leave",
            "User left the app (Home, Recents, or app switch)",
            "onUserLeaveHint"
        );
        super.onUserLeaveHint();
    }

    @Override
    public void onStop() {
        CrashDiagnostics.recordText(
            getApplicationContext(),
            "activity-lifecycle",
            "main",
            "stop",
            "isFinishing=" + isFinishing() + " changingConfigurations=" + isChangingConfigurations(),
            "onStop"
        );
        super.onStop();
    }

    @Override
    public void onDestroy() {
        CrashDiagnostics.recordText(
            getApplicationContext(),
            "activity-lifecycle",
            "main",
            "destroy",
            "isFinishing=" + isFinishing() + " changingConfigurations=" + isChangingConfigurations(),
            "onDestroy"
        );
        super.onDestroy();
    }

    @Override
    public void onTrimMemory(int level) {
        long now = SystemClock.elapsedRealtime();
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW
            && (level != lastTrimMemoryLevel || now - lastTrimMemoryRecordAt >= 10000L)) {
            lastTrimMemoryLevel = level;
            lastTrimMemoryRecordAt = now;
            CrashDiagnostics.recordText(
                getApplicationContext(),
                "memory-pressure",
                "main",
                "trim-memory",
                "level=" + level,
                "onTrimMemory"
            );
        }
        super.onTrimMemory(level);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && getBridge() != null) {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                webView.post(() -> restoreAdaptiveLayout(webView));
                webView.post(() -> PhoneFitCutout.apply(this));
            }
        }
    }

    // 用户在设置里开过「自适应屏幕分辨率」的话，恢复沉浸式全屏。失败时回滚，避免反复启动就崩。
    private void restoreAdaptiveLayout(WebView webView) {
        // 自适应布局的 inset 操作可能重置 cutout 模式，这里统一补一次挖孔适配。
        PhoneFitCutout.apply(this);
        if (!AdaptiveLayout.isEnabled(this)) return;
        if (!AdaptiveLayout.apply(this, webView, true)) {
            AdaptiveLayout.setEnabled(this, false);
        }
    }
}
