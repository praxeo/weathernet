// Two cache layers for WeatherNet's source modules.
//
// edgeJSON — Cloudflare's Cache API under a synthetic key. Per data center
// (colo), survives isolate restarts; the right place for anything a page load
// asks for (stories, satellite catalog, cams near a point).
//
// memo — a module-level Map inside one isolate. For large upstream registries
// (every camera in a state) that several requests in a row would otherwise
// re-download; an isolate lives seconds to minutes, so the TTL is a ceiling.

const CACHE_ORIGIN = "https://weathernet.internal/";

export async function edgeJSON(key, ttlSec, producer, ctx) {
  const cache = globalThis.caches && globalThis.caches.default;
  const req = new Request(CACHE_ORIGIN + key);
  if (cache) {
    try {
      const hit = await cache.match(req);
      if (hit) return await hit.json();
    } catch {
      // A cache read failure is a miss.
    }
  }
  const value = await producer();
  if (cache) {
    const res = new Response(JSON.stringify(value), {
      headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttlSec}` },
    });
    const put = cache.put(req, res).catch(() => {});
    if (ctx && ctx.waitUntil) ctx.waitUntil(put);
    else await put;
  }
  return value;
}

const MEMO = new Map();

export async function memo(key, ttlMs, producer) {
  const now = Date.now();
  const hit = MEMO.get(key);
  if (hit && hit.exp > now) return hit.promise;
  // Share one in-flight producer between concurrent callers; drop it on
  // failure so the next call retries instead of caching the rejection.
  const promise = producer();
  MEMO.set(key, { exp: now + ttlMs, promise });
  promise.catch(() => {
    if (MEMO.get(key)?.promise === promise) MEMO.delete(key);
  });
  return promise;
}

// JSON response with browser/edge cache headers.
export function json(data, { maxAge = 60, status = 200 } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}`,
      "access-control-allow-origin": "*",
    },
  });
}
