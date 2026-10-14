// src/svc/exportDiagnosticReport.ts
//
// 「设置 → 帮助 → 导出诊断数据」的服务层。
//
// 安卓走原生桥：把报告写进 App 缓存目录的 txt，再用 FileProvider 拉起系统分享面板，
// 用户可以直接发给微信 / QQ / 邮件。其它运行时优先用 Web Share API 分享同一个文件，
// 不支持时退回浏览器下载。文件内容与「复制诊断数据」完全一致。
//
// 同一次点击只生成一份报告（调用方传入），这里只负责落盘和分享；任何失败都向上抛，
// 由界面决定提示文案。

export type DiagnosticExportResult = 'shared' | 'downloaded' | 'cancelled';

type ShareTextFileOptions = {
    filename: string;
    content: string;
    title?: string;
};

type DiagnosticSharePlugin = {
    shareTextFile?: (options: ShareTextFileOptions) => Promise<unknown>;
    deleteDiagnosticFiles?: () => Promise<{ deleted?: number }>;
};

const DIAGNOSTIC_FILE_BASENAME = 'folia-diagnostics';

const pad = (value: number): string => String(value).padStart(2, '0');

/** 本地时间戳文件名，便于用户按时间区分多次导出。 */
export const buildDiagnosticFileName = (now: Date = new Date()): string => {
    const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `${DIAGNOSTIC_FILE_BASENAME}-${date}-${time}.txt`;
};

const getNativePlugin = (): DiagnosticSharePlugin | null => {
    if (typeof window === 'undefined') return null;
    return (window as unknown as {
        Capacitor?: { Plugins?: { FoliaNative?: DiagnosticSharePlugin } };
    }).Capacitor?.Plugins?.FoliaNative ?? null;
};

const isAbortError = (error: unknown): boolean =>
    error instanceof Error && (error.name === 'AbortError' || error.name === 'NotAllowedError');

const downloadFile = (filename: string, content: string): void => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // 立即撤销会让部分 WebView 来不及读取，延后一拍再释放。
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

/**
 * 把诊断报告导出成 txt 并打开系统分享。
 *
 * @param content 已经生成好的诊断报告正文
 * @param title   分享面板标题（来自界面文案）
 */
export const exportDiagnosticReport = async (
    content: string,
    title: string,
): Promise<DiagnosticExportResult> => {
    const filename = buildDiagnosticFileName();
    const plugin = getNativePlugin();
    if (typeof plugin?.shareTextFile === 'function') {
        await plugin.shareTextFile({ filename, content, title });
        return 'shared';
    }

    if (
        typeof navigator !== 'undefined'
        && typeof navigator.share === 'function'
        && typeof File !== 'undefined'
    ) {
        const file = new File([content], filename, { type: 'text/plain' });
        const canShareFiles = typeof navigator.canShare === 'function'
            ? navigator.canShare({ files: [file] })
            : false;
        if (canShareFiles) {
            try {
                await navigator.share({ files: [file], title });
                return 'shared';
            } catch (error) {
                if (isAbortError(error)) return 'cancelled';
                throw error;
            }
        }
    }

    downloadFile(filename, content);
    return 'downloaded';
};

/**
 * 「删除诊断」只在原生插件在场时可用。
 *
 * 桌面端的导出是浏览器下载，落到用户的下载目录，App 没有权限也没有必要去清理；
 * 安卓端每次导出都会在 App 缓存目录留一份 txt，这里提供配套的清理入口。
 */
export const canDeleteExportedDiagnostics = (): boolean =>
    typeof getNativePlugin()?.deleteDiagnosticFiles === 'function';

/** 清掉之前导出的诊断 txt，返回实际删除的文件数。 */
export const deleteExportedDiagnostics = async (): Promise<number> => {
    const plugin = getNativePlugin();
    if (typeof plugin?.deleteDiagnosticFiles !== 'function') return 0;
    const result = await plugin.deleteDiagnosticFiles();
    return typeof result?.deleted === 'number' ? result.deleted : 0;
};
