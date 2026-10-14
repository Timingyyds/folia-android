import { create } from 'zustand';

// src/state/useLibraryPlayerOcclusionStore.ts
// 资料库的常驻舞台（stage）此刻是否完全盖住了播放页（B6b）。stage 经契约的 reportPlayerOcclusion 报告，宿主的挂载位
// （library/app/LibrarySuiteStageSlot）代为写入；App 只读 selectLibraryOccludesPlayer 决定要不要卸载 visualizer，
// 不认识任何 suite，也不读 suite 自己的偏好。
//
// 复位不靠 stage 自觉：挂载位每挂一个 stage 就登记一个持有者（owner），卸载、换 suite 时注销。生效值要求「报告来自
// 当前登记的持有者」，所以 stage 卸载后晚到的报告、换 suite 前旧 stage 的报告都不算数；没有 stage（grid / TUI）时
// 没有持有者，永远是 false。报告与登记的先后不限（子组件的 effect 先于挂载位的 effect 执行）。
//
// 同一个持有者还报告「透出的画面怎么画」（backdrop：歌词文字、模糊；bravais 的「墙后的画面」设置，设计稿 §11）。
// App 只在首页显示着时按它给 visualizer 打开文字 / 加模糊，播放页不受影响；生效规则与遮挡相同（只认当前持有者，
// 卸载、换 suite 复位为 NO_LIBRARY_PLAYER_BACKDROP）。

/** 一次 stage 挂载的身份。挂载位每次挂载（含换 suite）新建一个，只比较引用。 */
export type LibraryPlayerOcclusionOwner = { readonly suiteId: string };

/** 透出的播放页画面：画不画歌词文字、加不加模糊。只有画面有透光处时 stage 才会报 true。 */
export type LibraryPlayerBackdrop = { readonly lyrics: boolean; readonly blur: boolean };

export const NO_LIBRARY_PLAYER_BACKDROP: LibraryPlayerBackdrop = Object.freeze({ lyrics: false, blur: false });

type LibraryPlayerOcclusionState = {
    /** 当前登记着的 stage；null = 没有 stage 挂着。 */
    mountedOwner: LibraryPlayerOcclusionOwner | null;
    /** 最近一次报告来自谁、报的是什么。只有 reportOwner === mountedOwner 时才生效。 */
    reportOwner: LibraryPlayerOcclusionOwner | null;
    reportedOccludes: boolean;
    /** 最近一次 backdrop 报告来自谁、报的是什么。只有 backdropOwner === mountedOwner 时才生效。 */
    backdropOwner: LibraryPlayerOcclusionOwner | null;
    reportedBackdrop: LibraryPlayerBackdrop;
    /** 挂载位登记 stage（顶替之前的持有者）。 */
    mount: (owner: LibraryPlayerOcclusionOwner) => void;
    /** 挂载位注销：只有仍是当前持有者时才清空，旧实例晚一步注销不会清掉新实例。 */
    release: (owner: LibraryPlayerOcclusionOwner) => void;
    /** stage 的报告（经挂载位转交）。值不变时不写 store；当前持有者报过之后，其他持有者的报告被忽略。 */
    report: (owner: LibraryPlayerOcclusionOwner, occludes: boolean) => void;
    /** stage 的 backdrop 报告（经挂载位转交）。规则同 report：值不变不写，当前持有者报过后别人的报告被忽略。 */
    reportBackdrop: (owner: LibraryPlayerOcclusionOwner, backdrop: LibraryPlayerBackdrop) => void;
};

export const useLibraryPlayerOcclusionStore = create<LibraryPlayerOcclusionState>((set, get) => ({
    mountedOwner: null,
    reportOwner: null,
    reportedOccludes: false,
    backdropOwner: null,
    reportedBackdrop: NO_LIBRARY_PLAYER_BACKDROP,
    mount: (owner) => {
        if (get().mountedOwner === owner) return;
        set({ mountedOwner: owner });
    },
    release: (owner) => {
        const state = get();
        if (state.mountedOwner !== owner) return;
        set({
            mountedOwner: null,
            ...(state.reportOwner === owner ? { reportOwner: null, reportedOccludes: false } : {}),
            ...(state.backdropOwner === owner ? { backdropOwner: null, reportedBackdrop: NO_LIBRARY_PLAYER_BACKDROP } : {}),
        });
    },
    report: (owner, occludes) => {
        const state = get();
        if (state.reportOwner === owner && state.reportedOccludes === occludes) return;
        // 当前持有者已经报过时，别人（已卸载的旧 stage 晚到的报告）不能顶掉它。
        if (state.reportOwner !== null && state.reportOwner !== owner && state.reportOwner === state.mountedOwner) return;
        set({ reportOwner: owner, reportedOccludes: occludes });
    },
    reportBackdrop: (owner, backdrop) => {
        const state = get();
        const next = backdrop.lyrics || backdrop.blur
            ? { lyrics: Boolean(backdrop.lyrics), blur: Boolean(backdrop.blur) }
            : NO_LIBRARY_PLAYER_BACKDROP;
        if (state.backdropOwner === owner
            && state.reportedBackdrop.lyrics === next.lyrics
            && state.reportedBackdrop.blur === next.blur) return;
        if (state.backdropOwner !== null && state.backdropOwner !== owner && state.backdropOwner === state.mountedOwner) return;
        set({ backdropOwner: owner, reportedBackdrop: next });
    },
}));

/** 生效值：当前挂着的 stage 报告自己完全遮挡播放页。 */
export const selectLibraryOccludesPlayer = (state: LibraryPlayerOcclusionState) => (
    state.mountedOwner !== null
    && state.reportOwner === state.mountedOwner
    && state.reportedOccludes
);

/** 生效的 backdrop：当前挂着的 stage 报的那一份；没有 stage、报告不是它的时为 NO_LIBRARY_PLAYER_BACKDROP（引用稳定）。 */
export const selectLibraryPlayerBackdrop = (state: LibraryPlayerOcclusionState): LibraryPlayerBackdrop => (
    state.mountedOwner !== null && state.backdropOwner === state.mountedOwner
        ? state.reportedBackdrop
        : NO_LIBRARY_PLAYER_BACKDROP
);
