package top.izuna.foliamajor;

import android.app.ActivityManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Keeps a small, bounded crash trail for the diagnostics report.
 *
 * The default Android handler still receives the exception after this recorder runs. This class
 * only persists enough context for the next app launch; it never swallows the crash.
 */
public final class CrashDiagnostics {
    private static final String PREFS = "folia_crash_diagnostics";
    private static final String KEY_HISTORY = "history";
    private static final String KEY_LAST_HEARTBEAT = "last_heartbeat";
    private static final String KEY_PREVIOUS_HEARTBEAT = "previous_heartbeat";
    private static final String KEY_LAST_SERVICE_HEARTBEAT = "last_service_heartbeat";
    private static final String KEY_PREVIOUS_SERVICE_HEARTBEAT = "previous_service_heartbeat";
    private static final String KEY_LAST_EXIT_TIMESTAMP = "last_exit_timestamp";
    private static final int MAX_RECORDS = 20;
    private static final int MAX_STACK_CHARS = 12_000;
    private static final long EXIT_LOOKBACK_MS = 7L * 24L * 60L * 60L * 1000L;
    private static final int EXIT_REASON_SIGNALED = 2;
    private static final int EXIT_REASON_LOW_MEMORY = 3;
    private static final int EXIT_REASON_CRASH = 4;
    private static final int EXIT_REASON_CRASH_NATIVE = 5;
    private static final int EXIT_REASON_ANR = 6;
    private static final int EXIT_REASON_INITIALIZATION_FAILURE = 7;
    private static final int EXIT_REASON_EXCESSIVE_RESOURCE_USAGE = 9;
    private static final int EXIT_REASON_USER_REQUESTED = 10;
    private static final int EXIT_REASON_USER_STOPPED = 11;
    private static final int EXIT_REASON_DEPENDENCY_DIED = 12;
    private static final int EXIT_REASON_FREEZER = 14;
    private static volatile boolean installed = false;

    private CrashDiagnostics() {}

    public static synchronized void install(Context context) {
        if (installed || context == null) return;
        installed = true;
        Context appContext = context.getApplicationContext();
        // Keep the immediately preceding session's last breadcrumb before the new session
        // overwrites it; this is what survives an abrupt process death.
        try {
            SharedPreferences preferences = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String previousHeartbeat = preferences.getString(KEY_LAST_HEARTBEAT, "");
            if (!previousHeartbeat.isEmpty()) {
                preferences.edit().putString(KEY_PREVIOUS_HEARTBEAT, previousHeartbeat).apply();
            }
            String previousServiceHeartbeat = preferences.getString(KEY_LAST_SERVICE_HEARTBEAT, "");
            if (!previousServiceHeartbeat.isEmpty()) {
                preferences.edit().putString(KEY_PREVIOUS_SERVICE_HEARTBEAT, previousServiceHeartbeat).apply();
            }
        } catch (Exception ignored) {
            // Heartbeat archiving is best-effort.
        }
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            record(appContext, "native-uncaught", thread == null ? "unknown" : thread.getName(), error);
            if (previous != null) {
                previous.uncaughtException(thread, error);
            } else {
                android.os.Process.killProcess(android.os.Process.myPid());
            }
        });
        Thread exitCollector = new Thread(
            () -> collectHistoricalExits(appContext),
            "folia-exit-diagnostics"
        );
        exitCollector.setDaemon(true);
        exitCollector.start();
    }

    public static void record(Context context, String source, String threadName, Throwable error) {
        if (error == null) return;
        StringWriter writer = new StringWriter();
        error.printStackTrace(new PrintWriter(writer));
        recordText(
            context,
            source,
            threadName,
            error.getClass().getName(),
            error.getMessage(),
            writer.toString()
        );
    }

    public static void recordText(
        Context context,
        String source,
        String threadName,
        String type,
        String message,
        String stack
    ) {
        if (context == null) return;
        try {
            SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONArray previous = new JSONArray(preferences.getString(KEY_HISTORY, "[]"));
            JSONArray next = new JSONArray();
            int start = Math.max(0, previous.length() - (MAX_RECORDS - 1));
            for (int index = start; index < previous.length(); index += 1) {
                next.put(previous.opt(index));
            }

            JSONObject entry = new JSONObject();
            entry.put("at", isoNow());
            entry.put("source", limit(source, 80));
            entry.put("thread", limit(threadName, 120));
            entry.put("type", limit(type, 240));
            entry.put("message", limit(message, 2_000));
            entry.put("stack", limit(stack, MAX_STACK_CHARS));
            entry.put("device", Build.MANUFACTURER + " " + Build.MODEL);
            entry.put("sdk", Build.VERSION.SDK_INT);
            next.put(entry);

            // commit(), not apply(): the records this class exists for are written on the way out
            // (a renderer death, an uncaught exception), and an asynchronous write can be lost when
            // the process goes away right afterwards — which is how a crash ended up as "(none)".
            preferences.edit().putString(KEY_HISTORY, next.toString()).commit();
        } catch (Exception ignored) {
            // Crash recording must never become a second crash.
        }
    }

    public static String read(Context context) {
        if (context == null) return "[]";
        try {
            return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_HISTORY, "[]");
        } catch (Exception ignored) {
            return "[]";
        }
    }

    public static void clear(Context context) {
        if (context == null) return;
        try {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .remove(KEY_HISTORY)
                .apply();
        } catch (Exception ignored) {}
    }

    /**
     * Last playback heartbeat. Written with apply(), not commit(): this one runs every 10 seconds
     * and is only a breadcrumb, so it must never block the UI or audio path.
     */
    public static void recordHeartbeat(Context context, String payload) {
        if (context == null) return;
        try {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_LAST_HEARTBEAT, limit(payload, 2_000))
                .apply();
        } catch (Exception ignored) {
            // A lost heartbeat is harmless; the next one is 10 seconds away.
        }
    }

    public static String readHeartbeat(Context context) {
        if (context == null) return "";
        try {
            return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_LAST_HEARTBEAT, "");
        } catch (Exception ignored) {
            return "";
        }
    }

    public static String readPreviousHeartbeat(Context context) {
        if (context == null) return "";
        try {
            return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_PREVIOUS_HEARTBEAT, "");
        } catch (Exception ignored) {
            return "";
        }
    }

    public static void recordServiceHeartbeat(Context context, String payload) {
        if (context == null) return;
        try {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_LAST_SERVICE_HEARTBEAT, limit(payload, 2_000))
                .apply();
        } catch (Exception ignored) {}
    }

    public static String readServiceHeartbeat(Context context) {
        if (context == null) return "";
        try {
            return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_LAST_SERVICE_HEARTBEAT, "");
        } catch (Exception ignored) {
            return "";
        }
    }

    public static String readPreviousServiceHeartbeat(Context context) {
        if (context == null) return "";
        try {
            return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_PREVIOUS_SERVICE_HEARTBEAT, "");
        } catch (Exception ignored) {
            return "";
        }
    }

    /**
     * Imports process exits that never reach Thread.UncaughtExceptionHandler.
     *
     * On Android 11+ this covers WebView renderer deaths, native crashes, ANRs and
     * resource kills. The timestamp is persisted so the same historical exit is not
     * appended on every launch.
     */
    public static synchronized void collectHistoricalExits(Context context) {
        if (context == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return;
        try {
            ActivityManager activityManager =
                (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
            if (activityManager == null) return;
            Method historyMethod = ActivityManager.class.getMethod("getHistoricalProcessExitInfos");
            Object rawExits = historyMethod.invoke(activityManager);
            if (!(rawExits instanceof List<?>)) return;
            List<?> exits = (List<?>) rawExits;
            if (exits == null || exits.isEmpty()) return;

            SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            long lastTimestamp = preferences.getLong(KEY_LAST_EXIT_TIMESTAMP, 0L);
            long cutoff = System.currentTimeMillis() - EXIT_LOOKBACK_MS;
            long newestTimestamp = lastTimestamp;
            int imported = 0;

            for (Object rawExit : exits) {
                if (rawExit == null) continue;
                long timestamp = longValue(rawExit, "getTimestamp", 0L);
                if (timestamp <= lastTimestamp) continue;
                newestTimestamp = Math.max(newestTimestamp, timestamp);
                int reasonCode = intValue(rawExit, "getReason", -1);
                if (timestamp < cutoff || !isRecordableReason(reasonCode)) continue;

                String reason = exitReasonLabel(reasonCode);
                String processName = limit(textValue(rawExit, "getProcessName"), 160);
                String description = limit(textValue(rawExit, "getDescription"), 1_000);
                String message = "time=" + isoAt(timestamp)
                    + " process=" + (processName.isEmpty() ? "(unknown)" : processName)
                    + " reason=" + reason
                    + " status=" + intValue(rawExit, "getStatus", -1)
                    + " importance=" + intValue(rawExit, "getImportance", -1)
                    + (description.isEmpty() ? "" : " description=" + description);

                recordText(
                    context,
                    "android-exit",
                    "system",
                    "process-exit:" + reason,
                    message,
                    readExitTrace(rawExit)
                );
                imported += 1;
                if (imported >= MAX_RECORDS) break;
            }

            if (newestTimestamp > lastTimestamp) {
                preferences.edit().putLong(KEY_LAST_EXIT_TIMESTAMP, newestTimestamp).apply();
            }
        } catch (Exception ignored) {
            // Diagnostics must never become a second failure.
        }
    }

    private static boolean isRecordableReason(int reason) {
        if (reason == EXIT_REASON_CRASH
            || reason == EXIT_REASON_CRASH_NATIVE
            || reason == EXIT_REASON_ANR
            || reason == EXIT_REASON_INITIALIZATION_FAILURE
            || reason == EXIT_REASON_SIGNALED
            || reason == EXIT_REASON_EXCESSIVE_RESOURCE_USAGE
            || reason == EXIT_REASON_LOW_MEMORY
            || reason == EXIT_REASON_DEPENDENCY_DIED
            || reason == EXIT_REASON_USER_REQUESTED
            || reason == EXIT_REASON_USER_STOPPED
            || reason == EXIT_REASON_FREEZER) {
            return true;
        }
        return false;
    }

    private static String exitReasonLabel(int reason) {
        if (reason == EXIT_REASON_CRASH) return "CRASH";
        if (reason == EXIT_REASON_CRASH_NATIVE) return "CRASH_NATIVE";
        if (reason == EXIT_REASON_ANR) return "ANR";
        if (reason == EXIT_REASON_INITIALIZATION_FAILURE) return "INITIALIZATION_FAILURE";
        if (reason == EXIT_REASON_SIGNALED) return "SIGNALED";
        if (reason == EXIT_REASON_EXCESSIVE_RESOURCE_USAGE) return "EXCESSIVE_RESOURCE_USAGE";
        if (reason == EXIT_REASON_LOW_MEMORY) return "LOW_MEMORY";
        if (reason == EXIT_REASON_USER_REQUESTED) return "USER_REQUESTED";
        if (reason == EXIT_REASON_USER_STOPPED) return "USER_STOPPED";
        if (reason == EXIT_REASON_DEPENDENCY_DIED) return "DEPENDENCY_DIED";
        if (reason == EXIT_REASON_FREEZER) return "FREEZER";
        return "OTHER";
    }

    private static String readExitTrace(Object exit) {
        try (InputStream stream = (InputStream) exit.getClass()
            .getMethod("getTraceInputStream")
            .invoke(exit)) {
            if (stream == null) return "";
            StringBuilder trace = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(stream, StandardCharsets.UTF_8)
            )) {
                char[] buffer = new char[2_048];
                int count;
                while ((count = reader.read(buffer)) >= 0) {
                    trace.append(buffer, 0, count);
                    if (trace.length() >= MAX_STACK_CHARS) break;
                }
            }
            return limit(trace.toString(), MAX_STACK_CHARS);
        } catch (Exception ignored) {
            return "";
        }
    }

    private static int intValue(Object target, String method, int fallback) {
        Object value = invoke(target, method);
        return value instanceof Number ? ((Number) value).intValue() : fallback;
    }

    private static long longValue(Object target, String method, long fallback) {
        Object value = invoke(target, method);
        return value instanceof Number ? ((Number) value).longValue() : fallback;
    }

    private static String textValue(Object target, String method) {
        Object value = invoke(target, method);
        return value == null ? "" : value.toString();
    }

    private static Object invoke(Object target, String method) {
        try {
            return target.getClass().getMethod(method).invoke(target);
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String isoNow() {
        return isoAt(System.currentTimeMillis());
    }

    private static String isoAt(long timestamp) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date(timestamp));
    }

    private static String limit(String value, int maxLength) {
        if (value == null) return "";
        String text = value.replace('\u0000', ' ').trim();
        return text.length() <= maxLength ? text : text.substring(0, maxLength) + "...";
    }
}
