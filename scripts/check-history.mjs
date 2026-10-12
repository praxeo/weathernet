// Live check for src/sources/history.js (hits ACIS; tornadoes from public/).
//
//   cd /home/user/weathernet && NODE_USE_ENV_PROXY=1 node scripts/check-history.mjs
//
// Prints each case's station, records, normals, series length and top
// tornadoes, cross-checks the yearly-interval series against a full daily
// pull and the records against ACIS's own smry max/min, and asserts a few
// known facts. Exits 1 if any check fails.
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

// Same shape as dev-server.mjs: serve public/ by pathname.
const env = {
  NWS_USER_AGENT: "WeatherNet/0.1 (check-history)",
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

const { climateHistory, TRACE } = await import("../src/sources/history.js");

const out = (s = "") => proc.stdout.write(s + "\n");
let failures = 0;
const check = (ok, label) => {
  out(`  ${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failures++;
};

async function acis(p, params) {
  const r = await fetch("https://data.rcc-acis.org/" + p, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": env.NWS_USER_AGENT },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(30e3),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
}

const rec = (r) => (r ? `${r.display} (${r.years.length ? r.years.join(", ") : "every year"})` : "—");
const tor = (t) => `${t.year} ${t.scale ?? "?"} ${t.place} — ${t.fatalities} dead, ${t.injuries} injured, ${t.lenMi} mi track, starts ${t.distMi} mi away`;

function show(label, h, ms) {
  out(`\n== ${label} — ${h.date} (${ms} ms)`);
  const s = h.station;
  out(s ? `station ${s.sid} "${s.name}"${s.site ? ` [${s.site}]` : ""} ${s.distMi} mi, POR ${s.por && s.por.start}..${s.por && s.por.end}, threadex=${s.threadex}` : "station: none");
  const R = h.records;
  if (R) {
    out(`record high ${rec(R.maxt && R.maxt.high)} · coldest high ${rec(R.maxt && R.maxt.low)} · warmest low ${rec(R.mint && R.mint.high)} · record low ${rec(R.mint && R.mint.low)}`);
    out(`record precip ${rec(R.pcpn && R.pcpn.max)} · record snow ${R.snow ? rec(R.snow.max) : "none on record"} · n=${R.maxt && R.maxt.n}/${R.mint && R.mint.n}/${R.pcpn && R.pcpn.n}`);
  }
  out(`normals ${JSON.stringify(h.normals)}`);
  out(`series ${h.series ? `${h.series.years.length} years ${h.series.years[0]}–${h.series.years.at(-1)}` : "none"}`);
  out(`recent ${JSON.stringify(h.recent)}`);
  const T = h.tornadoes;
  if (T) {
    out(`tornadoes: ${T.localCount} within ${T.localRadiusMi} mi, ${T.nationalCount} nationwide (${T.years.join("–")})`);
    T.local.slice(0, 3).forEach((t) => out(`  local    ${tor(t)}`));
    T.notable.slice(0, 3).forEach((t) => out(`  notable  ${tor(t)}`));
  } else out("tornadoes: none");
  if (h.notes.length) out(`notes: ${h.notes.join(" | ")}`);
}

async function run(label, lat, lon, date) {
  const t0 = Date.now();
  const h = await climateHistory(lat, lon, { date, env, ctx });
  show(label, h, Date.now() - t0);
  return h;
}

// Records recomputed by ACIS itself (smry over the same yearly-interval series).
async function smryCheck(h) {
  const { sid } = h.station;
  const first = `${h.series.years[0]}-${h.monthDay}`, last = `${h.series.years.at(-1)}-${h.monthDay}`;
  const el = (name, reduce) => ({ name, interval: [1, 0, 0], duration: 1, smry: { reduce, add: "date" }, smry_only: 1 });
  const j = await acis("StnData", { sid, sdate: first, edate: last, elems: [el("maxt", "max"), el("maxt", "min"), el("mint", "max"), el("mint", "min"), el("pcpn", "max")] });
  const ours = [h.records.maxt.high, h.records.maxt.low, h.records.mint.high, h.records.mint.low, h.records.pcpn.max];
  ["maxt high", "maxt low", "mint high", "mint low", "pcpn max"].forEach((label, i) => {
    const [v, date] = j.smry[i];
    const val = v === "T" ? TRACE : Number(v);
    const yearOk = ours[i].value === 0 || ours[i].years.includes(Number(date.slice(0, 4)));
    check(val === ours[i].value && yearOk, `${label}: ours ${ours[i].display} ${ours[i].years.join("/")} vs ACIS smry ${v} ${date}`);
  });
}

// One year's value from the yearly series vs that year's full daily pull.
async function dailyPullCheck(h, year) {
  const j = await acis("StnData", { sid: h.station.sid, sdate: `${year}-01-01`, edate: `${year}-12-31`, elems: ["maxt", "mint", "pcpn", "snow"] });
  const row = j.data.find((r) => r[0] === `${year}-${h.monthDay}`);
  const i = h.series.years.indexOf(year);
  const conv = (v) => (v === "T" ? TRACE : v === "M" || v === "S" || /A$/.test(v) ? null : Number(v));
  const theirs = row.slice(1).map(conv);
  const ours = ["maxt", "mint", "pcpn", "snow"].map((k) => h.series[k][i]);
  check(JSON.stringify(theirs) === JSON.stringify(ours), `series ${year}-${h.monthDay} ${JSON.stringify(ours)} vs daily pull ${JSON.stringify(row.slice(1))}`);
}

const bhm = await run("Birmingham, AL", 33.52, -86.81, "2026-10-09");
out("checks:");
check(bhm.station && bhm.station.sid === "BHMthr", "nearest ThreadEx is BHMthr");
check(bhm.station && bhm.station.por && bhm.station.por.start === "1895-04-01", "BHMthr record begins 1895-04-01");
check(bhm.series && bhm.series.years.length >= 130 && bhm.series.years.every((y, i, a) => !i || y === a[i - 1] + 1), "series covers 130+ consecutive years");
check(bhm.normals && bhm.normals.maxt === 79 && bhm.normals.mint === 57, "1991–2020 normals for Oct 9 are 79/57");
await dailyPullCheck(bhm, 1954);
await dailyPullCheck(bhm, bhm.records.maxt.high.years[0]);
await smryCheck(bhm);

const apr27 = await run("Birmingham, AL", 33.52, -86.81, "2026-04-27");
out("checks:");
const t2011 = (apr27.tornadoes ? apr27.tornadoes.local : []).filter((t) => t.year === 2011);
check(t2011.some((t) => t.scale === "EF4" && t.county === "Greene Co." && t.fatalities === 64), "04-27 local list has the 2011 Tuscaloosa–Birmingham EF4 (64 deaths, from Greene Co.)");
check(t2011.some((t) => t.scale === "EF5" && t.fatalities === 72), "04-27 local list has the 2011 Hackleburg–Phil Campbell EF5 (72 deaths)");
check(apr27.tornadoes && apr27.tornadoes.notable[0].year === 2011, "04-27 deadliest nationwide is from 2011");
check(apr27.recent && apr27.recent.yesterday && apr27.recent.yesterday.date === "2026-04-26", "yesterday relative to the requested date");
await smryCheck(apr27);

const okc = await run("Oklahoma City, OK", 35.47, -97.52, "2026-05-03");
out("checks:");
const moore = (okc.tornadoes ? okc.tornadoes.local : []).find((t) => t.year === 1999 && t.mag === 5);
check(okc.station && okc.station.sid === "OKCthr", "nearest ThreadEx is OKCthr");
check(!!moore && moore.scale === "F5" && moore.fatalities === 36 && moore.county === "Grady Co.", "05-03 local list has the 1999 Bridge Creek–Moore F5 (36 deaths, from Grady Co.)");
check(okc.tornadoes && okc.tornadoes.local[0] === moore, "…and it ranks first locally");
await smryCheck(okc);

const mia = await run("Miami, FL", 25.76, -80.19);
out("checks:");
check(mia.station && mia.station.sid === "MIAthr", "nearest ThreadEx is MIAthr");
check(mia.records && mia.records.snow === null, "no snow record for Miami");

// Leap day: records from leap years only, and a 02-29 tornado file.
const leap = await run("Birmingham, AL (leap day)", 33.52, -86.81, "2024-02-29");
out("checks:");
check(leap.series && leap.series.years.every((y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0), "02-29 series holds leap years only");
check(leap.tornadoes && leap.tornadoes.nationalCount > 0 && leap.tornadoes.notable.every((t) => t.date.endsWith("-02-29")), "02-29 tornado file read");

// Second call is served from the edge-cache stand-in.
const t0 = Date.now();
await climateHistory(33.52, -86.81, { date: "2026-10-09", env, ctx });
check(Date.now() - t0 < 500, `cached repeat call is fast (${Date.now() - t0} ms)`);

out(`\n${failures ? `${failures} check(s) FAILED` : "all checks passed"}`);
proc.exit(failures ? 1 : 0);
