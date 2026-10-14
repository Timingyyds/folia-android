import { OnlineProviderError } from '../../types/onlineMusic';
import type { BodianOperation, BodianParams, BodianResult } from 'bodian-music-api';
import { isFoliaExtensionBridgeAvailable, requestFoliaExtension } from '../foliaExtensionBridge';

// src/svc/onlineMusic/bodianTransport.ts

export type { BodianOperation, BodianParams } from 'bodian-music-api';
export type BodianBridgeResult = BodianResult;

const isAndroidNativeRuntime = (): boolean => (
    typeof window !== 'undefined'
    && (window as any).Capacitor?.getPlatform?.() === 'android'
);

export const getBodianTransportAvailability = () => (
    typeof window !== 'undefined'
    && (typeof window.electron?.bodianRequest === 'function' || isAndroidNativeRuntime())
        ? { configured: true } as const
        : { configured: false, reason: 'runtime-unavailable' } as const
);

export async function requestBodian<T = unknown>(operation: BodianOperation, params: BodianParams = {}): Promise<T> {
    if (!getBodianTransportAvailability().configured) {
        throw new OnlineProviderError('unavailable', 'Bodian requires the desktop app or Android bridge', 'bodian');
    }

    // Omni consumers request 150/1000-row batches; Bodian serves at most 100 and returns its own cursor.
    const boundedParams = Number.isSafeInteger(params.limit) && Number(params.limit) > 100
        ? { ...params, limit: 100 } : params;
    let result: BodianBridgeResult;

    if (typeof window.electron?.bodianRequest === 'function') {
        try {
            result = await window.electron.bodianRequest(operation, boundedParams);
        } catch {
            throw new OnlineProviderError('network', 'Bodian desktop request failed', 'bodian');
        }
    } else {
        if (!(await isFoliaExtensionBridgeAvailable())) {
            throw new OnlineProviderError('unavailable', 'Bodian Android bridge is unavailable', 'bodian');
        }
        try {
            result = await requestFoliaExtension<BodianBridgeResult>({
                provider: 'bodian',
                operation,
                params: boundedParams,
            });
        } catch {
            throw new OnlineProviderError('network', 'Bodian Android request failed', 'bodian');
        }
    }

    if (!result.ok) throw new OnlineProviderError(result.error.code, result.error.message, 'bodian');
    return result.data as T;
}
