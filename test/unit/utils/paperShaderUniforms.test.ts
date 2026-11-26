import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { updatePaperShaderUniforms, type PaperShaderMount } from '@/utils/paperShaderUniforms';

// test/unit/utils/paperShaderUniforms.test.ts
// updatePaperShaderUniforms 依赖 paper-shaders 的 setUniformValues（类型声明里是 private）。
// 升级 paper-shaders 时如果它被改名或删掉，这里先失败，提醒去看 utils/paperShaderUniforms.ts。

const fakeMount = () => {
    const mount = {
        setUniforms: vi.fn(),
        setUniformValues: vi.fn(),
    };
    return mount;
};

describe('updatePaperShaderUniforms', () => {
    it('运行中的着色器只写 uniform，不调用会当场重绘的 setUniforms', () => {
        const mount = fakeMount();
        updatePaperShaderUniforms(mount as unknown as PaperShaderMount, { u_progress: 0.5 }, true);
        expect(mount.setUniformValues).toHaveBeenCalledWith({ u_progress: 0.5 });
        expect(mount.setUniforms).not.toHaveBeenCalled();
    });

    it('停着的着色器没有帧循环，仍走 setUniforms 立即重绘', () => {
        const mount = fakeMount();
        updatePaperShaderUniforms(mount as unknown as PaperShaderMount, { u_progress: 0.5 }, false);
        expect(mount.setUniforms).toHaveBeenCalledWith({ u_progress: 0.5 });
        expect(mount.setUniformValues).not.toHaveBeenCalled();
    });

    it('没有 setUniformValues 时退回 setUniforms', () => {
        const mount = { setUniforms: vi.fn() };
        updatePaperShaderUniforms(mount as unknown as PaperShaderMount, { u_progress: 0.5 }, true);
        expect(mount.setUniforms).toHaveBeenCalledWith({ u_progress: 0.5 });
    });

    it('安装的 paper-shaders 仍然提供 setUniformValues', () => {
        const require = createRequire(import.meta.url);
        const entry = require.resolve('@paper-design/shaders');
        const source = readFileSync(join(dirname(entry), 'shader-mount.js'), 'utf8');
        expect(source).toMatch(/\bsetUniformValues\s*=\s*\(/);
    });
});
