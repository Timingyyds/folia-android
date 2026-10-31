// src/audioNative/consoleDiagnostics.ts
// 把 WebView 里带固定前缀的 console 行转给原生侧（FoliaNative.recordRuntimeDiagnostic）。
// 原生侧除了记在 SharedPreferences，还会往 /sdcard/Android/data/<包名>/files/logs/folia-runtime.log
// 追加一行 —— 那个文件是能从外部取出来看的，App 私有目录不是。
//
// 只转发明确加了前缀的几类日志：全量转发会把桥打爆，也会把有用的一行淹掉。

const FORWARD_PREFIXES = [
    '[YTM',
    '[KuGou',
    '[QQ',
    '[NetEase',
    '[netease',
    '[Prefetch]',
    '[AudioContext]',
    '[SiteUpdate]',
];

/** 一次会话最多转发这么多行；调试够了，也不会把日志刷爆。 */
const MAX_FORWARDED_LINES = 600;

type DiagnosticPlugin = {
    recordRuntimeDiagnostic?: (payload: {
        source: string;
        thread: string;
        type: string;
        message: string;
        stack: string;
    }) => Promise<unknown>;
};

let installed = false;
let forwarded = 0;

const getPlugin = (): DiagnosticPlugin | null => {
    if (typeof window === 'undefined') return null;
    const capacitor = (window as unknown as {
        Capacitor?: {
            isNativePlatform?: () => boolean;
            Plugins?: { FoliaNative?: DiagnosticPlugin };
        };
    }).Capacitor;
    if (!capacitor?.isNativePlatform?.()) return null;
    const plugin = capacitor.Plugins?.FoliaNative;
    return plugin && typeof plugin.recordRuntimeDiagnostic === 'function' ? plugin : null;
};

const stringifyArg = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
};

export const installConsoleDiagnosticsBridge = (): void => {
    if (installed) return;
    const plugin = getPlugin();
    if (!plugin) return;
    installed = true;

    (['log', 'info', 'warn', 'error'] as const).forEach(level => {
        const original = console[level].bind(console);
        console[level] = (...args: unknown[]) => {
            try {
                if (forwarded < MAX_FORWARDED_LINES) {
                    const head = typeof args[0] === 'string' ? args[0] : '';
                    if (FORWARD_PREFIXES.some(prefix => head.startsWith(prefix))) {
                        forwarded += 1;
                        const body = args.map(stringifyArg).join(' ').replace(/\s+/g, ' ').slice(0, 1500);
                        void plugin.recordRuntimeDiagnostic?.({
                            source: 'webview-console',
                            thread: 'webview',
                            type: `console.${level}`,
                            message: body,
                            stack: '',
                        })?.catch?.(() => undefined);
                    }
                }
            } catch {
                // 转日志失败不能影响本来那一行输出。
            }
            original(...args);
        };
    });
};
