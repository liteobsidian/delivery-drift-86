// Populated at build time with URLs and SHA-256 digests, without downloading a pack.
const files = new Map(Object.entries(__BUILD_ASSETS__).map(([name, digest]) =>
  [new URL(name, self.registration.scope).href, digest]));
const cacheName = "delivery-drift-assets-v1";

self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil((async () => {
  await self.clients.claim();
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    await Promise.all(keys.filter(key => !files.has(key.url)).map(key => cache.delete(key)));
  } catch { /* Storage may be disabled. */ }
})()));

async function storeVerified(cache, url, response, expected) {
  try {
    const bytes = await response.arrayBuffer();
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const digest = Array.from(hash, byte => byte.toString(16).padStart(2,"0")).join("");
    if (digest !== expected) return;
    // The body is already decoded by Fetch. Preserve its type, not the wire encoding.
    await cache.put(url, new Response(bytes, {headers: {
      "Content-Type": response.headers.get("Content-Type") || "application/octet-stream",
    }}));
  } catch { /* Quota or storage restrictions do not affect the live response. */ }
}

self.addEventListener("fetch", event => {
  const {request} = event;
  const digest = files.get(request.url);
  if (request.method !== "GET" || !digest || request.headers.has("Range")) return;
  event.respondWith((async () => {
    let cache;
    try {
      cache = await caches.open(cacheName);
      const hit = await cache.match(request.url);
      if (hit) return hit;
    } catch { /* Fall through to a normal network fetch. */ }
    const response = await fetch(request);
    if (cache && response.status === 200) {
      event.waitUntil(storeVerified(cache, request.url, response.clone(), digest));
    }
    return response;
  })());
});
