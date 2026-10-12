// Historical weather, for people and programs: archived NWS text products
// (Area Forecast Discussions back to ~2000 and everything else in the AFOS
// archive), what happened at a point on any past date, a climate station's
// daily values over a date range, and tornado tracks near a point since 1950.
// src/index.js serves these under /api/archive/* (JSON, open CORS) and as
// chat tools.
//
// Sources:
// - IEM (Iowa Environmental Mesonet): the AFOS text archive
//   (api/1/nws/afos/list, api/1/nwstext), VTEC events and storm-based warning
//   polygons by point, LSRs by point, SPC/WPC outlooks by point and valid
//   time, ASOS station networks and one-day observation history.
// - ACIS: the climate station's daily values and 1991–2020 normals. The
//   station is history.js's pick (nearest ThreadEx record), so a day here
//   matches the History section's records.
// - SPC severe weather database: public/data/tornadoes, built offline by
//   scripts/build-tornadoes.mjs. MM-DD.json by date, grid/<lat>_<lon>.json by
//   1° cell.
// - NWS points API: the point's forecast office (CWA), time zone and state.
//
// Discussions: IEM's archive starts around 1999–2001 depending on the office.
// Until ~2004 many offices filed AFDs under their city's id (AFDBHM, not
// AFDBMX; AFDOKC for Norman), so a 3-letter type is matched as a PIL prefix
// within the office's WMO id (KBMX), which catches both.
import { fetchJSON, fetchText, haversineMi, withDeadline, round } from "../lib/net.js";
import { edgeJSON, memo } from "../lib/cache.js";
import { TRACE, parseDate, addDays, acis, acisValue, tornadoDay, nearestClimateStation } from "./history.js";

const IEM = "https://mesonet.agron.iastate.edu";
const DAY_MS = 86400e3;
const MAX_DAILY_DAYS = 3660; // ~10 years per request
const MAX_TORNADO_RADIUS_MI = 100;

// Bad input → HTTP 400 (src/index.js); everything else is an upstream failure.
const inputError = (msg) => Object.assign(new Error(msg), { status: 400 });

// ── Dates and times ──────────────────────────────────────────────────────────
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const isoMinute = (ms) => new Date(ms).toISOString().slice(0, 16) + "Z";
const todayUTC = () => isoDate(Date.now());
// Past enough that the archive won't change: cache long.
const settled = (iso) => iso < addDays(todayUTC(), -3);

function requireDate(s, label = "date") {
  const d = parseDate(s);
  if (!d) throw inputError(`${label} must be a real YYYY-MM-DD date`);
  if (d.iso > addDays(todayUTC(), 1)) throw inputError(`${label} ${d.iso} is in the future`);
  return d;
}

// "2011-04-27" = the end of that UTC day; a time without a zone is UTC.
function parseAt(s) {
  const v = String(s || "").trim();
  if (!v) return Date.now();
  const t = /^\d{4}-\d{2}-\d{2}$/.test(v)
    ? Date.parse(v + "T23:59:59Z")
    : Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(v) ? v : v + "Z");
  if (!Number.isFinite(t)) throw inputError(`at must be an ISO time or YYYY-MM-DD, got "${v}"`);
  return Math.min(t, Date.now());
}

// Minutes the zone is ahead of UTC at an instant.
function tzOffsetMin(tz, ms) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]),
  );
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms) / 60e3;
}

// The UTC instant of local midnight starting a date (two passes for DST days).
function localMidnight(iso, tz) {
  const guess = Date.parse(iso + "T00:00:00Z");
  const first = guess - tzOffsetMin(tz, guess) * 60e3;
  return guess - tzOffsetMin(tz, first) * 60e3;
}

// ── Offices ──────────────────────────────────────────────────────────────────
// WMO ids for WFOs outside the K prefix and for the national centers. WPC
// files its discussions (QPFERD, PMDSPD, PMDEPD) under KWBC but its
// mesoscale precipitation discussions (FFGMPD) under KWNH.
const CCCC = {
  AFC: "PAFC", AFG: "PAFG", AJK: "PAJK", HFO: "PHFO", GUM: "PGUM", SJU: "TJSJ",
  SPC: "KWNS", WPC: "KWBC", NHC: "KNHC", CPC: "KWNC",
};

export function officeCode(office, type = "") {
  const o = String(office || "").trim().toUpperCase();
  if (/^[A-Z]{4}$/.test(o)) return o;
  if (o === "WPC" && type.startsWith("FFG")) return "KWNH";
  if (/^[A-Z]{3}$/.test(o)) return CCCC[o] || "K" + o;
  throw inputError(`office must be a 3-letter NWS office (BMX, OUN) or a 4-letter WMO id (KBMX), got "${office}"`);
}

function productType(type) {
  const t = String(type || "AFD").trim().toUpperCase();
  if (!/^[A-Z0-9]{3,6}$/.test(t)) throw inputError(`type must be a 3–6 character AFOS id (AFD, HWO, PNS, SWODY1), got "${type}"`);
  return t;
}

// The point's office, time zone and state (cached a month; offices and zones
// don't move).
export async function pointInfo(lat, lon, { env, ctx } = {}) {
  const la = round(lat, 4), lo = round(lon, 4);
  return edgeJSON(`archive/v1/point/${la},${lo}`, 30 * 86400, async () => {
    const j = await fetchJSON(`https://api.weather.gov/points/${la},${lo}`, { env, ttl: 86400, timeoutMs: 10e3 });
    const p = j && j.properties;
    if (!p || !p.cwa) throw new Error("no NWS forecast office covers this point");
    const rel = (p.relativeLocation && p.relativeLocation.properties) || {};
    return { office: p.cwa, timeZone: p.timeZone || null, state: rel.state || null, place: rel.city ? `${rel.city}, ${rel.state}` : null };
  }, ctx);
}

// ── Text products ────────────────────────────────────────────────────────────
// IEM product id: YYYYMMDDHHMM-CCCC-TTAAII-PIL[-BBB], issuance time in UTC.
const ID_RE = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})-([A-Z]{4})-([A-Z0-9]{6})-([A-Z0-9]{3,6})(?:-([A-Z]{3}))?$/;

function idMeta(id) {
  const m = ID_RE.exec(String(id || ""));
  if (!m) return null;
  return { id: m[0], issued: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z`, office: m[6], wmo: m[7], pil: m[8], correction: m[9] || null };
}

// One UTC day's issuances of a product type from one office, oldest first.
async function listDay(cccc, type, day, env, ctx) {
  const old = settled(day);
  return edgeJSON(`archive/v1/afos/${cccc}/${type}/${day}`, old ? 30 * 86400 : 300, async () => {
    const j = await fetchJSON(`${IEM}/api/1/nws/afos/list.json?cccc=${cccc}&pil=${type}&date=${day}`, { env, ttl: old ? 86400 : 120 });
    const seen = new Set();
    return (j.data || [])
      .map((r) => idMeta(r.product_id))
      .filter((p) => p && !seen.has(p.id) && seen.add(p.id))
      .sort((a, b) => a.issued.localeCompare(b.issued));
  }, ctx);
}

// Product listing over `days` UTC days ending on `date`, newest first.
export async function listProducts({ office, type, date, days = 1, env, ctx }) {
  const t = productType(type);
  const cccc = officeCode(office, t);
  const d = requireDate(date || todayUTC());
  const n = Math.min(7, Math.max(1, Math.floor(Number(days)) || 1));
  const lists = await Promise.all(Array.from({ length: n }, (_, i) => listDay(cccc, t, addDays(d.iso, -i), env, ctx)));
  const products = lists.flat().sort((a, b) => b.issued.localeCompare(a.issued));
  return {
    office: cccc,
    type: t,
    from: addDays(d.iso, -(n - 1)),
    to: d.iso,
    dates: "UTC",
    count: products.length,
    products,
    notes: products.length ? [] : [`No ${t} from ${cccc} in IEM's archive for these dates.`],
  };
}

function cleanText(raw) {
  return String(raw)
    .replace(/[\x01\x03\r]/g, "")
    .replace(/^\s*\d{3}\s*\n/, "") // transmission sequence number
    .trim();
}

// AFD-style sections (".SYNOPSIS...", ".SHORT TERM /Tonight/...", "&&"
// between, "$$" at the end). null when the product isn't laid out that way.
function sections(text) {
  const out = [];
  let cur = null;
  for (const line of text.split("\n")) {
    const m = /^\.([A-Z][^.]*?)\.\.\.(.*)$/.exec(line);
    if (m) {
      if (cur) out.push(cur);
      cur = { title: m[1].trim(), lines: m[2].trim() ? [m[2].trim()] : [] };
    } else if (/^(&&|\$\$)\s*$/.test(line)) {
      if (cur) out.push(cur);
      cur = null;
    } else if (cur) cur.lines.push(line);
  }
  if (cur) out.push(cur);
  const res = out.map((s) => ({ title: s.title, text: s.lines.join("\n").trim() })).filter((s) => s.text);
  return res.length >= 2 ? res : null;
}

export async function archivedProduct(id, { env, ctx } = {}) {
  const meta = idMeta(id);
  if (!meta) throw inputError(`id must be an IEM product id like 201104271505-KBMX-FXUS64-AFDBMX, got "${id}"`);
  return edgeJSON(`archive/v1/text/${meta.id}`, 30 * 86400, async () => {
    const text = cleanText(await fetchText(`${IEM}/api/1/nwstext/${meta.id}`, { env, ttl: 86400 }));
    if (!text) throw new Error(`empty text for ${meta.id}`);
    return { ...meta, text, sections: sections(text), link: `${IEM}/p.php?pid=${meta.id}` };
  }, ctx);
}

// The `count` most recent issuances at or before `at`, with text. Looks back
// up to a week of UTC days, one day at a time.
export async function productsAt({ office, type, at, count = 1, env, ctx }) {
  const t = productType(type);
  const cccc = officeCode(office, t);
  const when = parseAt(at);
  const n = Math.min(5, Math.max(1, Math.floor(Number(count)) || 1));
  const found = [];
  for (let back = 0; back < 7 && found.length < n; back++) {
    const list = await listDay(cccc, t, isoDate(when - back * DAY_MS), env, ctx);
    found.push(...list.filter((p) => Date.parse(p.issued) <= when).reverse());
  }
  const picked = found.slice(0, n);
  const products = await Promise.all(picked.map((p) => archivedProduct(p.id, { env, ctx })));
  return {
    office: cccc,
    type: t,
    at: new Date(when).toISOString(),
    count: products.length,
    products,
    notes: products.length ? [] : [`No ${t} from ${cccc} in the week before ${isoMinute(when)} in IEM's archive.`],
  };
}

// ── What happened at a point on a date ───────────────────────────────────────
// Phenomena NWS warns by polygon (storm-based warnings, official Oct 2007).
const SBW = new Set(["TO", "SV", "FF", "EW", "MA", "SQ", "DS"]);
const SBW_SINCE = "2007-10-01";

async function warningsAt(lat, lon, start, end, iso, env) {
  const q = `lat=${round(lat, 4)}&lon=${round(lon, 4)}&sdate=${addDays(iso, -1)}&edate=${addDays(iso, 1)}`;
  const ttl = settled(iso) ? 86400 : 300;
  const [ev, sbw] = await Promise.all([
    fetchJSON(`${IEM}/json/vtec_events_bypoint.py?${q}`, { env, ttl }),
    fetchJSON(`${IEM}/json/sbw_by_point.py?${q}`, { env, ttl }),
  ]);
  const overlaps = (e) => Date.parse(e.issue) < end && Date.parse(e.expire) > start;
  const key = (e) => `${e.wfo}.${e.phenomena}.${e.significance}.${e.eventid}.${String(e.issue).slice(0, 4)}`;
  const inPoly = new Map((sbw.sbws || []).filter(overlaps).map((e) => [key(e), e]));
  const out = new Map();
  for (const e of [...(sbw.sbws || []), ...(ev.events || [])]) {
    const k = key(e);
    if (!overlaps(e) || out.has(k)) continue;
    const polygonPhenom = SBW.has(e.phenomena) && e.significance === "W";
    const poly = inPoly.get(k);
    out.set(k, {
      event: e.name || `${e.ph_name || e.phenomena} ${e.sig_name || e.significance}`,
      phenomena: e.phenomena,
      significance: e.significance,
      office: e.wfo,
      eventId: e.eventid,
      issued: new Date(Date.parse(e.issue)).toISOString(),
      expires: new Date(Date.parse(e.expire)).toISOString(),
      // true: the point was inside the warning polygon. false: its county was
      // warned but the polygon missed it.
      inPolygon: poly ? true : polygonPhenom && String(e.issue) >= SBW_SINCE ? false : null,
      motion: poly && poly.tml_sknt != null ? { fromDeg: poly.tml_direction, kt: poly.tml_sknt } : undefined,
      link: e.url ? IEM + e.url : null,
    });
  }
  return [...out.values()].sort((a, b) => a.issued.localeCompare(b.issued));
}

const titleCase = (s) => String(s || "").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

async function stormReportsNear(lat, lon, radiusMi, start, end, iso, env) {
  const url = `${IEM}/api/1/nws/lsrs_by_point.json?lat=${round(lat, 4)}&lon=${round(lon, 4)}&radius_miles=${radiusMi}` +
    `&begints=${isoMinute(start)}&endts=${isoMinute(end)}`;
  const j = await fetchJSON(url, { env, ttl: settled(iso) ? 86400 : 300 });
  return (j.data || [])
    .map((r) => ({
      time: new Date(Date.parse(r.valid)).toISOString(),
      type: r.typetext,
      magnitude: r.magnitude ?? null,
      unit: r.unit || null,
      measured: r.qualifier ? r.qualifier === "M" : null,
      place: [r.city, r.state].filter(Boolean).join(", "),
      county: r.county ? titleCase(r.county) : null,
      source: r.source ? titleCase(r.source) : null,
      remark: r.remark || null,
      lat: r.lat,
      lon: r.lon,
      distMi: round(haversineMi(lat, lon, r.lat, r.lon), 1),
      office: r.wfo,
    }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

const OUTLOOK_NAMES = { C: "SPC convective", F: "SPC fire weather", E: "WPC excessive rainfall" };
const RISK_NAMES = {
  TSTM: "general thunderstorms", MRGL: "marginal", SLGT: "slight", ENH: "enhanced", MDT: "moderate", HIGH: "high",
  ELEV: "elevated", CRIT: "critical", EXTM: "extremely critical",
};

// The outlooks in force at 17Z on the date: normally SPC's 1630Z Day 1 and
// WPC's latest Excessive Rainfall Outlook.
async function outlooksAt(lat, lon, iso, env) {
  const valid = `${iso}T17:00Z`;
  const j = await fetchJSON(`${IEM}/api/1/nws/outlook_by_point.json?lat=${round(lat, 4)}&lon=${round(lon, 4)}&valid=${valid}`, {
    env, ttl: settled(iso) ? 86400 : 300,
  });
  const groups = new Map();
  for (const r of j.data || []) {
    const k = `${r.outlook_type}|${r.day}|${r.product_issue}`;
    if (!groups.has(k)) {
      groups.set(k, {
        outlook: OUTLOOK_NAMES[r.outlook_type] || r.outlook_type,
        day: r.day,
        issued: r.product_issue,
        valid: { from: r.issue, to: r.expire },
        risk: null,
        probabilities: {},
        significant: [],
      });
    }
    const g = groups.get(k);
    const cat = String(r.category || "").toLowerCase();
    const th = String(r.threshold || "");
    if (cat === "categorical") g.risk = { code: th, name: RISK_NAMES[th] || th.toLowerCase() };
    else if (th === "SIGN") g.significant.push(cat);
    else if (/^0?\.\d+$/.test(th)) g.probabilities[cat] = Math.round(Number(th) * 100);
    else g.probabilities[cat] = th;
  }
  return { asOf: valid, outlooks: [...groups.values()].sort((a, b) => a.day - b.day || a.outlook.localeCompare(b.outlook)) };
}

// ── Tornado tracks ───────────────────────────────────────────────────────────
// Closest approach of a straight start→end track to the point, in miles, on a
// local equirectangular projection (good to well under a mile at 100 mi).
function closestMi(lat, lon, slat, slon, elat, elon) {
  const kx = 69.17 * Math.cos((lat * Math.PI) / 180), ky = 69.05;
  const ax = (slon - lon) * kx, ay = (slat - lat) * ky;
  const bx = elon == null ? ax : (elon - lon) * kx, by = elat == null ? ay : (elat - lat) * ky;
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

const ratingOf = (date, mag) => (mag == null ? (date >= "2007-02-01" ? "EFU" : "unknown") : `${date >= "2007-02-01" ? "EF" : "F"}${mag}`);

function tornadoItem(o, lat, lon) {
  return {
    date: o.date,
    state: o.st,
    county: o.county,
    rating: ratingOf(o.date, o.mag),
    mag: o.mag,
    fatalities: o.fat,
    injuries: o.inj,
    lengthMi: o.len,
    widthYd: o.wid,
    start: [o.slat, o.slon],
    end: o.elat == null ? null : [o.elat, o.elon],
    closestMi: round(closestMi(lat, lon, o.slat, o.slon, o.elat, o.elon), 1),
  };
}

async function tornadoesOn(d, lat, lon, radiusMi, env) {
  const file = await tornadoDay(d.md, env);
  const ix = Object.fromEntries(file.cols.map((c, i) => [c, i]));
  const that = file.rows.filter((r) => r[ix.yr] === d.y);
  const near = that
    .map((r) => tornadoItem({ ...Object.fromEntries(file.cols.map((c, i) => [c, r[i]])), date: d.iso }, lat, lon))
    .filter((t) => t.closestMi <= radiusMi)
    .sort((a, b) => a.closestMi - b.closestMi);
  return {
    radiusMi,
    near,
    nationalCount: that.length,
    note: d.y > file.years[1]
      ? `SPC's final tornado data runs through ${file.years[1]}; for later dates see the storm reports.`
      : "SPC tornado dates are Central Standard Time calendar days.",
  };
}

async function gridCell(y, x, env) {
  const assets = env && env.ASSETS;
  if (!assets || typeof assets.fetch !== "function") throw new Error("no ASSETS binding");
  return memo(`tornado-grid/${y}_${x}`, 6 * 3600e3, async () => {
    const r = await withDeadline(assets.fetch(new Request(`https://assets.local/data/tornadoes/grid/${y}_${x}.json`)), 5e3, "tornado grid");
    if (r.status === 404) return null; // no tornado has ever crossed this cell
    if (!r.ok) throw new Error(`tornado grid ${y}_${x}: HTTP ${r.status}`);
    return r.json();
  });
}

export async function tornadoesNear(lat, lon, { radiusMi = 25, since, until, minRating, limit = 200, env } = {}) {
  const r = Math.min(MAX_TORNADO_RADIUS_MI, Math.max(1, Number(radiusMi) || 25));
  const dLat = r / 69, dLon = r / (69 * Math.cos((lat * Math.PI) / 180));
  const cells = [];
  for (let y = Math.floor(lat - dLat); y <= Math.floor(lat + dLat); y++) {
    for (let x = Math.floor(lon - dLon); x <= Math.floor(lon + dLon); x++) cells.push([y, x]);
  }
  const files = (await Promise.all(cells.map(([y, x]) => gridCell(y, x, env)))).filter(Boolean);
  const years = files[0] ? files[0].years : [1950, new Date().getUTCFullYear()];
  const int = (v, dflt) => (v == null || v === "" || !Number.isFinite(Number(v)) ? dflt : Math.floor(Number(v)));
  const y0 = Math.max(years[0], int(since, years[0]));
  const y1 = Math.min(years[1], int(until, years[1]));
  const minMag = int(minRating, null);

  const seen = new Set();
  const list = [];
  for (const f of files) {
    const ix = Object.fromEntries(f.cols.map((c, i) => [c, i]));
    for (const row of f.rows) {
      const id = row[ix.id];
      if (seen.has(id)) continue;
      seen.add(id);
      const yr = Number(row[ix.date].slice(0, 4));
      if (yr < y0 || yr > y1) continue;
      if (minMag != null && !(row[ix.mag] >= minMag)) continue;
      const t = tornadoItem(Object.fromEntries(f.cols.map((c, i) => [c, row[i]])), lat, lon);
      if (t.closestMi <= r) list.push(t);
    }
  }
  list.sort((a, b) => b.date.localeCompare(a.date) || a.closestMi - b.closestMi);

  const byRating = {}, byDecade = {};
  for (const t of list) {
    byRating[t.rating] = (byRating[t.rating] || 0) + 1;
    const dec = `${t.date.slice(0, 3)}0s`;
    byDecade[dec] = (byDecade[dec] || 0) + 1;
  }
  const top = (cmp) => [...list].sort(cmp).slice(0, 5);
  const n = Math.min(1000, Math.max(1, Math.floor(Number(limit)) || 200));
  return {
    point: { lat, lon },
    radiusMi: r,
    years: [y0, y1],
    count: list.length,
    summary: {
      byRating,
      byDecade,
      fatalities: list.reduce((s, t) => s + t.fatalities, 0),
      injuries: list.reduce((s, t) => s + t.injuries, 0),
      strongest: top((a, b) => (b.mag ?? -1) - (a.mag ?? -1) || b.fatalities - a.fatalities || b.date.localeCompare(a.date)),
      deadliest: top((a, b) => b.fatalities - a.fatalities || b.injuries - a.injuries).filter((t) => t.fatalities > 0),
      closest: top((a, b) => a.closestMi - b.closestMi || b.date.localeCompare(a.date)),
    },
    tornadoes: list.slice(0, n),
    truncated: list.length > n,
    source: "NOAA/NWS Storm Prediction Center severe weather database (whole tracks)",
    notes: [
      "Tracks are straight lines between SPC's recorded start and end points; real paths curve, so distances are approximate.",
      "Ratings are Fujita through January 2007 and Enhanced Fujita from February 2007. Weak tornadoes are undercounted before the 1990s.",
    ],
  };
}

// ── Climate station days (ACIS) ──────────────────────────────────────────────
const DAILY = ["maxt", "mint", "pcpn", "snow", "snwd"];
const NORMALS = ["maxt", "mint", "pcpn"].map((name) => ({ name, normal: "91" }));
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

async function stationDays(st, sdate, edate, env) {
  const who = st.threadex || !st.uid ? { sid: st.sid } : { uid: st.uid };
  const j = await acis("StnData", { ...who, sdate, edate, meta: "name,valid_daterange", elems: [...DAILY, ...NORMALS] }, {
    env, ttl: settled(edate) ? 86400 : 3600, timeoutMs: 20e3,
  });
  const counts = { accumulated: 0 };
  const rows = (j.data || []).map((r) => [
    r[0], acisValue(r[1], counts), acisValue(r[2], counts), acisValue(r[3], counts), acisValue(r[4], counts),
    acisValue(r[5], counts), num(r[6]), num(r[7]), num(r[8]),
  ]);
  return { name: j.meta && j.meta.name, rows, accumulated: counts.accumulated };
}

function stationOut(st) {
  const o = { sid: st.sid, name: st.name, lat: st.lat, lon: st.lon, distMi: st.distMi, threadex: !!st.threadex };
  if (st.site) o.site = st.site;
  if (st.por) o.periodOfRecord = Array.isArray(st.por) ? { start: st.por[0], end: st.por[1] } : st.por;
  return o;
}

async function climateDay(lat, lon, iso, env, ctx) {
  const st = await nearestClimateStation(lat, lon, iso, { env, ctx });
  if (!st) return null;
  const { rows, accumulated } = await stationDays(st, iso, iso, env);
  const r = rows[0];
  const recent = iso >= addDays(todayUTC(), -4);
  if (!r || [1, 2, 3, 4, 5].every((i) => r[i] == null)) {
    const why = recent ? "This day isn't in ACIS yet (it usually runs one to three days behind)." : "The station has no data for this day.";
    return { station: stationOut(st), observed: null, notes: [...st.notes, why] };
  }
  const [, maxt, mint, pcpn, snow, snwd, nmaxt, nmint, npcpn] = r;
  const notes = [...st.notes];
  if (accumulated) notes.push("Precipitation or snow was reported as a multi-day total and is left out.");
  if (!st.threadex) notes.push("Co-op stations report a 24-hour day ending at the observer's reading time, often 7 AM.");
  return {
    station: stationOut(st),
    observed: { maxt, mint, pcpn, snow, snwd },
    normal: nmaxt == null && nmint == null ? null : { maxt: nmaxt, mint: nmint, pcpn: npcpn, period: "1991-2020" },
    departure: { maxt: maxt != null && nmaxt != null ? maxt - nmaxt : null, mint: mint != null && nmint != null ? mint - nmint : null },
    units: { temp: "°F", pcpn: "in", snow: "in", trace: TRACE },
    notes,
  };
}

// ── Hourly observations (nearest ASOS, IEM) ──────────────────────────────────
async function asosNetwork(state, env, ctx) {
  return edgeJSON(`archive/v1/asos/${state}`, 7 * 86400, async () => {
    const j = await fetchJSON(`${IEM}/geojson/network.py?network=${state}_ASOS`, { env, ttl: 86400 });
    return (j.features || [])
      .filter((f) => f.geometry && Array.isArray(f.geometry.coordinates))
      .map((f) => ({
        id: f.properties.sid || f.id,
        name: f.properties.sname,
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
        begin: f.properties.archive_begin || null,
        end: f.properties.archive_end || null,
        reset: Number((f.properties.attributes || {}).METAR_RESET_MINUTE) || null,
      }));
  }, ctx);
}

function skyText(r) {
  return [1, 2, 3, 4]
    .map((i) => [String(r[`skyc${i}`] || "").trim(), r[`skyl${i}`]])
    .filter(([c]) => c)
    .map(([c, h]) => (h != null ? `${c}${String(Math.round(h / 100)).padStart(3, "0")}` : c))
    .join(" ") || null;
}

async function hourlyObs(lat, lon, iso, state, env, ctx) {
  if (!state) return null;
  const stations = (await asosNetwork(state, env, ctx))
    .filter((s) => (!s.begin || s.begin <= iso) && (!s.end || s.end >= iso))
    .map((s) => ({ ...s, distMi: round(haversineMi(lat, lon, s.lat, s.lon), 1) }))
    .filter((s) => s.distMi <= 75)
    .sort((a, b) => a.distMi - b.distMi)
    .slice(0, 2);
  for (const s of stations) {
    const j = await fetchJSON(`${IEM}/api/1/obhistory.json?station=${s.id}&network=${state}_ASOS&date=${iso}`, {
      env, ttl: settled(iso) ? 86400 : 300,
    });
    const data = j.data || [];
    if (!data.length) continue;
    const obs = data.map((r) => ({
      local: r.local_valid,
      utc: r.utc_valid,
      tempF: r.tmpf,
      dewF: r.dwpf,
      rh: r.relh != null ? Math.round(r.relh) : null,
      windDir: r.drct,
      windKt: r.sknt,
      gustKt: r.gust,
      visMi: r.vsby,
      wx: r.wxcodes || null,
      sky: skyText(r),
      pressureIn: r.alti,
      precipIn: r.p01i,
      metar: r.raw || null,
    }));
    const temps = obs.map((o) => o.tempF).filter((v) => v != null);
    const gusts = data.flatMap((r) => [r.gust, r.peak_wind_gust]).filter((v) => v != null);
    // METAR precip accumulates from the last routine (hourly) report, so the
    // day's total is the sum over routine reports, at the station's reset minute.
    const routine = s.reset != null ? data.filter((r) => Number(String(r.local_valid).slice(14, 16)) === s.reset) : [];
    const precip = routine.length ? routine.reduce((sum, r) => sum + (r.p01i || 0), 0) : null;
    return {
      station: { id: s.id, name: s.name, lat: s.lat, lon: s.lon, distMi: s.distMi, routineMinute: s.reset },
      summary: {
        highF: temps.length ? Math.max(...temps) : null,
        lowF: temps.length ? Math.min(...temps) : null,
        peakGustKt: gusts.length ? Math.max(...gusts) : null,
        precipIn: precip == null ? null : precip > 0 && precip < 0.005 ? TRACE : round(precip, 2),
        weather: [...new Set(obs.flatMap((o) => (o.wx ? o.wx.split(" ") : [])))],
      },
      obs,
    };
  }
  return null;
}

async function discussionsDuring(office, start, end, env, ctx) {
  const cccc = officeCode(office);
  const days = [...new Set([isoDate(start), isoDate(end - 1)])];
  const lists = await Promise.all(days.map((d) => listDay(cccc, "AFD", d, env, ctx)));
  return lists.flat()
    .filter((p) => Date.parse(p.issued) >= start && Date.parse(p.issued) < end)
    .map((p) => ({ id: p.id, pil: p.pil, issued: p.issued, correction: p.correction }));
}

// Everything known about one local calendar date at a point. Cached 30 days
// once settled; a result with failed sources is never cached long.
export async function dayHistory(lat, lon, { date, radiusMi = 25, env, ctx } = {}) {
  const d = requireDate(date);
  const r = Math.min(100, Math.max(1, Number(radiusMi) || 25));
  const key = `archive/v1/day/${round(lat, 3)},${round(lon, 3)}/${d.iso}/${r}`;
  try {
    return await edgeJSON(key, settled(d.iso) ? 30 * 86400 : 600, () => buildDay(lat, lon, d, r, env, ctx), ctx);
  } catch (err) {
    if (err && err.partial) return err.partial;
    throw err;
  }
}

async function buildDay(lat, lon, d, radiusMi, env, ctx) {
  const pt = await pointInfo(lat, lon, { env, ctx });
  const tz = pt.timeZone || "America/Chicago";
  const start = localMidnight(d.iso, tz), end = localMidnight(addDays(d.iso, 1), tz);
  const tasks = {
    climate: () => climateDay(lat, lon, d.iso, env, ctx),
    hourly: () => hourlyObs(lat, lon, d.iso, pt.state, env, ctx),
    outlooks: () => outlooksAt(lat, lon, d.iso, env),
    warnings: () => warningsAt(lat, lon, start, end, d.iso, env),
    stormReports: () => stormReportsNear(lat, lon, radiusMi, start, end, d.iso, env),
    tornadoes: () => tornadoesOn(d, lat, lon, radiusMi, env),
    discussions: () => discussionsDuring(pt.office, start, end, env, ctx),
  };
  const names = Object.keys(tasks);
  const results = await Promise.allSettled(names.map((k) => withDeadline(tasks[k](), 20e3, k)));
  const out = {
    date: d.iso,
    point: { lat, lon, place: pt.place },
    office: pt.office,
    timeZone: tz,
    window: { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
    radiusMi,
  };
  const unavailable = [];
  names.forEach((k, i) => {
    const res = results[i];
    out[k] = res.status === "fulfilled" ? res.value : null;
    if (res.status === "rejected") unavailable.push({ source: k, error: String((res.reason && res.reason.message) || res.reason) });
  });
  const notes = [];
  if (d.y < 2005) notes.push("Warnings, storm reports and outlooks come from IEM's archives, which are thin before about 2005.");
  if (d.y < 2000) notes.push("Forecast discussions in IEM's archive begin around 1999–2001.");
  out.unavailable = unavailable;
  out.notes = notes;
  if (unavailable.length) throw Object.assign(new Error("partial day"), { partial: out });
  return out;
}

// ── Daily series ─────────────────────────────────────────────────────────────
function mean(vals) {
  const v = vals.filter((x) => x != null);
  return v.length ? round(v.reduce((s, x) => s + x, 0) / v.length, 1) : null;
}

// Highest/lowest value with its dates (the last 10 if tied). A zero maximum
// (no rain or snow at all) is no extreme.
function extremeDay(rows, col, mode) {
  let best = null;
  for (const r of rows) if (r[col] != null && (best == null || (mode === "max" ? r[col] > best : r[col] < best))) best = r[col];
  if (best == null || (mode === "max" && best === 0 && col >= 3)) return null;
  return { value: best, dates: rows.filter((r) => r[col] === best).map((r) => r[0]).slice(-10) };
}

export async function dailySeries(lat, lon, { start, end, sid, env, ctx } = {}) {
  const e = requireDate(end || todayUTC(), "end");
  const s = requireDate(start || addDays(e.iso, -29), "start");
  if (s.iso > e.iso) throw inputError("start is after end");
  const span = (Date.parse(e.iso) - Date.parse(s.iso)) / DAY_MS + 1;
  if (span > MAX_DAILY_DAYS) throw inputError(`at most ${MAX_DAILY_DAYS} days per request (asked for ${span})`);

  let st;
  if (sid) {
    if (!/^[A-Za-z0-9]{3,12}$/.test(String(sid))) throw inputError("sid must be an ACIS station id (BHMthr, USW00013876)");
    st = { sid: String(sid), name: null, threadex: /thr$/i.test(sid), notes: [] };
  } else {
    if (lat == null || lon == null) throw inputError("lat and lon (or sid) required");
    st = await nearestClimateStation(lat, lon, e.iso, { env, ctx });
    if (!st) throw inputError("no long-record climate station within 100 mi");
  }
  const key = `archive/v1/daily/${st.sid}/${s.iso}/${e.iso}`;
  const days = await edgeJSON(key, settled(e.iso) ? 7 * 86400 : 3600, () => stationDays(st, s.iso, e.iso, env), ctx);
  const rows = days.rows;
  const col = { maxt: 1, mint: 2, pcpn: 3, snow: 4, snwd: 5, nmaxt: 6, nmint: 7, npcpn: 8 };
  const sum = (c) => rows.reduce((t, r) => t + (r[c] && r[c] !== TRACE ? r[c] : 0), 0);
  const have = (c) => rows.some((r) => r[c] != null);
  const notes = [...(st.notes || [])];
  if (days.accumulated) notes.push(`${days.accumulated} value(s) reported as multi-day totals are left out (null).`);
  return {
    station: { ...stationOut(st), name: st.name || days.name },
    start: s.iso,
    end: e.iso,
    cols: ["date", "maxt", "mint", "pcpn", "snow", "snwd", "normal_maxt", "normal_mint", "normal_pcpn"],
    rows,
    summary: {
      days: rows.length,
      maxt: { mean: mean(rows.map((r) => r[col.maxt])), normal: mean(rows.map((r) => r[col.nmaxt])), highest: extremeDay(rows, col.maxt, "max"), lowest: extremeDay(rows, col.maxt, "min") },
      mint: { mean: mean(rows.map((r) => r[col.mint])), normal: mean(rows.map((r) => r[col.nmint])), highest: extremeDay(rows, col.mint, "max"), lowest: extremeDay(rows, col.mint, "min") },
      pcpn: {
        total: have(col.pcpn) ? round(sum(col.pcpn), 2) : null,
        normal: have(col.npcpn) ? round(sum(col.npcpn), 2) : null,
        wettest: extremeDay(rows, col.pcpn, "max"),
        daysMeasurable: rows.filter((r) => r[col.pcpn] >= 0.01).length,
      },
      snow: { total: have(col.snow) ? round(sum(col.snow), 1) : null, snowiest: extremeDay(rows, col.snow, "max"), deepest: extremeDay(rows, col.snwd, "max") },
      daysAtOrAbove90: rows.filter((r) => r[col.maxt] >= 90).length,
      daysAtOrBelow32: rows.filter((r) => r[col.mint] != null && r[col.mint] <= 32).length,
    },
    units: { temp: "°F", pcpn: "in", snow: "in", trace: TRACE },
    notes,
  };
}

// ── Self-description (GET /api/archive) ──────────────────────────────────────
export const ARCHIVE_INDEX = {
  about: "WeatherNet historical weather API. JSON, open CORS. Times are UTC ISO 8601 unless noted; temperatures °F, precipitation and snow in inches (trace = 0.001).",
  endpoints: {
    "/api/archive/products": {
      what: "List archived NWS text products (Area Forecast Discussions by default) from one office over 1–7 UTC days, newest first.",
      params: { office: "3-letter NWS office (BMX) or WMO id (KBMX); SPC, WPC, NHC, CPC for the national centers. Or lat+lon for the office covering a point.", type: "AFOS id or 3-letter prefix: AFD (default), HWO, PNS, LSR; SPC SWODY1, SWOMCD; WPC QPFERD, PMDSPD, PMDEPD, FFGMPD; NHC TCDAT1 …", date: "YYYY-MM-DD, UTC (default today)", days: "1–7 (default 1)" },
      example: "/api/archive/products?office=BMX&type=AFD&date=2011-04-27",
    },
    "/api/archive/product": {
      what: "One product's full text (and AFD sections), by id; or the most recent `count` products at or before a time.",
      params: { id: "IEM product id from /products", office: "as above (or lat+lon)", type: "as above (default AFD)", at: "ISO time (UTC if no zone) or YYYY-MM-DD for the end of that UTC day; default now", count: "1–5 (default 1)" },
      example: "/api/archive/product?office=BMX&at=2011-04-27T15:00Z&count=2",
    },
    "/api/archive/day": {
      what: "What happened at a point on one local date: climate station observed vs normal, nearest ASOS hourly obs, SPC/WPC outlooks in force, warnings and watches that covered the point, storm reports and tornado tracks within the radius, and that day's AFDs.",
      params: { lat: "required", lon: "required", date: "YYYY-MM-DD local date (required)", radius: "miles for storm reports and tornadoes, 1–100 (default 25)" },
      example: "/api/archive/day?lat=33.21&lon=-86.65&date=2011-04-27",
    },
    "/api/archive/daily": {
      what: "Daily max/min temperature, precipitation, snowfall and snow depth, with 1991–2020 normals, at the nearest long-record (ThreadEx) climate station, plus a summary.",
      params: { lat: "with lon, or sid", lon: "", sid: "ACIS station id (BHMthr)", start: "YYYY-MM-DD (default end − 29 days)", end: "YYYY-MM-DD (default today)" },
      limits: "≤ 3660 days per request",
      example: "/api/archive/daily?lat=33.21&lon=-86.65&start=2025-01-01&end=2025-12-31",
    },
    "/api/archive/tornadoes": {
      what: "SPC tornado tracks (1950–latest final year) passing within a radius of a point, newest first, with counts by rating and decade and the strongest, deadliest and closest.",
      params: { lat: "required", lon: "required", radius: "miles, 1–100 (default 25)", since: "first year", until: "last year", min: "minimum F/EF rating 0–5", limit: "max tracks listed, 1–1000 (default 200)" },
      example: "/api/archive/tornadoes?lat=33.21&lon=-86.65&radius=10",
    },
    "/api/history": {
      what: "Records and normals for a calendar date at the nearest long-record station, every year's high and low on that date, and tornadoes on that date.",
      params: { lat: "required", lon: "required", date: "YYYY-MM-DD (default today)" },
    },
  },
  sources: [
    "Iowa Environmental Mesonet (Iowa State University): NWS text archive, VTEC warnings, LSRs, SPC/WPC outlooks, ASOS observations",
    "NOAA Regional Climate Centers ACIS: daily climate data and normals",
    "NOAA/NWS Storm Prediction Center severe weather database: tornado tracks",
    "NWS API: forecast office and time zone for a point",
  ],
};
