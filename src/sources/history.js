// "This day in weather history" for any US point: the nearest long-record
// climate station's daily records, 1991–2020 normals and year-by-year values
// on this month-day (ACIS), plus the tornadoes on this date (SPC database).
//
// Station: the nearest ThreadEx station — NOAA's ~400 threaded city records,
// each splicing a city's successive official sites into one series (BHMthr =
// Birmingham since 1895); the record set NWS climate reports quote. ACIS gives
// ThreadEx stations no coordinates, so a bbox search never returns them. But a
// ThreadEx id is its host site's FAA or NWSLI id + "thr" (BHMthr ↔ "BHM",
// Birmingham Airport), so: stations in a bbox → probe "<id>thr" for each of
// their ids → nearest active one within 100 mi, located at its host. Failing
// that, the nearest active station with >= 50 years of record.
//
// Values: one StnData query with a yearly interval ([1,0,0] from the first
// year's month-day) returns every year's value on this date. Checked against
// full daily pulls and ACIS's own smry max/min. (groupby ["year","02-29",
// "02-29"] comes back empty, hence the interval; on 02-29 it steps through
// 02-28 in common years, which are dropped.)
//
// Tornadoes: public/data/tornadoes/MM-DD.json, built offline by
// scripts/build-tornadoes.mjs, read through the Workers Static Assets binding.
import { fetchJSON, haversineMi, withDeadline, round } from "../lib/net.js";
import { edgeJSON, memo } from "../lib/cache.js";

const ACIS = "https://data.rcc-acis.org/";
const THREADEX_MAX_MI = 100;
const FALLBACK_MIN_YEARS = 50;
const LOCAL_RADIUS_MI = 150;
const LOCAL_CAP = 15;
const NOTABLE_CAP = 10;
const NORMALS = "91"; // ACIS normal code for 1991–2020 ("81" = 1981–2010)
const ELEMS = ["maxt", "mint", "pcpn", "snow"];

// ACIS "T" (trace): ranks above 0.00 so a trace can hold a record; any
// precip/snow value equal to TRACE should display as "T".
export const TRACE = 0.001;

// ── Dates ────────────────────────────────────────────────────────────────────
const pad2 = (n) => String(n).padStart(2, "0");
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

function todayCentral() {
  // en-CA formats as YYYY-MM-DD.
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(new Date());
}

function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y, iso: m[0], md: `${m[2]}-${m[3]}` };
}

function addDays(iso, n) {
  const t = new Date(iso + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

// ── ACIS ─────────────────────────────────────────────────────────────────────
// GET with the JSON in ?params= so the shared fetch helper (deadline, UA, edge
// cache) applies. ACIS reports bad requests as HTTP 200 + {"error": "..."}.
async function acis(path, params, { env, ttl = 3600, timeoutMs = 12e3 } = {}) {
  const url = ACIS + path + "?params=" + encodeURIComponent(JSON.stringify(params));
  const j = await fetchJSON(url, { env, ttl, timeoutMs });
  if (!j || j.error) throw new Error(`ACIS ${path}: ${(j && j.error) || "empty response"}`);
  return j;
}

// Daily values arrive as strings: "M" missing, "T" trace, "S" (amount folded
// into a later accumulation), "1.25A" (a multi-day total). Only true one-day
// values count toward daily records.
function acisValue(v, counts) {
  if (typeof v !== "string") return null;
  if (v === "T") return TRACE;
  if (v.endsWith("A")) {
    counts.accumulated++;
    return null;
  }
  const n = Number(v); // "M", "S" → NaN
  return v !== "" && Number.isFinite(n) ? n : null;
}

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

// ── Station search ───────────────────────────────────────────────────────────
// Candidates for every point in a 1° cell (cached two weeks): active ThreadEx
// stations located by their host site, plus long-record fallback stations.
// The bbox is the cell plus 100 mi, so the exact point's nearest is in it.
async function stationCandidates(lat, lon, env, ctx) {
  const cy = Math.floor(lat), cx = Math.floor(lon);
  return edgeJSON(
    `history/v1/stations/${cy},${cx}`,
    14 * 86400,
    async () => {
      const dLat = THREADEX_MAX_MI / 69 + 0.1;
      const edgeLat = Math.min(89, Math.max(Math.abs(cy), Math.abs(cy + 1)) + dLat);
      const dLon = Math.min(20, dLat / Math.cos((edgeLat * Math.PI) / 180));
      const bbox = [cx - dLon, cy - dLat, cx + 1 + dLon, cy + 1 + dLat].map((v) => round(v, 2)).join(",");
      const today = new Date().toISOString().slice(0, 10);
      const recent = addDays(today, -60);
      // Sites with temperature data since 1990, not just active ones: a thread
      // can outlive the site its id names (ISNthr, Williston, continues at the
      // new XWA airport since 2019; YUMthr, MQEthr, ...).
      const { meta = [] } = await acis(
        "StnMeta",
        { bbox, meta: "name,sids,ll,valid_daterange,uid", elems: "maxt", sdate: "1990-01-01", edate: today },
        { env, ttl: 86400 },
      );
      // Empty means ACIS hiccuped (or open ocean): throw rather than cache it.
      if (!meta.length) throw new Error("no climate stations within ~100 mi");

      const sites = meta.filter((s) => Array.isArray(s.ll) && s.ll.length === 2 && Array.isArray(s.sids));
      const range = (s) => (s.valid_daterange && s.valid_daterange[0]) || [];
      const start = (s) => range(s)[0] || "9999";
      const end = (s) => range(s)[1] || "";
      // FAA (type 3) and NWSLI (type 7) ids name ThreadEx stations; an ICAO id
      // (type 5) stands in where ACIS lacks the FAA one (KLMT → LMTthr, Klamath
      // Falls; PAGY → AGYthr, Skagway).
      const byId = new Map(); // id → sites carrying it
      for (const s of sites) {
        for (const x of s.sids) {
          const [raw, type] = String(x).split(" ");
          const id = type === "3" || type === "7" ? raw : type === "5" && /^[A-Z]{4}$/.test(raw) ? raw.slice(1) : null;
          if (!id) continue;
          const list = byId.get(id) || [];
          const hit = list.find((e) => e.s === s);
          if (hit) hit.faa = hit.faa || type !== "7";
          else list.push({ s, faa: type !== "7" });
          byId.set(id, list);
        }
      }

      // Probe "<id>thr" in batches (keeps each GET URL short); only threads
      // with data in the last 60 days come back.
      const ids = [...byId.keys()];
      const batches = [];
      for (let i = 0; i < ids.length; i += 150) batches.push(ids.slice(i, i + 150));
      const probes = await Promise.all(
        batches.map((b) =>
          acis(
            "StnMeta",
            { sids: b.map((id) => id + "thr").join(","), meta: "name,sids,valid_daterange", elems: "maxt", sdate: recent, edate: today },
            { env, ttl: 86400 },
          ),
        ),
      );
      const threadex = [];
      for (const t of probes.flatMap((p) => p.meta || [])) {
        const sid = (t.sids || []).map((x) => String(x).split(" ")).find(([, type]) => type === "9")?.[0];
        if (!sid || !sid.endsWith("thr")) continue;
        // An id can outlive its site: "DEN 3" is on both Denver Intl and the
        // old Stapleton site, which still reported weeks ago. The thread follows
        // the current site, so the latest report wins, then the FAA id (as in
        // ACIS's own id lookup), then the longest record.
        const host = (byId.get(sid.slice(0, -3)) || []).sort(
          (a, b) => end(b.s).localeCompare(end(a.s)) || b.faa - a.faa || start(a.s).localeCompare(start(b.s)),
        )[0];
        if (!host) continue;
        threadex.push({
          sid,
          name: t.name,
          site: host.s.name,
          lat: round(host.s.ll[1], 4),
          lon: round(host.s.ll[0], 4),
          por: (t.valid_daterange && t.valid_daterange[0]) || null,
        });
      }

      // Fallbacks: active sites with 30+ years (the 50-year test is per date).
      const cutoff = `${Number(today.slice(0, 4)) - 30}${today.slice(4)}`;
      const fallback = sites
        .filter((s) => start(s) <= cutoff && end(s) >= recent && s.uid)
        .sort((a, b) => (start(a) < start(b) ? -1 : 1))
        .slice(0, 120)
        .map((s) => {
          const ids = s.sids.map((x) => String(x).split(" "));
          const ghcn = ids.find(([, type]) => type === "6");
          return {
            sid: (ghcn || ids[0])[0],
            uid: s.uid,
            name: s.name,
            lat: round(s.ll[1], 4),
            lon: round(s.ll[0], 4),
            por: s.valid_daterange[0],
          };
        });
      return { threadex, fallback };
    },
    ctx,
  );
}

function pickStation(cands, lat, lon, d, notes) {
  const dist = (s) => ({ ...s, distMi: round(haversineMi(lat, lon, s.lat, s.lon), 1) });
  const thr = cands.threadex.map(dist).filter((s) => s.distMi <= THREADEX_MAX_MI).sort((a, b) => a.distMi - b.distMi);
  if (thr.length) return { ...thr[0], threadex: true };

  const near = cands.fallback.map(dist).filter((s) => s.distMi <= THREADEX_MAX_MI);
  const longEnough = `${d.y - FALLBACK_MIN_YEARS}-${d.md === "02-29" ? "02-28" : d.md}`;
  const pick =
    near.filter((s) => s.por[0] <= longEnough).sort((a, b) => a.distMi - b.distMi)[0] ||
    near.sort((a, b) => (a.por[0] < b.por[0] ? -1 : 1))[0];
  if (!pick) return null;
  notes.push(
    `No ThreadEx (threaded city) record within ${THREADEX_MAX_MI} mi; ` +
      `using ${pick.name}, ${pick.distMi} mi away, on record since ${pick.por[0].slice(0, 4)}.`,
  );
  return { ...pick, threadex: false };
}

// ── Records, normals, series for one station + date (cached 12 h) ────────────
const fmtTemp = (v) => String(v);
const fmtIn = (digits) => (v) => (v === TRACE ? "T" : v.toFixed(digits));

// Highest/lowest value with every tied year, most recent first. A zero
// "maximum" (no precip on this date, ever) ties every year, so no years.
function extreme(years, values, mode, fmt) {
  let best = null;
  for (const v of values) if (v != null && (best == null || (mode === "max" ? v > best : v < best))) best = v;
  if (best == null) return null;
  const tied = mode === "max" && best === 0 ? [] : years.filter((_, i) => values[i] === best).sort((a, b) => b - a);
  return { value: best, years: tied, display: fmt(best) };
}

const count = (arr) => arr.reduce((n, v) => n + (v != null), 0);

async function stationHistory(st, d, env, ctx) {
  try {
    return await edgeJSON(`history/v1/acis/${st.sid}/${d.iso}`, 12 * 3600, () => fetchStationHistory(st, d, env), ctx);
  } catch (err) {
    // One of the two queries failed: serve what came back, but uncached, so a
    // transient ACIS error doesn't stick for 12 h.
    if (err && err.partial) return err.partial;
    throw err;
  }
}

async function fetchStationHistory(st, d, env) {
  const who = st.threadex ? { sid: st.sid } : { uid: st.uid };
  const notes = [];
  // First year whose month-day falls inside the period of record.
  const porStart = (st.por && st.por[0]) || "1850-01-01";
  let y0 = Number(porStart.slice(0, 4));
  if (`${y0}-${d.md}` < porStart) y0++;
  if (d.md === "02-29") while (!isLeap(y0)) y0++;

  const yesterday = addDays(d.iso, -1);
  const yearly = ELEMS.map((name) => ({ name, interval: [1, 0, 0], duration: 1 }));
  const withNormals = [...ELEMS, ...ELEMS.map((name) => ({ name, normal: NORMALS }))];
  const [seriesRes, dailyRes] = await Promise.allSettled([
    y0 <= d.y
      ? acis("StnData", { ...who, sdate: `${y0}-${d.md}`, edate: d.iso, meta: "valid_daterange", elems: yearly }, { env })
      : Promise.reject(Object.assign(new Error("date precedes the station's record"), { expected: true })),
    // Yesterday's observations and this date's and yesterday's normals.
    acis("StnData", { ...who, sdate: yesterday, edate: d.iso, elems: withNormals }, { env }),
  ]);
  const seriesFailed = seriesRes.status === "rejected" && !seriesRes.reason.expected;
  if (seriesFailed && dailyRes.status === "rejected") throw seriesRes.reason;

  let por = st.por ? { start: st.por[0], end: st.por[1] } : null;
  let series = null, records = null;
  if (seriesRes.status === "fulfilled") {
    const ranges = (seriesRes.value.meta && seriesRes.value.meta.valid_daterange) || [];
    if (ranges[0] && ranges[0].length === 2) por = { start: ranges[0][0], end: ranges[0][1] };
    const lastData = ranges.reduce((m, r) => (r && r[1] > m ? r[1] : m), "");
    const counts = { accumulated: 0 };
    series = { years: [], maxt: [], mint: [], pcpn: [], snow: [] };
    for (const row of seriesRes.value.data || []) {
      // Common-year rows of a 02-29 series land on 02-28; future years are all "M".
      if (!Array.isArray(row) || typeof row[0] !== "string" || row[0].slice(5) !== d.md || (lastData && row[0] > lastData)) continue;
      series.years.push(Number(row[0].slice(0, 4)));
      ELEMS.forEach((el, i) => series[el].push(acisValue(row[i + 1], counts)));
    }
    // Leading years with nothing at all (record start not on file) carry no information.
    let k = 0;
    while (k < series.years.length && ELEMS.every((el) => series[el][k] == null)) k++;
    if (k) for (const key of ["years", ...ELEMS]) series[key].splice(0, k);
    const { years } = series;
    const nMax = count(series.maxt), nMin = count(series.mint), nP = count(series.pcpn), nS = count(series.snow);
    const snowMax = extreme(years, series.snow, "max", fmtIn(1));
    records = {
      maxt: nMax ? { high: extreme(years, series.maxt, "max", fmtTemp), low: extreme(years, series.maxt, "min", fmtTemp), n: nMax } : null,
      mint: nMin ? { high: extreme(years, series.mint, "max", fmtTemp), low: extreme(years, series.mint, "min", fmtTemp), n: nMin } : null,
      pcpn: nP ? { max: extreme(years, series.pcpn, "max", fmtIn(2)), n: nP } : null,
      // Never any snow (or no snow records) on this date: nothing to show.
      snow: nS && snowMax && snowMax.value > 0 ? { max: snowMax, n: nS } : null,
    };
    if (counts.accumulated) notes.push(`${counts.accumulated} multi-day accumulated precipitation/snow total(s) left out of the one-day records.`);
    if (d.md === "02-29") notes.push(`February 29 records come from leap years only (${years.length} years).`);
  } else {
    notes.push(`Daily records unavailable: ${seriesRes.reason && seriesRes.reason.message}`);
  }

  let normals = null, recent = null;
  if (dailyRes.status === "fulfilled") {
    const rows = dailyRes.value.data || [];
    const today = rows.find((r) => r[0] === d.iso);
    const prev = rows.find((r) => r[0] === yesterday);
    if (today) {
      const n = { maxt: num(today[5]), mint: num(today[6]), pcpn: num(today[7]), snow: num(today[8]) };
      if (n.maxt != null || n.mint != null) normals = { ...n, period: "1991-2020" };
    }
    if (!normals) notes.push("1991–2020 normals are not available for this station.");
    if (prev) {
      const c = { accumulated: 0 };
      const [maxt, mint, pcpn] = [acisValue(prev[1], c), acisValue(prev[2], c), acisValue(prev[3], c)];
      const [nmaxt, nmint] = [num(prev[5]), num(prev[6])];
      if (maxt != null || mint != null || pcpn != null) {
        recent = {
          yesterday: {
            date: yesterday,
            maxt,
            mint,
            pcpn,
            maxtDep: maxt != null && nmaxt != null ? maxt - nmaxt : null,
            mintDep: mint != null && nmint != null ? mint - nmint : null,
          },
        };
      }
    }
  } else {
    notes.push(`Normals unavailable: ${dailyRes.reason && dailyRes.reason.message}`);
  }
  const result = { por, records, normals, series, recent, notes };
  if (seriesFailed || dailyRes.status === "rejected") throw Object.assign(new Error("partial ACIS result"), { partial: result });
  return result;
}

// ── Tornadoes on this month-day ──────────────────────────────────────────────
async function tornadoDay(md, env) {
  const assets = env && env.ASSETS;
  if (!assets || typeof assets.fetch !== "function") throw new Error("no ASSETS binding");
  // Static file; keep the parsed copy for the isolate's life (bounded at 6 h).
  return memo(`tornado-day/${md}`, 6 * 3600e3, async () => {
    const r = await withDeadline(assets.fetch(new Request(`https://assets.local/data/tornadoes/${md}.json`)), 5e3, "tornado file");
    if (!r.ok) throw new Error(`tornado file ${md}: HTTP ${r.status}`);
    const j = await r.json();
    if (!j || !Array.isArray(j.cols) || !Array.isArray(j.rows) || !Array.isArray(j.years)) throw new Error(`tornado file ${md}: unexpected shape`);
    return j;
  });
}

function tornadoHistory(file, lat, lon, d) {
  const ix = Object.fromEntries(file.cols.map((c, i) => [c, i]));
  const all = [];
  for (const r of file.rows) {
    const year = r[ix.yr];
    if (!(year <= d.y)) continue; // as of the requested date
    const mag = r[ix.mag];
    const ef = year >= file.efFrom; // EF scale since 2007-02-01
    const county = r[ix.county] || null;
    all.push({
      year,
      date: `${year}-${d.md}`,
      state: r[ix.st],
      county,
      place: county ? `${county}, ${r[ix.st]}` : r[ix.st],
      scale: mag == null ? (ef ? "EFU" : null) : `${ef ? "EF" : "F"}${mag}`,
      mag,
      fatalities: r[ix.fat],
      injuries: r[ix.inj],
      lenMi: r[ix.len],
      widthYd: r[ix.wid],
      slat: r[ix.slat],
      slon: r[ix.slon],
      elat: r[ix.elat],
      elon: r[ix.elon],
      distMi: round(haversineMi(lat, lon, r[ix.slat], r[ix.slon]), 1),
    });
  }
  const magDesc = (a, b) => (b.mag ?? -1) - (a.mag ?? -1);
  const local = all.filter((t) => t.distMi <= LOCAL_RADIUS_MI).sort((a, b) => magDesc(a, b) || b.year - a.year || b.fatalities - a.fatalities);
  const notable = all.filter((t) => t.mag >= 4 || t.fatalities >= 10).sort((a, b) => b.fatalities - a.fatalities || magDesc(a, b) || b.year - a.year);
  return {
    local: local.slice(0, LOCAL_CAP),
    notable: notable.slice(0, NOTABLE_CAP),
    localRadiusMi: LOCAL_RADIUS_MI,
    localCount: local.length,
    nationalCount: all.length,
    years: [file.years[0], Math.min(file.years[1], d.y)],
    source: "NOAA/NWS Storm Prediction Center severe weather database",
  };
}

// ── Public ───────────────────────────────────────────────────────────────────
export async function climateHistory(lat, lon, { date, env, ctx } = {}) {
  lat = Number(lat);
  lon = Number(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new Error("climateHistory: lat/lon out of range");
  }
  const d = parseDate(date || todayCentral());
  if (!d) throw new Error(`climateHistory: bad date "${date}" (want a real YYYY-MM-DD)`);
  const notes = [];

  const climate = (async () => {
    const station = pickStation(await stationCandidates(lat, lon, env, ctx), lat, lon, d, notes);
    if (!station) return { station: null };
    return { station, history: await stationHistory(station, d, env, ctx) };
  })();
  const [clim, tor] = await Promise.allSettled([
    withDeadline(climate, 25e3, "climate history"),
    withDeadline(tornadoDay(d.md, env), 8e3, "tornado history"),
  ]);

  let station = null, h = null;
  if (clim.status === "fulfilled") {
    const s = clim.value.station;
    h = clim.value.history || null;
    if (s) {
      const por = (h && h.por) || (s.por ? { start: s.por[0], end: s.por[1] } : null);
      station = { sid: s.sid, name: s.name, distMi: s.distMi, lat: s.lat, lon: s.lon, por, threadex: s.threadex };
      if (s.site) station.site = s.site;
      if (s.distMi > 50) notes.push(`${s.name} is ${s.distMi} mi away; conditions at this point can differ from its record.`);
    } else {
      notes.push("No long-record climate station found near this point.");
    }
    if (h) notes.push(...h.notes);
  } else {
    notes.push(`Climate records unavailable: ${clim.reason && clim.reason.message}`);
  }

  let tornadoes = null;
  if (tor.status === "rejected") notes.push(`Tornado history unavailable: ${tor.reason && tor.reason.message}`);
  else if (d.y < tor.value.years[0]) notes.push(`The SPC tornado database begins in ${tor.value.years[0]}.`);
  else tornadoes = tornadoHistory(tor.value, lat, lon, d);

  return {
    date: d.iso,
    monthDay: d.md,
    station,
    records: h ? h.records : null,
    normals: h ? h.normals : null,
    series: h ? h.series : null,
    recent: h ? h.recent : null,
    tornadoes,
    units: { temp: "°F", pcpn: "in", snow: "in", trace: TRACE },
    notes,
  };
}
