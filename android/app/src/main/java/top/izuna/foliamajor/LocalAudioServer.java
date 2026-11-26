package top.izuna.foliamajor;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Arrays;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * 本地音频流服务器。
 *
 * 两种来源：
 *   /audio/<MediaStore id>          系统媒体库里的文件
 *   /audio/imported-<file name>     通过系统文件管理器挑选后复制进 App 私有目录的文件
 *
 * WebView 的 <audio> 播不了 content:// 这种 URI，也不认 App 私有目录里的路径，
 * 所以原生起一个只监听 127.0.0.1 的小服务，把音频以 http 的形式喂回去。
 * 必须支持 Range：<audio> 拖进度、以及某些格式要先读文件尾部的元数据，都靠它。
 */
final class LocalAudioServer {
    private static final String TAG = "LocalAudioServer";
    private static final String AUDIO_PATH_PREFIX = "/audio/";
    private static final String REMOTE_AUDIO_PATH_PREFIX = "/remote-audio/";
    /** 原生整段下载的音频（YouTube Music 等按出口 IP 签发的直链走这条）。 */
    private static final String DOWNLOADED_AUDIO_PATH_PREFIX = "/downloaded-audio/";
    private static final String DOWNLOADED_AUDIO_DIR = "downloaded-audio";
    /** 一首歌下到这么大还没完就不要了（无损也就几十 MB，这个上限只防跑飞）。 */
    private static final long DOWNLOADED_AUDIO_MAX_BYTES = 96L * 1024 * 1024;
    private static final String IMPORTED_PREFIX = "imported-";
    /** 直接按绝对路径流原文件的 ref 前缀（文件系统兜底扫描出来的歌，不复制进私有目录）。 */
    private static final String FILE_PREFIX = "file-";
    /** 在线壁纸：私有目录里的视频/图片，按文件名流回去。 */
    private static final String WALLPAPER_PATH_PREFIX = "/wallpaper/";
    private static final String WALLPAPER_DIR = "wallpapers";
    /** 在线壁纸的缩略图代理：站点要求 Referer，WebView 的 <img> 给不了。 */
    private static final String WALLPAPER_THUMB_PATH_PREFIX = "/wallpaper-thumb/";
    private static final String[] WALLPAPER_THUMB_HOST_SUFFIXES = {
        "moewalls.com", "bizhihui.com", "doubaocdn.com", "panlai.com"
    };
    /** 缩略图上限：只是列表上的小图，超过这个数说明拿到的不是图片。 */
    private static final long WALLPAPER_THUMB_MAX_BYTES = 8L * 1024 * 1024;
    /*
     * 只能代哪些主机的远端音频。
     *
     * 这个服务监听在 127.0.0.1 上，设备上任何应用都能连上来 —— 放行任意 URL 就等于
     * 开了一个「任读全网」的口子，所以按主机白名单收口。目前只有 Kuwo（波点）需要它：
     * 它的 CDN 不下发 CORS 头，而 <audio> 带 crossOrigin="anonymous"，
     * 于是播放被同源策略挡掉（表现是 MEDIA_ELEMENT_ERROR: Format error）。
     */
    private static final String[] REMOTE_AUDIO_HOST_SUFFIXES = { "kuwo.cn", "music.126.net" };
    private static final String REMOTE_AUDIO_USER_AGENT =
        "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36";
    private static final String REMOTE_AUDIO_REFERER = "https://www.kuwo.cn/";
    private static final String NETEASE_REMOTE_AUDIO_REFERER = "https://music.163.com/";
    private final Context context;
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final OkHttpClient remoteAudioClient = new OkHttpClient.Builder()
        .followRedirects(true)
        .followSslRedirects(true)
        .build();
    private final Map<String, String> remoteAudioUrls = new LinkedHashMap<>();
    /** 转发时要额外带上的请求头（按 token 存）；没有时为 null，见 {@link #registerRemoteAudio}。 */
    private final Map<String, Map<String, String>> remoteAudioHeaders = new LinkedHashMap<>();
    /** 下载好的音频：token → 磁盘上的文件（token 由地址算出来，重启后同名文件仍可复用）。 */
    private final Map<String, File> downloadedAudioFiles = new LinkedHashMap<>();
    private final Map<String, String> downloadedAudioTypes = new LinkedHashMap<>();
    private ServerSocket serverSocket;
    private int port;

    LocalAudioServer(Context context) {
        this.context = context.getApplicationContext();
    }

    synchronized int start() throws IOException {
        if (serverSocket != null && !serverSocket.isClosed()) return port;
        // 端口交给系统分配（0）：写死一个的话，被别的进程占了就起不来，
        // 而每次启动拿到的端口都可能不同，所以 URL 不能持久化，播放前要重新拼（见插件的 localAudioServerPort）。
        serverSocket = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        port = serverSocket.getLocalPort();
        executor.execute(() -> {
            while (!serverSocket.isClosed()) {
                try {
                    Socket socket = serverSocket.accept();
                    executor.execute(() -> handle(socket));
                } catch (IOException ignored) {
                    Log.i(TAG, "server socket closed, stopping accept loop");
                    break;
                }
            }
        });
        return port;
    }

    int getPort() {
        return port;
    }

    /**
     * 把一个远端音频地址挂到本地服务上，返回 `http://127.0.0.1:<port>/remote-audio/<token>`。
     *
     * 为什么要绕这一圈：<audio> 带 crossOrigin="anonymous"，而 Kuwo（波点）的 CDN
     * 根本不下发 Access-Control-Allow-Origin —— 请求连字节都拿不到，报出来却是
     * 一句毫无特征的 "MEDIA_ELEMENT_ERROR: Format error" / "The element has no supported sources"。
     * 本地服务回包带 ACAO: *，同源检查就过了；Range 也照样转发，拖进度条不受影响。
     */
    synchronized String registerRemoteAudio(String value) throws IOException {
        return registerRemoteAudio(value, null, false);
    }

    /**
     * 同 {@link #registerRemoteAudio(String)}，但多两个开关：转发时要附带的请求头，以及"允许任意主机"。
     *
     * 为什么要它们：飞牛（FNOS）这类自建服务的音频流只认 `Cookie: music-token=...`，
     * 而 <audio> 加不了任何请求头；它的地址又是用户在登录时自己填的局域网地址，
     * 不可能出现在 {@link #REMOTE_AUDIO_HOST_SUFFIXES} 那份白名单里。
     * 两个开关都由调用方显式打开，白名单那一路（Kuwo / 网易）行为不变。
     */
    synchronized String registerRemoteAudio(String value, Map<String, String> headers, boolean allowAnyHost) throws IOException {
        URL url = new URL(value);
        String host = url.getHost() == null ? "" : url.getHost().toLowerCase(Locale.ROOT);
        if (!("http".equals(url.getProtocol()) || "https".equals(url.getProtocol()))
            || !(allowAnyHost || isRemoteAudioHostAllowed(host))) {
            throw new IOException("Unsupported remote audio host");
        }
        int localPort = start();
        String token = android.util.Base64.encodeToString(
            value.getBytes(StandardCharsets.UTF_8),
            android.util.Base64.URL_SAFE | android.util.Base64.NO_PADDING | android.util.Base64.NO_WRAP
        );
        synchronized (remoteAudioUrls) {
            remoteAudioUrls.remove(token);
            remoteAudioUrls.put(token, value);
            remoteAudioHeaders.remove(token);
            if (headers != null && !headers.isEmpty()) remoteAudioHeaders.put(token, new HashMap<>(headers));
            while (remoteAudioUrls.size() > 128) {
                String oldest = remoteAudioUrls.keySet().iterator().next();
                remoteAudioUrls.remove(oldest);
                remoteAudioHeaders.remove(oldest);
            }
        }
        return "http://127.0.0.1:" + localPort + REMOTE_AUDIO_PATH_PREFIX + token;
    }

    /**
     * 把一整首远端音频先下到本地，再返回 `http://127.0.0.1:<port>/downloaded-audio/<token>`。
     *
     * 为什么不像 {@link #registerRemoteAudio} 那样边收边转：YouTube 的音频直链是按**取地址那一刻的
     * 出口 IP** 签发的（sparams 里的 ip 参数），而代理每开一条连接都可能换节点。分片去取时，
     * 第一片往往命中 CDN 缓存能拿到，从第二片起就是 403 —— 手机版此前的"点歌没声音"正是这个。
     * 这里用**一条连接**把整首拉回磁盘，再从本地服务按 Range 喂给 <audio>：
     *   - 下载全程一条连接，出口 IP 不会中途换掉；
     *   - 下载完成后本地文件可随机读，拖进度条、跳播都不用再碰网络；
     *   - 本地服务照样回 CORS 头，WebView 的 crossOrigin 检查过得去。
     */
    synchronized String registerDownloadedAudio(String value, Map<String, String> headers) throws IOException {
        URL url = new URL(value);
        if (!("http".equals(url.getProtocol()) || "https".equals(url.getProtocol()))) {
            throw new IOException("Unsupported audio url");
        }
        int localPort = start();
        String token = downloadedAudioToken(value);
        File directory = downloadedAudioDirectory();
        File target = new File(directory, token + ".m4a");
        if (!target.isFile() || target.length() <= 0) {
            downloadAudio(value, headers, target, token);
        } else {
            Log.i(TAG, "downloaded audio reused: " + token + " (" + target.length() + " bytes)");
        }
        String contentType = downloadedAudioTypes.get(token);
        if (contentType == null || contentType.isEmpty()) contentType = guessMimeType(target.getName());
        synchronized (downloadedAudioFiles) {
            downloadedAudioFiles.remove(token);
            downloadedAudioFiles.put(token, target);
            downloadedAudioTypes.put(token, contentType);
        }
        pruneDownloadedAudio(directory, target);
        return "http://127.0.0.1:" + localPort + DOWNLOADED_AUDIO_PATH_PREFIX + token;
    }

    private File downloadedAudioDirectory() {
        File dir = new File(context.getCacheDir(), DOWNLOADED_AUDIO_DIR);
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    /** 地址的 SHA-1：同一首歌在不同次解析里地址会变（带 expire/sig），同一个地址只下一次。 */
    private static String downloadedAudioToken(String value) throws IOException {
        try {
            java.security.MessageDigest digest = java.security.MessageDigest.getInstance("SHA-1");
            byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(bytes.length * 2);
            for (byte item : bytes) hex.append(String.format(Locale.ROOT, "%02x", item));
            return hex.toString();
        } catch (java.security.NoSuchAlgorithmException error) {
            throw new IOException("SHA-1 unavailable", error);
        }
    }

    private void downloadAudio(String value, Map<String, String> headers, File target, String token) throws IOException {
        Request.Builder request = new Request.Builder().url(value);
        request.header("User-Agent", REMOTE_AUDIO_USER_AGENT);
        if (headers != null) {
            for (Map.Entry<String, String> entry : headers.entrySet()) {
                if (entry.getKey() == null || entry.getValue() == null) continue;
                request.header(entry.getKey(), entry.getValue());
            }
        }
        Request built = request.build();
        if (built.header("Range") == null) request.header("Range", "bytes=0-");
        built = request.build();

        File part = new File(target.getPath() + ".part");
        IOException lastError = null;
        // 同一地址重试几次：CDN 偶发 403/5xx 时有用（出口 IP 换了的情况要靠调用方重新取地址）。
        for (int attempt = 1; attempt <= 3; attempt += 1) {
            Response response = null;
            try {
                response = remoteAudioClient.newCall(built).execute();
                ResponseBody body = response.body();
                if (!response.isSuccessful() || body == null) {
                    lastError = new IOException("audio download failed: HTTP " + response.code());
                    Log.w(TAG, "downloaded audio attempt " + attempt + " -> HTTP " + response.code() + " for " + token);
                    if (attempt < 3) sleepQuietly(300 * attempt);
                    continue;
                }
                String contentType = body.contentType() == null ? "" : body.contentType().toString();
                if (contentType.contains("text/html")) {
                    lastError = new IOException("audio download returned html");
                    if (attempt < 3) sleepQuietly(300 * attempt);
                    continue;
                }
                long total = 0;
                try (InputStream input = body.byteStream();
                     OutputStream output = new BufferedOutputStream(new FileOutputStream(part))) {
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = input.read(buffer)) != -1) {
                        output.write(buffer, 0, read);
                        total += read;
                        if (total > DOWNLOADED_AUDIO_MAX_BYTES) {
                            throw new IOException("audio too large: " + total + " bytes");
                        }
                    }
                }
                if (total <= 0) {
                    lastError = new IOException("audio download is empty");
                    if (attempt < 3) sleepQuietly(300 * attempt);
                    continue;
                }
                if (!part.renameTo(target)) throw new IOException("cannot store audio at " + target);
                synchronized (downloadedAudioFiles) {
                    downloadedAudioTypes.put(token, contentType.isEmpty() ? guessMimeType(target.getName()) : contentType);
                }
                Log.i(TAG, "downloaded audio " + token + " " + total + " bytes type=" + contentType);
                return;
            } catch (IOException error) {
                lastError = error;
                Log.w(TAG, "downloaded audio attempt " + attempt + " failed: " + error.getMessage());
                if (attempt < 3) sleepQuietly(300 * attempt);
            } finally {
                if (response != null) response.close();
            }
        }
        // 没下成就把半截文件丢掉，免得下次被当成"已经有缓存"。
        if (part.isFile() && !part.delete()) Log.w(TAG, "cannot delete partial download " + part);
        IOException cause = lastError == null ? new IOException("audio download failed") : lastError;
        // 403 的成因值得说清楚：直链是按"取地址那一刻的出口 IP"签发的。
        // 这里问一次 googlevideo 自己看到的出口 IP，和直链里的 ip 对一对，一眼能看出是不是代理分流的锅。
        String signedIp = "";
        try {
            signedIp = android.net.Uri.parse(value).getQueryParameter("ip");
        } catch (Exception ignored) {
            signedIp = "";
        }
        String egress = googlevideoEgressIp();
        String detail = "音频直链取不到字节（" + cause.getMessage() + "）";
        if (signedIp != null && !signedIp.isEmpty()) detail += "；直链签给 " + signedIp;
        if (!egress.isEmpty()) detail += "；googlevideo 出口 " + egress;
        if (signedIp != null && !signedIp.isEmpty() && !egress.isEmpty() && !signedIp.equals(egress)) {
            detail += " —— 两个出口不一致，代理把 youtube.com 与 googlevideo.com 走了不同节点";
        } else if (!egress.isEmpty()) {
            detail += " —— 出口一致仍被拒，属于 googlevideo 侧的限流/风控";
        }
        Log.w(TAG, detail);
        throw new IOException(detail, cause);
    }

    /** googlevideo 看到的我们的出口 IP（redirector 的 report_mapping 会把它写回来）。 */
    private String googlevideoEgressIp() {
        try {
            Request request = new Request.Builder()
                .url("https://redirector.googlevideo.com/report_mapping?di=no")
                .header("User-Agent", REMOTE_AUDIO_USER_AGENT)
                .build();
            Response response = remoteAudioClient.newCall(request).execute();
            try {
                ResponseBody body = response.body();
                if (body == null) return "";
                String text = body.string().trim();
                // 形如 "31.59.132.159 => nearoute-hkg1 (31.59.132.0/23)"
                int space = text.indexOf(' ');
                return space > 0 ? text.substring(0, space) : text;
            } finally {
                response.close();
            }
        } catch (Exception error) {
            Log.w(TAG, "googlevideo egress probe failed: " + error.getMessage());
            return "";
        }
    }

    private static void sleepQuietly(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
        }
    }

    /** 缓存别无限长：超过一天的文件先清掉，仍然多于 60 个就按最旧的删。 */
    private void pruneDownloadedAudio(File directory, File keep) {
        File[] files = directory.listFiles();
        if (files == null) return;
        long now = System.currentTimeMillis();
        for (File file : files) {
            if (file.equals(keep)) continue;
            if (now - file.lastModified() > 24L * 60 * 60 * 1000) {
                if (!file.delete()) Log.w(TAG, "cannot prune " + file);
            }
        }
        files = directory.listFiles();
        if (files != null && files.length > 60) {
            java.util.Arrays.sort(files, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
            for (int index = 0; index < files.length - 60; index += 1) {
                if (!files[index].equals(keep) && !files[index].delete()) Log.w(TAG, "cannot prune " + files[index]);
            }
        }
    }

    private void streamDownloadedAudio(
        BufferedOutputStream output,
        String[] requestParts,
        Map<String, String> headers,
        String token
    ) throws IOException {
        File target;
        synchronized (downloadedAudioFiles) {
            target = downloadedAudioFiles.get(token);
        }
        if (target == null) {
            // 进程重启过：token 是按地址算的，磁盘上的同名文件仍然可用。
            File cached = new File(downloadedAudioDirectory(), token + ".m4a");
            if (cached.isFile() && cached.length() > 0) target = cached;
        }
        if (target == null || !target.isFile()) {
            Log.w(TAG, "downloaded audio unknown: " + token);
            writeStatus(output, 404, "Not Found");
            return;
        }
        String contentType;
        synchronized (downloadedAudioFiles) {
            contentType = downloadedAudioTypes.get(token);
        }
        if (contentType == null || contentType.isEmpty()) contentType = guessMimeType(target.getName());
        final File file = target;
        writeResponse(output, requestParts, headers, file.length(), contentType, () -> new FileInputStream(file));
    }

    /** 有些 CDN 看 Referer 决定给不给资源：不带时回的是一段 HTML 而不是音频。 */
    private static String remoteAudioReferer(String value) {
        try {
            String host = new URL(value).getHost();
            if (host != null && (host.equals("music.126.net") || host.endsWith(".music.126.net"))) {
                return NETEASE_REMOTE_AUDIO_REFERER;
            }
        } catch (Exception ignored) {
            return REMOTE_AUDIO_REFERER;
        }
        return REMOTE_AUDIO_REFERER;
    }

    private static boolean isRemoteAudioHostAllowed(String host) {
        if (host.isEmpty()) return false;
        for (String suffix : REMOTE_AUDIO_HOST_SUFFIXES) {
            if (host.equals(suffix) || host.endsWith("." + suffix)) return true;
        }
        return false;
    }

    /** 复制进私有目录的音频存放位置。 */
    File importedAudioDirectory() {
        File dir = new File(context.getFilesDir(), "imported-audio");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    /** 在线壁纸（视频/图片）的存放位置：应用私有目录，卸载才清。 */
    File wallpaperDirectory() {
        File dir = new File(context.getFilesDir(), WALLPAPER_DIR);
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private void handle(Socket socket) {
        try (Socket client = socket;
             BufferedInputStream input = new BufferedInputStream(client.getInputStream());
             BufferedOutputStream output = new BufferedOutputStream(client.getOutputStream())) {
            String requestLine = readLine(input);
            if (requestLine == null) return;
            String[] requestParts = requestLine.split(" ");
            if (requestParts.length < 2) return;

            Map<String, String> headers = new HashMap<>();
            String line;
            while ((line = readLine(input)) != null && !line.isEmpty()) {
                int separator = line.indexOf(':');
                if (separator > 0) {
                    headers.put(
                        line.substring(0, separator).trim().toLowerCase(),
                        line.substring(separator + 1).trim()
                    );
                }
            }

            String path = requestParts[1];
            int query = path.indexOf('?');
            if (query >= 0) path = path.substring(0, query);
            /*
             * 预检（OPTIONS）必须自己答。
             *
             * 跨源请求只要带了 Range 之外的头、或者某些 WebView 版本对 Range 也走预检，
             * 浏览器就会先发一个 OPTIONS —— 服务不答就是 CORS 失败，
             * 而失败的表现和「文件不存在」一模一样（mediaErrorCode=4）。
             * 答一个 204 并放行 Range，探测和播放两条路都才走得通。
             */
            if ("OPTIONS".equals(requestParts[0])) {
                String response = "HTTP/1.1 204 No Content\r\n"
                    + "Access-Control-Allow-Origin: *\r\n"
                    + "Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n"
                    + "Access-Control-Allow-Headers: range, content-range, content-length\r\n"
                    + "Access-Control-Expose-Headers: range, content-range, content-length, accept-ranges\r\n"
                    + "Access-Control-Max-Age: 86400\r\n"
                    + "Content-Length: 0\r\nConnection: close\r\n\r\n";
                output.write(response.getBytes(StandardCharsets.US_ASCII));
                output.flush();
                return;
            }
            if (path.startsWith(DOWNLOADED_AUDIO_PATH_PREFIX)) {
                streamDownloadedAudio(output, requestParts, headers, path.substring(DOWNLOADED_AUDIO_PATH_PREFIX.length()));
                return;
            }
            if (path.startsWith(REMOTE_AUDIO_PATH_PREFIX)) {
                streamRemoteAudio(output, requestParts, headers, path.substring(REMOTE_AUDIO_PATH_PREFIX.length()));
                return;
            }
            if (path.startsWith(WALLPAPER_THUMB_PATH_PREFIX)) {
                streamWallpaperThumb(output, requestParts, path.substring(WALLPAPER_THUMB_PATH_PREFIX.length()));
                return;
            }
            if (path.startsWith(WALLPAPER_PATH_PREFIX)) {
                streamWallpaper(output, requestParts, headers, path.substring(WALLPAPER_PATH_PREFIX.length()));
                return;
            }
            if (!path.startsWith(AUDIO_PATH_PREFIX)) {
                writeStatus(output, 404, "Not Found");
                return;
            }

            String token = URLDecoder.decode(path.substring(AUDIO_PATH_PREFIX.length()), "UTF-8");
            if (token.startsWith(IMPORTED_PREFIX)) {
                /*
                 * 传**完整的** token，别先剥掉 imported- 再拼路径。
                 *
                 * 磁盘上的副本名本身就是 "imported-<稳定名>"（导入那边 safeName 就是这么起的，
                 * 删副本的 resolveImportedFile 也是按完整 ref 拼的），而这里剥掉前缀之后
                 * 拼出来的是 "imported-audio/<稳定名>" —— 少了一段，永远 isFile() == false，
                 * 于是每一首手动导入的歌都回 404：<audio> 报 Format error、
                 * 导入时抓封面和内嵌歌词的那次 fetch 也一起失败（封面/歌词全空）。
                 * 表现正是「扫描导入能播，手动导入一律播不了」。
                 */
                streamImportedFile(output, requestParts, headers, token);
                return;
            }
            if (token.startsWith(FILE_PREFIX)) {
                streamExternalFile(output, requestParts, headers, token.substring(FILE_PREFIX.length()));
                return;
            }
            streamMediaStoreFile(output, requestParts, headers, token);
        } catch (Exception error) {
            // 之前这里连日志都没有：流写到一半断掉，WebView 那边只会报一句
            // Format error，原生侧连发生了什么都不知道。
            Log.w(TAG, "audio request failed", error);
            // 顺带进崩溃诊断：诊断报告里能直接读到 local-audio-server 这条，
            // 不用再让用户去捞 logcat。
            CrashDiagnostics.record(context, "local-audio-server", "server", error);
        }
    }

    private void streamMediaStoreFile(
        BufferedOutputStream output,
        String[] requestParts,
        Map<String, String> headers,
        String mediaId
    ) throws IOException {
        Uri uri = Uri.withAppendedPath(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, mediaId);
        ContentResolver resolver = context.getContentResolver();
        long size = -1;
        String mime = "audio/*";
        try (Cursor cursor = resolver.query(uri, new String[]{
            MediaStore.Audio.Media.SIZE,
            MediaStore.Audio.Media.MIME_TYPE
        }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                size = cursor.getLong(0);
                String queriedMime = cursor.getString(1);
                if (queriedMime != null && !queriedMime.isEmpty()) mime = queriedMime;
            }
        }
        writeResponse(output, requestParts, headers, size, mime, () -> resolver.openInputStream(uri));
    }

    private void streamImportedFile(
        BufferedOutputStream output,
        String[] requestParts,
        Map<String, String> headers,
        String fileName
    ) throws IOException {
        // 现在传进来的是完整文件名（含 imported- 前缀）。这个服务监听在 127.0.0.1 上，
        // 设备上任何应用都能连，名字来自 URL，必须挡掉路径穿越。
        if (fileName.contains("/") || fileName.contains("\\") || fileName.contains("..")) {
            Log.w(TAG, "imported audio refused: " + fileName);
            writeStatus(output, 404, "Not Found");
            return;
        }
        File target = new File(importedAudioDirectory(), fileName);
        if (!target.isFile()) {
            Log.w(TAG, "imported audio missing: " + fileName);
            writeStatus(output, 404, "Not Found");
            return;
        }
        writeResponse(
            output,
            requestParts,
            headers,
            target.length(),
            guessMimeType(fileName),
            () -> new FileInputStream(target)
        );
    }

    /**
     * 按文件名流一张在线壁纸（视频或图片）。
     *
     * 和 imported-audio 一样只认私有目录里的一层文件名：这个服务监听在 127.0.0.1 上，
     * 设备上任何应用都能连，名字来自 URL，必须挡掉路径穿越。
     */
    private void streamWallpaper(
        BufferedOutputStream output,
        String[] requestParts,
        Map<String, String> headers,
        String fileName
    ) throws IOException {
        if (fileName.contains("/") || fileName.contains("\\") || fileName.contains("..")) {
            Log.w(TAG, "wallpaper refused: " + fileName);
            writeStatus(output, 404, "Not Found");
            return;
        }
        File target = new File(wallpaperDirectory(), fileName);
        if (!target.isFile()) {
            Log.w(TAG, "wallpaper missing: " + fileName);
            writeStatus(output, 404, "Not Found");
            return;
        }
        writeResponse(
            output,
            requestParts,
            headers,
            target.length(),
            guessWallpaperMime(fileName),
            () -> new FileInputStream(target)
        );
    }

    /**
     * 代取在线壁纸的缩略图。
     *
     * 两个壁纸站的图片都按 Referer 防盗链，而 WebView 里的 <img> 加不了请求头 ——
     * 直连的结果就是整页卡片「没有图」。这里由原生带 UA/Referer 取回来再以同源地址喂给页面。
     * 只放行壁纸站与它们的图床，避免这个名字变成一个任取全网的代理。
     */
    private void streamWallpaperThumb(BufferedOutputStream output, String[] requestParts, String encodedUrl) throws IOException {
        String raw;
        try {
            raw = URLDecoder.decode(encodedUrl, "UTF-8");
        } catch (Exception error) {
            writeStatus(output, 400, "Bad Request");
            return;
        }
        URL url;
        try {
            url = new URL(raw);
        } catch (Exception error) {
            writeStatus(output, 400, "Bad Request");
            return;
        }
        String host = url.getHost() == null ? "" : url.getHost().toLowerCase(Locale.ROOT);
        boolean allowed = false;
        for (String suffix : WALLPAPER_THUMB_HOST_SUFFIXES) {
            if (host.equals(suffix) || host.endsWith("." + suffix)) {
                allowed = true;
                break;
            }
        }
        if (!allowed || !("http".equals(url.getProtocol()) || "https".equals(url.getProtocol()))) {
            Log.w(TAG, "wallpaper thumb refused: " + host);
            writeStatus(output, 404, "Not Found");
            return;
        }

        boolean moewalls = host.endsWith("moewalls.com");
        Request request = new Request.Builder()
            .url(raw)
            .header("User-Agent", REMOTE_AUDIO_USER_AGENT)
            .header("Referer", moewalls ? "https://moewalls.com/" : "https://www.bizhihui.com/")
            .header("Accept", "image/avif,image/webp,image/*,*/*;q=0.8")
            .build();
        Response response = remoteAudioClient.newCall(request).execute();
        try {
            ResponseBody body = response.body();
            if (!response.isSuccessful() || body == null) {
                Log.w(TAG, "wallpaper thumb upstream " + response.code() + " for " + host);
                writeStatus(output, 502, "Upstream Error");
                return;
            }
            if (body.contentLength() > WALLPAPER_THUMB_MAX_BYTES) {
                writeStatus(output, 413, "Too Large");
                return;
            }
            byte[] bytes = body.bytes();
            if (bytes.length == 0 || bytes.length > WALLPAPER_THUMB_MAX_BYTES) {
                writeStatus(output, 404, "Not Found");
                return;
            }
            String contentType = body.contentType() == null ? "image/jpeg" : body.contentType().toString();
            StringBuilder header = new StringBuilder();
            header.append("HTTP/1.1 200 OK\r\n");
            header.append("Content-Type: ").append(contentType).append("\r\n");
            header.append("Content-Length: ").append(bytes.length).append("\r\n");
            header.append("Access-Control-Allow-Origin: *\r\n");
            header.append("Cache-Control: max-age=86400\r\n");
            header.append("Connection: close\r\n\r\n");
            output.write(header.toString().getBytes(StandardCharsets.US_ASCII));
            if (!"HEAD".equals(requestParts[0])) output.write(bytes);
            output.flush();
        } finally {
            response.close();
        }
    }

    /** 壁纸按扩展名给 Content-Type：WebView 只认这几个媒体类型。 */
    static String guessWallpaperMime(String fileName) {
        String lower = fileName == null ? "" : fileName.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".webm")) return "video/webm";
        if (lower.endsWith(".mov")) return "video/quicktime";
        if (lower.endsWith(".mkv")) return "video/x-matroska";
        if (lower.endsWith(".mp4") || lower.endsWith(".m4v")) return "video/mp4";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".avif")) return "image/avif";
        if (lower.endsWith(".bmp")) return "image/bmp";
        return "image/jpeg";
    }

    /**
     * 按绝对路径流用户自己的音频（文件系统兜底扫描的歌）。
     *
     * 只放行外存根目录下的音频文件，别的一律 404 —— 这个服务监听在 127.0.0.1 上，
     * 设备上任何应用都能连上来，不能让它变成一个任读全盘的口子。
     * 走这条路的歌要求已授予「所有文件访问」，没授权时读流会自己失败。
     */
    private void streamExternalFile(
        BufferedOutputStream output,
        String[] requestParts,
        Map<String, String> headers,
        String encodedPath
    ) throws IOException {
        String filePath = URLDecoder.decode(encodedPath, "UTF-8");
        File target = new File(filePath);
        File root = Environment.getExternalStorageDirectory();
        boolean insideRoot = root != null && filePath.startsWith(root.getPath() + File.separator);
        if (!insideRoot || !target.isFile() || !isAudioFileName(filePath)) {
            Log.w(TAG, "external audio refused: " + filePath);
            writeStatus(output, 404, "Not Found");
            return;
        }
        writeResponse(
            output,
            requestParts,
            headers,
            target.length(),
            guessMimeType(filePath),
            () -> new FileInputStream(target)
        );
    }

    /**
     * 代转发一个远端音频（只有白名单主机能用，见 {@link #registerRemoteAudio}）。
     *
     * Range 原样往上带：拖进度条时 <audio> 会发 `bytes=xxx-`，上游回 206，
     * 我们也要回 206 并把它的 Content-Range 转给 WebView，否则播放器会认为
     * 服务端不支持拖动，重新整首下载一次。
     */
    private void streamRemoteAudio(
        BufferedOutputStream output,
        String[] requestParts,
        Map<String, String> headers,
        String token
    ) throws IOException {
        String target;
        synchronized (remoteAudioUrls) {
            target = remoteAudioUrls.get(token);
        }
        if (target == null) {
            Log.w(TAG, "remote audio token unknown: " + token);
            writeStatus(output, 404, "Not Found");
            return;
        }

        Map<String, String> extraHeaders;
        synchronized (remoteAudioUrls) {
            extraHeaders = remoteAudioHeaders.get(token);
        }
        Request.Builder request = new Request.Builder().url(target);
        // 有些 CDN 看 UA / Referer 决定给不给资源，不带的话会回一段 HTML 而不是音频
        // —— 那种回包喂进 <audio> 正是「Format error」的经典来源。
        request.header("User-Agent", REMOTE_AUDIO_USER_AGENT);
        request.header("Referer", remoteAudioReferer(target));
        // 调用方带来的头（飞牛的 music-token）最后写：同名的以它为准。
        if (extraHeaders != null) {
            for (Map.Entry<String, String> entry : extraHeaders.entrySet()) {
                request.header(entry.getKey(), entry.getValue());
            }
        }
        String range = headers.get("range");
        if (range != null && range.startsWith("bytes=")) request.header("Range", range);

        Response upstream = remoteAudioClient.newCall(request.build()).execute();
        try {
            ResponseBody body = upstream.body();
            if (!upstream.isSuccessful() || body == null) {
                Log.w(TAG, "remote audio upstream " + upstream.code() + " for " + target);
                writeStatus(output, 502, "Upstream Error");
                return;
            }
            String contentType = body.contentType() != null ? body.contentType().toString() : "audio/mpeg";
            String contentRange = upstream.header("Content-Range");
            long size = body.contentLength();
            // 上游不给长度（chunked）时，拿 Content-Range 里的 total 兜底。
            if (size < 0 && contentRange != null) {
                int slash = contentRange.indexOf('/');
                if (slash >= 0 && slash + 1 < contentRange.length()) {
                    try {
                        size = Long.parseLong(contentRange.substring(slash + 1).trim());
                    } catch (NumberFormatException ignored) {
                        size = -1;
                    }
                }
            }
            boolean partial = upstream.code() == 206 || contentRange != null;

            Log.i(TAG, "remote " + target + " -> " + upstream.code()
                + " type=" + contentType + " size=" + size + " range=" + (contentRange == null ? "-" : contentRange));

            StringBuilder response = new StringBuilder();
            response.append(partial ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n");
            response.append("Content-Type: ").append(contentType).append("\r\n");
            response.append("Accept-Ranges: bytes\r\n");
            // 这一整条链路存在的唯一理由就是同源：没有这两行，<audio crossOrigin="anonymous">
            // 依然会被 CORS 挡在门外，和直连 CDN 没区别。
            response.append("Access-Control-Allow-Origin: *\r\n");
            response.append("Access-Control-Allow-Headers: range, content-range, content-length\r\n");
            response.append("Access-Control-Expose-Headers: range, content-range, content-length, accept-ranges\r\n");
            response.append("Connection: close\r\n");
            if (size >= 0) {
                response.append("Content-Length: ").append(size).append("\r\n");
                if (contentRange != null) {
                    response.append("Content-Range: ").append(contentRange).append("\r\n");
                }
            }
            response.append("\r\n");
            output.write(response.toString().getBytes(StandardCharsets.US_ASCII));

            if ("GET".equals(requestParts[0])) {
                try (InputStream audio = body.byteStream()) {
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = audio.read(buffer)) != -1) {
                        output.write(buffer, 0, read);
                    }
                }
            }
            output.flush();
        } finally {
            upstream.close();
        }
    }

    private interface StreamSupplier {
        InputStream open() throws IOException;
    }

    private void writeResponse(
        BufferedOutputStream output,
        String[] requestParts,
        Map<String, String> headers,
        long size,
        String mime,
        StreamSupplier supplier
    ) throws IOException {
        // 空文件喂给 <audio> 只会换来一句莫名的 MEDIA_ELEMENT_ERROR: Format error；
        // 这里直接 404 并把原因写进日志，下次一眼就能看出是"文件是空的"。
        if (size <= 0) {
            Log.w(TAG, "audio source is empty or unreadable (size=" + size + "): " + requestParts[1]);
            writeStatus(output, 404, "Empty Audio");
            return;
        }
        long start = 0;
        long end = size > 0 ? size - 1 : -1;
        String range = headers.get("range");
        boolean partial = false;
        if (range != null && range.startsWith("bytes=")) {
            String[] parts = range.substring(6).split("-", -1);
            try {
                if (!parts[0].isEmpty()) start = Long.parseLong(parts[0]);
                if (parts.length > 1 && !parts[1].isEmpty()) end = Long.parseLong(parts[1]);
                if (size > 0) end = Math.min(end, size - 1);
                partial = true;
            } catch (NumberFormatException ignored) {
                start = 0;
                end = size > 0 ? size - 1 : -1;
                partial = false;
            }
        }

        long contentLength = end >= start ? end - start + 1 : -1;
        Log.i(TAG, requestParts[0] + " " + requestParts[1]
            + " range=" + (range == null ? "-" : range)
            + " size=" + size + " partial=" + partial
            + (partial ? " bytes=" + start + "-" + end : ""));
        StringBuilder response = new StringBuilder();
        response.append(partial ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n");
        response.append("Content-Type: ").append(mime).append("\r\n");
        response.append("Accept-Ranges: bytes\r\n");
        response.append("Access-Control-Allow-Origin: *\r\n");
        // crossOrigin="anonymous" 的 <audio> 会带 CORS 语义，把 Range 相关头暴露出来，
        // 拖进度条（发 Range、读 Content-Range）才不会在 CORS 检查上被拦。
        response.append("Access-Control-Allow-Headers: range, content-range, content-length\r\n");
        response.append("Access-Control-Expose-Headers: range, content-range, content-length, accept-ranges\r\n");
        response.append("Connection: close\r\n");
        if (size > 0) {
            response.append("Content-Length: ").append(contentLength).append("\r\n");
            if (partial) {
                response.append("Content-Range: bytes ")
                    .append(start).append('-').append(end).append('/').append(size).append("\r\n");
            }
        }
        response.append("\r\n");
        output.write(response.toString().getBytes(StandardCharsets.US_ASCII));

        // HEAD 只回头部：<audio> 在真正下载前会先探一次，那时不能把整首歌读一遍。
        if ("GET".equals(requestParts[0])) {
            try (InputStream audio = supplier.open()) {
                if (audio != null) {
                    skipFully(audio, start);
                    byte[] buffer = new byte[64 * 1024];
                    long remaining = contentLength;
                    int read;
                    while ((read = audio.read(buffer)) != -1 && (remaining < 0 || remaining > 0)) {
                        int writeLength = remaining < 0 ? read : (int) Math.min(read, remaining);
                        output.write(buffer, 0, writeLength);
                        if (remaining > 0) remaining -= writeLength;
                    }
                }
            }
        }
        output.flush();
    }

    /**
     * InputStream.skip 不保证一次跳够（它爱跳多少跳多少），文件流上偶尔也会短跳。
     * 之前直接一个 skip 了事，短跳时从错误的位置开始发 —— 解码器读到的就是一段
     * 被错位的数据，表现正是「MEDIA_ELEMENT_ERROR: Format error」这类莫名失败。
     */
    private static void skipFully(InputStream audio, long bytes) throws IOException {
        long remaining = bytes;
        while (remaining > 0) {
            long skipped = audio.skip(remaining);
            if (skipped <= 0) {
                // skip 返回 0 只能靠读来推进（可能已经到头）。
                if (audio.read() == -1) return;
                skipped = 1;
            }
            remaining -= skipped;
        }
    }

    /** 路径是不是设备上常见的音频扩展名（文件系统兜底扫描与 file- 路由共用）。 */
    static boolean isAudioFileName(String fileName) {
        String lower = fileName == null ? "" : fileName.toLowerCase();
        return lower.endsWith(".mp3") || lower.endsWith(".flac") || lower.endsWith(".wav")
            || lower.endsWith(".m4a") || lower.endsWith(".aac") || lower.endsWith(".ogg")
            || lower.endsWith(".opus") || lower.endsWith(".ape") || lower.endsWith(".wma");
    }

    static String guessMimeType(String fileName) {
        String lower = fileName == null ? "" : fileName.toLowerCase();
        if (lower.endsWith(".flac")) return "audio/flac";
        if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";
        if (lower.endsWith(".wav")) return "audio/wav";
        if (lower.endsWith(".ogg") || lower.endsWith(".oga")) return "audio/ogg";
        if (lower.endsWith(".opus")) return "audio/opus";
        if (lower.endsWith(".aac")) return "audio/aac";
        if (lower.endsWith(".ape")) return "audio/ape";
        if (lower.endsWith(".wma")) return "audio/x-ms-wma";
        return "audio/mpeg";
    }

    private static String readLine(InputStream input) throws IOException {
        StringBuilder line = new StringBuilder();
        int value;
        while ((value = input.read()) != -1) {
            if (value == '\n') break;
            if (value != '\r') line.append((char) value);
        }
        return value == -1 && line.length() == 0 ? null : line.toString();
    }

    /**
     * 错误响应也一定要带 CORS 头。
     *
     * <audio> 带 crossOrigin="anonymous"，响应缺 Access-Control-Allow-Origin 时，
     * 浏览器把「CORS 被拒」和「文件不存在 / 空文件」报成一模一样的东西：
     * networkState=3、mediaErrorCode=4（MEDIA_ERR_SRC_NOT_SUPPORTED）——
     * 也就是那句毫无特征的 MEDIA_ELEMENT_ERROR: Format error。
     * 带上 ACAO 之后，上层用 fetch 探一次就能读到真实的 404/502，不用再猜。
     */
    private static void writeStatus(OutputStream output, int status, String message) throws IOException {
        String response = "HTTP/1.1 " + status + " " + message + "\r\n"
            + "Content-Type: text/plain\r\n"
            + "Content-Length: 0\r\n"
            + "Access-Control-Allow-Origin: *\r\n"
            + "Access-Control-Allow-Headers: range, content-range, content-length\r\n"
            + "Access-Control-Expose-Headers: range, content-range, content-length, accept-ranges\r\n"
            + "Connection: close\r\n\r\n";
        output.write(response.getBytes(StandardCharsets.US_ASCII));
        output.flush();
    }
}
