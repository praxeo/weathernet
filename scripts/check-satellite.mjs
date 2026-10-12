// Live smoke test for src/sources/satellite.js: builds the catalog against the
// STAR CDN and NOAA's AWS buckets, prints a compact summary, HEAD-checks a few
// of the URLs it produced and projects known coastline points.
//
//   NODE_USE_ENV_PROXY=1 node scripts/check-satellite.mjs
//
// Exits 1 if anything that should always work comes back empty or broken.
import proc from "node:process";
import { satelliteCatalog, goesProject } from "../src/sources/satellite.js";

const out = (s = "") => proc.stdout.write(s + "\n");
const problems = [];
const check = (ok, msg) => ok || problems.push(msg);
const hhmm = (iso) => (iso ? iso.slice(11, 16) + "Z" : "-");

const env = { NWS_USER_AGENT: "WeatherNet/0.1 (check-satellite)" };
const t0 = Date.now();
const cat = await satelliteCatalog(env, null);
const json = JSON.stringify(cat);
out(`catalog: ${Date.now() - t0} ms, ${Math.round(json.length / 1024)} KB JSON, generated ${cat.generated}`);
for (const [k, s] of Object.entries(cat.sats)) {
  out(`  ${k}: ${s.id} ${s.name} at ${s.lon}° (fixed grid ${s.gridLon}°), ABI mode ${s.mode ?? "?"}`);
}

out("\nviews (frames per band, newest frame):");
for (const v of [...cat.views, ...cat.fullDisk]) {
  const framed = v.bands.filter((b) => b.frames.length);
  const newest = framed.map((b) => b.latestTime).sort().pop();
  const loops = v.bands.filter((b) => b.loop).length;
  out(
    `  ${v.id.padEnd(10)} ${v.sat.padEnd(4)} ${v.title.slice(0, 30).padEnd(30)} ${String(v.bands.length).padStart(2)} bands, ` +
      `${loops} loops, frames ${framed.map((b) => `${b.id}:${b.frames.length}`).join(" ") || "-"}, newest ${hhmm(newest)}`
  );
  for (const b of framed) {
    const ts = b.frames.map((f) => f.t);
    check(ts.every((t, i) => i === 0 || t > ts[i - 1]), `${v.id}/${b.id} frames not strictly increasing`);
  }
}
const conus = cat.views.filter((v) => v.id.startsWith("conus-"));
check(conus.length === 2, "missing CONUS views");
for (const v of conus) for (const b of v.bands) check(b.frames.length >= 12, `${v.id}/${b.id} has ${b.frames.length} frames`);
check(cat.views.length >= 20, `only ${cat.views.length} views`);

out("\nmeso sectors:");
for (const m of cat.meso) {
  const c = m.center ? `${m.center.lat.toFixed(2)}, ${m.center.lon.toFixed(2)}` : "-";
  const imagery = m.coLocatedWith ? `imagery on ${m.coLocatedWith}` : `${m.bands.length} bands x ${m.bands[0]?.frames.length ?? 0} frames`;
  out(
    `  ${m.sat.padEnd(4)} ${m.id}: ${c} (${m.centerSource ?? "-"}) ${m.label ?? "-"} | STAR ${m.starSector ?? "-"}, ` +
      `${m.cadenceSec ?? "?"} s, ${m.coLocated ? "stacked, " : ""}${m.active ? "active" : "STALE"}, updated ${hhmm(m.updated)}, ` +
      `since ${m.since ?? "-"} | ${imagery}`
  );
  if (m.center && m.sat === "east") {
    const p = goesProject(m.center.lat, m.center.lon, cat.projection["conus-east"]);
    if (p) out(`         on conus-east 1250x750: (${p.x}, ${p.y})${p.inside ? "" : " outside image"}`);
  } else if (m.center) {
    const p = goesProject(m.center.lat, m.center.lon, cat.projection["conus-west"]);
    if (p) out(`         on conus-west 1250x750: (${p.x}, ${p.y})${p.inside ? "" : " outside image"}`);
  }
}
check(cat.meso.some((m) => m.active && m.center), "no active meso sector with a center");

out("\nprojection (pixel x, y at the entry's size):");
const TESTS = {
  "conus-east": [["Cape Hatteras", 35.25, -75.53], ["Key West", 24.55, -81.78], ["Brownsville", 25.9, -97.15],
    ["Cape Cod", 41.67, -69.95], ["S tip of Lake Michigan", 41.62, -87.3]],
  "conus-west": [["Cape Flattery", 48.38, -124.72], ["Point Conception", 34.45, -120.47], ["Cape Mendocino", 40.44, -124.41]],
  "fd-east": [["Cape Hatteras", 35.25, -75.53], ["Cape Horn", -55.98, -67.27]],
  "fd-west": [["Point Conception", 34.45, -120.47], ["Honolulu", 21.31, -157.86]],
};
for (const [id, pts] of Object.entries(TESTS)) {
  const pr = cat.projection[id];
  out(`  ${id} (${pr.width}x${pr.height}, grid origin ${pr.satLon}°)`);
  for (const [name, lat, lon] of pts) {
    const p = goesProject(lat, lon, pr);
    check(p && p.inside, `${name} not inside ${id}`);
    out(`    ${name.padEnd(24)} ${p ? `(${p.x}, ${p.y})` : "off disk"}`);
  }
}
check(goesProject(35, 100, cat.projection["conus-east"]) === null, "far-side point should project to null");

// A handful of produced URLs must actually load.
// The newest frame of each scan family is where render lag would show up.
const view = (id) => [...cat.views, ...cat.fullDisk].find((v) => v.id === id);
const band = (id, b) => view(id)?.bands.find((x) => x.id === b);
const urls = [
  ["conus-east GEOCOLOR oldest frame", band("conus-east", "GEOCOLOR")?.frames[0]?.url],
  ["conus-east GEOCOLOR newest frame", band("conus-east", "GEOCOLOR")?.latest],
  ["conus-east AirMass newest frame", band("conus-east", "AirMass")?.latest],
  ["conus-west Sandwich newest frame", band("conus-west", "Sandwich")?.latest],
  ["conus-west GEOCOLOR MP4 loop", band("conus-west", "GEOCOLOR")?.loop?.mp4],
  ["se AirMass latest (alias)", band("se", "AirMass")?.latest],
  ["sp GEOCOLOR newest frame", band("sp", "GEOCOLOR")?.latest],
  ["taw GEOCOLOR newest frame", band("taw", "GEOCOLOR")?.latest],
  ["hi GEOCOLOR newest frame", band("hi", "GEOCOLOR")?.latest],
  ["fd-east GEOCOLOR newest frame", band("fd-east", "GEOCOLOR")?.latest],
  ["fd-west 13 newest frame", band("fd-west", "13")?.latest],
  ...cat.meso.filter((m) => m.bands.length).map((m) => [`meso ${m.sat} ${m.id} newest frames`, m.bands[0].latest]),
  ...cat.meso.filter((m) => m.bands.length).map((m) => [`meso ${m.sat} ${m.id} Sandwich newest`, m.bands.find((b) => b.id === "Sandwich")?.latest]),
];
out("\nURL checks:");
for (const [name, url] of urls) {
  let status = "missing";
  // One retry for network errors only (STAR's CDN stalls now and then); an
  // HTTP status is an answer.
  for (let attempt = 0; url && attempt < 2; attempt++) {
    status = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10e3) })
      .then((r) => r.status)
      .catch((e) => e.name);
    if (typeof status === "number") break;
  }
  check(status === 200, `${name}: ${status}`);
  out(`  ${String(status).padEnd(4)} ${name}`);
}

out("\nnotes:");
for (const n of cat.notes) out(`  - ${n}`);
if (problems.length) {
  out(`\nFAIL (${problems.length}):`);
  for (const p of problems) out(`  - ${p}`);
  proc.exit(1);
}
out("\nOK");
