import React, { useMemo } from 'react';
import '../../src/i18n/config';
import Home from '../../src/components/app/Home';
import type { ProbeDefinition } from './definition';
import {
    isProbeSandbox,
    useHomeProbeEnvironment,
    useHomeProbeModel,
    type HomeProbeLibrary,
} from './homeBehavior/useHomeProbeHarness';
import { usePaletteTypingStandIn } from './paletteTypingStandIn';
import { WallToolsHostContext } from '../../src/components/wall/wallToolsHost';
import { PROBE_WALL_TOOLS_HOST } from './homeBehavior/probeWallToolsHost';
// dev/probes/homeBehavior.probe.tsx

/**
 * 首页与目录（GridMap）的行为回归探针：挂真实的 `Home`（GridViewOverlayHost → registry 解析出的首页
 * surface，网格 suite 下就是 Grid3D），所以首页三类来源、GridMap、批量面板和从首页打开的集合详情都在覆盖内。
 * 数据来自首页档的两个假 provider（两个已登录账户）、沙盒 IndexedDB 里的本地曲库种子和 Navidrome 垫片。
 *
 * 它是 P3 的回归闸门：test/component/homeBehavior.spec.ts 通过 window.__homeProbe 驱动它，断言请求账、
 * 回调账、服务调用账与宿主收到的集合描述。只在沙盒模式运行（测试浏览器里自动开启；手动打开要加 `&sandbox`），
 * 因为它要往 IndexedDB 写种子。
 *
 * 宿主区域套了一层 transform：GridMap、GridView 都是 `fixed inset-0`，transform 让它们以这块区域为包含块。
 * 墙面工具的宿主（真 App 在 WallToolsDockHost 上提供）这里用只记账的假宿主（probeWallToolsHost）包在 Home 外面。
 */
const HomeProbeStage: React.FC<{ library: HomeProbeLibrary }> = ({ library }) => {
    const { model, mountKey } = useHomeProbeModel(library);
    return (
        <WallToolsHostContext.Provider value={PROBE_WALL_TOOLS_HOST}>
            <Home key={mountKey} model={model} />
        </WallToolsHostContext.Provider>
    );
};

const HomeBehaviorProbe: React.FC = () => {
    const sandbox = useMemo(isProbeSandbox, []);
    const library = useHomeProbeEnvironment(sandbox);
    // 墙上打字交给 bravais 缝里的过滤输入位（命令面板那一支的替身，见 paletteTypingStandIn）。
    usePaletteTypingStandIn();

    return (
        <div
            data-probe-host
            className="fixed inset-0 overflow-hidden"
            style={{ transform: 'translateZ(0)', backgroundColor: 'var(--bg-color)', color: 'var(--text-primary)' }}
        >
            {!sandbox && (
                <div className="flex h-full items-center justify-center text-sm opacity-60">
                    homeBehavior 需要沙盒模式：在地址上加 &amp;sandbox（会写入本页的 IndexedDB）。
                </div>
            )}
            {sandbox && library && <HomeProbeStage library={library} />}
        </div>
    );
};

export default {
    id: 'homeBehavior',
    title: '首页与目录行为回归（真实 Home / Grid3D / GridMap）',
    description: '首页档假 provider + 本地 / Navidrome 种子，覆盖条目、打开、GridMap 筛选、批量、隐藏、导入；P3 每步跑的回归闸门。',
    Component: HomeBehaviorProbe,
} satisfies ProbeDefinition;
