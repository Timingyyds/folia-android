package top.izuna.foliamajor;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.content.Intent;
import android.net.wifi.WifiManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.content.Context;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;

import androidx.annotation.Nullable;

import java.io.InputStream;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

import org.json.JSONObject;

import top.izuna.foliamajor.coloros.ColorOsLyricBridge;

public class FoliaPlaybackService extends Service {
    private static final String CHANNEL_ID = "folia_playback";
    private static final int NOTIFICATION_ID = 31009;
    public static final String ACTION_REFRESH_METADATA = "top.izuna.foliamajor.action.REFRESH_METADATA";
    private MediaSession mediaSession;
    private final ExecutorService artworkExecutor = Executors.newSingleThreadExecutor();
    private final OkHttpClient artworkClient = new OkHttpClient();
    private final Map<String, Bitmap> artworkCache = new ConcurrentHashMap<>();
    /**
     * 封面磁盘缓存目录。
     *
     * 内存缓存只在服务活着时有用：服务被系统回收后重启，锁屏那块就只剩一片空白，
     * 直到网络把图再下一次 —— 而这正好是「锁屏不显示封面」最常见的现场。
     * 落到 app 私有目录后，重启即有图，离线也有图。
     */
    private java.io.File artworkDiskDir;
    /**
     * 写进 MediaSession 的封面上限。
     *
     * 系统对塞进 metadata 的 Bitmap 有 Binder 事务大小限制（1 MB 左右），
     * 一张 3000x3000 的封面直接 putBitmap 会让 setMetadata 抛 TransactionTooLarge，
     * 表现就是「歌词和歌名都对，就是没有封面」。所以先缩到这个边长，再写一次。
     */
    private static final int ARTWORK_MAX_EDGE = 1024;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private volatile String currentArtworkUrl = "";
    private volatile String appliedArtworkUrl = "";
    private volatile Bitmap appliedArtworkBitmap = null;
    private volatile String lastRequestedCoverUrl = "";
    private volatile String cachedTitle = "";
    private volatile String cachedArtist = "";
    private volatile String cachedAlbum = "";
    private volatile String cachedCoverUrl = "";
    private volatile String cachedSongKey = "";
    private volatile long cachedDurationMs = 0L;
    private volatile long cachedPositionMs = 0L;
    private volatile boolean cachedPlaying = false;
    private static volatile boolean running = false;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private static volatile String powerDiagnostic = "inactive";
    private static final long SERVICE_HEARTBEAT_INTERVAL_MS = 10_000L;
    /**
     * `service-start` 的重复记录间隔。前台服务每次收到播放状态推送都会走一遍 `onStartCommand`，
     * 崩溃历史只留 20 条，不节流的话这些重复记录会把真正的退出原因挤掉。
     */
    private static final long SERVICE_START_RECORD_INTERVAL_MS = 5_000L;
    private volatile boolean lastPlaying = false;
    private volatile long lastServiceStartRecordAt = 0L;
    private volatile boolean lastServiceStartPlaying = false;
    private volatile String lastServiceStartSongKey = "";
    /**
     * 通知正文的刷新节拍：只在播放中跑，且只在「当前那一行真的变了」时才 notify。
     *
     * 为什么不能靠播放状态推送：歌词行的推进不是一次 state 变化，它每秒都在动，
     * 而每次推送都会走一遍 startForeground。所以这里自己按秒查一次当前行，
     * 变了才 notify —— 不变就完全不碰，通知栏不会闪。
     */
    private static final long LYRIC_TICK_INTERVAL_MS = 1_000L;
    private volatile String lastDrawnLyricLine = "";
    private final Runnable lyricTickRunnable = new Runnable() {
        @Override
        public void run() {
            try {
                if (cachedPlaying && running) {
                    String line = ColorOsLyricBridge.currentLineFor(cachedSongKey, cachedPositionMs);
                    String next = line == null ? "" : line;
                    if (!next.equals(lastDrawnLyricLine)) {
                        lastDrawnLyricLine = next;
                        NotificationManager manager = getSystemService(NotificationManager.class);
                        if (manager != null) {
                            // notify=false 的语义这里用不上：这是整条通知的重建，
                            // 但 setOnlyAlertOnce 保证它不会响铃也不会弹横幅。
                            manager.notify(
                                NOTIFICATION_ID,
                                buildNotification(cachedTitle, cachedArtist, cachedPlaying, appliedArtworkBitmap)
                            );
                        }
                    }
                }
            } catch (Throwable ignored) {
                // 刷新失败什么也不做：下一拍再来。
            }
            mainHandler.postDelayed(this, LYRIC_TICK_INTERVAL_MS);
        }
    };

    private final Runnable serviceHeartbeatRunnable = new Runnable() {
        @Override
        public void run() {
            recordServiceHeartbeat();
            mainHandler.postDelayed(this, SERVICE_HEARTBEAT_INTERVAL_MS);
        }
    };

    /**
     * 音频焦点：本服务**不申请、也不重夺**。声音是 WebView 里的 Chromium 放的，它自己有
     * AudioFocusDelegate 管焦点；同一 App 里再有人申请 AUDIOFOCUS_GAIN，就等于把焦点从
     * 它手里抢走，而 Chromium **一收到焦点丢失就暂停 {@code <audio>}**。
     *
     * 2026-10-30 在真机 logcat 上抓到的完整因果链（用户点播放后约 1.9 秒歌自己停了）：
     * <pre>
     * 22:49:00.223  requestAudioFocus()  from ...chromium.content.browser.AudioFocusDelegate   ← 播放开始，Chromium 要焦点
     * 22:49:00.243  dispatching onAudioFocusChange(-1)  → FoliaPlaybackService                ← 本服务收到 LOSS
     * 22:49:00.944  requestAudioFocus()  from ...FoliaPlaybackService                         ← 监听器 700ms 后回抢
     * 22:49:00.946  dispatching onAudioFocusChange(-1)  → ...AudioFocusDelegate                ← Chromium 被夺走焦点
     * 22:49:00.947  abandonAudioFocus()  from ...AudioFocusDelegate                           ← Chromium 放掉焦点并暂停播放
     * </pre>
     *
     * 也就是说：本服务每夺一次焦点，Chromium 就暂停一次歌——「播两秒就停、再点才好」正是这么来的。
     * AUDIOFOCUS_GAIN 是独占的，「歌曲永不让位」在 WebView 播放的前提下根本做不到，两边只会互抢。
     * 所以这里彻底不碰焦点，让 Chromium 按 Android 的标准行为处理（别的 App 放声音时它会正常暂停）。
     * 不要为了「不让位」把 requestAudioFocus 加回来。
     */

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        // 封面磁盘缓存目录：app 私有目录下，不用权限，也不会被当媒体扫描。
        artworkDiskDir = new java.io.File(getCacheDir(), "playback-artwork");
        createNotificationChannel();
        // 通知栏歌词的节拍：每秒查一次当前行，变了才重画通知。
        mainHandler.postDelayed(lyricTickRunnable, LYRIC_TICK_INTERVAL_MS);
        mediaSession = new MediaSession(this, "FoliaPlayback");
        // 音频焦点交给 WebView 里的 Chromium 自己管，本服务不申请（原因见上面那段注释）。

mediaSession.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { emit("play"); }
            @Override public void onPause() { emit("pause"); }
            @Override public void onSkipToNext() { emit("next"); }
            @Override public void onSkipToPrevious() { emit("previous"); }
            @Override public void onStop() { emit("stop"); }
            @Override public void onSeekTo(long pos) { emit("seek:" + pos); }
        });
        mediaSession.setActive(true);
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        if (powerManager != null) {
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Folia:Playback");
            wakeLock.setReferenceCounted(false);
        }
        WifiManager wifiManager = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
        if (wifiManager != null) {
            int lockMode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
            wifiLock = wifiManager.createWifiLock(lockMode, "Folia:Playback");
            wifiLock.setReferenceCounted(false);
        }
        recordServiceLifecycle("service-create", "Foreground playback service created");
        mainHandler.post(serviceHeartbeatRunnable);
    }

    /** ColorOS lyric bridge uses this to decide whether a metadata refresh intent is worth sending. */
    public static boolean isRunning() {
        return running;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || "clear".equals(intent.getAction())) {
            recordServiceLifecycle("service-stop-command", "Stop command received");
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_REFRESH_METADATA.equals(intent.getAction())) {
            applyCachedMetadata();
            return START_STICKY;
        }

        cachedTitle = intent.getStringExtra("title");
        cachedArtist = intent.getStringExtra("artist");
        cachedAlbum = intent.getStringExtra("album");
        cachedCoverUrl = intent.getStringExtra("coverUrl");
        cachedSongKey = intent.getStringExtra("songKey");
        cachedPlaying = intent.getBooleanExtra("playing", false);
        cachedPositionMs = intent.getLongExtra("position", 0);
        cachedDurationMs = intent.getLongExtra("duration", 0);
        if (cachedTitle == null) cachedTitle = "";
        if (cachedArtist == null) cachedArtist = "";
        if (cachedAlbum == null) cachedAlbum = "";
        if (cachedCoverUrl == null) cachedCoverUrl = "";
        if (cachedSongKey == null) cachedSongKey = "";
        lastPlaying = cachedPlaying;
        recordServiceStartIfNoteworthy();
        currentArtworkUrl = cachedCoverUrl.trim();
        Bitmap retainedArtwork = appliedArtworkBitmap;
        if (currentArtworkUrl.isEmpty()) {
            appliedArtworkUrl = "";
            appliedArtworkBitmap = null;
            retainedArtwork = null;
        }
        if (!currentArtworkUrl.equals(lastRequestedCoverUrl)) {
            lastRequestedCoverUrl = currentArtworkUrl;
            FoliaCorePlugin.notePlaybackArtwork(
                currentArtworkUrl,
                currentArtworkUrl.isEmpty() ? "none" : "queued",
                ""
            );
        }

        // The notification goes on right below via startForeground; building it twice here was
        // one of the two writes per start command (the other is the lifecycle record).
        applyCachedMetadata(false);
        FoliaCorePlugin.notePlaybackArtworkApplied(retainedArtwork != null);

        Notification notification = buildNotification(cachedTitle, cachedArtist, cachedPlaying, retainedArtwork);
        startForeground(NOTIFICATION_ID, notification);
        updatePlaybackLocks(cachedPlaying);
        String requestedCover = currentArtworkUrl;
        loadArtwork(requestedCover, bitmap -> {
            if (!requestedCover.equals(currentArtworkUrl)) return;
            mediaSession.setMetadata(buildMetadata(cachedTitle, cachedArtist, cachedAlbum, cachedDurationMs, bitmap, cachedCoverUrl, cachedSongKey));
            FoliaCorePlugin.notePlaybackArtworkApplied(bitmap != null);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.notify(NOTIFICATION_ID, buildNotification(cachedTitle, cachedArtist, cachedPlaying, bitmap));
            }
        });
        return START_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        CrashDiagnostics.recordText(
            getApplicationContext(),
            "activity-lifecycle",
            "service",
            "task-removed",
            "Task removed from recents",
            "FoliaPlaybackService.onTaskRemoved"
        );
        super.onTaskRemoved(rootIntent);
    }

    private MediaMetadata buildMetadata(
        String title,
        String artist,
        String album,
        long duration,
        Bitmap artwork,
        String coverUrl,
        String songKey
    ) {
        MediaMetadata.Builder metadata = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title == null ? "Folia" : title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist == null ? "" : artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, album == null ? "" : album)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, duration);
        if (artwork == null && coverUrl != null && !coverUrl.isEmpty()) {
            metadata.putString(MediaMetadata.METADATA_KEY_ART_URI, coverUrl);
            metadata.putString(MediaMetadata.METADATA_KEY_ALBUM_ART_URI, coverUrl);
        }
        if (artwork != null) {
            metadata.putBitmap(MediaMetadata.METADATA_KEY_ART, artwork);
            metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork);
        }
        ColorOsLyricBridge.attach(metadata, songKey);
        return metadata.build();
    }

    private void applyCachedMetadata() {
        applyCachedMetadata(true);
    }

    /** `notify=false`：紧接着就要 `startForeground` 的路径，不再重复构建一次通知。 */
    private void applyCachedMetadata(boolean notify) {
        if (mediaSession == null) return;
        Bitmap retained = appliedArtworkBitmap;
        mediaSession.setMetadata(buildMetadata(
            cachedTitle,
            cachedArtist,
            cachedAlbum,
            cachedDurationMs,
            retained,
            cachedCoverUrl,
            cachedSongKey
        ));
        mediaSession.setPlaybackState(buildPlaybackState(cachedPlaying, cachedPositionMs, cachedSongKey));
        if (notify) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null && running) {
                manager.notify(NOTIFICATION_ID, buildNotification(cachedTitle, cachedArtist, cachedPlaying, retained));
            }
        }
    }

    private PlaybackState buildPlaybackState(boolean playing, long position, String songKey) {
        PlaybackState.Builder builder = new PlaybackState.Builder()
            .setActions(
                PlaybackState.ACTION_PLAY
                    | PlaybackState.ACTION_PAUSE
                    | PlaybackState.ACTION_PLAY_PAUSE
                    | PlaybackState.ACTION_SKIP_TO_NEXT
                    | PlaybackState.ACTION_SKIP_TO_PREVIOUS
                    | PlaybackState.ACTION_SEEK_TO
            )
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, position, playing ? 1f : 0f);
        if (ColorOsLyricBridge.hasTranslationFor(songKey)) {
            builder.addCustomAction(new PlaybackState.CustomAction.Builder(
                ColorOsLyricBridge.ACTION_TOGGLE_TRANSLATION,
                "翻译",
                translationActionIcon()
            ).build());
        }
        return builder.build();
    }

    private int translationActionIcon() {
        int icon = getApplicationInfo().icon;
        return icon != 0 ? icon : android.R.drawable.ic_menu_info_details;
    }

    private Notification buildNotification(
        String title,
        String artist,
        boolean playing,
        Bitmap artwork
    ) {
        Intent activityIntent = new Intent(this, MainActivity.class);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            activityIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        int playPauseIcon = playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play;
        PendingIntent playPauseIntent = PendingIntent.getBroadcast(
            this,
            1,
            new Intent(this, PlaybackActionReceiver.class).setAction(playing ? "pause" : "play"),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        PendingIntent previousIntent = PendingIntent.getBroadcast(
            this,
            2,
            new Intent(this, PlaybackActionReceiver.class).setAction("previous"),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        PendingIntent nextIntent = PendingIntent.getBroadcast(
            this,
            3,
            new Intent(this, PlaybackActionReceiver.class).setAction("next"),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        // 通知正文优先放当前那一行歌词，没有歌词才退回歌手名：
        // 这正是「通知栏歌词」的落点 —— 系统和厂商岛可能另读 metadata，
        // 但通知本身得先有一个显示词的地方。
        String lyricLine = ColorOsLyricBridge.currentLineFor(cachedSongKey, cachedPositionMs);
        String contentText = artist == null ? "" : artist;
        if (lyricLine != null && !lyricLine.trim().isEmpty()) {
            contentText = lyricLine;
        }
        Notification.Builder builder = new Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(title == null ? "Folia" : title)
            .setContentText(contentText)
            .setContentIntent(contentIntent)
            .setOnlyAlertOnce(true)
            .setOngoing(playing)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(android.R.drawable.ic_media_previous, "Previous", previousIntent)
            .addAction(playPauseIcon, playing ? "Pause" : "Play", playPauseIntent)
            .addAction(android.R.drawable.ic_media_next, "Next", nextIntent)
            .setStyle(new Notification.MediaStyle()
                .setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2));
        if (artwork != null) builder.setLargeIcon(artwork);
        return builder.build();
    }

    /** 封面在磁盘上的文件：URL 的 hash 做名，换 URL 就是换文件。 */
    private java.io.File artworkFileFor(String url) {
        if (artworkDiskDir == null) return null;
        String name = Integer.toHexString(url.hashCode()) + "-" + url.length() + ".img";
        return new java.io.File(artworkDiskDir, name);
    }

    /** 读磁盘缓存；读到就解成 Bitmap，坏文件顺手删掉。 */
    private Bitmap readArtworkFromDisk(String url) {
        java.io.File file = artworkFileFor(url);
        if (file == null || !file.isFile() || file.length() == 0) return null;
        try (java.io.InputStream input = new java.io.FileInputStream(file)) {
            Bitmap bitmap = BitmapFactory.decodeStream(input);
            if (bitmap == null) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
                return null;
            }
            return scaleArtwork(bitmap);
        } catch (Throwable error) {
            return null;
        }
    }

    private void writeArtworkToDisk(String url, Bitmap bitmap) {
        java.io.File file = artworkFileFor(url);
        if (file == null || bitmap == null) return;
        try {
            if (!artworkDiskDir.isDirectory() && !artworkDiskDir.mkdirs()) return;
            try (java.io.OutputStream output = new java.io.FileOutputStream(file)) {
                // PNG 而不是 JPEG：JPEG 丢掉 alpha，某些封面图（圆角/透明）会黑一块。
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, output);
            }
        } catch (Throwable ignored) {
            // 磁盘写失败不影响本次显示，下次再来。
        }
    }

    /**
     * 把封面缩到 ARTWORK_MAX_EDGE 以内：Binder 事务装不下大图，
     * 系统那边只会当作「没有封面」。等比缩放，小图不动。
     */
    private Bitmap scaleArtwork(Bitmap bitmap) {
        if (bitmap == null) return null;
        int width = bitmap.getWidth();
        int height = bitmap.getHeight();
        int longest = Math.max(width, height);
        if (longest <= ARTWORK_MAX_EDGE) return bitmap;
        float ratio = (float) ARTWORK_MAX_EDGE / (float) longest;
        int targetWidth = Math.max(1, Math.round(width * ratio));
        int targetHeight = Math.max(1, Math.round(height * ratio));
        return Bitmap.createScaledBitmap(bitmap, targetWidth, targetHeight, true);
    }

    private void loadArtwork(String value, ArtworkCallback callback) {
        if (value == null || value.isEmpty()) return;
        if (value.equals(appliedArtworkUrl)) return;
        Bitmap cached = artworkCache.get(value);
        if (cached != null) {
            mainHandler.post(() -> {
                if (value.equals(currentArtworkUrl)) {
                    appliedArtworkUrl = value;
                    appliedArtworkBitmap = cached;
                    FoliaCorePlugin.notePlaybackArtwork(
                        value,
                        "loaded",
                        "cached " + cached.getWidth() + "x" + cached.getHeight()
                    );
                }
                callback.onLoaded(cached);
            });
            return;
        }
        // 内存里没有就查磁盘：服务刚重启、或者网络还没通的时候，图就来自这里。
        Bitmap fromDisk = readArtworkFromDisk(value);
        if (fromDisk != null) {
            artworkCache.put(value, fromDisk);
            mainHandler.post(() -> {
                if (value.equals(currentArtworkUrl)) {
                    appliedArtworkUrl = value;
                    appliedArtworkBitmap = fromDisk;
                    FoliaCorePlugin.notePlaybackArtwork(
                        value,
                        "loaded",
                        "disk " + fromDisk.getWidth() + "x" + fromDisk.getHeight()
                    );
                }
                callback.onLoaded(fromDisk);
            });
            return;
        }
        if (!(value.startsWith("http://") || value.startsWith("https://"))) {
            FoliaCorePlugin.notePlaybackArtwork(value, "error", "unsupported-cover-url");
            return;
        }
        artworkExecutor.execute(() -> {
            Bitmap bitmap = null;
            String failure = "";
            try (Response response = artworkClient.newCall(new Request.Builder()
                .url(value)
                .header("User-Agent", "Mozilla/5.0 (Linux; Android 13; Mobile)")
                .build()).execute()) {
                ResponseBody body = response.body();
                if (response.isSuccessful() && body != null) {
                    try (InputStream input = body.byteStream()) {
                        bitmap = BitmapFactory.decodeStream(input);
                    }
                    if (bitmap == null) failure = "decode-failed";
                } else {
                    failure = "http-" + response.code();
                }
            } catch (Exception error) {
                failure = error.getClass().getSimpleName();
            }
            if (bitmap != null) {
                bitmap = scaleArtwork(bitmap);
                artworkCache.put(value, bitmap);
                writeArtworkToDisk(value, bitmap);
            }
            Bitmap resolved = bitmap;
            if (resolved != null) {
                mainHandler.post(() -> {
                    if (value.equals(currentArtworkUrl)) {
                        appliedArtworkUrl = value;
                        appliedArtworkBitmap = resolved;
                        FoliaCorePlugin.notePlaybackArtwork(
                            value,
                            "loaded",
                            resolved.getWidth() + "x" + resolved.getHeight()
                        );
                    }
                    callback.onLoaded(resolved);
                });
            } else {
                FoliaCorePlugin.notePlaybackArtwork(value, "error", failure.isEmpty() ? "unknown" : failure);
            }
        });
    }

    private interface ArtworkCallback {
        void onLoaded(Bitmap bitmap);
    }

    /**
     * Keeps the remote-audio proxy alive in the background.
     *
     * A foreground service keeps the process visible, but it does not stop Doze from throttling
     * the CPU or the Wi-Fi radio. Playback pulls the stream through LocalAudioServer, so losing
     * either one shows up as intermittent audio while the screen is off.
     */
    private void updatePlaybackLocks(boolean playing) {
        try {
            if (playing) {
                if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire();
                if (wifiLock != null && !wifiLock.isHeld()) wifiLock.acquire();
            } else {
                if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
                if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
            }
            powerDiagnostic = "wake=" + (wakeLock != null && wakeLock.isHeld() ? "held" : "released")
                + " wifi=" + (wifiLock != null && wifiLock.isHeld() ? "held" : "released")
                + " error=none";
        } catch (Exception error) {
            powerDiagnostic = "wake=" + (wakeLock != null && wakeLock.isHeld() ? "held" : "released")
                + " wifi=" + (wifiLock != null && wifiLock.isHeld() ? "held" : "released")
                + " error=" + error.getClass().getSimpleName();
        }
    }

    static String getPowerDiagnostic() {
        return powerDiagnostic;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Folia playback",
                NotificationManager.IMPORTANCE_LOW
            );
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    private void emit(String action) {
        FoliaCorePlugin.emitMediaAction(action);
    }

    private void recordServiceLifecycle(String type, String message) {
        CrashDiagnostics.recordText(
            getApplicationContext(),
            "service-lifecycle",
            "service",
            type,
            message,
            "FoliaPlaybackService"
        );
    }

    /**
     * 只在播放状态或曲目真的变了、或距上次记录已满 {@link #SERVICE_START_RECORD_INTERVAL_MS}
     * 时记一条 `service-start`。推送本身仍然每次都处理，只是不再每次都写诊断。
     */
    private void recordServiceStartIfNoteworthy() {
        long now = SystemClock.elapsedRealtime();
        boolean stateChanged = cachedPlaying != lastServiceStartPlaying
            || !cachedSongKey.equals(lastServiceStartSongKey);
        if (!stateChanged && now - lastServiceStartRecordAt < SERVICE_START_RECORD_INTERVAL_MS) {
            return;
        }
        lastServiceStartRecordAt = now;
        lastServiceStartPlaying = cachedPlaying;
        lastServiceStartSongKey = cachedSongKey;
        recordServiceLifecycle("service-start", "playing=" + cachedPlaying);
    }

    private void recordServiceHeartbeat() {
        try {
            JSONObject payload = new JSONObject();
            payload.put("at", System.currentTimeMillis());
            payload.put("playing", lastPlaying);
            payload.put("wakeLock", wakeLock != null && wakeLock.isHeld() ? "held" : "released");
            payload.put("wifiLock", wifiLock != null && wifiLock.isHeld() ? "held" : "released");
            payload.put("foreground", true);
            CrashDiagnostics.recordServiceHeartbeat(getApplicationContext(), payload.toString());
        } catch (Exception ignored) {
            // A missed heartbeat is harmless; the next one is 10 seconds away.
        }
    }

    @Override
    public void onDestroy() {
        recordServiceLifecycle("service-destroy", "Foreground playback service destroyed");
        running = false;
        mainHandler.removeCallbacks(serviceHeartbeatRunnable);
        mainHandler.removeCallbacks(lyricTickRunnable);
        updatePlaybackLocks(false);
        artworkExecutor.shutdownNow();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
