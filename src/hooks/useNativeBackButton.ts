import { useEffect } from 'react';

type NativeBackPlugin = {
    addListener: (
        eventName: string,
        listener: () => void,
    ) => Promise<{ remove: () => Promise<void> }> | { remove: () => Promise<void> };
    exitApp: () => Promise<unknown>;
    recordRuntimeDiagnostic?: (payload: {
        source: string;
        thread: string;
        type: string;
        message: string;
        stack: string;
    }) => Promise<unknown>;
};

const getPlugin = (): NativeBackPlugin | null => {
    if (typeof window === 'undefined') return null;
    const capacitor = (window as unknown as {
        Capacitor?: {
            getPlatform?: () => string;
            Plugins?: { FoliaNative?: NativeBackPlugin };
        };
    }).Capacitor;
    if (capacitor?.getPlatform?.() !== 'android') return null;
    const plugin = capacitor.Plugins?.FoliaNative;
    return plugin && typeof plugin.addListener === 'function' && typeof plugin.exitApp === 'function'
        ? plugin
        : null;
};

/**
 * Routes the Android hardware Back through the same keyboard handling the app already uses for
 * Escape. Dialogs and nested settings views close themselves there; only when no layer consumes
 * the event does the app finish.
 */
export const useNativeBackButton = (): void => {
    useEffect(() => {
        const plugin = getPlugin();
        if (!plugin) return;

        let disposed = false;
        let listenerHandle: { remove: () => Promise<void> } | { remove: () => void } | null = null;
        const registered = plugin.addListener('backButton', () => {
            if (disposed) return;
            const event = new KeyboardEvent('keydown', {
                key: 'Escape',
                code: 'Escape',
                bubbles: true,
                cancelable: true,
            });
            const handled = !window.dispatchEvent(event) || event.defaultPrevented;
            if (!handled) {
                void plugin.recordRuntimeDiagnostic?.({
                    source: 'activity-lifecycle',
                    thread: 'webview',
                    type: 'back-unhandled',
                    message: 'No layer handled Escape; requesting app exit',
                    stack: '',
                }).catch(() => undefined);
                void plugin.exitApp().catch(() => undefined);
            } else {
                void plugin.recordRuntimeDiagnostic?.({
                    source: 'activity-lifecycle',
                    thread: 'webview',
                    type: 'back-handled',
                    message: 'A layer handled Escape',
                    stack: '',
                }).catch(() => undefined);
            }
        });

        Promise.resolve(registered)
            .then(handle => {
                if (disposed) {
                    void handle.remove();
                    return;
                }
                listenerHandle = handle;
            })
            .catch(() => undefined);

        return () => {
            disposed = true;
            if (listenerHandle) void listenerHandle.remove();
        };
    }, []);
};
