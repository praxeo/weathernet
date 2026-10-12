// Shared fetch + geo helpers for WeatherNet's own source modules
// (src/sources/*). The ported weatherchat backend (src/brain.js) keeps its own
// copies; new code uses these.

// Every upstream fetch carries a deadline. A slow host (api.weather.gov and
// nhc.noaa.gov both crawl under storm-day load) must not hold a request open:
// a timed-out fetch rejects like any other failure and the caller degrades.
export const UPSTREAM_TIMEOUT_MS = 15e3;

export function upstreamSignal(ms) {
  return AbortSignal.timeout(ms || UPSTREAM_TIMEOUT_MS);
}

// NWS (and most NOAA hosts) want a real User-Agent with a contact.
export function userAgent(env) {
  return (env && env.NWS_USER_AGENT) || "WeatherNet/0.1 (personal weather site)";
}

async function upstream(url, { env, ttl = 300, timeoutMs, headers = {}, accept } = {}) {
  const r = await fetch(url, {
    headers: { "User-Agent": userAgent(env), Accept: accept || "*/*", ...headers },
    cf: { cacheTtl: ttl, cacheEverything: true },
    signal: upstreamSignal(timeoutMs),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`${r.status} on ${url}: ${body.slice(0, 160)}`);
  }
  return r;
}

export async function fetchJSON(url, opts = {}) {
  const r = await upstream(url, { accept: "application/geo+json,application/json;q=0.9,*/*;q=0.5", ...opts });
  return r.json();
}

export async function fetchText(url, opts = {}) {
  const r = await upstream(url, { accept: "text/plain,text/html,application/xml,*/*", ...opts });
  return r.text();
}

// Race a promise against a deadline; rejects with a labeled timeout error.
export function withDeadline(promise, ms, label = "task") {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

// ── Geo ──────────────────────────────────────────────────────────────────────
const R_MI = 3958.8;
const rad = (d) => (d * Math.PI) / 180;

export function haversineMi(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MI * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearingDeg(lat1, lon1, lat2, lon2) {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x =
    Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export function compass(deg) {
  return POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

// Centroid (vertex mean) and bbox of a GeoJSON Polygon/MultiPolygon — good
// enough for labeling and "cams near this warning" searches.
export function geometryCenter(geometry) {
  const pts = [];
  const walk = (c) => (typeof c[0] === "number" ? pts.push(c) : c.forEach(walk));
  if (geometry && geometry.coordinates) walk(geometry.coordinates);
  if (!pts.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, sx = 0, sy = 0;
  for (const [x, y] of pts) {
    sx += x; sy += y;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { lat: sy / pts.length, lon: sx / pts.length, bbox: [minX, minY, maxX, maxY] };
}

export function round(n, d = 2) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
