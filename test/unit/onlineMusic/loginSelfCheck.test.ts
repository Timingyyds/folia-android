import { afterEach, describe, expect, it, vi } from 'vitest';
import { canRunLoginSelfCheck, runLoginSelfCheck } from '@/services/onlineMusic/loginSelfCheck';

// test/unit/onlineMusic/loginSelfCheck.test.ts

describe('provider login self-check entry', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it('hands the check to the main process on the desktop build', async () => {
        const result = { providerId: 'netease', runtime: 'electron' };
        const runLoginSelfCheckBridge = vi.fn().mockResolvedValue(result);
        vi.stubGlobal('window', { electron: { runLoginSelfCheck: runLoginSelfCheckBridge } });

        expect(canRunLoginSelfCheck(null)).toBe(true);
        await expect(runLoginSelfCheck('netease', null)).resolves.toBe(result);
        expect(runLoginSelfCheckBridge).toHaveBeenCalledWith('netease');
    });

    it('probes the configured remote API on the web build', async () => {
        vi.stubGlobal('window', {});
        const fetchMock = vi.fn().mockResolvedValue({ status: 0 });
        vi.stubGlobal('fetch', fetchMock);

        expect(canRunLoginSelfCheck(null)).toBe(false);
        expect(canRunLoginSelfCheck('https://api.example.test/')).toBe(true);
        await expect(runLoginSelfCheck('qq', null)).resolves.toBeNull();

        const result = await runLoginSelfCheck('qq', 'https://api.example.test/');
        expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/', expect.objectContaining({ mode: 'no-cors', cache: 'no-store' }));
        // no-cors 的不透明响应没有状态码，但能拿到它就说明远端可达。
        expect(result).toMatchObject({
            providerId: 'qq',
            runtime: 'web',
            backend: { status: 'remote', url: 'https://api.example.test/', probe: { ok: true, httpStatus: null, error: null } },
            proxy: null,
            hosts: [],
        });
    });

    it('records an unreachable remote API instead of throwing', async () => {
        vi.stubGlobal('window', {});
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

        await expect(runLoginSelfCheck('netease', 'https://api.example.test')).resolves.toMatchObject({
            backend: { probe: { ok: false, error: { code: null, message: 'Failed to fetch' } } },
        });
    });

    it('flags an API address on this device when no API can run here, without probing it', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ status: 0 });
        vi.stubGlobal('fetch', fetchMock);
        const page = (href: string, userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150') => {
            vi.stubGlobal('window', { location: new URL(href) });
            vi.stubGlobal('navigator', { userAgent });
        };

        page('https://folia.example.com/');
        await expect(runLoginSelfCheck('netease', 'http://localhost:3000')).resolves.toMatchObject({
            backend: { probe: { ok: false, error: { code: 'ELOOPBACK' } } },
        });
        // 打包进安卓 App 的页面自己可能就在 localhost 上，但手机上不会有 API 服务。
        page('http://localhost/', 'Mozilla/5.0 (Linux; Android 16; wv) Chrome/153 Mobile Safari/537.36');
        await expect(runLoginSelfCheck('netease', 'http://127.0.0.1:3000')).resolves.toMatchObject({
            backend: { probe: { ok: false, error: { code: 'ELOOPBACK' } } },
        });
        expect(fetchMock).not.toHaveBeenCalled();

        // 本机开发：页面和 API 都在本机，照常探测。
        page('http://localhost:5173/');
        await expect(runLoginSelfCheck('netease', 'http://localhost:3000')).resolves.toMatchObject({ backend: { probe: { ok: true } } });
        // 相对地址（Docker 的 /netease、Vercel 的 /api/qq）跟着页面走，不算本机。
        page('https://folia.example.com/');
        await expect(runLoginSelfCheck('qq', '/api/qq')).resolves.toMatchObject({ backend: { probe: { ok: true } } });
    });
});
