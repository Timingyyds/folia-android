package top.izuna.foliamajor.coloros;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * ColorOS 原生锁屏歌词的 Web 侧入口。
 *
 * 与状态栏歌词（Lyricon）同一套路：换歌时把整条时间轴交过去，播放中一句话都不说。
 * 判定在原生侧做（要读 ROM 属性），Web 层只问一句「支不支持」再决定推不推。
 */
@CapacitorPlugin(name = "FoliaColorOsLyrics")
public class FoliaColorOsLyricsPlugin extends Plugin {

    /**
     * 这台机器要不要走 ColorOS 原生歌词通道。
     *
     * 不是「万能开关」：只有真机判定为 ColorOS 16+ 才返回 true，Web 层据此决定
     * 这条路走不走。用户没有手动开关 —— 判定不通过就当这条路不存在。
     */
    @PluginMethod
    public void isSupported(PluginCall call) {
        ColorOsLyricBridge.Detection detection = ColorOsLyricBridge.detect();
        JSObject result = new JSObject();
        result.put("supported", detection.supported);
        result.put("colorOsMajor", detection.colorOsMajor);
        result.put("detail", detection.detail);
        call.resolve(result);
    }

    /**
     * 交一份歌词时间轴过来。
     *
     * `lyricInfo` 是 Web 侧按 Bridge 协议拼好的 JSON 字符串（含逐行 / 逐字 / 翻译三条 lane），
     * 原生不解析它的内容，只在 metadata 上转发 —— 契约归播放器所有。
     */
    @PluginMethod
    public void publish(PluginCall call) {
        String lyricInfo = call.getString("lyricInfo");
        Boolean hasTranslation = call.getBoolean("hasTranslation");
        String songKey = call.getString("songKey");
        ColorOsLyricBridge.setPending(
                lyricInfo,
                hasTranslation != null && hasTranslation,
                songKey);
        ColorOsLyricBridge.requestRefresh(getContext());
        JSObject result = new JSObject();
        result.put("ok", lyricInfo != null && !lyricInfo.isEmpty());
        call.resolve(result);
    }

    /** 没有在播的东西了（或者这首歌没词）：把上一段歌词撤掉。 */
    @PluginMethod
    public void clear(PluginCall call) {
        ColorOsLyricBridge.clear();
        ColorOsLyricBridge.requestRefresh(getContext());
        call.resolve();
    }
}
