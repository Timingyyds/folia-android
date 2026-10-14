import { isLocalCoverWebRuntimeSupported } from './localCoverBinaryStore';
import { migrateLegacyLocalCoverAssetsInBackground } from './localCoverAssetService';
import { isLocalCoverAssetUrl } from './localCoverAssetUrl';

// src/svc/localCoverRuntime.ts
// Activates the Web resource route before local-library UI mounts, then starts resumable legacy migration.

export const LOCAL_COVER_SERVICE_WORKER_READY_TIMEOUT_MS = 10_000;

const withStartupTimeout = async <T>(
  pending: PromiseLike<T>,
  timeoutMs = LOCAL_COVER_SERVICE_WORKER_READY_TIMEOUT_MS,
  label = 'Local cover service worker readiness',
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve(pending), timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
};

// Bounds startup waiting while preserving the original registration result on success.
export const waitForLocalCoverServiceWorkerReady = (
  ready: PromiseLike<ServiceWorkerRegistration>,
  timeoutMs = LOCAL_COVER_SERVICE_WORKER_READY_TIMEOUT_MS,
): Promise<ServiceWorkerRegistration> => (
  withStartupTimeout(ready, timeoutMs, 'Local cover service worker readiness')
);

export const waitForLocalCoverServiceWorkerRegistration = (
  registration: PromiseLike<ServiceWorkerRegistration>,
  timeoutMs = LOCAL_COVER_SERVICE_WORKER_READY_TIMEOUT_MS,
): Promise<ServiceWorkerRegistration> => (
  withStartupTimeout(registration, timeoutMs, 'Local cover service worker registration')
);

export const initializeLocalCoverRuntime = async (): Promise<void> => {
  if (isLocalCoverWebRuntimeSupported() && 'serviceWorker' in navigator) {
    try {
      await waitForLocalCoverServiceWorkerRegistration(
        navigator.serviceWorker.register('/folia-cover-sw.js', { scope: '/' }),
      );
      await waitForLocalCoverServiceWorkerReady(navigator.serviceWorker.ready);
    } catch (error) {
      console.error('[LocalCoverAsset] Failed to initialize the local cover service worker', error);
    }
  }

  void migrateLegacyLocalCoverAssetsInBackground().then(() => {
    // Retry only covers that failed before their legacy payload reached external storage.
    document.querySelectorAll<HTMLImageElement>('img').forEach(image => {
      const source = image.getAttribute('src');
      if (!isLocalCoverAssetUrl(source) || image.naturalWidth > 0) return;
      image.removeAttribute('src');
      queueMicrotask(() => {
        if (image.isConnected) image.src = source;
      });
    });
  });
};
