// Build public/data/tornadoes/MM-DD.json — every US tornado (1950–latest) on
// each calendar day, from the SPC severe weather database, for the "this day
// in weather history" feature (src/sources/history.js reads one file per
// request through the ASSETS binding).
//
//   NODE_USE_ENV_PROXY=1 node scripts/build-tornadoes.mjs
//     [--csv <path|url>]       SPC 1950-YYYY_all_tornadoes.csv (default: newest
//                              one linked from https://www.spc.noaa.gov/wcm/)
//     [--counties <path|url>]  Census county reference (default: 2020 codes)
//     [--out <dir>]            default public/data/tornadoes
//
// Run it offline once a year, after SPC releases the prior year's final data
// (spring). Output is 366 compact JSON files (02-29 included):
//
//   { md, years: [first, last], efFrom, src, cols, rows }
//   cols = ["yr","st","mag","fat","inj","len","wid","slat","slon","elat","elon","county"]
//   e.g. [2011,"AL",5,72,145,132,2200,34.1043,-88.1479,35.0857,-86.1511,"Marion Co."]
//
// Also grid/<lat>_<lon>.json, the same tracks indexed by 1° cell for
// "tornadoes near a point" (see writeGrid below).
//
// mag is the F/EF number (null = unknown; SPC's -9). Rows from year >= efFrom
// are Enhanced Fujita ratings (EF in service 2007-02-01, so efFrom is 2007 for
// Feb–Dec days and 2008 for January days). len is miles, wid yards; elat/elon
// are null when SPC has no end point. county is the touchdown county.
//
// Why the "all" file, not "actual": both carry the same whole-track rows
// (sg=1), but a multi-state tornado's whole-track row (ns=2|3, sn=0, sg=1) has
// no county FIPS — that lives on its state segments (sg=2), which only the
// "all" file has. Per the SPC format spec (SPC_severe_database_description.pdf):
//   1,1,1 = entire track (single state)      1,0,-9 = continuing county list
//   2,0,1 / 3,0,1 = entire multi-state track (st = state of touchdown)
//   2,1,2 / 3,1,2 = one state's segment      2,0,-9 = continuing county list
// Since the 2025 release, 2007+ "om" ids are YYMMDDHHMM-NN and a tornado's
// whole track and segments get different suffixes, so the touchdown segment
// is matched by date + state + identical start point (older rows also share
// om, which is the fallback).
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import proc from "node:process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPC_WCM = "https://www.spc.noaa.gov/wcm/";
const COUNTIES_URL = "https://www2.census.gov/geo/docs/reference/codes2020/national_county2020.txt";
const UA = "WeatherNet/0.1 build-tornadoes (offline data build)";
const COLS = ["yr", "st", "mag", "fat", "inj", "len", "wid", "slat", "slon", "elat", "elon", "county"];

// County FIPS codes SPC rows use that the 2020 Census file no longer has.
// Verified against Census "Substantial Changes to Counties" (1970s–2010s pages):
const RETIRED_COUNTIES = {
  "FL-025": "Dade Co.", //         renamed Miami-Dade (12-086), 1997
  "SD-113": "Shannon Co.", //      renamed Oglala Lakota (46-102), 2015
  "SD-131": "Washabaugh Co.", //   merged into Jackson (46-071), 1979
  "VA-123": "Nansemond Co.", //    merged into Suffolk city (51-800), 1972
  "VA-780": "South Boston city", // became a town in Halifax Co., 1995
};

function arg(name) {
  const i = proc.argv.indexOf(name);
  return i > 0 ? proc.argv[i + 1] : undefined;
}

async function load(src, label) {
  if (!/^https?:\/\//.test(src)) return readFile(src, "utf8");
  const r = await fetch(src, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(180e3) });
  if (!r.ok) throw new Error(`${label}: HTTP ${r.status} from ${src}`);
  return r.text();
}

// The newest "1950-YYYY_all_tornadoes.csv" linked from the WCM page.
async function latestCsvUrl() {
  const html = await load(SPC_WCM, "SPC WCM page");
  const years = [...html.matchAll(/data\/1950-(\d{4})_all_tornadoes\.csv/g)].map((m) => Number(m[1]));
  if (!years.length) throw new Error("no 1950-YYYY_all_tornadoes.csv link on " + SPC_WCM);
  return `${SPC_WCM}data/1950-${Math.max(...years)}_all_tornadoes.csv`;
}

// Minimal CSV: SPC's file is plain ASCII with no quoting, but tolerate quotes
// and CRLF anyway.
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  const split = (line) => {
    if (!line.includes('"')) return line.split(",");
    const out = [];
    let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  const head = split(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const v = split(l);
    const o = {};
    head.forEach((h, i) => (o[h] = (v[i] ?? "").trim()));
    return o;
  });
}

// "Tuscaloosa County" → "Tuscaloosa Co."; parishes, boroughs, census areas
// and Virginia's independent cities keep their Census names.
const shortCounty = (name) => name.replace(/ County$/, " Co.");

function countyNames(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/).slice(1)) {
    const p = line.split("|");
    if (p.length >= 5 && /^[A-Z]{2}$/.test(p[0]) && /^\d{3}$/.test(p[2])) map.set(`${p[0]}-${p[2]}`, shortCounty(p[4]));
  }
  if (map.size < 3000) throw new Error(`county file looks wrong (${map.size} counties)`);
  return map;
}

const num = (s) => (s === "" || s == null ? NaN : Number(s));
const pad2 = (n) => String(n).padStart(2, "0");

// ── Spatial index ────────────────────────────────────────────────────────────
// grid/<lat>_<lon>.json holds every track whose start–end box touches that 1°
// cell (SW corner, e.g. 33_-87 covers 33–34°N, 87–86°W), for "tornadoes near
// a point" (src/sources/archive.js). A track crossing cells is in each; its id
// ("MM-DD/<row in that day file>") dedupes them.
const GRID_COLS = ["date", "st", "mag", "fat", "inj", "len", "wid", "slat", "slon", "elat", "elon", "county", "id"];

function addToGrid(grid, row, md, i) {
  const [yr, st, mag, fat, inj, len, wid, slat, slon, elat, elon, county] = row;
  const lat2 = elat ?? slat, lon2 = elon ?? slon;
  const out = [`${yr}-${md}`, st, mag, fat, inj, len, wid, slat, slon, elat, elon, county, `${md}/${i}`];
  for (let y = Math.floor(Math.min(slat, lat2)); y <= Math.floor(Math.max(slat, lat2)); y++) {
    for (let x = Math.floor(Math.min(slon, lon2)); x <= Math.floor(Math.max(slon, lon2)); x++) {
      const k = `${y}_${x}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(out);
    }
  }
}

async function writeGrid(grid, dir, { years, src }) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  let bytes = 0, rows = 0;
  for (const [k, list] of grid) {
    list.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const [y, x] = k.split("_").map(Number);
    const body = JSON.stringify({ cell: [y, x], years, efFrom: "2007-02-01", src, cols: GRID_COLS, rows: list });
    await writeFile(path.join(dir, `${k}.json`), body);
    bytes += Buffer.byteLength(body);
    rows += list.length;
  }
  return { files: grid.size, bytes, rows };
}

async function main() {
  const csvSrc = arg("--csv") || (await latestCsvUrl());
  const outDir = path.resolve(ROOT, arg("--out") || "public/data/tornadoes");
  const [csvText, cntyText] = await Promise.all([load(csvSrc, "SPC CSV"), load(arg("--counties") || COUNTIES_URL, "county file")]);
  const all = parseCsv(csvText);
  const names = countyNames(cntyText);
  for (const k of ["om", "yr", "date", "time", "tz", "st", "mag", "inj", "fat", "slat", "slon", "elat", "elon", "len", "wid", "ns", "sn", "sg", "f1"]) {
    if (!(k in all[0])) throw new Error(`SPC CSV has no "${k}" column — format changed?`);
  }

  // State segments, for multi-state tracks' touchdown county.
  const segByStart = new Map();
  const segByOm = new Map();
  for (const r of all) {
    if (r.sg !== "2") continue;
    const a = `${r.date}|${r.st}|${num(r.slat)}|${num(r.slon)}`;
    const b = `${r.yr}|${r.om}|${r.st}`;
    if (!segByStart.has(a)) segByStart.set(a, r);
    const prev = segByOm.get(b);
    if (!prev || r.time < prev.time) segByOm.set(b, r);
  }

  const stats = { rows: all.length, tracks: 0, multiState: 0, skipped: 0, county: { direct: 0, segment: 0, segmentByOm: 0, retired: 0, unknown: 0, invalid: 0 } };
  const invalidCodes = new Map();
  const byDay = new Map();
  let firstYear = Infinity, lastYear = -Infinity;

  for (const r of all) {
    if (r.sg !== "1") continue; // whole tracks only — segments would double count
    let [y, m, d] = [num(r.yr), num(r.mo), num(r.dy)];
    let time = r.time;
    const slat = num(r.slat), slon = num(r.slon);
    if (!(y >= 1950 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) || !/^[A-Z]{2}$/.test(r.st) ||
        !Number.isFinite(slat) || !Number.isFinite(slon) || slat === 0) {
      stats.skipped++;
      continue;
    }
    // SPC converted everything to CST (tz=3) except a handful: 9 = GMT gets
    // shifted so the row lands on its CST calendar day. (Unknown/other codes
    // keep their date — 37 rows in the 2025 release, none near midnight.)
    if (r.tz === "9" && /^\d\d:\d\d/.test(time)) {
      const t = new Date(Date.UTC(y, m - 1, d, num(time.slice(0, 2)), num(time.slice(3, 5))) - 6 * 3600e3);
      [y, m, d] = [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
      time = `${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}:00`;
    }
    stats.tracks++;

    let f1 = r.f1;
    if (r.ns !== "1") {
      stats.multiState++;
      const seg = segByStart.get(`${r.date}|${r.st}|${slat}|${slon}`);
      const segOm = seg ? null : segByOm.get(`${r.yr}|${r.om}|${r.st}`);
      f1 = seg ? seg.f1 : segOm ? segOm.f1 : "0";
      if (seg) stats.county.segment++;
      else if (segOm) stats.county.segmentByOm++;
    }
    let county = null;
    const code = `${r.st}-${String(num(f1) || 0).padStart(3, "0")}`;
    if (!num(f1)) stats.county.unknown++;
    else if (names.has(code)) {
      county = names.get(code);
      if (r.ns === "1") stats.county.direct++;
    } else if (RETIRED_COUNTIES[code]) {
      county = RETIRED_COUNTIES[code];
      stats.county.retired++;
    } else {
      stats.county.invalid++;
      invalidCodes.set(code, (invalidCodes.get(code) || 0) + 1);
    }

    const mag = num(r.mag);
    const elat = num(r.elat), elon = num(r.elon);
    const hasEnd = Number.isFinite(elat) && Number.isFinite(elon) && elat !== 0 && elon !== 0;
    const md = `${pad2(m)}-${pad2(d)}`;
    const row = [
      y,
      r.st,
      mag >= 0 && mag <= 5 ? mag : null,
      Math.max(0, num(r.fat) || 0),
      Math.max(0, num(r.inj) || 0),
      Math.round((num(r.len) || 0) * 100) / 100,
      Math.round(num(r.wid) || 0),
      slat,
      slon,
      hasEnd ? elat : null,
      hasEnd ? elon : null,
      county,
    ];
    if (!byDay.has(md)) byDay.set(md, []);
    byDay.get(md).push({ row, sort: `${y}|${time}` });
    firstYear = Math.min(firstYear, y);
    lastYear = Math.max(lastYear, y);
  }

  await mkdir(outDir, { recursive: true });
  const src = `SPC ${path.basename(new URL(csvSrc, "file:///").pathname)} (sg=1 whole tracks)`;
  let total = 0, biggest = { md: "", bytes: 0, rows: 0 }, smallest = { md: "", bytes: Infinity, rows: 0 };
  const grid = new Map(); // "lat_lon" (1° cell, SW corner) → rows
  for (let mo = 1; mo <= 12; mo++) {
    for (let dy = 1; dy <= new Date(Date.UTC(2024, mo, 0)).getUTCDate(); dy++) { // 2024: leap year → 02-29
      const md = `${pad2(mo)}-${pad2(dy)}`;
      const rows = (byDay.get(md) || []).sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0)).map((x) => x.row);
      const body = JSON.stringify({ md, years: [firstYear, lastYear], efFrom: md >= "02-01" ? 2007 : 2008, src, cols: COLS, rows });
      await writeFile(path.join(outDir, `${md}.json`), body);
      const bytes = Buffer.byteLength(body);
      total += bytes;
      if (bytes > biggest.bytes) biggest = { md, bytes, rows: rows.length };
      if (bytes < smallest.bytes) smallest = { md, bytes, rows: rows.length };
      rows.forEach((row, i) => addToGrid(grid, row, md, i));
    }
  }
  const gridStats = await writeGrid(grid, path.join(outDir, "grid"), { years: [firstYear, lastYear], src });

  const kb = (b) => `${(b / 1024).toFixed(1)} KB`;
  proc.stdout.write(
    [
      `source: ${csvSrc}`,
      `rows read ${stats.rows}; whole tracks ${stats.tracks} (multi-state ${stats.multiState}); skipped ${stats.skipped}`,
      `years ${firstYear}-${lastYear}`,
      `county: single-state ${stats.county.direct}, multi-state via start-point segment ${stats.county.segment}, via om ${stats.county.segmentByOm}, ` +
        `retired code ${stats.county.retired}, unknown (f1=0) ${stats.county.unknown}, invalid code ${stats.county.invalid} ${JSON.stringify(Object.fromEntries(invalidCodes))}`,
      `wrote 366 files to ${path.relative(ROOT, outDir)}: total ${kb(total)} (${(total / 1048576).toFixed(2)} MB); ` +
        `largest ${biggest.md} ${kb(biggest.bytes)} (${biggest.rows} rows); smallest ${smallest.md} ${kb(smallest.bytes)} (${smallest.rows} rows)`,
      `grid: ${gridStats.files} 1° cells, ${gridStats.rows} rows (tracks repeat in each cell they cross), ${(gridStats.bytes / 1048576).toFixed(2)} MB`,
      "",
    ].join("\n"),
  );
}

main().catch((err) => {
  proc.stderr.write(String((err && err.stack) || err) + "\n");
  proc.exit(1);
});
