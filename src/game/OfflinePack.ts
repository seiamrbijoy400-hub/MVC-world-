export const OFFLINE_CACHE_NAME = 'apex-zero-v5';

export const REQUIRED_OFFLINE_ASSETS: readonly string[] = [
  './index.html',
  './manifest.webmanifest',
  './assets/icon-192.svg',
  './assets/icon-512.svg',
  './assets/models/car%201203.fbx',
  './assets/models/wheel_front_right.fbx',
  './assets/models/wheel_back_right.fbx',
  './assets/models/male.glb',
  './assets/models/female.glb',
  './assets/models/helicopter.glb',
  './assets/sounds/low.wav',
  './assets/sounds/high%20ACC.wav',
  './assets/sounds/high%20Deacc.wav',
  './assets/sounds/CarColision.wav',
  './assets/sounds/TrackColision.wav',
  './assets/sounds/step-inside-your-mind-instrumental-eurobeat-royalty-free-music.mp3'
];

export interface OfflinePackStatus {
  cacheSupported: boolean;
  swActive: boolean;
  ready: boolean;
  cachedCount: number;
  totalCount: number;
  missing: string[];
}

export interface OfflinePackProgress {
  completed: number;
  total: number;
  currentAsset: string;
}

export interface OfflinePackDownloadResult {
  ok: boolean;
  cachedCount: number;
  totalCount: number;
  failed: string[];
  error?: string;
}

function collectRuntimeBundleUrls(): string[] {
  // Headless test runners may expose a partial `document` stub without DOM queries.
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') {
    return [...REQUIRED_OFFLINE_ASSETS];
  }
  const urls = new Set<string>(REQUIRED_OFFLINE_ASSETS);
  document
    .querySelectorAll('script[src], link[rel="stylesheet"][href], link[rel="modulepreload"][href]')
    .forEach((el) => {
      const raw = el.getAttribute('src') || el.getAttribute('href');
      if (!raw) return;
      try {
        const resolved = new URL(raw, document.baseURI);
        if (resolved.origin === location.origin) {
          urls.add(resolved.href);
        }
      } catch {}
    });
  return Array.from(urls);
}

export async function checkOfflinePackStatus(
  assets?: readonly string[]
): Promise<OfflinePackStatus> {
  // Default to the same complete list used by downloadOfflinePack, including the
  // hashed JS/CSS chunks that the initial page load needs.
  const targets = assets ? [...assets] : collectRuntimeBundleUrls();
  const swActive =
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    Boolean(navigator.serviceWorker.controller);

  if (typeof caches === 'undefined') {
    return {
      cacheSupported: false,
      swActive,
      ready: false,
      cachedCount: 0,
      totalCount: targets.length,
      missing: [...targets]
    };
  }

  try {
    const cache = await caches.open(OFFLINE_CACHE_NAME);
    const missing: string[] = [];
    for (const url of targets) {
      const hit = await cache.match(url);
      if (!hit) missing.push(url);
    }
    const cachedCount = targets.length - missing.length;
    return {
      cacheSupported: true,
      swActive,
      ready: swActive && missing.length === 0,
      cachedCount,
      totalCount: targets.length,
      missing
    };
  } catch {
    return {
      cacheSupported: false,
      swActive,
      ready: false,
      cachedCount: 0,
      totalCount: targets.length,
      missing: [...targets]
    };
  }
}

export async function downloadOfflinePack(
  onProgress?: (p: OfflinePackProgress) => void
): Promise<OfflinePackDownloadResult> {
  if (typeof caches === 'undefined') {
    return {
      ok: false,
      cachedCount: 0,
      totalCount: REQUIRED_OFFLINE_ASSETS.length,
      failed: [...REQUIRED_OFFLINE_ASSETS],
      error: 'Cache Storage API unavailable in this browser context.'
    };
  }

  const assetList = collectRuntimeBundleUrls();
  const failed: string[] = [];
  let completed = 0;

  try {
    const cache = await caches.open(OFFLINE_CACHE_NAME);
    for (const url of assetList) {
      onProgress?.({
        completed,
        total: assetList.length,
        currentAsset: url.split('/').pop() || url
      });

      try {
        const existing = await cache.match(url);
        if (!existing) {
          const res = await fetch(url, { cache: 'reload' });
          if (!res.ok) {
            failed.push(url);
          } else {
            await cache.put(url, res);
          }
        }
      } catch (err) {
        failed.push(url);
        const msg = err instanceof Error ? err.message : '';
        if (msg.toLowerCase().includes('quota')) {
          return {
            ok: false,
            cachedCount: completed,
            totalCount: assetList.length,
            failed,
            error: 'Storage quota exceeded while saving offline pack.'
          };
        }
      }
      completed++;
      onProgress?.({
        completed,
        total: assetList.length,
        currentAsset: url.split('/').pop() || url
      });
    }

    const status = await checkOfflinePackStatus(REQUIRED_OFFLINE_ASSETS);
    return {
      ok: failed.length === 0 && status.missing.length === 0,
      cachedCount: status.cachedCount,
      totalCount: status.totalCount,
      failed,
      error: failed.length > 0 ? `${failed.length} asset(s) failed to download.` : undefined
    };
  } catch (err) {
    return {
      ok: false,
      cachedCount: completed,
      totalCount: assetList.length,
      failed: assetList.slice(completed),
      error: err instanceof Error ? err.message : 'Offline download failed.'
    };
  }
}
