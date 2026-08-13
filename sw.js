const CACHE_NAME = 'presence-study-tracker-v9-offline-alarm';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './alarm.mp3'
];

const AI_RESOURCES = [
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs',
  'https://unpkg.com/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs',
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm/vision_wasm_internal.js',
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm/vision_wasm_internal.wasm',
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm/vision_wasm_nosimd_internal.js',
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm/vision_wasm_nosimd_internal.wasm',
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
  'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Cache each local asset independently so one optional/missing file can
    // never prevent the PWA shell (especially alarm.mp3) from being installed.
    await Promise.all(SHELL.map(async url => {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (response && response.ok) await cache.put(url, response.clone());
      } catch (error) {
        console.warn('Shell cache failed:', url, error);
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

async function cacheAIResources() {
  const cache = await caches.open(CACHE_NAME);
  let done = 0;
  for (const url of AI_RESOURCES) {
    try {
      const request = new Request(url, { cache: 'no-store' });
      const response = await fetch(request);
      if (response && (response.ok || response.type === 'opaque')) {
        await cache.put(url, response.clone());
      }
    } catch (error) {
      console.warn('AI cache failed:', url, error);
    }
    done++;
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach(client => client.postMessage({
      type: 'AI_CACHE_PROGRESS', done, total: AI_RESOURCES.length
    }));
  }
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach(client => client.postMessage({
    type: 'AI_CACHE_READY', done, total: AI_RESOURCES.length
  }));
}

self.addEventListener('message', event => {
  if (event.data?.type === 'PRECACHE_AI') {
    event.waitUntil(cacheAIResources());
  }
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // alarm.mp3: always prefer the cached full file. Browsers may request
  // media with a Range header; matching a clean Request avoids a cache miss
  // caused by that header and keeps the alarm playable without internet.
  if (url.origin === self.location.origin && url.pathname.endsWith('/alarm.mp3')) {
    event.respondWith((async () => {
      const cleanRequest = new Request(url.href, { method: 'GET' });
      const cached = await caches.match(cleanRequest);
      if (cached) return cached;
      try {
        const response = await fetch(cleanRequest);
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(cleanRequest, copy)).catch(() => {});
        }
        return response;
      } catch (error) {
        return new Response('Offline alarm audio is not cached yet.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' }
        });
      }
    })());
    return;
  }

  // App shell: cache first, then network, then cached index as offline fallback.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => {});
          }
          return response;
        }).catch(() => caches.match('./index.html'));
      })
    );
    return;
  }

  // AI resources: cache first after first online setup.
  const isAIResource =
    url.hostname === 'cdn.jsdelivr.net' ||
    url.hostname === 'unpkg.com' ||
    url.hostname === 'storage.googleapis.com';

  if (isAIResource) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(response => {
          if (response && (response.ok || response.type === 'opaque')) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => {});
          }
          return response;
        })
      })
    );
  }
});
