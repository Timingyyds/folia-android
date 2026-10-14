import { create } from 'zustand';
import { getStoredBoolean, getStoredString, setStoredBoolean } from './storagePrimitives';

// src/state/useLatticeSettingsStore.ts
// Persistent queue-collage preferences. Deliberately separate from useLatticeControlsStore: that
// store only publishes runtime actions from the currently mounted wall.

const LATTICE_PERFORMANCE_MODE_KEY = 'lattice_performance_mode';
const LATTICE_VIGNETTE_KEY = 'lattice_vignette';
const LATTICE_AUTO_FOCUS_ON_SONG_CHANGE_KEY = 'lattice_auto_focus_on_song_change';
const LATTICE_LIGHTS_ON_KEY = 'lattice_lights_on';
const LATTICE_POSTER_TINT_ENABLED_KEY = 'lattice_poster_tint_enabled';
const LATTICE_POSTER_TINT_USE_CUSTOM_COLOR_KEY = 'lattice_poster_tint_use_custom_color';
const LATTICE_POSTER_TINT_COLOR_KEY = 'lattice_poster_tint_color';
const LATTICE_POSTER_TINT_INTENSITY_KEY = 'lattice_poster_tint_intensity';
const WALL_TOOLS_QUEUE_ISLAND_OPEN_KEY = 'wall_tools_queue_island_open';
const DEFAULT_POSTER_TINT_COLOR = '#161419';

const clampPosterTintIntensity = (value: number) => Math.max(0, Math.min(1, value));
const normalizePosterTintColor = (value: string) => (
    /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : DEFAULT_POSTER_TINT_COLOR
);

const getStoredPosterTintIntensity = () => {
    const stored = Number(getStoredString(LATTICE_POSTER_TINT_INTENSITY_KEY, '0.5'));
    return Number.isFinite(stored) ? clampPosterTintIntensity(stored) : 0.5;
};

export type LatticeSettingsState = {
    /**
     * 性能优先（默认开）：只保留翻牌 / 入场波次 / 缝的展开收起，其余装饰效果全部让路 ——
     * 全屏噪点混合、海报的多层叠层与阴影过渡、悬停滤镜、暗角与光晕一并关掉，封面降一档分辨率，
     * 拼贴的裁剪余量与相机行程都收窄。见 ui/wall/wall.css 的 .is-performance 一段。
     */
    latticePerformanceMode: boolean;
    latticeVignette: boolean;
    autoFocusOnSongChange: boolean;
    latticeLightsOn: boolean;
    latticePosterTintEnabled: boolean;
    latticePosterTintUseCustomColor: boolean;
    latticePosterTintColor: string;
    latticePosterTintIntensity: number;
    handleToggleLatticePerformanceMode: (enabled: boolean) => void;
    /**
     * 墙面工具面板（bravais 与 Lattice 共用）上方的队列浮岛上次是否展开着：下次打开面板时照旧。
     * 这是面板的开合状态，不是设置——不进外观导入导出，也不注册命令面板（完整的队列编辑已经有 Ctrl+P 的队列命令）。
     * 放在这个 store 里，bravais ↔ Lattice 交接时两面墙读同一份。
     */
    wallToolsQueueIslandOpen: boolean;
    handleToggleLatticeVignette: (enabled: boolean) => void;
    handleToggleAutoFocusOnSongChange: (enabled: boolean) => void;
    handleToggleLatticeLights: (enabled: boolean) => void;
    handleToggleLatticePosterTint: (enabled: boolean) => void;
    handleToggleLatticePosterTintCustomColor: (enabled: boolean) => void;
    handleSetLatticePosterTintColor: (color: string) => void;
    handleSetLatticePosterTintIntensity: (intensity: number) => void;
    setWallToolsQueueIslandOpen: (open: boolean) => void;
};

export const useLatticeSettingsStore = create<LatticeSettingsState>(set => ({
    latticePerformanceMode: getStoredBoolean(LATTICE_PERFORMANCE_MODE_KEY, true),
    latticeVignette: getStoredBoolean(LATTICE_VIGNETTE_KEY, true),
    autoFocusOnSongChange: getStoredBoolean(LATTICE_AUTO_FOCUS_ON_SONG_CHANGE_KEY, true),
    latticeLightsOn: getStoredBoolean(LATTICE_LIGHTS_ON_KEY, true),
    latticePosterTintEnabled: getStoredBoolean(LATTICE_POSTER_TINT_ENABLED_KEY, true),
    latticePosterTintUseCustomColor: getStoredBoolean(LATTICE_POSTER_TINT_USE_CUSTOM_COLOR_KEY, false),
    latticePosterTintColor: normalizePosterTintColor(getStoredString(LATTICE_POSTER_TINT_COLOR_KEY, DEFAULT_POSTER_TINT_COLOR)),
    latticePosterTintIntensity: getStoredPosterTintIntensity(),
    handleToggleLatticePerformanceMode: (enabled) => {
        set({ latticePerformanceMode: enabled });
        setStoredBoolean(LATTICE_PERFORMANCE_MODE_KEY, enabled);
    },
    wallToolsQueueIslandOpen: getStoredBoolean(WALL_TOOLS_QUEUE_ISLAND_OPEN_KEY, false),
    handleToggleLatticeVignette: (enabled) => {
        set({ latticeVignette: enabled });
        setStoredBoolean(LATTICE_VIGNETTE_KEY, enabled);
    },
    handleToggleAutoFocusOnSongChange: (enabled) => {
        set({ autoFocusOnSongChange: enabled });
        setStoredBoolean(LATTICE_AUTO_FOCUS_ON_SONG_CHANGE_KEY, enabled);
    },
    handleToggleLatticeLights: (enabled) => {
        set({ latticeLightsOn: enabled });
        setStoredBoolean(LATTICE_LIGHTS_ON_KEY, enabled);
    },
    handleToggleLatticePosterTint: (enabled) => {
        set({ latticePosterTintEnabled: enabled });
        setStoredBoolean(LATTICE_POSTER_TINT_ENABLED_KEY, enabled);
    },
    handleToggleLatticePosterTintCustomColor: (enabled) => {
        set({ latticePosterTintUseCustomColor: enabled });
        setStoredBoolean(LATTICE_POSTER_TINT_USE_CUSTOM_COLOR_KEY, enabled);
    },
    handleSetLatticePosterTintColor: (color) => {
        const normalized = normalizePosterTintColor(color);
        set({ latticePosterTintColor: normalized });
        if (typeof window !== 'undefined') localStorage.setItem(LATTICE_POSTER_TINT_COLOR_KEY, normalized);
    },
    handleSetLatticePosterTintIntensity: (intensity) => {
        const normalized = clampPosterTintIntensity(intensity);
        set({ latticePosterTintIntensity: normalized });
        if (typeof window !== 'undefined') localStorage.setItem(LATTICE_POSTER_TINT_INTENSITY_KEY, String(normalized));
    },
    setWallToolsQueueIslandOpen: (open) => {
        set({ wallToolsQueueIslandOpen: open });
        setStoredBoolean(WALL_TOOLS_QUEUE_ISLAND_OPEN_KEY, open);
    },
}));
