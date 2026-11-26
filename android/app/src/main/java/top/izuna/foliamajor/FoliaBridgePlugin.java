package top.izuna.foliamajor;

import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import android.webkit.CookieManager;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.annotation.ActivityCallback;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * FoliaBridge：Folia Android 扩展协议的原生网络层。
 * 音源请求与扫码登录全部经由这里（OkHttp + 系统级 CookieManager）发出：
 * - Cookie 由 WebView 的 CookieManager 统一管理，登录态即浏览器级体验；
 * - 重定向手动跟随，每一跳的 Set-Cookie 都写入 CookieManager 并回传给 WebView；
 * - 支持 binary 返回（base64），用于二维码 PNG 等二进制响应。
 */
@CapacitorPlugin(name = "FoliaBridge")
public class FoliaBridgePlugin extends Plugin {

    private final OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(90, TimeUnit.SECONDS)
            .writeTimeout(90, TimeUnit.SECONDS)
            .followRedirects(false)
            .followSslRedirects(false)
            .build();

    @PluginMethod
    public void request(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("FoliaBridge.request requires url");
            return;
        }
        String method = call.getString("method", "GET");
        String body = call.getString("body");
        boolean binary = Boolean.TRUE.equals(call.getBoolean("binary"));
        int timeoutMs = call.getInt("timeoutMs", 60000);
        boolean followRedirects = !Boolean.FALSE.equals(call.getBoolean("followRedirects"));
        boolean omitCookies = Boolean.TRUE.equals(call.getBoolean("omitCookies"));
        JSObject headers = call.getObject("headers");

        getBridge().execute(() -> {
            try {
                call.resolve(executeWithRedirects(url, method, body, headers, binary, timeoutMs, followRedirects, omitCookies));
            } catch (Exception e) {
                call.reject("FoliaBridge request failed: " + e.getMessage(), e);
            }
        });
    }

    private JSObject executeWithRedirects(String url, String method, String body, JSObject headerObject,
                                          boolean binary, int timeoutMs, boolean followRedirects,
                                          boolean omitCookies) throws Exception {
        String currentUrl = url;
        String currentMethod = method;
        String currentBody = body;
        JSObject lastHeaders = new JSObject();
        java.util.List<String> setCookies = new java.util.ArrayList<>();

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);

        for (int hop = 0; hop < 8; hop++) {
            Map<String, String> headerMap = new HashMap<>();
            if (headerObject != null) {
                java.util.Iterator<String> keyIterator = headerObject.keys();
                while (keyIterator.hasNext()) {
                    String key = keyIterator.next();
                    Object value = headerObject.opt(key);
                    if (value != null) {
                        headerMap.put(key, String.valueOf(value));
                    }
                }
            }
            // 浏览器级 Cookie：没有显式 Cookie 头时自动附加 CookieManager 中该域的会话
            if (!omitCookies && !headerMap.containsKey("Cookie") && !headerMap.containsKey("cookie")) {
                String cookies = cookieManager.getCookie(currentUrl);
                if (cookies != null && !cookies.isEmpty()) {
                    headerMap.put("Cookie", cookies);
                }
            }

            Request.Builder builder = new Request.Builder().url(currentUrl);
            for (Map.Entry<String, String> entry : headerMap.entrySet()) {
                builder.header(entry.getKey(), entry.getValue());
            }
            boolean hasBody = currentBody != null
                    && ("POST".equalsIgnoreCase(currentMethod) || "PUT".equalsIgnoreCase(currentMethod)
                    || "PATCH".equalsIgnoreCase(currentMethod) || "DELETE".equalsIgnoreCase(currentMethod));
            if (hasBody) {
                String contentType = headerMap.getOrDefault("Content-Type",
                        headerMap.getOrDefault("content-type", "application/x-www-form-urlencoded"));
                builder.method(currentMethod.toUpperCase(),
                        RequestBody.create(MediaType.parse(contentType), currentBody.getBytes("UTF-8")));
            } else {
                builder.method(currentMethod.toUpperCase(), null);
            }

            OkHttpClient scoped = client.newBuilder()
                    .callTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                    .build();
            Response response = scoped.newCall(builder.build()).execute();
            try {
                // 记录并同步 Set-Cookie 到 CookieManager（跨跳保持会话）；omitCookies 时不落库
                if (!omitCookies) {
                    for (String setCookie : response.headers("Set-Cookie")) {
                        try {
                            cookieManager.setCookie(currentUrl, setCookie);
                        } catch (Exception ignored) {
                        }
                        setCookies.add(setCookie);
                    }
                }
                lastHeaders = new JSObject();
                for (Map.Entry<String, java.util.List<String>> entry : response.headers().toMultimap().entrySet()) {
                    String name = entry.getKey();
                    if ("set-cookie".equalsIgnoreCase(name) || entry.getValue().isEmpty()) continue;
                    lastHeaders.put(name, entry.getValue().get(0));
                }

                if (followRedirects && response.isRedirect()) {
                    String location = response.header("Location");
                    if (location != null) {
                        currentUrl = new java.net.URL(new java.net.URL(currentUrl), location).toString();
                        if ("POST".equalsIgnoreCase(currentMethod) && response.code() != 307 && response.code() != 308) {
                            currentMethod = "GET";
                            currentBody = null;
                        }
                        continue;
                    }
                }

                JSObject result = new JSObject();
                result.put("status", response.code());
                result.put("headers", lastHeaders);
                if (!setCookies.isEmpty()) {
                    JSArray arr = new JSArray();
                    for (String part : setCookies) arr.put(part);
                    result.put("setCookies", arr);
                }
                if (binary) {
                    InputStream in = response.body().byteStream();
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    byte[] buffer = new byte[8192];
                    int read;
                    while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
                    in.close();
                    result.put("bodyBase64", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                } else {
                    result.put("body", response.body() != null ? response.body().string() : "");
                }
                cookieManager.flush();
                return result;
            } finally {
                response.close();
            }
        }
        throw new Exception("too many redirects");
    }

    /**
     * 内存监控用的一次采样。
     *
     * 桌面版由 Electron 主进程读各进程的 working set；Android 没有那个东西，
     * 这里给的是系统能拿到的等价值：本进程的 PSS（含 Java/native/图形）、
     * 系统的可用/总内存，以及进程运行时长。JS 堆由渲染进程自己用 performance.memory 补上。
     */
    @PluginMethod
    public void memoryInfo(PluginCall call) {
        getBridge().execute(() -> {
            try {
                android.app.ActivityManager am =
                        (android.app.ActivityManager) getContext().getSystemService(android.content.Context.ACTIVITY_SERVICE);
                int pid = android.os.Process.myPid();
                android.os.Debug.MemoryInfo[] info = am.getProcessMemoryInfo(new int[]{pid});
                android.app.ActivityManager.MemoryInfo system = new android.app.ActivityManager.MemoryInfo();
                am.getMemoryInfo(system);
                Runtime runtime = Runtime.getRuntime();

                double toMB = 1024d * 1024d;
                JSObject result = new JSObject();
                result.put("pid", pid);
                result.put("pssMB", info.length > 0 ? info[0].getTotalPss() / 1024d : 0);
                // 私有内存（不含共享页）与 Java 堆的 PSS：曲线各自独立，不会和 PSS 重合。
                result.put("privateMB", info.length > 0 ? info[0].getTotalPrivateDirty() / 1024d : 0);
                // dalvikPss 是 Java/WebView 堆那一块在 PSS 口径下的占用。
                result.put("javaHeapPssMB", info.length > 0 ? info[0].dalvikPss / 1024d : 0);
                result.put("javaHeapMB", (runtime.totalMemory() - runtime.freeMemory()) / toMB);
                result.put("javaHeapTotalMB", runtime.totalMemory() / toMB);
                result.put("nativeHeapMB", android.os.Debug.getNativeHeapAllocatedSize() / toMB);
                result.put("systemFreeMB", system.availMem / toMB);
                result.put("systemTotalMB", system.totalMem / toMB);
                result.put("lowMemory", system.lowMemory);
                result.put("uptimeSec", android.os.SystemClock.elapsedRealtime() / 1000d);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("memoryInfo failed: " + e.getMessage(), e);
            }
        });
    }

    /**
     * 运行日志与内存监控要写的两个文件在手机上的位置。
     *
     * 默认和 CrashDiagnostics 同目录（files/logs），不需要任何权限；用户选了目录之后
     * 写的是 SAF 授权的那棵树，这里回显它的显示名。
     */
    @PluginMethod
    public void debugLogPaths(PluginCall call) {
        getBridge().execute(() -> {
            try {
                String dir = displayDir();
                JSObject result = new JSObject();
                result.put("dir", dir);
                result.put("runtime", dir.isEmpty() ? "" : dir + "/" + RUNTIME_LOG);
                result.put("memory", dir.isEmpty() ? "" : dir + "/" + MEMORY_LOG);
                result.put("custom", customTreeUri() != null);
                java.io.File fallback = defaultLogDir();
                result.put("default", fallback == null ? "" : fallback.getAbsolutePath());
                call.resolve(result);
            } catch (Exception e) {
                call.reject("debugLogPaths failed: " + e.getMessage(), e);
            }
        });
    }

    private static final String RUNTIME_LOG = "folia-runtime.log";
    private static final String MEMORY_LOG = "folia-memory.log";
    private static final long LOG_MAX_BYTES = 2L * 1024 * 1024;

    private static final String DEBUG_PREFS = "folia_debug";
    private static final String KEY_LOG_TREE = "log_tree";
    private static final String KEY_LOG_TREE_NAME = "log_tree_name";

    /**
     * 用户自选的目录记的是 SAF 的 tree URI，不是文件路径。
     *
     * 存路径这条路在真机上行不通：Android 11+ 要「所有文件访问」才能按路径写任意目录，
     * 而多数 ROM 把这个开关做成了灰色不可点。SAF 的授权跟着 URI 走，不需要那个权限。
     */
    private Uri customTreeUri() {
        try {
            String value = getContext().getSharedPreferences(DEBUG_PREFS, android.content.Context.MODE_PRIVATE)
                    .getString(KEY_LOG_TREE, "");
            return value == null || value.isEmpty() ? null : Uri.parse(value);
        } catch (Exception e) {
            return null;
        }
    }

    private java.io.File defaultLogDir() {
        java.io.File dir = getContext().getExternalFilesDir("logs");
        if (dir == null || (!dir.exists() && !dir.mkdirs())) {
            // 部分定制系统/存储受限的设备拿不到外置目录：退回应用内部目录，
            // 否则「写入本地文件」会一直失败，看起来像日志模块坏了。
            dir = new java.io.File(getContext().getFilesDir(), "logs");
            if (!dir.exists() && !dir.mkdirs()) return null;
        }
        return dir;
    }

    /** 界面回显用：选了目录显示它的名字，否则显示应用自己的路径。 */
    private String displayDir() {
        if (customTreeUri() != null) {
            try {
                String name = getContext().getSharedPreferences(DEBUG_PREFS, android.content.Context.MODE_PRIVATE)
                        .getString(KEY_LOG_TREE_NAME, "");
                if (name != null && !name.isEmpty()) return name;
            } catch (Exception ignored) { }
        }
        java.io.File dir = defaultLogDir();
        return dir == null ? "" : dir.getAbsolutePath();
    }

    /** 选一个日志目录。授权由 SAF 自己持久化，不需要「所有文件访问」。 */
    @PluginMethod
    public void debugPickLogDir(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        try {
            startActivityForResult(call, intent, "handlePickedLogDir");
        } catch (Exception e) {
            call.reject("无法打开目录选择器: " + e.getMessage());
        }
    }

    @ActivityCallback
    private void handlePickedLogDir(PluginCall call, ActivityResult activityResult) {
        if (call == null) return;
        Intent data = activityResult == null ? null : activityResult.getData();
        Uri treeUri = data == null ? null : data.getData();
        JSObject result = new JSObject();
        if (treeUri == null) {
            result.put("cancelled", true);
            call.resolve(result);
            return;
        }
        try {
            getContext().getContentResolver().takePersistableUriPermission(
                    treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception ignored) {
            // 有的提供方不给持久授权，本次进程内仍然可写。
        }
        String name = treeDisplayName(treeUri);
        try {
            getContext().getSharedPreferences(DEBUG_PREFS, android.content.Context.MODE_PRIVATE)
                    .edit().putString(KEY_LOG_TREE, treeUri.toString()).putString(KEY_LOG_TREE_NAME, name).commit();
        } catch (Exception ignored) { }
        result.put("cancelled", false);
        result.put("dir", name);
        call.resolve(result);
    }

    /** 取目录显示名（如 “Download”），拿不到就用 URI 末段。 */
    private String treeDisplayName(Uri treeUri) {
        try {
            Uri doc = DocumentsContract.buildDocumentUriUsingTree(treeUri, DocumentsContract.getTreeDocumentId(treeUri));
            android.database.Cursor cursor = getContext().getContentResolver().query(doc, null, null, null, null);
            if (cursor != null) {
                try {
                    int index = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                    if (cursor.moveToFirst() && index >= 0) {
                        String name = cursor.getString(index);
                        if (name != null && !name.isEmpty()) return name;
                    }
                } finally {
                    cursor.close();
                }
            }
        } catch (Exception ignored) { }
        String fallback = treeUri.getLastPathSegment();
        return fallback == null ? "" : fallback;
    }

    /** 清掉自定义目录，回到应用自己的 files/logs。 */
    @PluginMethod
    public void debugResetLogDir(PluginCall call) {
        try {
            getContext().getSharedPreferences(DEBUG_PREFS, android.content.Context.MODE_PRIVATE)
                    .edit().remove(KEY_LOG_TREE).remove(KEY_LOG_TREE_NAME).commit();
        } catch (Exception ignored) { }
        JSObject result = new JSObject();
        java.io.File dir = defaultLogDir();
        result.put("dir", dir == null ? "" : dir.getAbsolutePath());
        call.resolve(result);
    }

    /**
     * 追加（或首次覆盖）一段日志。
     *
     * 桌面版由主进程写文件；手机没有主进程，只能由这里代劳。写入在 plugin 的后台线程里做，
     * 不阻塞 WebView 的 JS 线程 —— 每秒一批的情况下这点差别就是掉帧与不掉帧。
     */
    @PluginMethod
    public void debugAppendLog(PluginCall call) {
        String kind = call.getString("kind", "runtime");
        String text = call.getString("text", "");
        getBridge().execute(() -> {
            try {
                String fileName = "memory".equals(kind) ? MEMORY_LOG : RUNTIME_LOG;
                Uri tree = customTreeUri();
                String path = tree != null
                        ? writeViaTree(tree, fileName, text)
                        : writeToDefaultDir(fileName, text);
                JSObject result = new JSObject();
                result.put("path", path);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("debugAppendLog failed: " + e.getMessage(), e);
            }
        });
    }

    /** 一律追加；写满上限就把当前文件改名成第二份，再开一个新的继续写。 */
    private String writeToDefaultDir(String fileName, String text) throws Exception {
        java.io.File dir = defaultLogDir();
        if (dir == null) throw new IllegalStateException("no external files dir");
        java.io.File file = new java.io.File(dir, fileName);
        if (file.exists() && file.length() > LOG_MAX_BYTES) {
            java.io.File rotated = new java.io.File(dir, rotatedName(fileName));
            if (rotated.exists()) rotated.delete();
            file.renameTo(rotated);
        }
        try (java.io.Writer writer = new java.io.OutputStreamWriter(new java.io.FileOutputStream(file, true), "UTF-8")) {
            writer.write(text);
            writer.flush();
        }
        return file.getAbsolutePath();
    }

    /**
     * 写进用户用 SAF 选的目录：一律追加。
     *
     * 不能用 "wa"：不少提供方（下载、云盘、部分 ROM 的 DocumentsUI）不支持追加模式，
     * 直接抛异常。这里改成找到已有文档 → 以 "rw" 打开 → lseek 到末尾再写。
     * 超过上限时把当前文档改名成第二份（同名旧的一份先删掉），再新建一个继续写。
     */
    private String writeViaTree(Uri treeUri, String fileName, String text) throws Exception {
        android.content.ContentResolver resolver = getContext().getContentResolver();
        String treeDocId = DocumentsContract.getTreeDocumentId(treeUri);
        Uri treeDoc = DocumentsContract.buildDocumentUriUsingTree(treeUri, treeDocId);

        Uri fileUri = findChildDocument(rootChildrenUri(treeUri, treeDocId), fileName);
        long size = fileUri == null ? -1 : documentSize(fileUri);
        if (fileUri != null && size > LOG_MAX_BYTES) {
            Uri rotated = findChildDocument(rootChildrenUri(treeUri, treeDocId), rotatedName(fileName));
            try {
                if (rotated != null) DocumentsContract.deleteDocument(resolver, rotated);
                DocumentsContract.renameDocument(resolver, fileUri, rotatedName(fileName));
            } catch (Exception ignored) {
                // 该提供方不支持改名：退回删除，至少不会把日志写到别人文件里。
                try { DocumentsContract.deleteDocument(resolver, fileUri); } catch (Exception ignoredToo) { }
            }
            fileUri = null;
        }
        if (fileUri == null) {
            fileUri = DocumentsContract.createDocument(resolver, treeDoc, "text/plain", fileName);
            if (fileUri == null) throw new IllegalStateException("cannot create " + fileName);
        }

        byte[] bytes = text.getBytes("UTF-8");
        try (android.os.ParcelFileDescriptor pfd = resolver.openFileDescriptor(fileUri, "rw")) {
            if (pfd == null) throw new IllegalStateException("cannot open " + fileName);
            android.system.Os.lseek(pfd.getFileDescriptor(), 0, android.system.OsConstants.SEEK_END);
            try (java.io.FileOutputStream out = new java.io.FileOutputStream(pfd.getFileDescriptor())) {
                out.write(bytes);
                out.flush();
            }
        }
        String name = displayDir();
        return name.isEmpty() ? fileName : name + "/" + fileName;
    }

    /** folia-runtime.log → folia-runtime.1.log */
    private static String rotatedName(String fileName) {
        int dot = fileName.lastIndexOf('.');
        return dot < 0 ? fileName + ".1" : fileName.substring(0, dot) + ".1" + fileName.substring(dot);
    }

    private Uri rootChildrenUri(Uri treeUri, String treeDocId) {
        return DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, treeDocId);
    }

    /** 在这棵树里按显示名找子文档；找不到返回 null。 */
    private Uri findChildDocument(Uri childrenUri, String displayName) {
        android.database.Cursor cursor = null;
        try {
            cursor = getContext().getContentResolver().query(childrenUri,
                    new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                            DocumentsContract.Document.COLUMN_DISPLAY_NAME},
                    null, null, null);
            if (cursor == null) return null;
            int idIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
            int nameIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
            while (cursor.moveToNext()) {
                if (idIndex < 0 || nameIndex < 0) return null;
                String name = cursor.getString(nameIndex);
                if (displayName.equals(name)) {
                    return DocumentsContract.buildDocumentUriUsingTree(
                            childrenUri, cursor.getString(idIndex));
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) cursor.close();
        }
        return null;
    }

    private long documentSize(Uri documentUri) {
        android.database.Cursor cursor = null;
        try {
            cursor = getContext().getContentResolver().query(documentUri,
                    new String[]{DocumentsContract.Document.COLUMN_SIZE}, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE);
                if (index >= 0 && !cursor.isNull(index)) return cursor.getLong(index);
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) cursor.close();
        }
        return -1;
    }
}
