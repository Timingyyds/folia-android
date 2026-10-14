// src/svc/nativeRemoteAudio.ts
// Routes signed Kuwo/Bodian URLs through the Android Range-capable local stream server.

export const proxyNativeRemoteAudioUrl = async (url: string): Promise<string> => {
    if (!url || typeof window === 'undefined') return url;
    const plugin = (window as any).Capacitor?.Plugins?.FoliaNative;
    if (!plugin?.registerRemoteAudio) return url;
    try {
        const result = await plugin.registerRemoteAudio({ url });
        return typeof result?.url === 'string' && result.url ? result.url : url;
    } catch (error) {
        console.warn('[NativeRemoteAudio] proxy registration failed', error);
        return url;
    }
};
