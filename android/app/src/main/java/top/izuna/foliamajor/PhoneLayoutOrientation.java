package top.izuna.foliamajor;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;

/** Native orientation lock used only while the Android phone-fit switch is enabled. */
final class PhoneLayoutOrientation {
    private static final String PREFS_NAME = "folia_native_prefs";
    private static final String KEY_ENABLED = "phone_fit_enabled";
    private static final String KEY_ORIENTATION = "phone_fit_orientation";
    private static final String MODE_PORTRAIT = "portrait";
    private static final String MODE_LANDSCAPE = "landscape";

    private PhoneLayoutOrientation() {
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    static boolean isEnabled(Context context) {
        return prefs(context).getBoolean(KEY_ENABLED, false);
    }

    static String getOrientation(Context context) {
        return normalize(prefs(context).getString(KEY_ORIENTATION, MODE_PORTRAIT));
    }

    static void update(Context context, boolean enabled, String orientation) {
        prefs(context).edit()
            .putBoolean(KEY_ENABLED, enabled)
            .putString(KEY_ORIENTATION, normalize(orientation))
            .apply();
    }

    static void apply(Activity activity) {
        if (activity == null) return;
        if (!isEnabled(activity)) {
            activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            return;
        }
        activity.setRequestedOrientation(
            MODE_LANDSCAPE.equals(getOrientation(activity))
                ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                : ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
        );
    }

    private static String normalize(String value) {
        return MODE_LANDSCAPE.equals(value) ? MODE_LANDSCAPE : MODE_PORTRAIT;
    }
}
