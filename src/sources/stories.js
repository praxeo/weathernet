// National story board: what is interesting across the US right now, ranked.
//
// Inputs, all fetched in parallel and each allowed to fail on its own:
//   NWS short-fuse warnings (tornado, severe, flash flood, extreme wind, dust,
//   snow squall) with their impact-based tags; long-fuse hazards (blizzard,
//   ice storm, extreme heat/cold, red flag); SPC watches (IEM, which flags
//   PDS); the SPC Day 1 categorical outlook + text; NHC active storms;
//   nationwide Local Storm Reports (6 h); NWS Record Event Reports; GDACS red
//   alerts outside the US ("world" lane — only the truly extraordinary).
//
// Tiers: 3 extreme (Tornado/Flash Flood Emergency, Extreme Wind Warning, SPC
// High Risk, PDS watch, major hurricane at the coast), 2 major, 1 notable,
// 0 context (counted, mapped, not headlined). Related items cluster into one
// story by distance, anchored on hurricanes and SPC risk areas first.
import { fetchJSON, fetchText, withDeadline, haversineMi, geometryCenter, round } from "../lib/net.js";
import { edgeJSON } from "../lib/cache.js";
import { describePlace, nearestRadar, milesToUS } from "../lib/places.js";
import { COUNTIES } from "../data/counties.js";
import { satelliteCatalog } from "./satellite.js";

const ALERTS = "https://api.weather.gov/alerts/active?status=actual&message_type=alert,update&event=";
const SHORT_FUSE = [
  "Tornado Warning", "Severe Thunderstorm Warning", "Flash Flood Warning",
  "Extreme Wind Warning", "Dust Storm Warning", "Snow Squall Warning",
];
const LONG_FUSE = ["Blizzard Warning", "Ice Storm Warning", "Extreme Heat Warning", "Extreme Cold Warning", "Red Flag Warning"];
const SOURCE_DEADLINE_MS = 9e3;
const CACHE_KEY = "stories/v1";

export async function nationalStories(env, ctx) {
  return edgeJSON(CACHE_KEY, 120, () => buildStories(env), ctx);
}

export async function handleStories(request, env, ctx) {
  const data = await nationalStories(env, ctx);
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60" },
  });
}

// ── Fetchers ────────────────────────────────────────────────────────────────
const enc = (list) => list.map(encodeURIComponent).join(",");

async function getAlerts(events, env) {
  const d = await fetchJSON(ALERTS + enc(events), { env, ttl: 60 });
  return (d.features || []).map(normAlert);
}

async function getWatches(env) {
  const d = await fetchJSON("https://mesonet.agron.iastate.edu/json/spcwatch.py", { env, ttl: 60 });
  return (d.features || []).map((f) => {
    const p = f.properties || {};
    const c = geometryCenter(f.geometry);
    return {
      number: p.number, type: p.type, pds: !!p.is_pds, issue: p.issue, expires: p.expire,
      maxHail: p.max_hail_size, maxGustKt: p.max_wind_gust_knots, url: p.spcurl,
      lat: c?.lat, lon: c?.lon, geometry: simplifyGeom(f.geometry, 0.02),
    };
  });
}

const CAT_ORDER = { TSTM: 0, MRGL: 1, SLGT: 2, ENH: 3, MDT: 4, HIGH: 5 };

async function getOutlook(env) {
  const [gj, text] = await Promise.all([
    fetchJSON("https://www.spc.noaa.gov/products/outlook/day1otlk_cat.lyr.geojson", { env, ttl: 300 }),
    fetchText("https://www.spc.noaa.gov/products/outlook/day1otlk.txt", { env, ttl: 300 }).catch(() => ""),
  ]);
  const areas = (gj.features || [])
    .map((f) => {
      const label = String(f.properties?.LABEL || "");
      return { label, rank: CAT_ORDER[label] ?? -1, name: f.properties?.LABEL2 || label, geometry: f.geometry };
    })
    .filter((a) => a.rank >= 2 && a.geometry);
  const p0 = gj.features?.[0]?.properties || {};
  return { areas, issued: spcTime(p0.ISSUE), valid: spcTime(p0.VALID), expires: spcTime(p0.EXPIRE), text: outlookSummary(text) };
}

async function getStorms(env) {
  const d = await fetchJSON("https://www.nhc.noaa.gov/CurrentStorms.json", { env, ttl: 300 });
  return (d.activeStorms || []).map((s) => ({
    id: s.id, bin: s.binNumber, name: s.name, classification: s.classification,
    kt: Number(s.intensity) || null, mb: Number(s.pressure) || null,
    lat: s.latitudeNumeric, lon: s.longitudeNumeric,
    moveDir: s.movementDir, moveKt: s.movementSpeed, updated: s.lastUpdate,
    advisory: s.publicAdvisory?.advNum || null,
    links: { advisory: s.publicAdvisory?.url || null, graphics: s.forecastGraphics?.url || null },
  }));
}

async function getReports(env) {
  const d = await fetchJSON("https://mesonet.agron.iastate.edu/geojson/lsr.geojson?hours=6", { env, ttl: 120 });
  return (d.features || []).map((f) => {
    const p = f.properties || {};
    return {
      type: p.typetext || "", mag: p.magnitude === "" || p.magnitude == null ? null : Number(p.magnitude),
      unit: p.unit || "", qualifier: p.qualifier || "", place: [p.city, p.st].filter(Boolean).join(", "),
      county: p.county || "", source: p.source || "", remark: clean(p.remark).slice(0, 240),
      time: p.valid ? new Date(p.valid).toISOString() : null, lat: Number(p.lat), lon: Number(p.lon), wfo: p.wfo,
    };
  }).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

// Record Event Reports from the last ~18 h. The list is cheap; each text is
// one more call, so only the newest dozen are read.
async function getRecords(env) {
  const list = await fetchJSON("https://api.weather.gov/products/types/RER", { env, ttl: 600 });
  const since = Date.now() - 18 * 3600e3;
  const recent = (list["@graph"] || []).filter((p) => Date.parse(p.issuanceTime) >= since).slice(0, 12);
  const texts = await Promise.allSettled(
    recent.map((p) => fetchJSON(`https://api.weather.gov/products/${p.id}`, { env, ttl: 3600 })),
  );
  return texts
    .filter((t) => t.status === "fulfilled" && t.value?.productText)
    .map((t) => parseRER(t.value));
}

async function getWorld(env) {
  const to = new Date();
  const from = new Date(Date.now() - 7 * 86400e3);
  const day = (d) => d.toISOString().slice(0, 10);
  const url = `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC;FL;WF&alertlevel=Red&fromdate=${day(from)}&todate=${day(to)}`;
  // GDACS answers an empty body (not an empty collection) when nothing matches.
  const body = await fetchText(url, { env, ttl: 900, accept: "application/json" });
  const d = body.trim() ? JSON.parse(body) : { features: [] };
  return (d.features || [])
    .map((f) => ({ p: f.properties || {}, c: f.geometry?.coordinates || [] }))
    .filter(({ p }) => p.iscurrent === true || p.iscurrent === "true")
    .filter(({ p }) => !/United States/i.test(String(p.country || "")))
    .map(({ p, c }) => ({
      id: p.eventid, type: p.eventtype, name: p.name, country: p.country, alert: p.alertlevel,
      severity: p.severitydata?.severitytext || "", from: p.fromdate, to: p.todate,
      lon: c[0], lat: c[1], url: p.url?.report || `https://www.gdacs.org/report.aspx?eventtype=${p.eventtype}&eventid=${p.eventid}`,
    }));
}

// ── Normalizing NWS alerts ──────────────────────────────────────────────────
function normAlert(f) {
  const p = f.properties || {};
  const prm = p.parameters || {};
  const first = (k) => (Array.isArray(prm[k]) && prm[k][0]) || null;
  const desc = String(p.description || "");
  const up = desc.toUpperCase();
  // Zone-based alerts (heat, blizzard, red flag…) carry no polygon; their
  // SAME county codes ("0" + FIPS) still place them.
  const c = f.geometry ? geometryCenter(f.geometry) : sameCenter(p.geocode?.SAME);
  const awips = first("AWIPSidentifier") || "";
  return {
    id: p.id,
    event: p.event,
    area: p.areaDesc || "",
    states: statesOf(p.areaDesc).length ? statesOf(p.areaDesc) : sameStates(p.geocode?.SAME),
    sent: p.sent,
    expires: p.ends || p.expires,
    wfo: awips.length >= 6 ? awips.slice(-3) : null,
    narrative: hazardNarrative(desc),
    tags: {
      tornadoDetection: first("tornadoDetection"),
      tornadoDamageThreat: first("tornadoDamageThreat"),
      thunderstormDamageThreat: first("thunderstormDamageThreat"),
      flashFloodDetection: first("flashFloodDetection"),
      flashFloodDamageThreat: first("flashFloodDamageThreat"),
      maxWindGust: first("maxWindGust"),
      maxHailSize: first("maxHailSize"),
    },
    emergency: /TORNADO EMERGENCY/.test(up) ? "Tornado Emergency" : /FLASH FLOOD EMERGENCY/.test(up) ? "Flash Flood Emergency" : null,
    pds: /PARTICULARLY DANGEROUS SITUATION/.test(up),
    lat: c?.lat,
    lon: c?.lon,
    geometry: f.geometry ? simplifyGeom(f.geometry, 0.005) : null,
  };
}

const FIPS_ST = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC",
  "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
  "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT",
  "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
  "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY", "60": "AS", "66": "GU", "69": "MP",
  "72": "PR", "78": "VI",
};
function sameStates(codes) {
  return [...new Set((codes || []).map((c) => FIPS_ST[String(c).slice(-5, -3)]).filter(Boolean))];
}

function sameCenter(codes) {
  const pts = (codes || []).map((c) => COUNTIES[String(c).slice(-5)]).filter(Boolean);
  if (!pts.length) return null;
  return { lat: pts.reduce((a, p) => a + p[0], 0) / pts.length, lon: pts.reduce((a, p) => a + p[1], 0) / pts.length };
}

// How much an alert matters nationally, with the Learn explainers that fit.
function alertRank(a) {
  const t = a.tags;
  switch (a.event) {
    case "Extreme Wind Warning":
      return { score: 100, tier: 3, label: "Extreme Wind Warning", kind: "wind", learn: ["extreme-wind-warning", "saffir-simpson"] };
    case "Tornado Warning":
      if (a.emergency || t.tornadoDamageThreat === "CATASTROPHIC") return { score: 98, tier: 3, label: "Tornado Emergency", kind: "tornado", learn: ["tornado-emergency", "debris-signature"] };
      if (t.tornadoDamageThreat === "CONSIDERABLE") return { score: 80, tier: 2, label: "PDS Tornado Warning", kind: "tornado", learn: ["damage-threat-tags", "debris-signature"] };
      if (t.tornadoDetection === "OBSERVED") return { score: 70, tier: 2, label: "Confirmed tornado", kind: "tornado", learn: ["tornado-warning", "debris-signature"] };
      return { score: 50, tier: 1, label: "Tornado Warning", kind: "tornado", learn: ["tornado-warning", "velocity-couplet"] };
    case "Flash Flood Warning":
      if (a.emergency || t.flashFloodDamageThreat === "CATASTROPHIC") return { score: 95, tier: 3, label: "Flash Flood Emergency", kind: "flood", learn: ["flash-flood-emergency", "damage-threat-tags"] };
      if (t.flashFloodDamageThreat === "CONSIDERABLE") return { score: 45, tier: 1, label: "Considerable flash flooding", kind: "flood", learn: ["flash-flood-warning", "damage-threat-tags"] };
      return { score: 15, tier: 0, label: "Flash Flood Warning", kind: "flood", learn: ["flash-flood-warning"] };
    case "Severe Thunderstorm Warning": {
      const gust = parseInt(t.maxWindGust, 10) || 0;
      const hail = parseFloat(t.maxHailSize) || 0;
      if (t.thunderstormDamageThreat === "DESTRUCTIVE") return { score: 65, tier: 2, label: "Destructive thunderstorm", kind: "severe", learn: ["damage-threat-tags", "severe-thunderstorm-warning"] };
      if (t.thunderstormDamageThreat === "CONSIDERABLE" || gust >= 70 || hail >= 2) return { score: 30, tier: 1, label: "Severe thunderstorm", kind: "severe", learn: ["severe-thunderstorm-warning", "hail"] };
      return { score: 12, tier: 0, label: "Severe Thunderstorm Warning", kind: "severe", learn: ["severe-thunderstorm-warning"] };
    }
    case "Dust Storm Warning":
      return { score: 40, tier: 1, label: "Dust Storm Warning", kind: "wind", learn: ["haboob"] };
    case "Snow Squall Warning":
      return { score: 30, tier: 1, label: "Snow Squall Warning", kind: "winter", learn: ["blizzard"] };
    case "Blizzard Warning":
      return { score: 42, tier: 2, label: "Blizzard Warning", kind: "winter", learn: ["blizzard"] };
    case "Ice Storm Warning":
      return { score: 42, tier: 2, label: "Ice Storm Warning", kind: "winter", learn: ["ice-storm"] };
    case "Extreme Heat Warning":
      return { score: 25, tier: 1, label: "Extreme Heat Warning", kind: "heat", learn: ["heat-risk"] };
    case "Extreme Cold Warning":
      return { score: 25, tier: 1, label: "Extreme Cold Warning", kind: "cold", learn: [] };
    case "Red Flag Warning":
      if (a.pds) return { score: 90, tier: 3, label: "PDS Red Flag Warning", kind: "fire", learn: ["red-flag-warning"] };
      return { score: 8, tier: 0, label: "Red Flag Warning", kind: "fire", learn: ["red-flag-warning"] };
    default:
      return { score: 5, tier: 0, label: a.event, kind: "other", learn: [] };
  }
}

function reportRank(r) {
  const t = r.type.toUpperCase();
  const m = r.mag;
  if (t === "TORNADO") return { score: 60, tier: 2, label: "Tornado report" };
  if (t === "HAIL" && m >= 4) return { score: 55, tier: 2, label: `${m}" hail` };
  if (t === "HAIL" && m >= 2.75) return { score: 35, tier: 1, label: `${m}" hail` };
  if (/WND GST|TROPICAL CYCLONE/.test(t) && m >= 100) return { score: 60, tier: 2, label: `${Math.round(m)} mph gust` };
  if (/WND GST|TROPICAL CYCLONE/.test(t) && m >= 80) return { score: 35, tier: 1, label: `${Math.round(m)} mph gust` };
  if (t === "FLASH FLOOD" && /RESCUE|SWEPT|TRAPPED|STRANDED/i.test(r.remark)) return { score: 40, tier: 1, label: "Flood rescues" };
  if (t === "HAIL" && m >= 2) return { score: 15, tier: 0, label: `${m}" hail` };
  if (/WND GST|TROPICAL CYCLONE/.test(t) && m >= 58) return { score: 10, tier: 0, label: `${Math.round(m)} mph gust` };
  if (/FLASH FLOOD|WND DMG|TSTM WND DMG/.test(t)) return { score: 5, tier: 0, label: r.type.toLowerCase() };
  return null;
}

// ── Story assembly ──────────────────────────────────────────────────────────
function saffir(kt) {
  if (kt >= 137) return 5;
  if (kt >= 113) return 4;
  if (kt >= 96) return 3;
  if (kt >= 83) return 2;
  if (kt >= 64) return 1;
  return 0;
}

const TC_NAME = { HU: "Hurricane", TS: "Tropical Storm", TD: "Tropical Depression", STS: "Subtropical Storm", STD: "Subtropical Depression", PTC: "Potential Tropical Cyclone", PC: "Post-Tropical Cyclone" };

function tropicalStory(s) {
  const cat = s.classification === "HU" ? saffir(s.kt || 0) : 0;
  const mph = s.kt ? Math.round((s.kt * 1.15078) / 5) * 5 : null;
  const usMi = milesToUS(s.lat, s.lon);
  const nearUS = usMi <= 300;
  let tier = 0;
  if (cat >= 4) tier = 3;
  else if (cat >= 1) tier = nearUS ? (cat >= 3 ? 3 : 2) : cat >= 3 ? 2 : 1;
  else if (/TS|STS/.test(s.classification)) tier = nearUS ? 2 : 1;
  else tier = nearUS ? 1 : 0;
  const kind = TC_NAME[s.classification] || "Tropical system";
  // Over open water far from the US, "805 mi SSW of McAllen" says less than
  // a position and a basin.
  const basin = { AL: "Atlantic", EP: "eastern Pacific", CP: "central Pacific" }[String(s.id).slice(0, 2).toUpperCase()] || "";
  const where = usMi <= 350
    ? describePlace(s.lat, s.lon)
    : `${Math.abs(s.lat).toFixed(1)}°${s.lat >= 0 ? "N" : "S"} ${Math.abs(s.lon).toFixed(1)}°${s.lon <= 0 ? "W" : "E"}${basin ? ` in the ${basin}` : ""}`;
  const moveMph = s.moveKt != null ? Math.round(s.moveKt * 1.15078) : null;
  const facts = [
    cat ? `Category ${cat}` : null,
    mph ? `${mph} mph` : null,
    s.mb ? `${s.mb} mb` : null,
  ].filter(Boolean);
  return {
    id: `tc-${String(s.id).toLowerCase()}`,
    tier,
    score: 60 + cat * 8 + (nearUS ? 10 : 0),
    lane: "us",
    kind: "tropical",
    kicker: cat >= 3 ? "Major hurricane" : kind,
    title: `${kind} ${s.name}`,
    facts,
    place: where,
    summary: [
      where ? `Centered ${where}` : null,
      s.moveDir != null && moveMph != null ? `moving ${compass(s.moveDir)} at ${moveMph} mph` : null,
    ].filter(Boolean).join(", ") + (s.advisory ? `. NHC advisory ${s.advisory}.` : "."),
    lat: s.lat,
    lon: s.lon,
    time: s.updated,
    storm: { id: s.id, name: s.name, kt: s.kt, mph, cat, classification: s.classification },
    learn: cat ? ["saffir-simpson", "nhc-cone", "storm-surge"] : ["nhc-cone", "tropical-watches-warnings"],
    links: [
      s.links.advisory && { label: "NHC public advisory", url: s.links.advisory },
      s.links.graphics && { label: "NHC forecast cone", url: s.links.graphics },
    ].filter(Boolean),
    radius: 260,
    farFromUS: usMi > 350,
  };
}

function outlookStory(o, area) {
  const c = geometryCenter(area.geometry);
  const tier = area.label === "HIGH" ? 3 : area.label === "MDT" ? 2 : area.label === "ENH" ? 1 : 0;
  return {
    id: `spc-d1-${area.label.toLowerCase()}`,
    tier,
    score: area.label === "HIGH" ? 92 : area.label === "MDT" ? 66 : 28,
    lane: "us",
    kind: "outlook",
    kicker: `SPC ${area.name}`,
    title: `${area.name} of severe storms`,
    summary: o.text || `SPC Day 1 convective outlook: ${area.name} ${describePlace(c.lat, c.lon) || ""}.`,
    lat: c.lat,
    lon: c.lon,
    time: o.issued,
    learn: ["spc-outlook", "ingredients"],
    links: [{ label: "SPC Day 1 outlook", url: "https://www.spc.noaa.gov/products/outlook/day1otlk.html" }],
    radius: 320,
    outlook: area.label,
  };
}

function watchStory(w) {
  const tor = w.type === "TOR";
  const name = `${w.pds ? "PDS " : ""}${tor ? "Tornado" : "Severe Thunderstorm"} Watch ${w.number}`;
  return {
    id: `watch-${w.number}`,
    tier: w.pds ? 3 : tor ? 1 : 0,
    score: w.pds ? 94 : tor ? 34 : 10,
    lane: "us",
    kind: tor ? "tornado" : "severe",
    kicker: w.pds ? "Particularly Dangerous Situation" : tor ? "Tornado Watch" : "Severe Thunderstorm Watch",
    title: `${name} ${describePlace(w.lat, w.lon) || ""}`.trim(),
    summary: `Until ${hhmmZ(w.expires)}. Hail to ${w.maxHail ?? "?"}" and gusts to ${w.maxGustKt ? Math.round(w.maxGustKt * 1.15078) : "?"} mph possible.`,
    lat: w.lat,
    lon: w.lon,
    time: w.issue,
    learn: w.pds ? ["pds-watch", "tornado-watch"] : tor ? ["tornado-watch"] : ["severe-thunderstorm-warning"],
    links: w.url ? [{ label: `SPC watch ${w.number}`, url: w.url }] : [],
    radius: 160,
  };
}

// A story started by an alert or report that didn't land in an anchor.
function seedStory(item) {
  return {
    id: `${item.rank.kind}-${round(item.lat, 1)}_${round(item.lon, 1)}`,
    tier: item.rank.tier,
    score: item.rank.score,
    lane: "us",
    kind: item.rank.kind || "reports",
    kicker: item.rank.label,
    title: "",
    summary: "",
    lat: item.lat,
    lon: item.lon,
    time: item.sent || item.time,
    learn: [...(item.rank.learn || [])],
    links: [],
    radius: item.rank.kind === "winter" || item.rank.kind === "heat" || item.rank.kind === "cold" || item.rank.kind === "fire" ? 250 : 130,
  };
}

async function buildStories(env) {
  const tasks = {
    short: getAlerts(SHORT_FUSE, env),
    long: getAlerts(LONG_FUSE, env),
    watches: getWatches(env),
    outlook: getOutlook(env),
    storms: getStorms(env),
    reports: getReports(env),
    records: getRecords(env),
    world: getWorld(env),
    // Where NOAA has aimed the 1-minute mesoscale sectors: a story under one
    // is weather forecasters are watching closely.
    meso: satelliteCatalog(env).then((c) => (c.meso || []).filter((m) => m.center && Number.isFinite(m.center.lat))),
  };
  const keys = Object.keys(tasks);
  const settled = await Promise.allSettled(keys.map((k) => withDeadline(tasks[k], SOURCE_DEADLINE_MS, k)));
  const got = {};
  const unavailable = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") got[keys[i]] = s.value;
    else unavailable.push(keys[i]);
  });

  const stories = [];
  // 1. Anchors: hurricanes first (everything near a landfall is that story),
  //    then SPC MDT/HIGH/ENH areas, then watches.
  for (const s of got.storms || []) if (Number.isFinite(s.lat)) stories.push(tropicalStory(s));
  const topArea = (got.outlook?.areas || []).filter((a) => a.rank >= 3).sort((a, b) => b.rank - a.rank)[0];
  if (topArea) stories.push(outlookStory(got.outlook, topArea));
  for (const st of stories) st.members = [];

  const attach = (item, makeSeed) => {
    let best = null;
    for (const st of stories) {
      const d = haversineMi(st.lat, st.lon, item.lat, item.lon);
      if (d <= st.radius && (!best || d < best.d)) best = { st, d };
    }
    if (best) {
      best.st.members.push(item);
      return best.st;
    }
    if (!makeSeed) return null;
    const st = seedStory(item);
    st.members = [item];
    stories.push(st);
    return st;
  };

  for (const w of got.watches || []) {
    if (!Number.isFinite(w.lat)) continue;
    const host = attach({ ...w, kindOf: "watch", rank: { score: w.pds ? 94 : 20, tier: w.pds ? 3 : 0, label: "watch" } }, false);
    if (!host && (w.pds || w.type === "TOR")) {
      const st = watchStory(w);
      st.members = [];
      stories.push(st);
    }
  }

  // 2. Alerts, most severe first, so the strongest item seeds each cluster.
  const alerts = [...(got.short || []), ...(got.long || [])]
    .filter((a) => Number.isFinite(a.lat))
    .map((a) => ({ ...a, kindOf: "alert", rank: alertRank(a) }))
    .sort((a, b) => b.rank.score - a.rank.score);
  for (const a of alerts) attach(a, a.rank.tier >= 1);

  // 3. Storm reports: evidence for existing stories; significant ones seed.
  const reports = (got.reports || [])
    .map((r) => ({ ...r, kindOf: "report", rank: reportRank(r) }))
    .filter((r) => r.rank)
    .sort((a, b) => b.rank.score - a.rank.score);
  for (const r of reports) attach(r, r.rank.tier >= 1);

  // 4. Finish each story: tier from its members, counts, title, summary.
  for (const st of stories) finishStory(st);
  for (const st of stories) attachMeso(st, got.meso || []);

  // 5. Records and the world lane.
  const rec = recordsStory(got.records || []);
  if (rec) stories.push(rec);
  for (const w of got.world || []) stories.push(worldStory(w));

  const shown = stories
    .filter((s) => s.tier >= 1 || s.kind === "tropical")
    .sort((a, b) => b.tier - a.tier || b.score - a.score || String(b.time).localeCompare(String(a.time)))
    .slice(0, 14);
  for (const s of shown) {
    if (Number.isFinite(s.lat)) {
      s.place = s.place || describePlace(s.lat, s.lon);
      const radar = s.lane === "us" ? nearestRadar(s.lat, s.lon) : null;
      s.radar = radar && radar.distMi <= 230 ? radar : null;
    }
    delete s.members;
    delete s.radius;
  }

  const usTier = Math.max(0, ...shown.filter((s) => s.lane === "us").map((s) => s.tier));
  return {
    generated: new Date().toISOString(),
    level: ["quiet", "active", "major", "extreme"][usTier],
    counts: { ...countEvents(alerts, got.watches || [], reports), reports6hAll: (got.reports || []).length },
    stories: shown,
    map: mapLayers(alerts, got.watches || [], got.outlook, reports, got.storms || []),
    outlook: got.outlook ? { issued: got.outlook.issued, max: maxCategory(got.outlook), text: got.outlook.text } : null,
    unavailable,
  };
}

function finishStory(st) {
  const m = st.members || [];
  const alerts = m.filter((x) => x.kindOf === "alert").sort((a, b) => b.rank.score - a.rank.score);
  const reports = m.filter((x) => x.kindOf === "report").sort((a, b) => b.rank.score - a.rank.score);
  const watches = m.filter((x) => x.kindOf === "watch");
  const top = alerts[0];
  const topReport = reports[0];

  // Members can raise a story's tier (an Extreme Wind Warning inside a
  // hurricane story), never lower it. Eight or more tornado warnings in one
  // area is an outbreak whatever their tags say.
  const tors = alerts.filter((a) => a.event === "Tornado Warning").length;
  const memberTier = Math.max(0, ...m.map((x) => x.rank.tier), tors >= 8 ? 3 : tors >= 4 ? 2 : 0);
  if (memberTier > st.tier) st.tier = memberTier;
  const memberScore = Math.max(0, ...m.map((x) => x.rank.score));
  st.score = Math.max(st.score, memberScore) + Math.min(10, m.length);

  for (const x of [...alerts.slice(0, 3)]) for (const k of x.rank.learn || []) if (!st.learn.includes(k)) st.learn.push(k);
  if (reports.length && !st.learn.includes("local-storm-reports")) st.learn.push("local-storm-reports");
  if (watches.some((w) => w.pds) && !st.learn.includes("pds-watch")) st.learn.unshift("pds-watch");
  st.learn = st.learn.slice(0, 4);

  // Badges: what's in the story, extreme first.
  const byEvent = {};
  for (const a of alerts) byEvent[a.rank.label] = (byEvent[a.rank.label] || 0) + 1;
  const badges = Object.entries(byEvent)
    .map(([label, n]) => {
      const tier = alerts.find((a) => a.rank.label === label).rank.tier;
      return { label: n > 1 ? `${n} × ${label}` : label, tone: ["context", "notable", "major", "extreme"][tier], tier };
    })
    .sort((a, b) => b.tier - a.tier);
  for (const w of watches) badges.push({ label: `${w.pds ? "PDS " : ""}${w.type === "TOR" ? "Tornado" : "Svr Tstm"} Watch ${w.number}`, tone: w.pds ? "extreme" : "notable", tier: w.pds ? 3 : 1 });
  if (reports.length) badges.push({ label: `${reports.length} storm report${reports.length > 1 ? "s" : ""}`, tone: "context", tier: 0 });
  st.badges = badges.slice(0, 6).map(({ tier, ...b }) => b);

  // Kicker/title/summary. Anchored stories keep their own title and lead
  // with their most extreme member; seeded stories are named from it.
  if (top && top.rank.tier >= 2 && (st.kind === "tropical" || st.kind === "outlook")) st.kicker = top.rank.label;
  if (!st.title) {
    const place = areaText(top ? top.area : "", 3, top ? top.states : []) || describePlace(st.lat, st.lon) || "";
    if (top) {
      const n = alerts.filter((a) => a.rank.label === top.rank.label).length;
      st.title = n > 1 ? `${n} ${plural(top.rank.label)} — ${place}` : `${top.rank.label} — ${place}`;
    } else if (topReport) {
      st.title = `${topReport.rank.label} — ${topReport.place || describePlace(st.lat, st.lon)}`;
    }
  }
  const lead = top && top.rank.tier >= 1 && top.narrative ? top.narrative : null;
  if (lead) st.summary = st.summary ? `${lead} ${st.summary}` : lead;
  else if (!st.summary && topReport) st.summary = `${topReport.type.toLowerCase()} ${topReport.mag != null ? `(${topReport.mag}${topReport.unit === "MPH" ? " mph" : topReport.unit === "INCH" ? '"' : ""}) ` : ""}reported ${topReport.place ? `at ${topReport.place}` : ""} ${relTime(topReport.time)}.${topReport.remark ? " " + topReport.remark : ""}`.replace(/\s+/g, " ").trim();
  st.time = [st.time, ...m.map((x) => x.sent || x.time)].filter(Boolean).sort().pop() || st.time;
  st.expires = alerts.map((a) => a.expires).filter(Boolean).sort().pop() || null;

  st.items = [
    ...alerts.slice(0, 6).map((a) => ({ type: "alert", label: a.rank.label, area: areaText(a.area, 4, a.states), expires: a.expires, text: a.narrative })),
    ...reports.slice(0, 5).map((r) => ({ type: "report", label: r.rank.label, area: r.place, time: r.time, source: r.source, text: r.remark })),
  ];
  st.geometry = alerts.filter((a) => a.geometry).slice(0, 12).map((a) => ({ event: a.event, label: a.rank.label, geometry: a.geometry }));
  st.counts = { alerts: alerts.length, reports: reports.length, tornadoWarnings: tors };
  if (st.lane === "us" && top?.wfo) st.links.push({ label: `NWS ${top.wfo}`, url: `https://www.weather.gov/${top.wfo.toLowerCase()}` });
}

function attachMeso(st, meso) {
  if (!Number.isFinite(st.lat)) return;
  const near = meso.filter((m) => haversineMi(st.lat, st.lon, m.center.lat, m.center.lon) <= 300);
  if (!near.length) return;
  st.meso = near.map((m) => ({ sat: m.sat, id: m.id, label: m.label || null, cadenceSec: m.cadenceSec || null, imagery: !!m.bands?.length }));
  for (const sat of ["east", "west"]) {
    const mine = near.filter((m) => m.sat === sat);
    if (!mine.length) continue;
    const ids = mine.map((m) => m.id.replace("M", "")).sort().join("+");
    const fast = mine.some((m) => m.cadenceSec === 30) ? " · 30-s scans" : "";
    // Third in line: after the most extreme items, before the counts.
    (st.badges = st.badges || []).splice(2, 0, { label: `GOES-${sat === "west" ? "West" : "East"} Meso ${ids} watching${fast}`, tone: "notable" });
  }
  if (!st.learn.includes("mesoscale-sectors")) st.learn.push("mesoscale-sectors");
}

function recordsStory(records) {
  if (!records.length) return null;
  const all = records.flatMap((r) => r.lines.map((l) => ({ ...l, office: r.office, st: r.st })));
  const n = all.length;
  const big = records.some((r) => /ALL[- ]TIME|MONTHLY|FOR THE MONTH|WARMEST .* ON RECORD|COLDEST .* ON RECORD|EARLIEST|LATEST/i.test(r.text));
  const kinds = {};
  for (const r of records) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
  const mainKind = Object.entries(kinds).sort((a, b) => b[1] - a[1])[0]?.[0] || "records";
  const states = [...new Set(records.map((r) => r.st).filter(Boolean))];
  return {
    id: `records-${new Date().toISOString().slice(0, 10)}`,
    tier: big || n >= 20 ? 2 : 1,
    score: big ? 50 : 20 + Math.min(20, n),
    lane: "us",
    kind: "records",
    kicker: "Records",
    title: n
      ? `${n} record${n === 1 ? "" : "s"} set in the last day${mainKind !== "records" ? ` — mostly ${mainKind}` : ""}`
      : `${records.length} record event report${records.length === 1 ? "" : "s"} in the last day`,
    summary: records.slice(0, 3).map((r) => `${r.office}: ${r.headline}`).join(" · "),
    states,
    time: records.map((r) => r.issued).sort().pop(),
    items: all.slice(0, 10).map((l) => ({ type: "record", label: l.text, area: l.office })),
    badges: states.slice(0, 6).map((s) => ({ label: s, tone: "context" })),
    learn: ["record-event-report"],
    links: [{ label: "NWS record reports", url: "https://www.weather.gov/" }],
  };
}

function worldStory(w) {
  const what = { TC: "Tropical cyclone", FL: "Flooding", WF: "Wildfire" }[w.type] || "Disaster";
  return {
    id: `gdacs-${w.id}`,
    tier: 3,
    score: 70,
    lane: "world",
    kind: "world",
    kicker: `World · GDACS red alert`,
    title: `${w.name}${w.country ? ` — ${w.country}` : ""}`,
    summary: `${what}. ${w.severity}`.trim(),
    lat: w.lat,
    lon: w.lon,
    time: w.to,
    learn: w.type === "TC" ? ["saffir-simpson"] : [],
    links: [{ label: "GDACS report", url: w.url }],
  };
}

// ── Map layers (compact) ────────────────────────────────────────────────────
function mapLayers(alerts, watches, outlook, reports, storms) {
  return {
    warnings: alerts
      .filter((a) => a.geometry && a.rank.kind !== "fire" && a.rank.kind !== "heat" && a.rank.kind !== "cold")
      .slice(0, 160)
      .map((a) => ({ event: a.event, label: a.rank.label, tier: a.rank.tier, expires: a.expires, area: areaText(a.area, 3), geometry: a.geometry })),
    // Long-fuse hazards are mostly zone-based: a marker at the counties'
    // center, plus the polygon when the alert has one.
    hazards: alerts
      .filter((a) => a.rank.kind === "fire" || a.rank.kind === "heat" || a.rank.kind === "cold" || a.event === "Blizzard Warning" || a.event === "Ice Storm Warning")
      .slice(0, 120)
      .map((a) => ({ event: a.event, label: a.rank.label, tier: a.rank.tier, area: areaText(a.area, 2, a.states), lat: round(a.lat, 2), lon: round(a.lon, 2), geometry: a.geometry ? simplifyGeom(a.geometry, 0.03) : null })),
    watches: watches.map((w) => ({ number: w.number, type: w.type, pds: w.pds, expires: w.expires, geometry: w.geometry })),
    outlook: (outlook?.areas || []).map((a) => ({ label: a.label, name: a.name, geometry: simplifyGeom(a.geometry, 0.04) })),
    reports: reports.slice(0, 200).map((r) => ({ type: r.type, label: r.rank.label, tier: r.rank.tier, mag: r.mag, place: r.place, time: r.time, lat: round(r.lat, 3), lon: round(r.lon, 3) })),
    storms: storms.map((s) => ({ name: s.name, classification: s.classification, kt: s.kt, cat: s.classification === "HU" ? saffir(s.kt || 0) : 0, lat: s.lat, lon: s.lon })),
  };
}

function countEvents(alerts, watches, reports) {
  const c = { tornadoWarnings: 0, severeWarnings: 0, flashFloodWarnings: 0, extremeWind: 0, emergencies: 0, watches: watches.length, pdsWatches: watches.filter((w) => w.pds).length, reports6h: reports.length };
  for (const a of alerts) {
    if (a.event === "Tornado Warning") c.tornadoWarnings++;
    else if (a.event === "Severe Thunderstorm Warning") c.severeWarnings++;
    else if (a.event === "Flash Flood Warning") c.flashFloodWarnings++;
    else if (a.event === "Extreme Wind Warning") c.extremeWind++;
    if (a.emergency || a.tags.tornadoDamageThreat === "CATASTROPHIC" || a.tags.flashFloodDamageThreat === "CATASTROPHIC") c.emergencies++;
  }
  return c;
}

function maxCategory(o) {
  const top = (o.areas || []).sort((a, b) => b.rank - a.rank)[0];
  return top ? top.label : "TSTM or none";
}

// ── Text helpers ────────────────────────────────────────────────────────────
function clean(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

// The "* At 544 PM CDT, …" bullet of a warning: what the radar or spotters
// see right now, in the forecaster's words.
// Long-fuse products have no such bullet; their "* WHAT..." line says it.
function hazardNarrative(desc) {
  const m = /\*\s*At\s+([\s\S]*?)(?:\n\s*\n|\n\s*\*|$)/i.exec(desc);
  const what = /\*\s*WHAT\.\.\.([\s\S]*?)(?:\n\s*\n|\n\s*\*|$)/i.exec(desc);
  const text = m ? "At " + clean(m[1]) : what ? clean(what[1]) : clean(desc.split(/\n\s*\n/)[1] || "");
  return text.length > 320 ? text.slice(0, 317).replace(/\s+\S*$/, "") + "…" : text;
}

function statesOf(areaDesc) {
  const out = new Set();
  for (const m of String(areaDesc || "").matchAll(/,\s*([A-Z]{2})(?=;|$)/g)) out.add(m[1]);
  return [...out];
}

// "Walton Co., FL" / "Bay, Calhoun & Washington counties, FL" / "6 counties in FL, AL".
function areaText(areaDesc, max = 3, fallbackStates = []) {
  const parts = String(areaDesc || "").split(";").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return "";
  const rows = parts.map((p) => {
    const m = /^(.*?),\s*([A-Z]{2})$/.exec(p);
    return m ? { name: m[1], st: m[2] } : { name: p, st: "" };
  });
  const states = [...new Set(rows.map((r) => r.st).filter(Boolean))];
  // Zone-based alerts name forecast zones ("Imperial County Southwest"), not
  // "County, ST" pairs.
  if (!states.length) {
    const st = fallbackStates.length ? ` (${fallbackStates.join(", ")})` : "";
    return rows.length <= 2 ? rows.map((r) => r.name).join(" & ") + st : `${rows[0].name} & ${rows.length - 1} more zones${st}`;
  }
  if (rows.length === 1) return rows[0].st ? `${rows[0].name} Co., ${rows[0].st}` : rows[0].name;
  if (rows.length <= max && states.length === 1) {
    const names = rows.map((r) => r.name);
    return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]} counties, ${states[0]}`;
  }
  return `${rows.length} counties in ${states.join(", ")}`;
}

function plural(label) {
  if (/Warning$|Watch$/.test(label)) return label + (label.endsWith("Watch") ? "es" : "s");
  if (/tornado$/i.test(label)) return label.replace(/tornado$/i, "tornadoes");
  if (/storm$/i.test(label)) return label + "s";
  return label;
}

function compass(deg) {
  const P = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return P[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

function hhmmZ(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "expiration";
  return d.toISOString().slice(11, 16) + "Z";
}

function relTime(iso) {
  const ms = Date.now() - Date.parse(iso || "");
  if (!Number.isFinite(ms)) return "";
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min ago`;
  return `${Math.round(min / 60)} h ago`;
}

// SPC GeoJSON times are "YYYYMMDDHHMM" UTC.
function spcTime(s) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(s || ""));
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z` : null;
}

// "...THERE IS A MODERATE RISK OF SEVERE THUNDERSTORMS ACROSS …" plus the
// SUMMARY paragraph, de-capitalized enough to read.
function outlookSummary(text) {
  const t = String(text || "");
  const risk = /\.\.\.(THERE IS (?:A|AN) [\s\S]*?)\.\.\./.exec(t);
  const sum = /\.\.\.SUMMARY\.\.\.\s*([\s\S]*?)\n\s*\n/.exec(t);
  const pieces = [risk && clean(risk[1]), sum && clean(sum[1])].filter(Boolean);
  return pieces.map((x) => prettyCaps(x).replace(/([^.!?])$/, "$1.")).join(" ") || null;
}

function sentenceCase(s) {
  if (s !== s.toUpperCase()) return s;
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// One RER: office, state, headline, and each record it lists. Offices write
// these three ways: prose ("A RECORD HIGH TEMPERATURE OF 93 DEGREES WAS SET
// AT LAKE CHARLES TODAY"), "SITE  85  85 (1965)" tables, and "SITE  93 IN
// 2010  94 IN 2026" tables. Headlines can wrap onto a second line.
function parseRER(prod) {
  const text = String(prod.productText || "");
  const flat = clean(text);
  const office = /NATIONAL WEATHER SERVICE ([A-Za-z .'/-]+?),?\s+([A-Z]{2})\s*$/im.exec(text) || [];
  const head = /\.\.\.([A-Za-z0-9][^]{4,220}?)\.\.\./.exec(text);
  const kind = /RECORD (?:DAILY )?(?:MAXIMUM|HIGH)|WARM/i.test(text)
    ? /LOW(?:EST)? MAX|COOL/i.test(text) ? "cool highs" : "heat"
    : /RECORD (?:DAILY )?(?:MINIMUM|LOW)|COLD/i.test(text) ? "cold"
      : /RAIN|PRECIP/i.test(text) ? "rain" : /SNOW/i.test(text) ? "snow" : "records";
  const lines = [];
  for (const m of flat.matchAll(/A RECORD ([A-Z ]+?) OF ([-\d.]+|TRACE)[^.]*? WAS SET AT ([A-Z .'/-]+?)(?: TODAY| YESTERDAY|\.| ON)/gi)) {
    lines.push({ text: `${titleCase(m[3].trim())}: record ${m[1].toLowerCase()} of ${m[2]}` });
  }
  if (!lines.length) {
    for (const m of text.matchAll(/^([A-Za-z][A-Za-z .'/-]+?)\s{2,}(-?\d+(?:\.\d+)?|T) IN (\d{4})\s+(-?\d+(?:\.\d+)?|T) IN (\d{4})/gm)) {
      lines.push({ text: `${titleCase(m[1].trim())}: ${m[4]} (old record ${m[2]}, ${m[3]})` });
    }
  }
  if (!lines.length) {
    for (const m of text.matchAll(/^([A-Za-z][A-Za-z .'/-]+?)\s{2,}(-?\d+(?:\.\d+)?|T)\s+(-?\d+(?:\.\d+)?|T)\s*\(([\d, ]+)\)/gm)) {
      lines.push({ text: `${titleCase(m[1].trim())}: ${m[2]} (old record ${m[3]}, ${m[4].replace(/\s+/g, "")})` });
    }
  }
  return {
    office: office[1] ? titleCase(office[1]) : prod.issuingOffice,
    st: office[2] || null,
    issued: prod.issuanceTime,
    headline: head ? headlineCase(clean(head[1])) : "Record event report",
    kind,
    lines: lines.slice(0, 6),
    text,
  };
}

// Upper-case product text → readable sentence case that keeps place names.
const PROPER = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida",
  "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine",
  "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska",
  "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas",
  "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming", "Gulf Coast", "Gulf",
  "Mid-South", "Midwest", "Southeast", "Southwest", "Northeast", "Northwest", "Mid-Atlantic", "New England",
  "Great Lakes", "Great Plains", "High Plains", "Plains", "Ozarks", "Appalachians", "Rockies", "Panhandle",
  "Upper Midwest", "Ohio Valley", "Tennessee Valley", "Mississippi Valley", "Missouri Valley", "Red River",
  "Big Bend", "Piedmont", "Carolinas", "Atlantic", "Pacific", "Hurricane", "Tropical Storm",
];
const PROPER_RE = new RegExp(`\\b(${PROPER.map((w) => w.toLowerCase().replace(/[-]/g, "\\-")).join("|")})\\b`, "g");
function prettyCaps(s) {
  if (s !== s.toUpperCase()) return s;
  const lower = s.toLowerCase().replace(PROPER_RE, (w) => w.replace(/(^|[\s-])[a-z]/g, (c) => c.toUpperCase()));
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

const SMALL = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to"]);
function headlineCase(s) {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().split(" ").map((w, i) => (i && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
}

function titleCase(s) {
  return String(s).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// ── Geometry ────────────────────────────────────────────────────────────────
// Round coordinates and drop points closer than `tol` degrees to the last kept
// one (cheap radial simplification — NWS polygons are small, SPC ones large).
function simplifyGeom(g, tol) {
  if (!g || !g.coordinates) return null;
  const ring = (r) => {
    const out = [];
    for (const p of r) {
      const q = [round(p[0], 3), round(p[1], 3)];
      const last = out[out.length - 1];
      if (!last || Math.abs(last[0] - q[0]) > tol || Math.abs(last[1] - q[1]) > tol) out.push(q);
    }
    if (out.length && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) out.push(out[0]);
    return out.length >= 4 ? out : null;
  };
  if (g.type === "Polygon") {
    const rings = g.coordinates.map(ring).filter(Boolean);
    return rings.length ? { type: "Polygon", coordinates: rings } : null;
  }
  if (g.type === "MultiPolygon") {
    const polys = g.coordinates.map((p) => p.map(ring).filter(Boolean)).filter((p) => p.length);
    return polys.length ? { type: "MultiPolygon", coordinates: polys } : null;
  }
  return null;
}

// Chat tool: the board in a shape the model can quote.
export async function storiesForChat(env) {
  const d = await nationalStories(env);
  return {
    generated: d.generated,
    nationalLevel: d.level,
    counts: d.counts,
    spcDay1: d.outlook,
    stories: d.stories.map((s) => ({
      tier: s.tier, lane: s.lane, kicker: s.kicker, title: s.title, place: s.place, lat: s.lat, lon: s.lon,
      summary: s.summary, badges: (s.badges || []).map((b) => b.label), facts: s.facts,
      items: (s.items || []).slice(0, 5), radar: s.radar?.id, learn: s.learn,
    })),
    unavailable: d.unavailable,
  };
}
