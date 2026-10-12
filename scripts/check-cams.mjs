// Live check for src/sources/cams.js: per-source registry counts and samples,
// a hotlink probe of sample stills (foreign Referer) and streams (foreign
// Origin), camsNear for five cities, camsInGeometry around Tuscaloosa, and
// the Texas snapshot proxy. Every upstream call is real.
//
//   cd /home/user/weathernet && NODE_USE_ENV_PROXY=1 node scripts/check-cams.mjs
//
// WINDY_API_KEY in the environment switches the Windy source on.
import proc from "node:process";

// Cache API stand-in (as in dev-server.mjs) so edge caching runs as deployed.
const store = new Map();
const keyOf = (req) => (typeof req === "string" ? req : req.url);
globalThis.caches = {
  default: {
    async match(req) {
      const e = store.get(keyOf(req));
      if (!e || e.exp < Date.now()) return undefined;
      return new Response(e.body.slice(0), { status: e.status, headers: e.headers });
    },
    async put(req, res) {
      const m = /max-age=(\d+)/.exec(res.headers.get("cache-control") || "");
      store.set(keyOf(req), { body: await res.arrayBuffer(), status: res.status, headers: [...res.headers], exp: Date.now() + (m ? Number(m[1]) : 60) * 1000 });
    },
  },
};

const { CAM_SOURCES, camRegistry, camsNear, camsInGeometry, camSnapshot, SKYCAM_LINKS } = await import("../src/sources/cams.js");

const env = { NWS_USER_AGENT: "WeatherNet/0.1 (cams check)", WINDY_API_KEY: proc.env.WINDY_API_KEY };
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };
const out = (s = "") => proc.stdout.write(s + "\n");
const pad = (s, n) => String(s).padEnd(n);
const pick = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);

async function probe(url, headers) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (WeatherNet check)", ...headers }, signal: AbortSignal.timeout(15e3) });
    const body = await r.arrayBuffer();
    return `${r.status} ${(r.headers.get("content-type") || "?").split(";")[0]} ${Math.round(body.byteLength / 1024)}KB acao=${r.headers.get("access-control-allow-origin") || "-"}`;
  } catch (err) {
    return `ERR ${err.message}`;
  }
}

// ── 1. Registries ────────────────────────────────────────────────────────────
out("== Registries (camRegistry) ==");
const registries = {};
await Promise.all(CAM_SOURCES.map(async (s) => {
  const t0 = Date.now();
  try {
    registries[s.id] = { list: await camRegistry(s.id, env, { ctx }), ms: Date.now() - t0 };
  } catch (err) {
    registries[s.id] = { err: err.message, ms: Date.now() - t0 };
  }
}));
let total = 0;
for (const s of CAM_SOURCES) {
  const r = registries[s.id];
  if (r.err) {
    out(`${pad(s.id, 9)} ERROR ${r.err} (${r.ms} ms)`);
    continue;
  }
  const stills = r.list.filter((c) => c.snapshot).length;
  const hls = r.list.filter((c) => c.hls).length;
  total += r.list.length;
  const why = s.requiresKey && !env[s.requiresKey] ? `  (needs ${s.requiresKey})` : s.id === "windy" ? "  (query-only)" : "";
  out(`${pad(s.id, 9)} ${pad(r.list.length, 5)} cams  stills ${pad(stills, 5)} hls ${pad(hls, 5)} ${pad(r.ms + " ms", 9)}${why}`);
}
out(`total ${total} cams across ${CAM_SOURCES.length} sources`);

out("\n== One sample per source ==");
for (const s of CAM_SOURCES) {
  const r = registries[s.id];
  if (!r.list || !r.list.length) continue;
  const c = pick(r.list, 1)[0];
  out(`${c.id} | ${c.name}${c.city ? ` (${c.city})` : ""}, ${c.state} @ ${c.lat},${c.lon} | kind=${c.kind} refresh=${c.refreshSec}`);
  out(`   snapshot: ${c.snapshot || "-"}`);
  if (c.hls) out(`   hls:      ${c.hls}`);
  if (c.views) out(`   views:    ${c.views.length}`);
}

// ── 2. Hotlink probe ─────────────────────────────────────────────────────────
out("\n== Hotlink probe (stills with a foreign Referer, streams with a foreign Origin) ==");
const foreign = { Referer: "https://weathernet.example/", Origin: "https://weathernet.example" };
for (const s of CAM_SOURCES) {
  const r = registries[s.id];
  if (!r.list || !r.list.length) continue;
  for (const c of pick(r.list.filter((x) => x.snapshot), 2)) {
    if (c.snapshot.startsWith("/")) {
      const res = await camSnapshot(new URL(c.snapshot, "https://x/").searchParams.get("id"), env, ctx);
      const body = await res.arrayBuffer();
      out(`${pad(s.id, 9)} still(proxy) ${res.status} ${res.headers.get("content-type") || "?"} ${Math.round(body.byteLength / 1024)}KB  ${c.name}`);
    } else {
      out(`${pad(s.id, 9)} still  ${await probe(c.snapshot, foreign)}  ${c.snapshot}`);
    }
  }
  for (const c of pick(r.list.filter((x) => x.hls), 1)) out(`${pad(s.id, 9)} hls    ${await probe(c.hls, foreign)}  ${c.hls}`);
}

// ── 3. camsNear ──────────────────────────────────────────────────────────────
const CITIES = [
  ["Birmingham AL", 33.52, -86.81],
  ["Mobile AL", 30.69, -88.04],
  ["Oklahoma City", 35.47, -97.52],
  ["Miami", 25.76, -80.19],
  ["Denver", 39.74, -104.99],
];
for (const [label, lat, lon] of CITIES) {
  const t0 = Date.now();
  const res = await camsNear(lat, lon, { radiusMi: 50, limit: 12, env, ctx });
  out(`\n== camsNear ${label} (${lat}, ${lon}) — ${res.cams.length} cams, ${Date.now() - t0} ms ==`);
  out(`sources ${JSON.stringify(res.sources)}${res.notes.length ? `  notes ${JSON.stringify(res.notes)}` : ""}`);
  for (const c of res.cams) {
    const media = [c.snapshot ? "still" : null, c.hls ? "hls" : null].filter(Boolean).join("+");
    out(`  ${pad(c.distMi + " mi", 8)} ${pad(c.bearing, 4)} ${pad(c.source, 9)} ${pad(media, 10)} ${c.name}${c.approx ? " (approx)" : ""}`);
  }
}

// Second call for the same city should come straight from the edge cache.
{
  const t0 = Date.now();
  await camsNear(33.52, -86.81, { radiusMi: 50, limit: 12, env, ctx });
  out(`\n(cached repeat for Birmingham: ${Date.now() - t0} ms)`);
}

// Skycam-only search (kinds filter), the headline use case.
{
  const res = await camsNear(33.52, -86.81, { radiusMi: 60, limit: 6, env, ctx, kinds: ["sky"] });
  out(`\n== camsNear Birmingham, kinds=sky — ${res.cams.length} cams ==`);
  for (const c of res.cams) out(`  ${pad(c.distMi + " mi", 8)} ${pad(c.bearing, 4)} ${c.name} — ${c.attribution}`);
}

// ── 4. camsInGeometry ────────────────────────────────────────────────────────
// A small warning-sized box around Tuscaloosa (~14 x 12 mi).
const tuscaloosa = {
  type: "Polygon",
  coordinates: [[[-87.65, 33.15], [-87.42, 33.15], [-87.42, 33.32], [-87.65, 33.32], [-87.65, 33.15]]],
};
{
  const res = await camsInGeometry(tuscaloosa, { limit: 12, bufferMi: 10, env, ctx });
  out(`\n== camsInGeometry Tuscaloosa box — ${res.cams.length} cams, center ${JSON.stringify(res.center)} ==`);
  out(`sources ${JSON.stringify(res.sources)}${res.notes.length ? `  notes ${JSON.stringify(res.notes)}` : ""}`);
  for (const c of res.cams) {
    out(`  ${pad(c.inside ? "inside" : `+${c.outsideMi} mi`, 9)} ${pad(c.distMi + " mi", 8)} ${pad(c.bearing, 4)} ${pad(c.source, 7)} ${c.name}${c.approx ? " (approx)" : ""}`);
  }
}
{
  const res = await camsInGeometry({ type: "Point", coordinates: [-87.5, 33.2] }, { env, ctx });
  out(`camsInGeometry(non-polygon) → ${res.cams.length} cams, notes ${JSON.stringify(res.notes)}`);
}

// ── 5. TV skycam pages ───────────────────────────────────────────────────────
out(`\n== SKYCAM_LINKS (${SKYCAM_LINKS.length}) ==`);
for (const l of SKYCAM_LINKS) {
  const r = await probe(l.url, { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" });
  out(`  ${pad(l.station, 18)} ${pad(r.split(" ")[0], 4)} ${l.url}${l.inSource ? `  [stills in ${l.inSource}]` : ""}`);
}
