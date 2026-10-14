import React from 'react';
import i18n from '../../i18n/config';
import { isChunkLoadError, recoverFromChunkLoadError, resetChunkLoadRecovery } from '../../lib/chunkLoadRecovery';

// 分包加载失败的最终兜底：React.lazy 的加载错误若没有被边界接住，会把整棵树卸载成白屏。
// 这里只接管分包的加载错误（先触发一次自动刷新），其他错误仍按原路径向上抛，避免改变现有崩溃诊断。

type ChunkLoadBoundaryProps = {
    children: React.ReactNode;
};

type ChunkLoadBoundaryState = {
    error: unknown | null;
};

class ChunkLoadBoundary extends React.Component<ChunkLoadBoundaryProps, ChunkLoadBoundaryState> {
    state: ChunkLoadBoundaryState = { error: null };

    static getDerivedStateFromError(error: unknown): ChunkLoadBoundaryState {
        return { error };
    }

    componentDidCatch(error: unknown): void {
        if (isChunkLoadError(error)) recoverFromChunkLoadError(error);
    }

    private retry = (): void => {
        resetChunkLoadRecovery();
        window.location.reload();
    };

    render(): React.ReactNode {
        const { error } = this.state;
        if (!error) return this.props.children;
        if (!isChunkLoadError(error)) throw error;
        return (
            <div className="fixed inset-0 z-[2147483000] flex flex-col items-center justify-center gap-4 bg-[#09090b] px-8 text-center text-white">
                <p className="text-sm text-white/70">{i18n.t('playlist.loadFailed', { error: '' })}</p>
                <button
                    type="button"
                    className="rounded-md border border-white/20 px-4 py-2 text-sm text-white/90 active:bg-white/10"
                    onClick={this.retry}
                >
                    {i18n.t('playlist.reload')}
                </button>
            </div>
        );
    }
}

export default ChunkLoadBoundary;
