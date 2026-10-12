// Live check for src/sources/archive.js (hits IEM, ACIS and the NWS points
// API; tornado tracks from public/).
//
//   cd /home/user/weathernet && NODE_USE_ENV_PROXY=1 node scripts/check-archive.mjs
//
// Runs each archive function on days whose facts are well documented
// (27 April 2011 in central Alabama, 20 May 2013 at Moore) and asserts them.
// Exits 1 if any check fails.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import proc from "node:process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");

// Cache API stand-in (as in dev-server.mjs) so edgeJSON runs its real path.
const store = new Map();
globalThis.caches = {
  default: {
    async match(req) {
      const e = store.get(typeof req === "string" ? req : req.url);
      return e ? new Response(e.slice(0), { headers: { "content-type": "application/json" } }) : undefined;
    },
    async put(req, res) {
      store.set(typeof req === "string" ? req : req.url, await res.arrayBuffer());
    },
  },
};

const env = {
  NWS_USER_AGENT: "WeatherNet/0.1 (check-archive)",
  ASSETS: {
    async fetch(req) {
      const rel = decodeURIComponent(new URL(req.url).pathname);
      const file = path.join(PUBLIC, rel);
      if (!file.startsWith(PUBLIC) || !existsSync(file)) return new Response("Not found", { status: 404 });
      return new Response(await readFile(file), { headers: { "content-type": "application/json" } });
    },
  },
};
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };

const A = await import("../src/sources/archive.js");

const out = (s = "") => proc.stdout.write(s + "\n");
let failures = 0;
const check = (ok, label) => {
  out(`  ${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failures++;
};
async function timed(label, fn) {
  const t = Date.now();
  try {
    const v = await fn();
    out(`\n== ${label} (${Date.now() - t} ms)`);
    return v;
  } catch (e) {
    out(`\n== ${label} (${Date.now() - t} ms)\n  FAIL threw: ${e.stack || e}`);
    failures++;
    return null;
  }
}

const SHELBY = { lat: 33.21, lon: -86.65 };
const MOORE = { lat: 35.33, lon: -97.48 };

// ── Products ────────────────────────────────────────────────────────────────
const list = await timed("BMX AFDs, 2011-04-27 UTC", () => A.listProducts({ office: "BMX", type: "AFD", date: "2011-04-27", env, ctx }));
if (list) {
  out(list.products.map((p) => `  ${p.issued} ${p.id}`).join("\n"));
  check(list.products.length >= 4, `at least 4 AFDs (${list.products.length})`);
  check(list.products.some((p) => p.id === "201104270252-KBMX-FXUS64-AFDBMX"), "includes the 0252Z issuance");
  check(list.products.every((p, i, a) => !i || a[i - 1].issued >= p.issued), "newest first");
}

const legacy = await timed("OUN AFDs, 1999-05-03 (city-id era)", () => A.listProducts({ office: "OUN", date: "1999-05-03", env, ctx }));
if (legacy) {
  out(`  pils: ${[...new Set(legacy.products.map((p) => p.pil))].join(", ")}`);
  check(legacy.products.some((p) => p.pil === "AFDOKC"), "AFDOKC found under KOUN");
}

const one = await timed("one product by id", () => A.archivedProduct("201104270252-KBMX-FXUS64-AFDBMX", { env, ctx }));
if (one) {
  out(`  ${one.text.split("\n").slice(0, 7).join(" / ")}`);
  out(`  sections: ${(one.sections || []).map((s) => s.title).join(" | ")}`);
  check(/SIGNIFICANT SEVERE WEATHER OUTBREAK/.test(one.text), "headline present");
  check(!/^\d{3}\s/.test(one.text) && !one.text.includes("\x01"), "sequence number and control characters stripped");
  check(Array.isArray(one.sections) && one.sections.some((s) => /^UPDATE/.test(s.title)), "sections parsed");
}

const at = await timed("BMX AFD in force 2011-04-27 15Z, 3 back", () => A.productsAt({ office: "BMX", at: "2011-04-27T15:00Z", count: 3, env, ctx }));
if (at) {
  out(at.products.map((p) => `  ${p.issued} ${p.id} (${p.text.length} chars)`).join("\n"));
  check(at.products.length === 3, "three issuances");
  check(at.products.every((p) => p.issued <= "2011-04-27T15:00:00Z"), "all at or before 15Z");
  check(at.products[0].issued > at.products[2].issued, "newest first");
}

const spc = await timed("SPC Day 1 text, 2011-04-27 18Z", () => A.productsAt({ office: "SPC", type: "SWODY1", at: "2011-04-27T18:00Z", env, ctx }));
if (spc) {
  const p = spc.products[0];
  out(`  ${p && p.id}`);
  check(p && p.office === "KWNS" && /HIGH RISK/.test(p.text), "SPC 1630Z Day 1 with HIGH RISK");
}

// National centers file under several WMO ids (WPC: KWBC, but KWNH for MPDs).
for (const [office, type, pil] of [["WPC", "QPFERD", "QPFERD"], ["WPC", "FFGMPD", "FFGMPD"], ["NHC", "TCD", "TCDAT"], ["SPC", "SWOMCD", "SWOMCD"]]) {
  const l = await timed(`${office} ${type}, 2024-09-26`, () => A.listProducts({ office, type, date: "2024-09-26", env, ctx }));
  if (l) check(l.products.some((p) => p.pil.startsWith(pil)), `${office} ${type} found under ${l.office} (${l.products.length})`);
}

for (const [label, fn] of [
  ["bad office", () => A.listProducts({ office: "X1", env })],
  ["bad id", () => A.archivedProduct("not-an-id", { env })],
  ["future date", () => A.dayHistory(SHELBY.lat, SHELBY.lon, { date: "2999-01-01", env })],
]) {
  try {
    await fn();
    check(false, `${label} rejected`);
  } catch (e) {
    check(e.status === 400, `${label} → 400 (${e.message})`);
  }
}

// ── A day ───────────────────────────────────────────────────────────────────
function showDay(d) {
  out(`  office ${d.office}, ${d.timeZone}, window ${d.window.start} → ${d.window.end}, place ${d.point.place}`);
  if (d.unavailable.length) out(`  UNAVAILABLE ${JSON.stringify(d.unavailable)}`);
  const c = d.climate;
  if (c) out(`  climate ${c.station.sid} "${c.station.name}" ${c.station.distMi} mi: ${JSON.stringify(c.observed)} normal ${JSON.stringify(c.normal)} dep ${JSON.stringify(c.departure)}`);
  const h = d.hourly;
  if (h) out(`  hourly ${h.station.id} "${h.station.name}" ${h.station.distMi} mi: ${h.obs.length} obs, ${JSON.stringify(h.summary)}`);
  for (const o of (d.outlooks && d.outlooks.outlooks) || []) out(`  outlook ${o.outlook} day ${o.day} ${o.issued}: ${o.risk && o.risk.code} ${JSON.stringify(o.probabilities)} sig ${o.significant}`);
  for (const w of d.warnings || []) out(`  warning ${w.issued.slice(11, 16)}Z ${w.event} ${w.office}#${w.eventId} inPolygon=${w.inPolygon}${w.motion ? ` motion ${w.motion.fromDeg}°/${w.motion.kt}kt` : ""}`);
  out(`  storm reports ${d.stormReports && d.stormReports.length}: ${(d.stormReports || []).slice(0, 4).map((r) => `${r.time.slice(11, 16)}Z ${r.type} ${r.place} (${r.distMi} mi)`).join("; ")}`);
  const t = d.tornadoes;
  if (t) out(`  tornadoes within ${t.radiusMi} mi: ${t.near.map((x) => `${x.rating} ${x.county || x.state} closest ${x.closestMi} mi`).join("; ") || "none"} (nationally that day ${t.nationalCount})`);
  out(`  AFDs that day: ${(d.discussions || []).map((p) => p.issued.slice(11, 16) + "Z").join(", ")}`);
}

const apr27 = await timed("Shelby County AL, 2011-04-27", () => A.dayHistory(SHELBY.lat, SHELBY.lon, { date: "2011-04-27", env, ctx }));
if (apr27) {
  showDay(apr27);
  check(apr27.unavailable.length === 0, "every source answered");
  check(apr27.office === "BMX" && apr27.window.start === "2011-04-27T05:00:00.000Z", "BMX, CDT local day");
  check(apr27.outlooks.outlooks.some((o) => o.risk && o.risk.code === "HIGH"), "SPC High Risk at the point");
  check(apr27.warnings.some((w) => w.phenomena === "TO" && w.significance === "A"), "under a Tornado Watch");
  check(apr27.warnings.some((w) => w.phenomena === "TO" && w.significance === "W"), "Tornado Warning(s) that day");
  check(apr27.stormReports.length > 5, "storm reports nearby");
  check(apr27.climate && apr27.climate.observed.maxt === 84 && apr27.climate.observed.pcpn === 1.12, "Birmingham: 84°F, 1.12 in (ACIS)");
  check(apr27.hourly && apr27.hourly.obs.length >= 20, "hourly observations");
  check(apr27.tornadoes.nationalCount > 150, "the outbreak's national tornado count");
  check(apr27.discussions.length >= 3, "that day's AFDs listed");
}

const moore = await timed("Moore OK, 2013-05-20", () => A.dayHistory(MOORE.lat, MOORE.lon, { date: "2013-05-20", radiusMi: 10, env, ctx }));
if (moore) {
  showDay(moore);
  check(moore.office === "OUN", "OUN");
  check(moore.tornadoes.near.some((t) => t.rating === "EF5" && t.closestMi < 2), "the EF5 track passes within 2 mi");
  check(moore.warnings.some((w) => w.phenomena === "TO" && w.significance === "W" && w.inPolygon === true), "inside a Tornado Warning polygon");
}

// ── Tornadoes near a point ──────────────────────────────────────────────────
const near = await timed("tornadoes within 10 mi of Shelby County", () => A.tornadoesNear(SHELBY.lat, SHELBY.lon, { radiusMi: 10, env }));
if (near) {
  out(`  ${near.count} tracks ${near.years.join("–")}; byRating ${JSON.stringify(near.summary.byRating)}; deaths ${near.summary.fatalities}`);
  out(near.tornadoes.map((t) => `  ${t.date} ${t.rating} ${t.county}, ${t.state} closest ${t.closestMi} mi`).join("\n"));
  check(near.count === 18, "18 tracks (1950–2025)");
  check(near.tornadoes.some((t) => t.date === "2021-03-25" && t.rating === "EF3" && Math.abs(t.closestMi - 2.7) < 0.2), "2021-03-25 EF3 at ~2.7 mi");
  check(near.tornadoes.every((t, i, a) => !i || a[i - 1].date >= t.date), "newest first");
}
const since = await timed("…EF2+ within 25 mi since 1976", () => A.tornadoesNear(SHELBY.lat, SHELBY.lon, { radiusMi: 25, since: 1976, minRating: 2, env }));
if (since) {
  check(since.tornadoes.every((t) => t.mag >= 2 && t.date >= "1976"), `filters hold (${since.count} tracks)`);
}

// ── Daily series ────────────────────────────────────────────────────────────
const apr = await timed("daily, April 2011 near Shelby County", () => A.dailySeries(SHELBY.lat, SHELBY.lon, { start: "2011-04-01", end: "2011-04-30", env, ctx }));
if (apr) {
  out(`  ${apr.station.sid} "${apr.station.name}": ${JSON.stringify(apr.summary)}`);
  check(apr.rows.length === 30, "30 rows");
  check(apr.rows.find((r) => r[0] === "2011-04-27")?.[1] === 84, "27th matches the day view");
  check(apr.summary.pcpn.total > 0 && apr.summary.pcpn.normal > 0, "precip total and normal");
}

out(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
proc.exitCode = failures ? 1 : 0;
