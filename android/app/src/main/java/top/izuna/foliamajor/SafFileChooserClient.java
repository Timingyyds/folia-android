package top.izuna.foliamajor;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebView;

import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

import java.util.LinkedHashSet;
import java.util.Locale;

/**
 * 把 WebView 的 <input type="file"> 换成系统文件管理器（SAF），不再走相册选择器。
 *
 * 为什么要换：Android 13 起 WebView 对 `accept="image/*"` 的输入框默认弹系统相册选择器
 * （界面上写「仅可访问所选的照片和视频」）。那是系统策略，不是 App 申请的权限：
 * 应用清单里没有 READ_MEDIA_IMAGES，设置里自然也没有「相册」开关可关，
 * ColorOS 17 还会把这次临时授权记在系统服务里，清缓存和 pm reset-permissions 都动不了它。
 *
 * SAF 的 ACTION_OPEN_DOCUMENT 不需要任何存储/媒体权限：用户能浏览手机里的任意目录
 * （含下载、文档、SD 卡和云盘提供方），系统按选中的文件单独授权，
 * 标题栏也不会再出现那句「仅可访问所选的照片和视频」。
 * 其余 WebChromeClient 行为（控制台、权限请求、全屏）继续由 Capacitor 的父类负责。
 */
public class SafFileChooserClient extends BridgeWebChromeClient {

    private static final String TAG = "SafFileChooser";

    private final Bridge bridge;
    private final ActivityResultLauncher<Intent> pickerLauncher;
    /** 一次只允许一个选择框：上一次没返回时又开一个，旧的先按取消收场，免得输入框永久卡住。 */
    private ValueCallback<Uri[]> pendingCallback;

    public SafFileChooserClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
        // 必须在构造时注册：onShowFileChooser 发生在 RESUMED 之后，那时注册会直接抛异常。
        this.pickerLauncher = bridge.registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            this::handleResult
        );
    }

    @Override
    public boolean onShowFileChooser(
        WebView webView,
        ValueCallback<Uri[]> filePathCallback,
        FileChooserParams fileChooserParams
    ) {
        if (pendingCallback != null) {
            pendingCallback.onReceiveValue(null);
            pendingCallback = null;
        }
        pendingCallback = filePathCallback;

        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);

        String[] mimeTypes = resolveMimeTypes(
            fileChooserParams == null ? null : fileChooserParams.getAcceptTypes()
        );
        intent.setType(mimeTypes[0]);
        if (mimeTypes.length > 1) {
            intent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes);
        }
        if (fileChooserParams != null && fileChooserParams.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }

        try {
            pickerLauncher.launch(intent);
            return true;
        } catch (Exception error) {
            // 极少数精简系统没有 DocumentsUI：退回 Capacitor 原来的选择器，至少还能选。
            Log.w(TAG, "SAF picker unavailable, falling back: " + error.getMessage());
            pendingCallback = null;
            return super.onShowFileChooser(webView, filePathCallback, fileChooserParams);
        }
    }

    private void handleResult(ActivityResult result) {
        ValueCallback<Uri[]> callback = pendingCallback;
        pendingCallback = null;
        if (callback == null) return;

        Uri[] uris = null;
        Intent data = result.getData();
        if (result.getResultCode() == Activity.RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null && clip.getItemCount() > 0) {
                uris = new Uri[clip.getItemCount()];
                for (int index = 0; index < clip.getItemCount(); index += 1) {
                    uris[index] = clip.getItemAt(index).getUri();
                }
            } else if (data.getData() != null) {
                uris = new Uri[] { data.getData() };
            }
        }

        if (uris != null) {
            for (Uri uri : uris) takePersistableGrant(uri);
        }
        callback.onReceiveValue(uris);
    }

    /** 尽力把读权限持久化；提供方不支持时忽略，本次运行的临时授权仍然有效。 */
    private void takePersistableGrant(Uri uri) {
        if (uri == null) return;
        try {
            bridge.getContext().getContentResolver().takePersistableUriPermission(
                uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
            );
        } catch (Exception ignored) {
            // 有些云盘/下载提供方只给一次性授权。
        }
    }

    /**
     * 把 accept 列表换成 SAF 能用的 MIME 列表。
     *
     * 扩展名（.png/.zip/.m3u）先经 MimeTypeMap 转成 MIME；出现 `*&#47;*` 或全部无法识别时退回
     * `*&#47;*`，让用户至少能浏览所有文件，而不是一个空列表。
     */
    private static String[] resolveMimeTypes(String[] acceptTypes) {
        LinkedHashSet<String> types = new LinkedHashSet<>();
        boolean any = false;
        if (acceptTypes != null) {
            for (String raw : acceptTypes) {
                if (raw == null) continue;
                for (String part : raw.split(",")) {
                    String value = part.trim().toLowerCase(Locale.ROOT);
                    if (value.isEmpty()) continue;
                    if ("*/*".equals(value)) {
                        any = true;
                        continue;
                    }
                    if (value.startsWith(".")) {
                        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(value.substring(1));
                        if (mime != null) types.add(mime);
                    } else if (value.contains("/")) {
                        types.add(value);
                    }
                }
            }
        }
        if (any || types.isEmpty()) return new String[] { "*/*" };
        return types.toArray(new String[0]);
    }
}
