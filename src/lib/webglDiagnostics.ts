// src/lib/webglDiagnostics.ts
// WebGL2 capability probe for the copy-diagnostics report. Nomand（漫游）背景和部分可视化
// 依赖 WebGL2；把真实上下文、GPU 型号和失败原因一起导出，才能区分「设备不支持 / 驱动降级」
// 和「我们的渲染代码有问题」。

export type WebGL2Diagnostics = {
    supported: boolean;
    version?: string;
    vendor?: string;
    renderer?: string;
    maxTextureSize?: number;
    webgl1?: boolean;
    error?: string;
};

const probeWebGL1 = (): boolean => {
    try {
        return Boolean(document.createElement('canvas').getContext('webgl'));
    } catch {
        return false;
    }
};

export const collectWebGL2Diagnostics = (): WebGL2Diagnostics => {
    if (typeof document === 'undefined') return { supported: false, error: 'no-document' };
    let gl: WebGL2RenderingContext | null = null;
    try {
        const canvas = document.createElement('canvas');
        gl = canvas.getContext('webgl2');
        if (!gl) return { supported: false, error: 'context-unavailable', webgl1: probeWebGL1() };
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        return {
            supported: true,
            version: String(gl.getParameter(gl.VERSION) || ''),
            vendor: String(gl.getParameter(debugInfo ? debugInfo.UNMASKED_VENDOR_WEBGL : gl.VENDOR) || ''),
            renderer: String(gl.getParameter(debugInfo ? debugInfo.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || ''),
            maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || undefined,
        };
    } catch (error) {
        return {
            supported: false,
            error: error instanceof Error ? error.message : String(error),
            webgl1: probeWebGL1(),
        };
    } finally {
        try {
            gl?.getExtension('WEBGL_lose_context')?.loseContext();
        } catch {
            // Losing the throwaway context is best-effort; a failure here must not break the report.
        }
    }
};

export const formatWebGL2DiagnosticsLine = (diagnostics: WebGL2Diagnostics): string => {
    if (!diagnostics.supported) {
        const webgl1 = diagnostics.webgl1 === undefined ? '' : ` webgl1=${diagnostics.webgl1 ? 'yes' : 'no'}`;
        return `  webgl2: supported=no error=${JSON.stringify(diagnostics.error || 'unknown')}${webgl1}`;
    }
    const quote = (value?: string) => JSON.stringify(value || 'unknown');
    return `  webgl2: supported=yes version=${quote(diagnostics.version)}`
        + ` vendor=${quote(diagnostics.vendor)} renderer=${quote(diagnostics.renderer)}`
        + ` maxTexture=${diagnostics.maxTextureSize ?? 'n/a'}`;
};
