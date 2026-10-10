// WeatherNet "brain": weatherchat's backend, carried over intact.
//
// This is weatherchat's worker (github.com/praxeo/weatherchat, index.js) minus
// its bundled Node polyfills and its single-file front end (INDEX_HTML). The
// `// src/*.ts` markers are the original module boundaries; split along them
// when a part needs real surgery. WeatherNet-specific changes in this file are
// marked "WeatherNet:"; everything else should stay in step with weatherchat
// so fixes can be ported in either direction.
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/geo.ts
function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  const n = ring.length;
  let j = n - 1;
  for (let i = 0; i < n; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
__name(pointInRing, "pointInRing");
function pointInPolygon(point, polygon) {
  if (!polygon.length) return false;
  if (!pointInRing(point, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(point, polygon[i])) return false;
  }
  return true;
}
__name(pointInPolygon, "pointInPolygon");
function pointInGeometry(point, geometry) {
  if (!geometry) return false;
  if (geometry.type === "Polygon") {
    return pointInPolygon(point, geometry.coordinates);
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((poly) => pointInPolygon(point, poly));
  }
  return false;
}
__name(pointInGeometry, "pointInGeometry");

// src/weather.ts
// Every upstream data fetch gets a deadline. Without one, a single slow host
// (api.weather.gov and nhc.noaa.gov both crawl under storm-day load) holds a
// tool round, the dashboard or the discussion open indefinitely and the page
// just spins. A timed-out fetch rejects like any other upstream failure, so
// the existing partial-failure handling takes over.
var UPSTREAM_TIMEOUT_MS = 15e3;
function upstreamSignal(ms) {
  return AbortSignal.timeout(ms || UPSTREAM_TIMEOUT_MS);
}
__name(upstreamSignal, "upstreamSignal");
async function nwsJSON(url, ua, cacheTtl = 300) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": ua,
      "Accept": "application/geo+json,application/ld+json,application/json"
    },
    cf: { cacheTtl, cacheEverything: true },
    signal: upstreamSignal()
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`NWS ${r.status} on ${url}: ${body.slice(0, 200)}`);
  }
  return r.json();
}
__name(nwsJSON, "nwsJSON");
async function fetchText(url, ua, cacheTtl = 300) {
  const r = await fetch(url, {
    headers: { "User-Agent": ua, "Accept": "text/plain,text/html,application/xml,*/*" },
    cf: { cacheTtl, cacheEverything: true },
    signal: upstreamSignal()
  });
  if (!r.ok) throw new Error(`${r.status} on ${url}`);
  return r.text();
}
__name(fetchText, "fetchText");
async function fetchJSON(url, ua, cacheTtl = 300) {
  const r = await fetch(url, {
    headers: { "User-Agent": ua, "Accept": "application/json,application/geo+json" },
    cf: { cacheTtl, cacheEverything: true },
    signal: upstreamSignal()
  });
  if (!r.ok) throw new Error(`${r.status} on ${url}`);
  return r.json();
}
__name(fetchJSON, "fetchJSON");
async function pointInfo(lat, lon, ua) {
  const la = Math.round(lat * 1e4) / 1e4;
  const lo = Math.round(lon * 1e4) / 1e4;
  return nwsJSON(`https://api.weather.gov/points/${la},${lo}`, ua, 86400);
}
__name(pointInfo, "pointInfo");
async function getForecast(lat, lon, ua) {
  const pt = await pointInfo(lat, lon, ua);
  const fc = await nwsJSON(pt.properties.forecast, ua, 600);
  const periods = (fc.properties.periods || []).map((p) => ({
    name: p.name,
    isDaytime: p.isDaytime,
    temp: `${p.temperature}\xB0${p.temperatureUnit}`,
    wind: `${p.windSpeed} ${p.windDirection}`,
    short: p.shortForecast,
    detailed: p.detailedForecast,
    pop: p.probabilityOfPrecipitation?.value ?? null
  }));
  return JSON.stringify({
    location: `${pt.properties.relativeLocation?.properties?.city ?? "?"}, ${pt.properties.relativeLocation?.properties?.state ?? "?"}`,
    office: pt.properties.gridId,
    grid: `${pt.properties.gridX},${pt.properties.gridY}`,
    elevation_m: pt.properties.elevation?.value ?? null,
    timeZone: pt.properties.timeZone,
    updated: fc.properties.updated,
    periods
  }, null, 2);
}
__name(getForecast, "getForecast");
async function getHourlyForecast(lat, lon, hours, ua) {
  const pt = await pointInfo(lat, lon, ua);
  const fc = await nwsJSON(pt.properties.forecastHourly, ua, 600);
  const max = Math.min(Math.max(hours || 36, 1), 156);
  const periods = (fc.properties.periods || []).slice(0, max).map((p) => ({
    t: p.startTime,
    temp: `${p.temperature}\xB0${p.temperatureUnit}`,
    wind: `${p.windSpeed} ${p.windDirection}`,
    short: p.shortForecast,
    pop: p.probabilityOfPrecipitation?.value ?? null
  }));
  return JSON.stringify({
    location: `${pt.properties.relativeLocation?.properties?.city}, ${pt.properties.relativeLocation?.properties?.state}`,
    office: pt.properties.gridId,
    updated: fc.properties.updated,
    hours: periods.length,
    periods
  }, null, 2);
}
__name(getHourlyForecast, "getHourlyForecast");
function parseISODurationMs(dur) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(dur || "");
  if (!m) return 36e5;
  const d = +(m[1] || 0), h = +(m[2] || 0), mi = +(m[3] || 0), s = +(m[4] || 0);
  const ms = ((d * 24 + h) * 60 + mi) * 6e4 + s * 1e3;
  return ms || 36e5;
}
__name(parseISODurationMs, "parseISODurationMs");
function gridSeriesToHourly(prop, startMs, hours, conv) {
  const out = new Array(hours).fill(null);
  if (!prop || !Array.isArray(prop.values)) return out;
  const intervals = [];
  for (const v of prop.values) {
    const vt = String(v.validTime);
    const slash = vt.indexOf("/");
    const startISO = slash >= 0 ? vt.slice(0, slash) : vt;
    const durMs = slash >= 0 ? parseISODurationMs(vt.slice(slash + 1)) : 36e5;
    const s = Date.parse(startISO);
    if (isNaN(s)) continue;
    intervals.push({ s, e: s + durMs, val: v.value });
  }
  intervals.sort((a, b) => a.s - b.s);
  for (let i = 0; i < hours; i++) {
    const t = startMs + i * 36e5;
    let val = null;
    for (const iv of intervals) {
      if (iv.s > t) break;
      if (t >= iv.s && t < iv.e) { val = iv.val; break; }
    }
    out[i] = val == null ? null : conv ? conv(val) : Math.round(val);
  }
  return out;
}
__name(gridSeriesToHourly, "gridSeriesToHourly");
function gridAccumHourly(prop, startMs, hours) {
  const out = new Array(hours).fill(null);
  if (!prop || !Array.isArray(prop.values)) return out;
  const iv = [];
  for (const v of prop.values) {
    if (v.value == null) continue;
    const vt = String(v.validTime);
    const slash = vt.indexOf("/");
    const s = Date.parse(slash >= 0 ? vt.slice(0, slash) : vt);
    if (isNaN(s)) continue;
    const durMs = slash >= 0 ? parseISODurationMs(vt.slice(slash + 1)) : 36e5;
    iv.push({ s, e: s + durMs, perHrMm: v.value * 36e5 / durMs });
  }
  iv.sort((a, b) => a.s - b.s);
  for (let i = 0; i < hours; i++) {
    const t = startMs + i * 36e5;
    let val = null;
    for (const x of iv) { if (x.s > t) break; if (t >= x.s && t < x.e) { val = x.perHrMm; break; } }
    out[i] = val == null ? null : Math.round(val * 0.0393701 * 1e3) / 1e3;
  }
  return out;
}
__name(gridAccumHourly, "gridAccumHourly");
async function getGridpointSeries(lat, lon, ua, hours) {
  const H = Math.min(Math.max(hours || 48, 1), 156);
  const pt = await pointInfo(lat, lon, ua);
  const gridUrl = pt.properties?.forecastGridData;
  if (!gridUrl) throw new Error("no gridpoint data url");
  const g = await nwsJSON(gridUrl, ua, 900);
  const P = g.properties || {};
  const startMs = Math.floor(Date.now() / 36e5) * 36e5;
  const c2f = /* @__PURE__ */ __name((v) => Math.round((v * 9 / 5 + 32) * 10) / 10, "c2f");
  const kmh2mph = /* @__PURE__ */ __name((v) => Math.round(v * 0.621371), "kmh2mph");
  const mm2in = /* @__PURE__ */ __name((v) => Math.round(v * 0.0393701 * 100) / 100, "mm2in");
  const times = [];
  for (let i = 0; i < H; i++) times.push(new Date(startMs + i * 36e5).toISOString());
  const series = {
    start: new Date(startMs).toISOString(),
    hours: H,
    times,
    temp_F: gridSeriesToHourly(P.temperature, startMs, H, c2f),
    dewpoint_F: gridSeriesToHourly(P.dewpoint, startMs, H, c2f),
    apparent_F: gridSeriesToHourly(P.apparentTemperature, startMs, H, c2f),
    pop: gridSeriesToHourly(P.probabilityOfPrecipitation, startMs, H, null),
    sky: gridSeriesToHourly(P.skyCover, startMs, H, null),
    wind_mph: gridSeriesToHourly(P.windSpeed, startMs, H, kmh2mph),
    gust_mph: gridSeriesToHourly(P.windGust, startMs, H, kmh2mph),
    windDir: gridSeriesToHourly(P.windDirection, startMs, H, null),
    rh: gridSeriesToHourly(P.relativeHumidity, startMs, H, null),
    qpf_in: gridAccumHourly(P.quantitativePrecipitation, startMs, H)
  };
  // QPF is an ACCUMULATION per interval (e.g. a 6-hour block total), so sum the
  // raw intervals prorated by their overlap with the window — never the per-hour
  // replicated array, which would multiply each block total by its hour count.
  const accumOverWindow = /* @__PURE__ */ __name((prop, winStart, winEnd) => {
    if (!prop || !Array.isArray(prop.values)) return null;
    let total = 0, any = false;
    for (const v of prop.values) {
      if (v.value == null) continue;
      const vt = String(v.validTime);
      const slash = vt.indexOf("/");
      const s = Date.parse(slash >= 0 ? vt.slice(0, slash) : vt);
      if (isNaN(s)) continue;
      const durMs = slash >= 0 ? parseISODurationMs(vt.slice(slash + 1)) : 36e5;
      const ov = Math.min(s + durMs, winEnd) - Math.max(s, winStart);
      if (ov > 0) { total += v.value * (ov / durMs); any = true; }
    }
    return any ? total : null;
  }, "accumOverWindow");
  const maxp = /* @__PURE__ */ __name((arr, n) => {
    let m = null;
    for (let i = 0; i < Math.min(n, arr.length); i++) if (arr[i] != null && (m == null || arr[i] > m)) m = arr[i];
    return m;
  }, "maxp");
  const qpf24mm = accumOverWindow(P.quantitativePrecipitation, startMs, startMs + 24 * 36e5);
  const qpf48mm = accumOverWindow(P.quantitativePrecipitation, startMs, startMs + 48 * 36e5);
  series.qpf24_in = qpf24mm == null ? null : mm2in(qpf24mm);
  series.qpf48_in = qpf48mm == null ? null : mm2in(qpf48mm);
  series.popMax24 = maxp(series.pop, 24);
  series.popMax48 = maxp(series.pop, 48);
  return series;
}
__name(getGridpointSeries, "getGridpointSeries");
async function getActiveAlerts(lat, lon, ua) {
  const data = await nwsJSON(
    `https://api.weather.gov/alerts/active?point=${lat},${lon}`,
    ua,
    60
  );
  const alerts = (data.features || []).map((f) => {
    const p = f.properties || {};
    return {
      id: p.id,
      event: p.event,
      severity: p.severity,
      certainty: p.certainty,
      urgency: p.urgency,
      messageType: p.messageType,
      sent: p.sent,
      effective: p.effective,
      onset: p.onset,
      expires: p.expires,
      ends: p.ends,
      senderName: p.senderName,
      headline: p.headline,
      areaDesc: p.areaDesc,
      description: p.description,
      instruction: p.instruction
    };
  });
  if (!alerts.length) return JSON.stringify({ count: 0, alerts: [] });
  return JSON.stringify({ count: alerts.length, alerts }, null, 2);
}
__name(getActiveAlerts, "getActiveAlerts");
async function getAFD(office, ua) {
  return getProduct("AFD", office, ua);
}
__name(getAFD, "getAFD");
async function getProduct(type, office, ua) {
  const t = type.toUpperCase();
  const o = office.toUpperCase();
  const list = await nwsJSON(
    `https://api.weather.gov/products/types/${t}/locations/${o}`,
    ua,
    300
  );
  const items = list["@graph"] || list.products || [];
  if (!items.length) return `No ${t} products found for ${o}.`;
  const productId = items[0].id || items[0]["@id"]?.split("/").pop();
  const prod = await nwsJSON(`https://api.weather.gov/products/${productId}`, ua, 300);
  return JSON.stringify({
    productCode: t,
    office: o,
    issuanceTime: prod.issuanceTime,
    productName: prod.productName,
    wmoCollectiveId: prod.wmoCollectiveId,
    text: prod.productText
  }, null, 2);
}
__name(getProduct, "getProduct");
var CAT_RANK = { TSTM: 1, MRGL: 2, SLGT: 3, ENH: 4, MDT: 5, HIGH: 6 };
async function fetchSPCLayer(url, ua) {
  try {
    return await fetchJSON(url, ua, 600);
  } catch {
    return null;
  }
}
__name(fetchSPCLayer, "fetchSPCLayer");
function findHighestRiskAtPoint(geojson, pt) {
  if (!geojson?.features?.length) return null;
  let best = null;
  for (const f of geojson.features) {
    if (!pointInGeometry(pt, f.geometry)) continue;
    const raw = String(f.properties?.LABEL ?? f.properties?.label ?? "");
    const sig = /#/.test(raw) || f.properties?.SIG === 1 || f.properties?.sig === 1;
    const label = raw.replace("#", "");
    const rank = CAT_RANK[label] ?? parseFloat(label);
    if (Number.isNaN(rank)) continue;
    if (!best || rank > best.rank) best = { label, rank, sig };
  }
  return best;
}
__name(findHighestRiskAtPoint, "findHighestRiskAtPoint");
async function spcOutlookText(day, ua) {
  const urls = [
    `https://www.spc.noaa.gov/products/outlook/day${day}otlk.txt`,
    `https://www.spc.noaa.gov/products/outlook/archive/`
    // fallback list, unused
  ];
  try {
    return await fetchText(urls[0], ua, 600);
  } catch {
    return null;
  }
}
__name(spcOutlookText, "spcOutlookText");
async function getSPCConvectiveOutlook(day, lat, lon, ua) {
  if (![1, 2, 3].includes(day)) throw new Error("day must be 1, 2, or 3");
  const pt = [lon, lat];
  const base = `https://www.spc.noaa.gov/products/outlook/day${day}otlk`;
  const layerUrls = day === 3 ? { categorical: `${base}_cat.lyr.geojson`, probabilistic: `${base}_prob.lyr.geojson` } : {
    categorical: `${base}_cat.lyr.geojson`,
    tornado: `${base}_torn.lyr.geojson`,
    wind: `${base}_wind.lyr.geojson`,
    hail: `${base}_hail.lyr.geojson`
  };
  const entries = await Promise.all(
    Object.entries(layerUrls).map(async ([k, url]) => [k, await fetchSPCLayer(url, ua)])
  );
  const atPoint = {};
  for (const [k, gj] of entries) {
    const hit = gj ? findHighestRiskAtPoint(gj, pt) : null;
    if (k === "categorical") {
      atPoint.categorical = hit ? { label: hit.label, rank: hit.rank } : { label: "none", rank: 0 };
    } else if (k === "probabilistic") {
      atPoint.probabilistic = hit ? { label: `${hit.label}%`, significant: hit.sig } : null;
    } else {
      atPoint[k] = hit ? { probability: `${hit.label}%`, significant: hit.sig } : null;
    }
  }
  let valid = null;
  let issue = null;
  let expire = null;
  for (const [, gj] of entries) {
    const p = gj?.features?.[0]?.properties;
    if (p) {
      valid = p.VALID ?? p.valid ?? valid;
      issue = p.ISSUE ?? p.issue ?? issue;
      expire = p.EXPIRE ?? p.expire ?? expire;
      if (valid && issue) break;
    }
  }
  const text = await spcOutlookText(day, ua);
  return JSON.stringify({
    day,
    queriedAt: { lat, lon },
    issued: issue,
    valid,
    expires: expire,
    atPoint,
    discussion: text ?? "(SPC text not retrieved)"
  }, null, 2);
}
__name(getSPCConvectiveOutlook, "getSPCConvectiveOutlook");
// First <pre> block of an HTML page as plain text (SPC/CPC product pages).
function preText(html) {
  const m = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(String(html || ""));
  if (!m) return "";
  return m[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
}
__name(preText, "preText");
// Latest NWS text product of a type whose WMO header matches — the API files
// every SPC outlook as "Severe Storm Outlook Narrative", so the header
// (ACUS48 for Day 4-8) is the only way to tell them apart.
async function latestProductByWmo(type, wmo, ua, location) {
  const url = location ? `https://api.weather.gov/products/types/${type}/locations/${location}` : `https://api.weather.gov/products/types/${type}`;
  const list = await nwsJSON(url, ua, 600);
  const item = (list["@graph"] || []).find((p) => !wmo || p.wmoCollectiveId === wmo);
  if (!item) return null;
  const id = item.id || item["@id"]?.split("/").pop();
  const prod = await nwsJSON(`https://api.weather.gov/products/${id}`, ua, 600);
  return prod && prod.productText ? { text: prod.productText, issued: prod.issuanceTime || null } : null;
}
__name(latestProductByWmo, "latestProductByWmo");
// SPC Day 4-8 (SWOD48): NWS API first, the SPC page's <pre> block second.
// (SPC retired the old day48text.txt.)
async function getSPCDay48Outlook(ua) {
  const page = "https://www.spc.noaa.gov/products/exper/day4-8/";
  let got = null;
  try {
    got = await latestProductByWmo("SWO", "ACUS48", ua);
  } catch {
  }
  if (!got) {
    try {
      const text = preText(await fetchText(page, ua, 1800));
      if (text) got = { text, issued: null };
    } catch {
    }
  }
  return JSON.stringify({ product: "SPC Day 4-8 Convective Outlook", issued: got?.issued || null, page, text: got?.text || "(unable to retrieve)" }, null, 2);
}
__name(getSPCDay48Outlook, "getSPCDay48Outlook");
async function getSPCMesoscaleDiscussions(limit, ua) {
  const cap = Math.min(Math.max(limit || 10, 1), 30);
  const xml = await fetchText("https://www.spc.noaa.gov/products/spcmdrss.xml", ua, 120);
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) && items.length < cap) {
    const block = m[1];
    const title2 = (block.match(/<title>([\s\S]*?)<\/title>/) || [, ""])[1];
    const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [, ""])[1];
    const pub = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [, ""])[1];
    const desc = (block.match(/<description>([\s\S]*?)<\/description>/) || [, ""])[1];
    const num = (title2.match(/#?(\d{3,5})/) || [, null])[1];
    items.push({
      number: num ? Number(num) : null,
      title: title2.replace(/<!\[CDATA\[|\]\]>/g, "").trim(),
      issued: pub,
      link,
      summary: desc.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").trim().slice(0, 400)
    });
  }
  return JSON.stringify({ count: items.length, items }, null, 2);
}
__name(getSPCMesoscaleDiscussions, "getSPCMesoscaleDiscussions");
async function getSPCMesoscaleDiscussion(num, ua) {
  if (!num || num < 1) throw new Error("MD number required");
  const padded = String(num).padStart(4, "0");
  const url = `https://www.spc.noaa.gov/products/md/md${padded}.html`;
  const html = await fetchText(url, ua, 1800);
  const pre = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  const text = pre ? pre[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">") : html.replace(/<[^>]+>/g, "");
  return JSON.stringify({ number: num, url, text: text.trim() }, null, 2);
}
__name(getSPCMesoscaleDiscussion, "getSPCMesoscaleDiscussion");
async function getSPCActiveWatches(ua) {
  const [torn, svr] = await Promise.all([
    nwsJSON("https://api.weather.gov/alerts/active?event=Tornado%20Watch", ua, 60),
    nwsJSON("https://api.weather.gov/alerts/active?event=Severe%20Thunderstorm%20Watch", ua, 60)
  ]);
  const all = [...torn.features || [], ...svr.features || []];
  const watches = all.map((f) => {
    const p = f.properties || {};
    const num = (p.headline?.match(/Watch\s+(\d+)/i) || [, null])[1];
    return {
      event: p.event,
      number: num ? Number(num) : null,
      severity: p.severity,
      certainty: p.certainty,
      urgency: p.urgency,
      sent: p.sent,
      effective: p.effective,
      expires: p.expires,
      areaDesc: p.areaDesc,
      headline: p.headline,
      senderName: p.senderName
    };
  });
  return JSON.stringify({ count: watches.length, watches }, null, 2);
}
__name(getSPCActiveWatches, "getSPCActiveWatches");
async function getSPCFireWeatherOutlook(day, ua) {
  if (![1, 2].includes(day)) throw new Error("day must be 1 or 2");
  const url = `https://www.spc.noaa.gov/products/fire_wx/fwdy${day}.txt`;
  const text = await fetchText(url, ua, 1800);
  return JSON.stringify({ product: `SPC Fire Weather Outlook Day ${day}`, url, text }, null, 2);
}
__name(getSPCFireWeatherOutlook, "getSPCFireWeatherOutlook");
async function getWPCQPF(ua) {
  const fetchOne = /* @__PURE__ */ __name(async (type) => {
    try {
      const list = await nwsJSON(
        `https://api.weather.gov/products/types/${type}`,
        ua,
        600
      );
      const items = list["@graph"] || [];
      if (!items.length) return null;
      const id = items[0].id || items[0]["@id"]?.split("/").pop();
      const prod = await nwsJSON(`https://api.weather.gov/products/${id}`, ua, 600);
      return { type, issued: prod.issuanceTime, text: prod.productText };
    } catch {
      return null;
    }
  }, "fetchOne");
  const [qpf, erd] = await Promise.all([fetchOne("QPF"), fetchOne("RBG")]);
  return JSON.stringify({
    qpf_discussion: qpf,
    excessive_rainfall_discussion: erd
  }, null, 2);
}
__name(getWPCQPF, "getWPCQPF");
// CPC's 6-10 and 8-14 day outlooks are one product (FXUS06 KWBC, AWIPS
// PMDMRD): both discussions, then a state-by-state category table per
// period. The old 610prnt/814prnt/fxus06/fxus07 .txt files are gone.
var CPC_STATE_ROWS = {
  AL: ["ALABAMA"], AZ: ["ARIZONA"], AR: ["ARKANSAS"], CA: ["NRN CALIF", "SRN CALIF"], CO: ["COLORADO"], CT: ["CONN"],
  DE: ["DELAWARE"], FL: ["FL PNHDL", "FL PENIN"], GA: ["GEORGIA"], ID: ["IDAHO"], IL: ["ILLINOIS"], IN: ["INDIANA"],
  IA: ["IOWA"], KS: ["KANSAS"], KY: ["KENTUCKY"], LA: ["LOUISIANA"], ME: ["MAINE"], MD: ["MARYLAND"], DC: ["MARYLAND"],
  MA: ["MASS"], MI: ["MICHIGAN"], MN: ["MINNESOTA"], MS: ["MISSISSIPPI"], MO: ["MISSOURI"], MT: ["W MONTANA", "E MONTANA"],
  NE: ["NEBRASKA"], NV: ["NEVADA"], NH: ["NEW HAMP"], NJ: ["NEW JERSEY"], NM: ["NEW MEXICO"], NY: ["NEW YORK"],
  NC: ["N CAROLINA"], ND: ["N DAKOTA"], OH: ["OHIO"], OK: ["OKLAHOMA"], OR: ["OREGON"], PA: ["PENN"], RI: ["RHODE IS"],
  SC: ["S CAROLINA"], SD: ["S DAKOTA"], TN: ["TENNESSEE"], TX: ["N TEXAS", "S TEXAS", "W TEXAS"], UT: ["UTAH"],
  VT: ["VERMONT"], VA: ["VIRGINIA"], WA: ["WASHINGTON"], WV: ["W VIRGINIA"], WI: ["WISCONSIN"], WY: ["WYOMING"],
  AK: ["AK N SLOPE", "AK ALEUTIAN", "AK WESTERN", "AK INT BSN", "AK S INT", "AK SO COAST", "AK PNHDL"]
};
var CPC_CAT = { A: "above normal", N: "near normal", B: "below normal" };
async function getCPCOutlook(period, ua, lat, lon) {
  const head = { "6-10day": "6-10 DAY OUTLOOK", "8-14day": "8-14 DAY OUTLOOK" }[period];
  if (!head) throw new Error("period must be '6-10day' or '8-14day'");
  let got = null;
  try {
    got = await latestProductByWmo("PMD", "FXUS06", ua, "MRD");
  } catch {
  }
  if (!got) {
    try {
      const text = preText(await fetchText("https://www.cpc.ncep.noaa.gov/products/predictions/610day/fxus06.html", ua, 3600));
      if (text) got = { text, issued: null };
    } catch {
    }
  }
  if (!got) return JSON.stringify({ product: `CPC ${period} outlook discussion`, text: "(unable to retrieve CPC text)" }, null, 2);
  const t = got.text.replace(/\r/g, "");
  // Discussion: from this period's "N-N DAY OUTLOOK FOR …" line to the next
  // period's (6-10) or the forecaster sign-off (8-14).
  const from = t.indexOf(head + " FOR");
  const until = period === "6-10day" ? t.indexOf("8-14 DAY OUTLOOK FOR", from + 1) : t.search(/\n\s*FORECASTER:|\n\s*Notes:/);
  const section = from >= 0 ? t.slice(from, until > from ? until : void 0).trim() : t;
  const valid = from >= 0 ? (t.slice(from).match(/OUTLOOK FOR ([^\n]+)/) || [])[1]?.trim() || null : null;
  // This period's category table → the point's state row(s).
  let atPoint;
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    try {
      const pt = await pointInfo(lat, lon, ua);
      const st = pt?.properties?.relativeLocation?.properties?.state;
      const names = CPC_STATE_ROWS[st] || [];
      const tFrom = t.indexOf(head + " TABLE");
      const tEnd = period === "6-10day" ? t.indexOf("8-14 DAY OUTLOOK TABLE", tFrom + 1) : t.indexOf("THE FORECAST CLASSES", tFrom + 1);
      if (names.length && tFrom >= 0) {
        const table = t.slice(tFrom, tEnd > tFrom ? tEnd : void 0);
        const rows = {};
        for (const m of table.matchAll(/([A-Z][A-Z .]{1,12}?)\s+([ABN])\s+([ABN])(?=\s|$)/g)) rows[m[1].trim()] = [m[2], m[3]];
        atPoint = names.filter((n) => rows[n]).map((n) => ({ region: n, temperature: CPC_CAT[rows[n][0]], precipitation: CPC_CAT[rows[n][1]] }));
        if (!atPoint.length) atPoint = void 0;
      }
    } catch {
    }
  }
  return JSON.stringify({
    product: `CPC ${period} outlook discussion`,
    issued: got.issued,
    valid,
    atPoint,
    atPointNote: atPoint ? "CPC's categorical forecast for the point's state (state average; the most likely of above/near/below normal)" : void 0,
    text: section
  }, null, 2);
}
__name(getCPCOutlook, "getCPCOutlook");
async function getDroughtMonitor(lat, lon, ua) {
  const geoUrl = `https://geo.fcc.gov/api/census/area?lat=${lat}&lon=${lon}&format=json`;
  const geoR = await fetch(geoUrl, {
    headers: { "User-Agent": ua, "Accept": "application/json" },
    cf: { cacheTtl: 86400, cacheEverything: true },
    signal: upstreamSignal()
  });
  if (!geoR.ok) {
    const body = await geoR.text().catch(() => "");
    throw new Error(`FCC Geo API ${geoR.status}: ${body.slice(0, 200)}`);
  }
  const geoData = await geoR.json();
  const result = geoData?.results?.[0];
  if (!result?.county_fips) throw new Error("FCC Geo API returned no county FIPS for this location");
  const fips = result.county_fips;
  const countyName = result.county_name;
  const stateCode = result.state_code;
  const now = /* @__PURE__ */ new Date();
  const fmt = /* @__PURE__ */ __name((d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`, "fmt");
  let usdmData = null;
  const todayStr = fmt(now);
  const usdmUrl1 = `https://usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent?aoi=${fips}&startdate=${todayStr}&enddate=${todayStr}&statisticsType=1`;
  const usdmR1 = await fetch(usdmUrl1, {
    headers: { "User-Agent": ua, "Accept": "application/json" },
    cf: { cacheTtl: 21600, cacheEverything: true },
    signal: upstreamSignal()
  });
  if (!usdmR1.ok) {
    const body = await usdmR1.text().catch(() => "");
    throw new Error(`USDM API ${usdmR1.status}: ${body.slice(0, 200)}`);
  }
  usdmData = await usdmR1.json();
  if (!usdmData || usdmData.length === 0) {
    const past = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1e3);
    const usdmUrl2 = `https://usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent?aoi=${fips}&startdate=${fmt(past)}&enddate=${todayStr}&statisticsType=1`;
    const usdmR2 = await fetch(usdmUrl2, {
      headers: { "User-Agent": ua, "Accept": "application/json" },
      cf: { cacheTtl: 21600, cacheEverything: true },
      signal: upstreamSignal()
    });
    if (!usdmR2.ok) {
      const body = await usdmR2.text().catch(() => "");
      throw new Error(`USDM API (14-day fallback) ${usdmR2.status}: ${body.slice(0, 200)}`);
    }
    usdmData = await usdmR2.json();
  }
  if (!usdmData || usdmData.length === 0) {
    throw new Error("USDM API returned no drought data for this county in the last 14 days");
  }
  const latest = usdmData[usdmData.length - 1];
  const coverage = {
    None: parseFloat(latest.None) || 0,
    D0: parseFloat(latest.D0) || 0,
    D1: parseFloat(latest.D1) || 0,
    D2: parseFloat(latest.D2) || 0,
    D3: parseFloat(latest.D3) || 0,
    D4: parseFloat(latest.D4) || 0
  };
  let dominant_class = "None";
  if (coverage.None <= 50) {
    const dLevels = [
      ["D0", coverage.D0],
      ["D1", coverage.D1],
      ["D2", coverage.D2],
      ["D3", coverage.D3],
      ["D4", coverage.D4]
    ];
    let maxPct = 0;
    for (const [label, pct] of dLevels) {
      if (pct > maxPct) {
        maxPct = pct;
        dominant_class = label;
      }
    }
    if (maxPct === 0) dominant_class = "None";
  }
  const validDate = latest.MapDate || latest.ValidStart || todayStr;
  return JSON.stringify({
    source: "U.S. Drought Monitor",
    point: { lat, lon },
    county: { fips, name: countyName, state: stateCode },
    valid_date: validDate,
    dominant_class,
    coverage
  }, null, 2);
}
__name(getDroughtMonitor, "getDroughtMonitor");
async function getCurrentObservations(lat, lon, ua) {
  const la = Math.round(lat * 1e4) / 1e4;
  const lo = Math.round(lon * 1e4) / 1e4;
  const stationsResp = await nwsJSON(`https://api.weather.gov/points/${la},${lo}/stations`, ua, 3600);
  const features = stationsResp.features || [];
  if (!features.length) throw new Error("No NWS stations near this location");
  const c2f = /* @__PURE__ */ __name((v) => v == null ? null : Math.round((v * 9 / 5 + 32) * 10) / 10, "c2f");
  // NWS observations report wind in km/h (wmoUnit:km_h-1), not m/s. Read the
  // unit instead of assuming it: treating km/h as m/s inflated every wind and
  // gust 3.6x (a 14 mph breeze read as 50 mph).
  const wind2mph = /* @__PURE__ */ __name((q) => {
    if (!q || q.value == null) return null;
    const u = String(q.unitCode || "");
    const f = u.includes("m_s-1") ? 2.23694 : u.includes("kt") ? 1.15078 : 0.621371;
    return Math.round(q.value * f);
  }, "wind2mph");
  const m2mi = /* @__PURE__ */ __name((v) => v == null ? null : Math.round(v * 6.21371e-4 * 10) / 10, "m2mi");
  const pa2inhg = /* @__PURE__ */ __name((v) => v == null ? null : Math.round(v * 2.953e-4 * 100) / 100, "pa2inhg");
  const mm2in = /* @__PURE__ */ __name((v) => v == null ? null : Math.round(v * 0.0393701 * 100) / 100, "mm2in");
  let lastErr = null;
  for (let i = 0; i < Math.min(features.length, 4); i++) {
    const sid = features[i].properties?.stationIdentifier;
    if (!sid) continue;
    try {
      const obs = await nwsJSON(`https://api.weather.gov/stations/${sid}/observations/latest`, ua, 300);
      const p = obs.properties || {};
      if (p.temperature?.value == null && p.windSpeed?.value == null && p.barometricPressure?.value == null) continue;
      return JSON.stringify({
        station: sid,
        stationName: features[i].properties?.name,
        distance_note: i === 0 ? "nearest station" : `station ${i + 1} of ${features.length} (closer stations had no data)`,
        observed: p.timestamp,
        textDescription: p.textDescription,
        temperature_F: c2f(p.temperature?.value),
        dewpoint_F: c2f(p.dewpoint?.value),
        humidity_pct: p.relativeHumidity?.value != null ? Math.round(p.relativeHumidity.value) : null,
        windSpeed_mph: wind2mph(p.windSpeed),
        windGust_mph: wind2mph(p.windGust),
        windDir_deg: p.windDirection?.value,
        visibility_mi: m2mi(p.visibility?.value),
        pressure_inHg: pa2inhg(p.barometricPressure?.value),
        seaLevelPressure_mb: p.seaLevelPressure?.value != null ? Math.round(p.seaLevelPressure.value / 100) : null,
        precipLastHour_in: mm2in(p.precipitationLastHour?.value),
        precipLast3Hour_in: mm2in(p.precipitationLast3Hours?.value),
        precipLast6Hour_in: mm2in(p.precipitationLast6Hours?.value),
        heatIndex_F: c2f(p.heatIndex?.value),
        windChill_F: c2f(p.windChill?.value)
      }, null, 2);
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  throw new Error(`No usable observations from nearby stations${lastErr ? `: ${lastErr.message}` : ""}`);
}
__name(getCurrentObservations, "getCurrentObservations");
async function getAirQuality(lat, lon, ua, apiKey) {
  if (!apiKey) {
    return JSON.stringify({
      error: "AirNow API key not configured",
      note: "Set AIRNOW_API_KEY in the Worker environment. Get a free key at https://docs.airnowapi.org/account/request/"
    });
  }
  const url = `https://www.airnowapi.org/aq/observation/latLong/current/?format=application/json&latitude=${lat}&longitude=${lon}&distance=25&API_KEY=${apiKey}`;
  const r = await fetch(url, {
    headers: { "User-Agent": ua, "Accept": "application/json" },
    cf: { cacheTtl: 1800, cacheEverything: true },
    signal: upstreamSignal()
  });
  if (!r.ok) throw new Error(`AirNow ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  const data = await r.json();
  if (!data?.length) return JSON.stringify({ point: { lat, lon }, note: "No AirNow data within 25 miles" });
  const observations = data.map((d) => ({
    parameter: d.ParameterName,
    aqi: d.AQI,
    category: d.Category?.Name,
    category_number: d.Category?.Number,
    reportingArea: d.ReportingArea,
    state: d.StateCode,
    observed: `${d.DateObserved.trim()} ${d.HourObserved}:00 ${d.LocalTimeZone}`
  }));
  const worst = observations.reduce((a, b) => (b.aqi > (a?.aqi ?? -1) ? b : a), null);
  return JSON.stringify({
    point: { lat, lon },
    worst,
    observations
  }, null, 2);
}
__name(getAirQuality, "getAirQuality");
async function getRiverGauges(lat, lon, radiusMi, ua) {
  const r = Math.min(Math.max(radiusMi || 25, 1), 100);
  const dLat = r / 69;
  const dLon = r / (69 * Math.cos(lat * Math.PI / 180));
  const bbox = `${(lon - dLon).toFixed(4)},${(lat - dLat).toFixed(4)},${(lon + dLon).toFixed(4)},${(lat + dLat).toFixed(4)}`;
  const url = `https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=${bbox}&parameterCd=00060,00065&siteStatus=active`;
  const resp = await fetch(url, {
    headers: { "User-Agent": ua, "Accept": "application/json" },
    cf: { cacheTtl: 900, cacheEverything: true },
    signal: upstreamSignal()
  });
  if (!resp.ok) throw new Error(`USGS ${resp.status}`);
  const data = await resp.json();
  const ts = data?.value?.timeSeries || [];
  const sites = {};
  for (const series of ts) {
    const info = series.sourceInfo || {};
    const siteCode = info.siteCode?.[0]?.value;
    const name = info.siteName;
    const geo = info.geoLocation?.geogLocation || {};
    const variable = series.variable || {};
    const varCode = variable.variableCode?.[0]?.value;
    const unit = variable.unit?.unitCode;
    const lastValue = series.values?.[0]?.value?.slice(-1)?.[0];
    if (!siteCode || !lastValue) continue;
    if (!sites[siteCode]) {
      sites[siteCode] = { siteCode, name, lat: geo.latitude, lon: geo.longitude, readings: {} };
    }
    const key = varCode === "00060" ? "discharge_cfs" : varCode === "00065" ? "gauge_height_ft" : varCode;
    sites[siteCode].readings[key] = {
      value: parseFloat(lastValue.value),
      observed: lastValue.dateTime,
      unit
    };
  }
  const siteList = Object.values(sites);
  return JSON.stringify({
    point: { lat, lon },
    radius_mi: r,
    siteCount: siteList.length,
    sites: siteList.slice(0, 20)
  }, null, 2);
}
__name(getRiverGauges, "getRiverGauges");
// src/tropical.ts — NHC storm geometry (cone, track, watches/warnings, wind
// field, TS-wind arrival) from NHC's GIS MapServer, plus the facts relative to
// the user's point: distance, inside the cone or not, closest forecast
// approach. Feeds /api/tropical (the storm map), get_nhc_tropical and the
// home-screen discussion.
var NHC_GIS = "https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer";
// The MapServer files each active storm under a fixed slot ("AT4", "EP2", …,
// CurrentStorms.json's binNumber) with one layer per product. Layer ids are
// looked up by name rather than hardcoded.
var nhcLayerCache = null;
async function nhcLayerIds(ua) {
  if (nhcLayerCache && Date.now() - nhcLayerCache.at < 6 * 36e5) return nhcLayerCache.ids;
  const d = await fetchJSON(`${NHC_GIS}?f=json`, ua, 21600);
  const ids = {};
  for (const l of d.layers || []) ids[l.name] = l.id;
  if (!Object.keys(ids).length) throw new Error("NHC GIS layer list empty");
  nhcLayerCache = { at: Date.now(), ids };
  return ids;
}
__name(nhcLayerIds, "nhcLayerIds");
async function nhcFeatures(ids, name, ua) {
  const id = ids[name];
  if (id == null) return [];
  const d = await fetchJSON(`${NHC_GIS}/${id}/query?where=1%3D1&outFields=*&f=geojson&geometryPrecision=3`, ua, 300);
  return Array.isArray(d.features) ? d.features : [];
}
__name(nhcFeatures, "nhcFeatures");
function r2(v) {
  return Math.round(v * 100) / 100;
}
__name(r2, "r2");
// Douglas-Peucker in degrees; the GIS cone and wind-field rings carry far more
// vertices than a 800 px map can show.
function simplifyLine(pts, tol) {
  if (pts.length < 3) return pts.map((p) => [r2(p[0]), r2(p[1])]);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      const d = L ? Math.abs(dy * px - dx * py + bx * ay - by * ax) / L : Math.hypot(px - ax, py - ay);
      if (d > best) {
        best = d;
        bi = i;
      }
    }
    if (best > tol) {
      keep[bi] = 1;
      stack.push([a, bi], [bi, b]);
    }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push([r2(pts[i][0]), r2(pts[i][1])]);
  return out;
}
__name(simplifyLine, "simplifyLine");
// Every ring / line of a GeoJSON geometry as plain coordinate arrays.
function geomLines(g) {
  if (!g || !g.coordinates) return [];
  if (g.type === "LineString") return [g.coordinates];
  if (g.type === "MultiLineString" || g.type === "Polygon") return g.coordinates;
  if (g.type === "MultiPolygon") return g.coordinates.flat();
  return [];
}
__name(geomLines, "geomLines");
function haversineMi(lat1, lon1, lat2, lon2) {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
__name(haversineMi, "haversineMi");
function bearingDeg(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * rad) * Math.cos(lat2 * rad);
  const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos((lon2 - lon1) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}
__name(bearingDeg, "bearingDeg");
function compass16(deg) {
  const w = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return deg == null || !Number.isFinite(deg) ? null : w[Math.round((deg % 360 + 360) % 360 / 22.5) % 16];
}
__name(compass16, "compass16");
// "07/1500" (day / HHMM UTC) in the advisory's month — or the next/previous
// one when the forecast crosses a month boundary.
function nhcValidTime(validtime, refMs) {
  const m = /^(\d{1,2})\/(\d{2})(\d{2})$/.exec(String(validtime || "").trim());
  if (!m || !Number.isFinite(refMs)) return null;
  const ref = new Date(refMs);
  const at = (dm) => Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + dm, +m[1], +m[2], +m[3]);
  let t = at(0);
  if (t < refMs - 15 * 864e5) t = at(1);
  else if (t > refMs + 20 * 864e5) t = at(-1);
  return t;
}
__name(nhcValidTime, "nhcValidTime");
function dtgTime(dtg) {
  const s = String(dtg || "");
  if (!/^\d{10}$/.test(s)) return null;
  return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10));
}
__name(dtgTime, "dtgTime");
// Saffir-Simpson category from max sustained wind (kt); 0 below hurricane.
function ssCategory(kt) {
  if (kt == null) return null;
  return kt >= 137 ? 5 : kt >= 113 ? 4 : kt >= 96 ? 3 : kt >= 83 ? 2 : kt >= 64 ? 1 : 0;
}
__name(ssCategory, "ssCategory");
// NHC system type + wind → [map letter, words]. Letters follow NHC's track
// graphic: D/S/H/M for tropical depression / storm / hurricane / major
// hurricane, L for anything no longer (or not yet) tropical.
function tcKind(type, kt) {
  const t = String(type || "").toUpperCase();
  const cat = ssCategory(kt);
  if (t === "HU" || t === "MH" || t === "TY" || (t === "" && cat >= 1)) {
    return cat >= 3 ? ["M", `Cat ${cat} hurricane`] : ["H", `Cat ${Math.max(1, cat || 1)} hurricane`];
  }
  if (t === "TS") return ["S", "Tropical storm"];
  if (t === "TD") return ["D", "Tropical depression"];
  if (t === "STS" || t === "SS") return ["S", "Subtropical storm"];
  if (t === "STD" || t === "SD") return ["D", "Subtropical depression"];
  if (t === "EX" || t === "PT" || t === "PTC" || t === "PC") return ["L", "Post-tropical"];
  if (t === "LO" || t === "RL") return ["L", "Remnant low"];
  if (t === "DB" || t === "WV") return ["L", "Disturbance"];
  return ["L", t || "Unknown"];
}
__name(tcKind, "tcKind");
// CurrentStorms.json classification → the name NHC prints before the storm's.
var NHC_CLASS = {
  HU: "Hurricane", MH: "Hurricane", TS: "Tropical Storm", TD: "Tropical Depression", STS: "Subtropical Storm",
  STD: "Subtropical Depression", PTC: "Potential Tropical Cyclone", PC: "Post-Tropical Cyclone", TY: "Typhoon"
};
var NHC_WW = {
  HWR: { label: "Hurricane Warning", rank: 4 },
  HWA: { label: "Hurricane Watch", rank: 3 },
  TWR: { label: "Tropical Storm Warning", rank: 2 },
  TWA: { label: "Tropical Storm Watch", rank: 1 }
};
// Closest approach of the forecast track to the point. Each leg is a straight
// line in a local equirectangular frame around the point — accurate enough at
// the 6–24 h spacing of NHC forecast points — and time and wind are
// interpolated along it.
function closestApproach(pt, track) {
  if (!track.length) return null;
  const k = Math.cos(pt.lat * Math.PI / 180);
  let best = null;
  for (let i = 0; i < track.length; i++) {
    const a = track[i], b = track[i + 1] || a;
    const ax = (a.lon - pt.lon) * k, ay = a.lat - pt.lat;
    const dx = (b.lon - a.lon) * k, dy = b.lat - a.lat;
    const L2 = dx * dx + dy * dy;
    const f = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
    const lat = a.lat + (b.lat - a.lat) * f, lon = a.lon + (b.lon - a.lon) * f;
    const mi = haversineMi(pt.lat, pt.lon, lat, lon);
    if (!best || mi < best.mi) {
      const lerp = (u, v) => u == null || v == null ? u ?? v : u + (v - u) * f;
      best = { mi, lat, lon, t: lerp(a.t, b.t), wind_kt: lerp(a.wind_kt, b.wind_kt), type: f < 0.5 ? a.type : b.type };
    }
  }
  const [code, kind] = tcKind(best.type, best.wind_kt);
  return {
    distance_mi: Math.round(best.mi),
    // Where the center would be, as seen from the point.
    direction: compass16(bearingDeg(pt.lat, pt.lon, best.lat, best.lon)),
    time: best.t != null ? new Date(Math.round(best.t / 6e4) * 6e4).toISOString() : null,
    wind_kt: best.wind_kt != null ? Math.round(best.wind_kt / 5) * 5 : null,
    kind,
    code,
    lat: r2(best.lat),
    lon: r2(best.lon)
  };
}
__name(closestApproach, "closestApproach");
// One active storm from CurrentStorms.json → its full map geometry and
// point-relative summary. Each GIS layer is optional: a slow or missing layer
// drops out of the map instead of failing the storm.
async function nhcStormDetail(s, ids, ua, pt) {
  const bin = s.binNumber;
  const ref = Date.parse(s.lastUpdate || s.publicAdvisory?.issuance || "") || Date.now();
  const names = ["Forecast Points", "Forecast Cone", "Watch-Warning", "Past Points", "Advisory Wind Field", "Earliest Reasonable Arrival Time"];
  const got = await Promise.allSettled(names.map((n) => withTimeout(nhcFeatures(ids, `${bin} ${n}`, ua), 1e4, n)));
  const [fpts, cone, ww, ppts, wind, eta] = got.map((g) => g.status === "fulfilled" ? g.value : []);
  // The GIS lags CurrentStorms.json by a few minutes after each advisory and
  // its slots get reused, so keep only features that belong to this storm.
  const stormNum = parseInt(String(s.id || "").slice(2, 4), 10);
  const mine = (f) => {
    const p = f.properties || {};
    return p.stormnum == null || +p.stormnum === stormNum;
  };
  const forecast = fpts.filter(mine).map((f) => {
    const p = f.properties || {};
    const c = f.geometry?.coordinates || [];
    const wind_kt = p.maxwind != null && p.maxwind < 9e3 ? p.maxwind : null;
    const [code, kind] = tcKind(p.stormtype, wind_kt);
    return {
      tau: p.tau,
      t: nhcValidTime(p.validtime, ref),
      label: p.datelbl || null,
      lat: r2(c[1]),
      lon: r2(c[0]),
      wind_kt,
      gust_kt: p.gust != null && p.gust < 9e3 ? p.gust : null,
      mslp: p.mslp != null && p.mslp < 9e3 ? p.mslp : null,
      type: p.stormtype || null,
      code: p.dvlbl && p.dvlbl !== "X" ? p.dvlbl : code,
      kind
    };
  }).filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon)).sort((a, b) => (a.tau ?? 0) - (b.tau ?? 0));
  // The GIS tau-0 point is the synoptic-time fix (e.g. 00Z) while the
  // advisory is issued 3 h later and can carry an upgrade (TS → HU), so "now"
  // takes the advisory's own position and intensity.
  const nowKt = Number(s.intensity);
  if (forecast.length && forecast[0].tau === 0 && Number.isFinite(s.latitudeNumeric) && Number.isFinite(s.longitudeNumeric) && Number.isFinite(nowKt)) {
    const f0 = forecast[0];
    const [code0, kind0] = tcKind(s.classification, nowKt);
    if (nowKt !== f0.wind_kt) f0.gust_kt = null;
    Object.assign(f0, {
      t: ref,
      lat: r2(s.latitudeNumeric),
      lon: r2(s.longitudeNumeric),
      wind_kt: nowKt,
      mslp: Number(s.pressure) || f0.mslp,
      type: s.classification || f0.type,
      code: code0,
      kind: s.classification === "PTC" ? "Potential tropical cyclone" : kind0
    });
  }
  const past = ppts.filter(mine).map((f) => {
    const p = f.properties || {};
    const c = f.geometry?.coordinates || [];
    return { t: dtgTime(p.dtg), lat: r2(c[1]), lon: r2(c[0]), wind_kt: p.intensity ?? null, type: p.stormtype || null, code: tcKind(p.stormtype, p.intensity)[0] };
  }).filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon)).sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  const coneF = cone.filter(mine);
  const coneRings = coneF.flatMap((f) => geomLines(f.geometry)).map((r) => simplifyLine(r, 0.02)).filter((r) => r.length > 2);
  const warnings = [];
  for (const f of ww.filter(mine)) {
    const code = String(f.properties?.tcww || "").toUpperCase();
    // Combined segments (e.g. a hurricane watch over a TS warning) are drawn
    // and labeled as their highest-ranked part.
    const parts = Object.keys(NHC_WW).filter((k) => code.includes(k)).sort((a, b) => NHC_WW[b].rank - NHC_WW[a].rank);
    if (!parts.length) continue;
    const lines = geomLines(f.geometry).map((l) => simplifyLine(l, 0.01)).filter((l) => l.length > 1);
    if (lines.length) warnings.push({ code: parts[0], label: parts.map((k) => NHC_WW[k].label).join(" + "), rank: NHC_WW[parts[0]].rank, lines });
  }
  warnings.sort((a, b) => a.rank - b.rank);
  const windField = wind.filter((f) => {
    const sid = String(f.properties?.stormid || "").toLowerCase();
    return !sid || sid === String(s.id).toLowerCase();
  }).map((f) => ({
    kt: f.properties?.radii,
    rings: geomLines(f.geometry).map((r) => simplifyLine(r, 0.02)).filter((r) => r.length > 2)
  })).filter((w) => w.kt && w.rings.length).sort((a, b) => a.kt - b.kt);
  const arrival = eta.filter((f) => {
    const src = String(f.properties?.idp_source || "").toUpperCase();
    return !src || src.includes(String(s.id).toUpperCase());
  }).map((f) => ({
    label: String(f.properties?.arrival_time || "").trim(),
    lines: geomLines(f.geometry).map((l) => simplifyLine(l, 0.03)).filter((l) => l.length > 1)
  })).filter((a) => a.label && a.lines.length);
  const lat = s.latitudeNumeric, lon = s.longitudeNumeric;
  const wind_kt = Number(s.intensity) || null;
  let [code, kind] = tcKind(s.classification, wind_kt);
  if (s.classification === "PTC") kind = "Potential tropical cyclone";
  let point = null;
  if (pt && Number.isFinite(lat) && Number.isFinite(lon)) {
    const inCone = coneF.some((f) => pointInGeometry([pt.lon, pt.lat], f.geometry));
    const track = forecast.map((f) => ({ lat: f.lat, lon: f.lon, t: f.t, wind_kt: f.wind_kt, type: f.type }));
    point = {
      distance_mi: Math.round(haversineMi(pt.lat, pt.lon, lat, lon)),
      direction: compass16(bearingDeg(pt.lat, pt.lon, lat, lon)),
      inCone: coneF.length ? inCone : null,
      closest: closestApproach(pt, track)
    };
  }
  return {
    id: s.id,
    bin,
    name: s.name,
    classification: s.classification,
    kind,
    code,
    label: `${NHC_CLASS[s.classification] || kind} ${s.name}`,
    wind_kt,
    wind_mph: wind_kt != null ? Math.round(wind_kt * 1.15078 / 5) * 5 : null,
    pressure_mb: Number(s.pressure) || null,
    lat,
    lon,
    movement: s.movementDir != null && s.movementSpeed != null ? { dir_deg: s.movementDir, speed_kt: s.movementSpeed, text: `${compass16(s.movementDir)} at ${s.movementSpeed} kt` } : null,
    advisory: { num: s.publicAdvisory?.advNum || null, issued: s.publicAdvisory?.issuance || s.lastUpdate || null },
    gisAdvisory: forecast.length ? fpts[0]?.properties?.advisnum || null : null,
    links: {
      publicAdvisory: s.publicAdvisory?.url || null,
      discussion: s.forecastDiscussion?.url || null,
      graphics: s.forecastGraphics?.url || null,
      windProbabilities: s.windSpeedProbabilities?.url || null
    },
    forecast,
    past,
    cone: coneRings,
    warnings: warnings.map(({ rank, ...w }) => w),
    windField,
    arrival,
    point,
    unavailable: names.filter((n, i) => got[i].status !== "fulfilled")
  };
}
__name(nhcStormDetail, "nhcStormDetail");
// All active storms with geometry, nearest to the point first.
async function getTropicalStorms(ua, pt) {
  const data = await fetchJSON("https://www.nhc.noaa.gov/CurrentStorms.json", ua, 300);
  const active = Array.isArray(data.activeStorms) ? data.activeStorms : [];
  if (!active.length) return [];
  const ids = await nhcLayerIds(ua);
  const storms = await Promise.all(active.map((s) => nhcStormDetail(s, ids, ua, pt)));
  if (pt) storms.sort((a, b) => (a.point?.distance_mi ?? 1e9) - (b.point?.distance_mi ?? 1e9));
  return storms;
}
__name(getTropicalStorms, "getTropicalStorms");
// Chat tool / discussion view: the same storms, minus map geometry, plus the
// forecast track in words the model can quote.
async function getNHCTropical(ua, lat, lon) {
  const pt = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  try {
    let storms;
    try {
      storms = await getTropicalStorms(ua, pt);
    } catch (e) {
      // GIS down: fall back to the bare storm list.
      const data = await fetchJSON("https://www.nhc.noaa.gov/CurrentStorms.json", ua, 300);
      storms = (data.activeStorms || []).map((s) => ({
        id: s.id, bin: s.binNumber, name: s.name, classification: s.classification,
        wind_kt: Number(s.intensity) || null, pressure_mb: Number(s.pressure) || null,
        lat: s.latitudeNumeric, lon: s.longitudeNumeric,
        movement: s.movementDir != null ? { text: `${compass16(s.movementDir)} at ${s.movementSpeed} kt` } : null,
        advisory: { num: s.publicAdvisory?.advNum, issued: s.publicAdvisory?.issuance || s.lastUpdate },
        links: { publicAdvisory: s.publicAdvisory?.url, discussion: s.forecastDiscussion?.url, graphics: s.forecastGraphics?.url }
      }));
    }
    const out = storms.map((s) => ({
      id: s.id,
      name: s.name,
      status: s.kind ? `${s.kind} (${s.classification})` : s.classification,
      intensity_kt: s.wind_kt,
      intensity_mph: s.wind_mph,
      pressure_mb: s.pressure_mb,
      position: { lat: s.lat, lon: s.lon },
      movement: s.movement?.text || null,
      advisory: s.advisory,
      nhcTextProducts: s.bin ? `get_product with office "${s.bin}": TCP (public advisory), TCD (forecast discussion), TCM (forecast advisory), PWS (wind speed probabilities by location)` : void 0,
      relativeToPoint: s.point ? {
        centerNow: `${s.point.distance_mi} mi ${s.point.direction} of the point`,
        pointInsideForecastCone: s.point.inCone,
        closestForecastApproach: s.point.closest ? `${s.point.closest.distance_mi} mi ${s.point.closest.direction} of the point around ${s.point.closest.time} as a ${/^Cat/.test(s.point.closest.kind) ? s.point.closest.kind : s.point.closest.kind.toLowerCase()} (~${s.point.closest.wind_kt} kt), interpolated between forecast points` : null
      } : void 0,
      forecastTrack: s.forecast ? s.forecast.map((f) => ({
        hour: f.tau,
        valid: f.t != null ? new Date(f.t).toISOString() : f.label,
        lat: f.lat,
        lon: f.lon,
        wind_kt: f.wind_kt,
        gust_kt: f.gust_kt,
        status: f.kind
      })) : void 0,
      watchesWarnings: s.warnings ? [...new Set(s.warnings.map((w) => w.label))] : void 0,
      links: s.links
    }));
    return JSON.stringify({
      basinFocus: "Atlantic + East/Central Pacific (active storms only)",
      count: out.length,
      storms: out,
      note: out.length === 0 ? "No active tropical cyclones in NHC's areas of responsibility." : "The app shows the user a live map of each storm's cone, track, watches/warnings and wind field alongside this answer."
    }, null, 2);
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}
__name(getNHCTropical, "getNHCTropical");
async function handleTropical(request, env2) {
  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get("lat"));
  const lon = parseFloat(url.searchParams.get("lon"));
  const ua = env2.NWS_USER_AGENT || "WeatherChatBot/1.0 (contact@example.com)";
  const pt = Number.isFinite(lat) && Number.isFinite(lon) ? { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 } : null;
  const bucket = Math.floor(Date.now() / (5 * 60 * 1e3));
  const cache = caches.default;
  const cacheKey = new Request(`https://wx-tropical.internal/v1?lat=${pt?.lat}&lon=${pt?.lon}&h=${bucket}`);
  try {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  } catch (e) {
  }
  let storms = [];
  let error = null;
  try {
    storms = await withTimeout(getTropicalStorms(ua, pt), 2e4, "tropical");
  } catch (e) {
    error = e.message;
  }
  const ttl = error ? 60 : 300;
  const resp = new Response(JSON.stringify({ point: pt, storms, error, generatedAt: (/* @__PURE__ */ new Date()).toISOString() }), {
    headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttl}, s-maxage=${ttl}` }
  });
  try {
    await cache.put(cacheKey, resp.clone());
  } catch (e) {
  }
  return resp;
}
__name(handleTropical, "handleTropical");
// Static basemap for the storm map: Natural Earth 1:50m (public domain) land
// polygons and large lakes (each polygon a list of rings), country borders and
// US/Canadian state lines, clipped to the Atlantic / Pacific hurricane basins
// (180°W–5°W, 5°S–62°N), simplified to ~3 km and stored as Google-polyline
// strings at 0.02° precision. Decoded in the browser; served with a long cache.
function handleBasemap() {
  return new Response(JSON.stringify({ precision: 50, ...BASEMAP_ENC, cities: MAP_CITIES }), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=604800, s-maxage=604800" }
  });
}
__name(handleBasemap, "handleBasemap");
// [name, lat, lon, rank] — reference labels for the storm map; rank 1 shows
// first when labels collide.
var MAP_CITIES = [
  ["Brownsville", 25.9, -97.5, 2], ["Corpus Christi", 27.8, -97.4, 2], ["Houston", 29.76, -95.37, 1], ["San Antonio", 29.42, -98.49, 2],
  ["Dallas", 32.78, -96.8, 1], ["Lake Charles", 30.23, -93.22, 2], ["Shreveport", 32.53, -93.75, 2], ["New Orleans", 29.95, -90.07, 1],
  ["Baton Rouge", 30.45, -91.19, 3], ["Jackson", 32.3, -90.18, 2], ["Mobile", 30.69, -88.04, 1], ["Pensacola", 30.42, -87.22, 2],
  ["Panama City", 30.16, -85.66, 2], ["Tallahassee", 30.44, -84.28, 2], ["Tampa", 27.95, -82.46, 1], ["Fort Myers", 26.64, -81.87, 2],
  ["Miami", 25.76, -80.19, 1], ["Key West", 24.56, -81.78, 2], ["Orlando", 28.54, -81.38, 2], ["Jacksonville", 30.33, -81.66, 1],
  ["Savannah", 32.08, -81.09, 2], ["Charleston", 32.78, -79.93, 2], ["Wilmington", 34.23, -77.94, 2], ["Cape Hatteras", 35.25, -75.53, 2],
  ["Norfolk", 36.85, -76.29, 2], ["Washington", 38.91, -77.04, 1], ["New York", 40.71, -74.01, 1], ["Boston", 42.36, -71.06, 1],
  ["Atlanta", 33.75, -84.39, 1], ["Birmingham", 33.52, -86.8, 2], ["Montgomery", 32.37, -86.3, 3], ["Memphis", 35.15, -90.05, 2],
  ["Nashville", 36.16, -86.78, 2], ["Little Rock", 34.75, -92.29, 3], ["Charlotte", 35.23, -80.84, 2], ["Raleigh", 35.78, -78.64, 3],
  ["Halifax", 44.65, -63.58, 2], ["Bermuda", 32.3, -64.78, 1], ["Havana", 23.11, -82.37, 1], ["Nassau", 25.05, -77.35, 2],
  ["Kingston", 17.97, -76.79, 2], ["Port-au-Prince", 18.59, -72.31, 2], ["Santo Domingo", 18.49, -69.93, 2], ["San Juan", 18.47, -66.11, 1],
  ["Cancún", 21.16, -86.85, 1], ["Mérida", 20.97, -89.62, 2], ["Campeche", 19.85, -90.53, 3], ["Veracruz", 19.17, -96.13, 2],
  ["Tampico", 22.23, -97.86, 2], ["Monterrey", 25.69, -100.32, 2], ["Belize City", 17.5, -88.2, 2], ["Bridgetown", 13.1, -59.62, 2],
  ["Fort-de-France", 14.6, -61.07, 3], ["Pointe-à-Pitre", 16.24, -61.53, 3], ["Praia", 14.93, -23.51, 2], ["Mexico City", 19.43, -99.13, 1],
  ["Acapulco", 16.85, -99.88, 2], ["Manzanillo", 19.05, -104.32, 3], ["Puerto Vallarta", 20.65, -105.23, 2], ["Mazatlán", 23.25, -106.41, 2],
  ["Cabo San Lucas", 22.89, -109.91, 2], ["La Paz", 24.14, -110.31, 3], ["San Diego", 32.72, -117.16, 2], ["Los Angeles", 34.05, -118.24, 1],
  ["Phoenix", 33.45, -112.07, 2], ["Honolulu", 21.31, -157.86, 1], ["Hilo", 19.72, -155.08, 2], ["Managua", 12.11, -86.24, 3],
  ["Panama", 8.98, -79.52, 2], ["Caracas", 10.49, -66.88, 3]
];
// src/ground.ts — ground truth around a point: NWS Local Storm Reports (via
// the Iowa Environmental Mesonet's LSR feed), every surface station around
// it (IEM current observations), and posts from local broadcast
// meteorologists. Feeds /api/ground (dashboard card), three chat
// tools and the home-screen discussion.
function bboxAround(lat, lon, mi) {
  const dLat = mi / 69, dLon = mi / (69 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  return { west: lon - dLon, east: lon + dLon, south: lat - dLat, north: lat + dLat };
}
__name(bboxAround, "bboxAround");
// LSR sources that are instruments rather than people.
var LSR_AUTOMATED = /^(mesonet|asos|awos|asos\/awos|official nws ob)/i;
async function localStormReports(lat, lon, ua, radiusMi, hours) {
  const r = Math.min(Math.max(Number(radiusMi) || 50, 5), 250);
  const h = Math.min(Math.max(Number(hours) || 24, 1), 168);
  const b = bboxAround(lat, lon, r);
  const url = `https://mesonet.agron.iastate.edu/geojson/lsr.geojson?west=${b.west.toFixed(3)}&east=${b.east.toFixed(3)}&south=${b.south.toFixed(3)}&north=${b.north.toFixed(3)}&hours=${h}`;
  const d = await fetchJSON(url, ua, 300);
  const reports = (d.features || []).map((f) => {
    const p = f.properties || {};
    const c = f.geometry?.coordinates || [];
    const plat = Number(p.lat ?? c[1]), plon = Number(p.lon ?? c[0]);
    if (!Number.isFinite(plat) || !Number.isFinite(plon)) return null;
    const mi = haversineMi(lat, lon, plat, plon);
    const mag = p.magnitude !== "" && p.magnitude != null ? `${p.magnitude}${p.unit ? " " + String(p.unit).toLowerCase() : ""}${p.qualifier === "E" ? " (est.)" : p.qualifier === "M" ? " (measured)" : ""}` : null;
    return {
      time: p.valid ? new Date(p.valid).toISOString() : null,
      type: p.typetext || null,
      magnitude: mag,
      place: [p.city, p.st || p.state].filter(Boolean).join(", "),
      county: p.county || null,
      source: p.source || null,
      automated: LSR_AUTOMATED.test(String(p.source || "")),
      remark: p.remark ? String(p.remark).replace(/\s+/g, " ").trim().slice(0, 400) : null,
      distance_mi: Math.round(mi),
      direction: compass16(bearingDeg(lat, lon, plat, plon)),
      lat: r2(plat),
      lon: r2(plon)
    };
  }).filter((x) => x && x.distance_mi <= r).sort((a, b2) => String(b2.time).localeCompare(String(a.time)));
  const byType = {};
  for (const x of reports) byType[x.type || "OTHER"] = (byType[x.type || "OTHER"] || 0) + 1;
  return { point: { lat, lon }, radius_mi: r, hours: h, count: reports.length, byType, reports };
}
__name(localStormReports, "localStormReports");
async function getLocalStormReports(lat, lon, ua, radiusMi, hours) {
  try {
    const o = await localStormReports(lat, lon, ua, radiusMi, hours);
    return JSON.stringify({
      ...o,
      reports: o.reports.slice(0, 60),
      note: "NWS Local Storm Reports issued by the local WFOs (via the Iowa Environmental Mesonet), newest first. Reliability follows the source: trained spotters, emergency managers, law enforcement and NWS staff over public, broadcast-media and social-media reports. 'automated' marks instrument readings (mesonet, ASOS)."
    }, null, 2);
  } catch (e) {
    return JSON.stringify({ error: `Local storm reports unavailable: ${e.message}` });
  }
}
__name(getLocalStormReports, "getLocalStormReports");

// Every surface station in the point's NWS forecast area (ASOS/AWOS, state
// mesonets, co-op and DCP rain gauges) via IEM's current-observations feed,
// filtered to a radius: the spatial picture a single nearest-station ob
// can't give — gradients, outflow, where the rain and gusts are.
async function areaObservations(lat, lon, ua, radiusMi) {
  const r = Math.min(Math.max(Number(radiusMi) || 60, 10), 150);
  const pt = await pointInfo(lat, lon, ua);
  const wfo = pt?.properties?.cwa || pt?.properties?.gridId;
  if (!wfo) throw new Error("no NWS forecast office for this point");
  const d = await fetchJSON(`https://mesonet.agron.iastate.edu/api/1/currents.json?wfo=${wfo}`, ua, 120);
  const mph = (kt) => kt == null ? null : Math.round(kt * 1.15078);
  const rows = (d.data || []).map((o) => {
    const t = Date.parse(o.utc_valid || "");
    if (!Number.isFinite(t) || Date.now() - t > 2 * 36e5) return null;
    if (o.tmpf == null && o.sknt == null && o.phour == null && o.pday == null) return null;
    const mi = haversineMi(lat, lon, o.lat, o.lon);
    if (!(mi <= r)) return null;
    return {
      station: o.station,
      name: o.name,
      network: o.network,
      distance_mi: Math.round(mi),
      direction: compass16(bearingDeg(lat, lon, o.lat, o.lon)),
      time: new Date(t).toISOString(),
      temp_F: o.tmpf != null ? Math.round(o.tmpf) : null,
      dewpoint_F: o.dwpf != null ? Math.round(o.dwpf) : null,
      wind: o.sknt != null ? `${o.drct != null ? compass16(o.drct) + " " : ""}${mph(o.sknt)} mph` + (o.gust != null ? ` G${mph(o.gust)}` : "") : null,
      peak_gust_today_mph: o.max_gust != null ? mph(o.max_gust) : null,
      altimeter_inHg: o.alti ?? null,
      precip_1h_in: o.phour != null ? Math.round(o.phour * 100) / 100 : null,
      precip_today_in: o.pday != null ? Math.round(o.pday * 100) / 100 : null,
      visibility_mi: o.vsby ?? null,
      weather: o.wxcodes ? [].concat(o.wxcodes).join(" ") : null
    };
  }).filter(Boolean).sort((a, b2) => a.distance_mi - b2.distance_mi);
  const vals = (k) => rows.map((x) => x[k]).filter((v) => v != null);
  const span = (k) => {
    const v = vals(k);
    return v.length ? [Math.min(...v), Math.max(...v)] : null;
  };
  const top = (k) => rows.filter((x) => x[k] != null).sort((a, b2) => b2[k] - a[k])[0] || null;
  const g = top("peak_gust_today_mph"), p1 = top("precip_1h_in"), pd = top("precip_today_in");
  return {
    point: { lat, lon },
    office: wfo,
    radius_mi: r,
    count: rows.length,
    summary: {
      temp_F_range: span("temp_F"),
      dewpoint_F_range: span("dewpoint_F"),
      altimeter_inHg_range: span("altimeter_inHg"),
      highest_peak_gust_today: g ? `${g.peak_gust_today_mph} mph at ${g.name} (${g.distance_mi} mi ${g.direction})` : null,
      wettest_last_hour: p1 && p1.precip_1h_in > 0 ? `${p1.precip_1h_in} in at ${p1.name} (${p1.distance_mi} mi ${p1.direction})` : null,
      wettest_today: pd && pd.precip_today_in > 0 ? `${pd.precip_today_in} in at ${pd.name} (${pd.distance_mi} mi ${pd.direction})` : null
    },
    stations: rows
  };
}
__name(areaObservations, "areaObservations");
async function getAreaObservations(lat, lon, ua, radiusMi) {
  try {
    const o = await areaObservations(lat, lon, ua, radiusMi);
    return JSON.stringify({
      ...o,
      stations: o.stations.slice(0, 40),
      note: "Latest reading (within 2 h) from every surface station in the point's NWS forecast area within the radius, nearest first, via the Iowa Environmental Mesonet. Networks: *_ASOS/AWOS airports, *_DCP and *_COOP mostly rain gauges, USCRN/SCAN climate stations. Altimeter is comparable across stations; use it, not sea-level pressure, for gradients and falls."
    }, null, 2);
  } catch (e) {
    return JSON.stringify({ error: `Area observations unavailable: ${e.message}` });
  }
}
__name(getAreaObservations, "getAreaObservations");

// Local broadcast meteorologists on X (default: James Spann, ABC 33/40
// Birmingham — X_HANDLES). Needs a pay-per-use API key (X_BEARER_TOKEN):
// $0.005 per post read, and X bills a given post once per UTC day however
// often it's re-read, so following a timeline costs about one charge per new
// post. The dashboard never shows the posts themselves — expertSignals
// distills them into short flagged items with a link back.
var xUserIds = {};
async function xPosts(handle, token, limit, sinceMs) {
  const h = { Authorization: `Bearer ${token}` };
  let user = xUserIds[handle];
  if (!user) {
    const u = await fetch(`https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}`, { headers: h, signal: upstreamSignal() });
    if (!u.ok) throw new Error(`X user lookup ${u.status}`);
    const data = (await u.json())?.data;
    if (!data?.id) throw new Error("X user not found");
    user = xUserIds[handle] = { id: data.id, name: data.name || handle };
  }
  const id = user.id;
  const since = sinceMs ? `&start_time=${new Date(sinceMs).toISOString().replace(/\.\d{3}Z$/, "Z")}` : "";
  const r = await fetch(`https://api.x.com/2/users/${id}/tweets?max_results=${Math.min(Math.max(limit, 5), 50)}&exclude=replies,retweets&tweet.fields=created_at${since}`, { headers: h, signal: upstreamSignal() });
  if (!r.ok) throw new Error(`X timeline ${r.status}`);
  const d = await r.json();
  // NFKC folds the "bold"/"italic" Unicode letters people post in to plain text.
  return (d.data || []).map((t) => ({ network: "X", author: user.name, handle, time: t.created_at || null, text: String(t.text || "").normalize("NFKC").trim(), url: `https://x.com/${handle}/status/${t.id}` }));
}
__name(xPosts, "xPosts");
// Keyword pass for the raw posts the chat tool hands the model (the
// dashboard's stricter filter is expertSignals): broadcaster feeds mix
// forecasts and warnings with station promos, school visits and personal
// posts. A hazard/forecast term scores 2, a general weather word 1 (each
// distinct word once); a post needs 2 — one strong term, or two weak ones.
var WX_STRONG = /\b(?:tornad\w*|severe|thunderstorms?|t-?storms?|supercells?|hail(?:stones?)?|downbursts?|squall\w*|derecho|funnel|wall cloud|shelf cloud|mammatus|rotation|hurricanes?|tropical|landfall|storm surge|cat(?:egory)? \d|flood\w*|rain(?:fall|s|y|ing|ed)?|drizzle|downpours?|snow\w*|sleet|freezing|ice storm|black ice|frost|fog|lightning|thunder|heat (?:index|wave|advisory)|wind chill|dew ?points?|humidity|humid|gusts?|gusty|mph|(?:cold|warm|stationary|back-?door) front|frontal|(?:upper|surface) (?:low|high|ridge|trough)|trough|drought|temperatures?|precip\w*|forecast\w*|outlook|radar|nowcast|briefing|spc|nws|nhc|wpc|instability|wind shear|damage|trees? down|power lines? down|(?:wind|freeze|frost|fog|flood|winter storm|winter weather|red flag|small craft|excessive heat) (?:advisory|warning|watch)|weather (?:xtreme|briefing|update|video|alert|statement|discussion))\b|\d\s?\xB0|\b\d{2,3}(?:-\d{2,3})? degrees?\b|\b(?:highs?|lows?)(?: (?:will|should|stay|stays|remain|be|are|in|near|around|of|into|well|the|between|from|to|mostly|generally|only|about|upper|lower|mid|low))* -?\d|\b(?:upper|lower|mid|low|high) (?:\d0s|teens)\b/gi;
var WX_WEAK = /\b(?:weather|showers?|sunny|sunshine|clouds?|cloudy|cloudless|sky|skies|clear|dry|drier|wet|warm\w*|cool\w*|cold\w*|hot|chilly|breezy|windy|winds?|storms?|stormy|muggy|pleasant|ice|icy|heat|#\w*wx)\b/gi;
function wxPostScore(text) {
  const t = String(text || "");
  const strong = t.match(WX_STRONG) || [];
  const weak = new Set((t.match(WX_WEAK) || []).map((w) => w.toLowerCase()));
  return 2 * strong.length + weak.size;
}
__name(wxPostScore, "wxPostScore");
// Is anything going on at the point? Gates the paid X timelines (and the
// signals model run on them): on a quiet day there's nothing to flag, so X
// isn't read. Active = an NWS alert, SPC Day 1 Marginal or higher, a
// tropical cyclone with the point in its cone or a forecast closest approach
// within 300 mi (the client's tropThreat rule), or a non-automated storm
// report within 75 mi in the last 6 h. A check that fails or times out counts
// as quiet. `reports` (optional) is a promise of localStormReports rows
// covering at least 75 mi / 6 h, to reuse a fetch already in flight.
async function wxActiveAtPoint(lat, lon, ua, reports) {
  const [al, spc, trop, lsr] = await Promise.allSettled([
    withTimeout(nwsJSON(`https://api.weather.gov/alerts/active?point=${lat},${lon}`, ua, 60), 8e3, "alerts"),
    withTimeout(fetchSPCLayer("https://www.spc.noaa.gov/products/outlook/day1otlk_cat.lyr.geojson", ua), 8e3, "spc"),
    withTimeout(getTropicalStorms(ua, { lat, lon }), 8e3, "tropical"),
    withTimeout(reports || localStormReports(lat, lon, ua, 75, 6).then((o) => o.reports), 1e4, "reports")
  ]);
  const reasons = [];
  if (al.status === "fulfilled") {
    const ev = [...new Set((al.value.features || []).map((f) => f.properties?.event).filter(Boolean))];
    if (ev.length) reasons.push(`alert: ${ev.join(", ")}`);
  }
  if (spc.status === "fulfilled" && spc.value) {
    const hit = findHighestRiskAtPoint(spc.value, [lon, lat]);
    if (hit && hit.rank >= CAT_RANK.MRGL) reasons.push(`SPC Day 1 ${hit.label}`);
  }
  if (trop.status === "fulfilled") {
    for (const st of trop.value) {
      const P = st.point;
      if (P && (P.inCone || P.closest && P.closest.distance_mi <= 300)) reasons.push(`tropical: ${st.name}${P.inCone ? " (point in cone)" : ` (closest approach ${P.closest.distance_mi} mi)`}`);
    }
  }
  if (lsr.status === "fulfilled" && Array.isArray(lsr.value)) {
    const since = Date.now() - 6 * 3600e3;
    const n = lsr.value.filter((r) => !r.automated && r.distance_mi <= 75 && Date.parse(r.time) >= since).length;
    if (n) reasons.push(`${n} storm report${n > 1 ? "s" : ""} within 75 mi in 6 h`);
  }
  return { active: reasons.length > 0, reasons };
}
__name(wxActiveAtPoint, "wxActiveAtPoint");
async function localExperts(env2, ua, opts) {
  const limit = Math.min(Math.max(Number(opts?.limit) || 10, 1), 50);
  const handles = String(env2.X_HANDLES || "spann").split(",").map((s2) => s2.trim().replace(/^@/, "")).filter(Boolean);
  if (!env2.X_BEARER_TOKEN) return { posts: [], handles, configured: false, errors: [] };
  const got = await Promise.allSettled(handles.map((h) => withTimeout(xPosts(h, env2.X_BEARER_TOKEN, limit, opts?.sinceMs), 1e4, h)));
  const posts = got.flatMap((g) => g.status === "fulfilled" ? g.value : []).filter((p) => p.text).sort((a, b2) => String(b2.time).localeCompare(String(a.time)));
  const errors = got.map((g, i) => g.status === "rejected" ? `${handles[i]}: ${g.reason?.message || g.reason}` : null).filter(Boolean);
  return { posts, handles, configured: true, errors };
}
__name(localExperts, "localExperts");
async function getLocalExperts(env2, ua, lat, lon, limit, includeX) {
  const gate = env2.X_BEARER_TOKEN && !includeX ? await wxActiveAtPoint(lat, lon, ua) : null;
  if (gate && !gate.active) {
    return JSON.stringify({
      posts: [],
      xStatus: "X not read: nothing active at the point (no NWS alert, SPC Day 1 below MRGL, no tropical threat, no storm reports within 75 mi in 6 h). Call again with include_x only if the user explicitly asks for the posts anyway."
    }, null, 2);
  }
  const o = await localExperts(env2, ua, { limit: Number(limit) || 10 });
  const posts = o.posts.filter((p) => wxPostScore(p.text) >= 2);
  return JSON.stringify({
    ...o,
    posts,
    droppedNonWeather: o.posts.length - posts.length,
    xStatus: !o.configured ? void 0 : includeX ? "X read on request" : `X read: active weather at the point (${gate.reasons.join("; ")})`,
    note: o.configured ? "Recent X posts by local broadcast meteorologists — expert interpretation and relayed reports, not observations. Attribute them by name, weigh them against the data, and flag where they differ from NWS/SPC. Don't quote posts wholesale; summarize what matters and link the post." : "Local meteorologists' feeds aren't configured (X_BEARER_TOKEN is not set)."
  }, null, 2);
}
__name(getLocalExperts, "getLocalExperts");
// Broadcaster posts → short flagged items ("Trees down on Lorna Rd,
// Hoover") with a link back, for the dashboard. The feed is noisy, so the
// model keeps only reports and warnings and drops forecasts, promos and
// chatter; a keyword pass is the fallback. Results are cached by the set of
// posts, so the model runs only when new posts arrive.
var SIGNAL_KINDS = ["damage", "tornado", "flooding", "hail", "power", "warning", "official", "other"];
var SIGNALS_SYS = `You read recent posts by local broadcast meteorologists and pull out only what someone living nearby would want flagged right now.

Include: damage reports (trees or power lines down, structural damage), tornado or funnel sightings and confirmed touchdowns, flooding and water rescues, significant hail, widespread power outages, warnings the poster calls out for a specific area, and official orders they relay (evacuations, closures, curfews).
Exclude: forecasts, outlooks, timing discussions, briefing or show promotions, links without a report, retweet-style commentary, and anything not about current weather impacts.

Return JSON only, no prose: {"items":[{"i":<post index>,"kind":"damage|tornado|flooding|hail|power|warning|official|other","headline":"...","place":"..."}]}
- headline: at most 70 characters, your own words, specific (what + where), no hashtags, emoji or @handles. Example: "Trees down on Lorna Rd in Hoover".
- place: town or county as written in the post (add the state if given), or null.
- One item per distinct report, newest first; merge duplicates across posts (keep the newest index).
- If nothing qualifies, return {"items":[]}.`;
var SIGNAL_WORDS = [
  ["tornado", /\b(tornado|funnel|touchdown|rotation|debris signature|TDS)\b/i],
  ["damage", /\b(damag\w*|trees? (down|on)|uproot\w*|roofs?|debris|destroy\w*|collapsed)\b/i],
  ["flooding", /\b(flood|flash flood|water rescue|high water|road(s)? (under water|closed))\b/i],
  ["hail", /\bhail\b/i],
  ["power", /\b(power (out|outage)|outages?|lines? down)\b/i],
  ["warning", /\bwarning\b/i],
  ["official", /\b(evacuat\w*|curfew|closed until|closures?)\b/i]
];
function keywordSignals(posts) {
  const items = [];
  for (const p of posts) {
    const hit = SIGNAL_WORDS.find(([, re]) => re.test(p.text));
    if (hit) items.push({ kind: hit[0], headline: `${p.author} posted about ${hit[0] === "warning" ? "a warning" : hit[0]}`, place: null, time: p.time, url: p.url, author: p.author });
  }
  return items.slice(0, 8);
}
__name(keywordSignals, "keywordSignals");
function parseSignals(text, posts) {
  let t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  let o;
  try {
    o = JSON.parse(t.slice(a, b + 1));
  } catch {
    return null;
  }
  if (!o || !Array.isArray(o.items)) return null;
  return o.items.map((it) => {
    const p = posts[Number(it.i)];
    if (!p || !it.headline) return null;
    return {
      kind: SIGNAL_KINDS.includes(it.kind) ? it.kind : "other",
      headline: String(it.headline).replace(/\s+/g, " ").trim().slice(0, 90),
      place: it.place ? String(it.place).slice(0, 60) : null,
      time: p.time,
      url: p.url,
      author: p.author
    };
  }).filter(Boolean).slice(0, 8);
}
__name(parseSignals, "parseSignals");
async function expertSignals(env2, posts) {
  const recent = posts.filter((p) => p.time && Date.now() - Date.parse(p.time) < 12 * 36e5).slice(0, 40);
  if (!recent.length) return { items: [], method: "none" };
  const cache = caches.default;
  const cacheKey = new Request(`https://wx-signals.internal/v1?k=${encodeURIComponent(`${recent.length}|${recent[0].url}|${recent[recent.length - 1].url}`)}`);
  try {
    const hit = await cache.match(cacheKey);
    if (hit) return await hit.json();
  } catch (e) {
  }
  let items = null, method = "model";
  const provider = resolveProvider(env2);
  if (provider.apiKey) {
    try {
      const up = await withTimeout(callLLM(provider, {
        model: env2.SUMMARY_MODEL || env2.MODEL || provider.defaultModel,
        messages: [
          { role: "system", content: SIGNALS_SYS },
          { role: "user", content: recent.map((p, i) => `[${i}] ${p.time} ${p.author}: ${p.text.replace(/\s+/g, " ")}`).join("\n") }
        ],
        maxTokens: 3e3,
        effort: clampEffort(provider, "low"),
        cacheKey: "weatherchat-signals"
      }, null), 3e4, "signals");
      if (up.ok) items = parseSignals(up.resp?.choices?.[0]?.message?.content, recent);
    } catch (e) {
    }
  }
  if (!items) {
    items = keywordSignals(recent);
    method = "keywords";
  }
  const out = { items, method };
  // A model result holds until new posts change the key; a keyword
  // fallback is retried after a few minutes.
  try {
    await cache.put(cacheKey, new Response(JSON.stringify(out), { headers: { "content-type": "application/json", "cache-control": `public, max-age=${method === "model" ? 21600 : 300}` } }));
  } catch (e) {
  }
  return out;
}
__name(expertSignals, "expertSignals");
// Dashboard bundle: storm reports within 75 mi over 24 h, the nearest
// stations, and flagged items from local meteorologists' posts.
async function handleGround(request, env2) {
  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get("lat"));
  const lon = parseFloat(url.searchParams.get("lon"));
  if (isNaN(lat) || isNaN(lon)) return Response.json({ error: "lat and lon required" }, { status: 400 });
  const ua = env2.NWS_USER_AGENT || "WeatherChatBot/1.0 (contact@example.com)";
  const la = Math.round(lat * 100) / 100, lo = Math.round(lon * 100) / 100;
  const bucket = Math.floor(Date.now() / (5 * 60 * 1e3));
  const cache = caches.default;
  const cacheKey = new Request(`https://wx-ground.internal/v2?lat=${la}&lon=${lo}&h=${bucket}`);
  try {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  } catch (e) {
  }
  // X (and the signals model) only when weather is active at the point; a
  // quiet day returns no signals and the section stays hidden.
  const repP = withTimeout(localStormReports(la, lo, ua, 75, 24), 1e4, "reports");
  const gateP = env2.X_BEARER_TOKEN ? wxActiveAtPoint(la, lo, ua, repP.then((o) => o.reports)) : Promise.resolve(null);
  const [rep, exp, obs] = await Promise.allSettled([
    repP,
    gateP.then((g) => !g?.active ? null : withTimeout(localExperts(env2, ua, { limit: 30, sinceMs: Date.now() - 12 * 36e5 }).then((o) => o.configured ? expertSignals(env2, o.posts) : null), 4e4, "signals")),
    withTimeout(areaObservations(la, lo, ua, 50), 1e4, "stations")
  ]);
  const body = {
    point: { lat: la, lon: lo },
    reports: rep.status === "fulfilled" ? { radius_mi: rep.value.radius_mi, hours: rep.value.hours, count: rep.value.count, byType: rep.value.byType, items: rep.value.reports.slice(0, 40) } : null,
    signals: exp.status === "fulfilled" ? exp.value : null,
    stations: obs.status === "fulfilled" ? { summary: obs.value.summary, items: obs.value.stations.filter((x) => x.temp_F != null || x.wind).slice(0, 10) } : null,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  // A bundle missing a section (an upstream timed out) is cached for a
  // minute, not five, so it fills in on the next load.
  const ttl = body.reports && body.stations ? 300 : 60;
  const resp = new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttl}, s-maxage=${ttl}` } });
  try {
    await cache.put(cacheKey, resp.clone());
  } catch (e) {
  }
  return resp;
}
__name(handleGround, "handleGround");
var BASEMAP_ENC = {"land":[["alAd}F@BKBFI"],["olAp{F?@A?AC?A@?"],["mxCb`E@h@MpAQr@STU`AEBEa@JsAJk@h@gBLK"],["qnC|}DCWHPBEHJBCE_@S[?ZIOE?GGKSJGBc@BAHHDK\\v@D\\@z@MNUDWIKOq@c@QYAM?GF@NG`@LL@HF"],["u{DdfOBI@_@HCNBBGHCFp@D?@BWbBS\\A{@GEG]"],["yjDz}NNIN]GZJT?p@BNLNBRATKFEAIQSU?SMo@AS"],["ux@lpFDc@LSHc@VKD\\K`@LFCPNFKNCf@]ZCXK@IIAWEI"],["sx@rmE@EC@Fm@L?Xb@BXCt@BJE\\UAMFMI"],["usDx|MD?G[@SJDJYJRCr@BD?UJI@RFP@TNl@BID?HJFTCHO[ER@HIEARBL@MFEFF?FKNODMLIAKMIi@@IFARSDKMJSBAMMREEAMLUEG?QKECDAEF]"],["kuDh{MEIJa@D?FJINDFDCBVEDHFDVGl@Ug@@SEAGFAU"],["klDhxKTHDHGVK@HRLJEDS@OSYAKc@VY"],["aoDj`L@c@JKH@Ha@HOTORYK`@JJ?UNYHB@Uf@?FBANONERQF?FH??F[`@GOIJGCAXGDARGJEIBOKQIBAHH\\ADC@MUGD"],["cqDv_L@EAIDSDCR?DFUZTOJ?B^AN_@BS\\EK"],["grDvdLRMj@SJ?FBTAFBEJWPOI@LELI??PKAGKELIBEF?BRNBNIEQDGSQQ?I"],["wtDzcL@k@X[XMEHa@XAJNC\\_@FABDHGDRNNFP?JGDa@MOPk@JWN?I"],["_uDdgLHOFB@FBGK[He@DCLD?XDHBc@LIHDQ|@?BP@DFATWN]n@KCCOGCJQICE_@"],["mdDvpKh@EVPGDW@OAFH?DMPQH[MNg@"],["chDp}KDICYLMJ@Nd@@AAc@QEQ@?SI[NBXP`@BJHDp@KTCC?YMf@[TUBOE"],["geDvzKHIPAB`@JYDYJLNQ?OJD?QFADHGROLe@z@OHAKC?G^EFAe@GY"],["epClfEAGGELw@E_BDMTp@P@@E@D?XAFE@?JEKGDAHIGJ\\@K@DGh@KNCCAb@Q@CVKA]c@LALHLQDCFB"],["a_CpaFDF?EIWCe@f@`CFdACIC@FRE@OOGQBCGGG_BOa@"],["kgAv~FBYC_@HKCo@N]Du@DBFQNMPYB{@Xu@R[HU@MIF?GVc@BBAPLIIOPYD@AMFGDe@FQ@c@JKHDDE@LHA?q@Da@Zc@Fc@L?FH@d@Nn@IBHL?XERAf@JzCUO_@m@I?MJGlACJ]d@c@FQLAHDb@AP]vAWVD@At@QLJBBD?FGFCf@OVKc@IAGL?xAl@~@Br@VLNl@O?J`@GBQw@QDKA[_@]mAG{@Ow@"],["g}CnlKJq@RyBx@u@H?HIJSR_ALQp@_@KGVMDDAHHLa@~BMZU]SARH@j@DJO`@GQIRBJC@KCBFGTDDEJ@JQ?Gg@@REPONETDF?LEFMAEDFHIJBf@QACJIECYFOMBCEA\\DAB^SZICEe@"],["s|@z_F@KCIIGEID_@G[L_@?SLWCW^MDGAi@BGFF?ZF@LgAFUT]DCF@^^QXC`@?p@DVJNB\\KNDd@DDL@j@`@MRUFU`@?j@Dd@G~@BTNLQRQd@C@QICOL}@FqAKO?SEGE?g@n@EGI@SEQb@C`@EBGCGQCa@@WNi@"],["T`zCEq@LgAb@H@DT@RJJLHCFBJRILPDGXRFFTIXBBBf@GHm@NKC@KCAAJEFK@YAc@MKQCU"],["w{CrNJJ@HGTBPGBEGCWYa@sB?GNKBADMYoG?KLKB?KIE{A?JTK@KEKQVh@TCf@PBD?JE@UGQQAJWAm@SWUTn@ARKHAPOg@CJSYMCIHCLG?GUCHGDUM?k@QXQGAa@KHMCEE"],["akDlUAMIIEm@@c@\\YHMD?FNB?A]NID?IRNA?IHBBTPRARDEBPf@ST@j@MPLRDRVHMDVCTDJGDFBDr@HHDXJPE`@FEFDTxAANBd@KKEQABFt@[s@Hn@AXEBYo@Ap@ECGU@c@MJMYMuAGTJPAd@Hb@Ym@GECDOOIc@ER@d@IH?XEGA\\ECEDEg@EPE?G_@G?@`@WE@FIB@JICCq@?WHQGMBm@IFIMEWMIB^G\\Se@M@KKCs@E?AILILHEQSBEUED?EJa@HTBB"],["ix@riEAPAM"],["iiB|vJALCG"],["yfBftJ?HEB?I"],["}e@lyE@BIJGA"],["aa@xjE@BENCK"],["uy@nbFF@IXIRE?@U"],["orBdmA@LEBAK"],["ihCxyDBXEF@YEM"],["evAdnHKCKKDA"],["{{AvtGDDA?ECAA"],["m}AvsG@@AFADA?BM"],["q}AfrG@F?J?BAEAO"],["kw@|cEAHEI"],["qw@lkECNAU@E"],["ot@lbE?FG?@G"],["ux@fhE?BEA?I"],["kx@`iEBDADCA"],["ox@zhEAHAM"],["sv@jiEBQD\\G?"],["emAtpFATCWBE"],["glAf|F?HAEAM"],["ikBdnF?@?BADA@?E"],["orC|~JEDAC"],["er@`mGFTKS?Q"],["{XpuFB@GBK?AGJC"],["amCzdF@f@Yo@"],["mmCheF?NIMAM"],["cmCn}DGJ?O"],["wrCn`E@MBDANQGUe@?MFFDR"],["stCphEDBDLIA"],["{tCnhEDJKI"],["oqC||E@HCAI["],["miCbnEBBC?II"],["ciCluE@FE?AA"],["sjCroEDLQI?E"],["qiC`tE@JF@EHEAII@E"],["yDtjNJO?DO`@ACFIIGGL?EDK"],["gK|pNFGB@AFAECDB@C@"],["mz@deNDHKR]@c@L[UMFKEZ_AJKLA?GHAJORXDVNV"],["iaAhjNDq@HLEj@IE"],["m`A~gNASR]JJB\\SFALGDKAAG"],["gcApsNBDIAKK@EHB"],["abAblN?GNG@D@HGH@DE@@BBC?LYNAOIO"],["qcA`qNDFALMPIEGM?UJE"],["}_AbiN@LOF@QDG"],["}{DxzODc@HMAf@Qj@ECCKHE"],["uqDvrOBHEJCY"],["}kD~sNF@GP"],["{kDbuNEKF@JIB^SBEK@C"],["kjDdzNILCQBA"],["_iD~zN?PIF"],["yjD~pN?DGB@E"],["gkDrrNR`@KEG@O]D@BE"],["kkDnqNH@AHME"],["cdDhqOB@AZEQ"],["icDptOBDE@IMBIDB"],["_hDfeOBRIDESHS"],["ehDjdO?DKBAEFS"],["ueDzkOH^RTRx@S[IAGIE]K@IKESDYJB"],["mgDtgOBCAGKKDMT\\?S@C@DRh@Fd@Jb@@LELSaAQKDUGEIb@E@EGEc@?E"],["{fDjfOCDGM"],["kbD|yO?NIMDO"],["}aDj}ODu@BpAGN"],["saDz`P@|@ScBCCEPI[FMHBBJDE"],["}`D~dP@HCHC?"],["{`DzePDDIFAC"],["aaDzfP@A@MF@J^EDFJSGCMMCBO"],["oaD`eP?JEBCIFI"],["s`DphP@t@Ii@KK@G"],["k`DzjP@BELGGKTCWFO@OBL"],["qa@jq@@FGBGQF?"],["q|@dr@HDKBMM"],["ueBvt@BMAMFUJLAPIR"],["sa@tp@@DMA"],["uwA`r@TFJJBJa@VEa@OWASD?"],["kyAzi@FDAFOCK[IGBCRD"],["_wAjk@HLCNKYo@WCMNC^H"],["gVbf@Mj@CIAWDI"],["}vAbo@XADDFJAHKLK?OK"],["ab@bp@B?ADEAAI"],["ac@ro@?DIMF?"],["}s@rmA?LOBIU@GFE"],["qs@vlA@LCFGO"],["qvAtt@AHGBGEFO"],["yb@tp@@BCFKE@C"],["cd@|p@JDADID"],["{uAzv@NHKP?KIK"],["wq@rfA@QDCJ@DHEL"],["mm@|jA@LIFCAEI@G"],["axAvv@YNGG?KJGNB"],["}r@fjABCARHFKFEA"],["as@nfADBIDI@CE"],["in@lgACFMC?GDAH?"],["{m@fhAFDCRKFWC"],["yoDrSADEI?G"],["glD|NCVMDCACE?MJG"],["aoD`QBt@CAAKMCEPGUHOBQ"],["ymDbRTED@DTGAI@FROG"],["mmDtQ@DIBGOADCCGU"],["c`EtSBDMRBU"],["__E|SIPIDDS"],["w`E`TBACJ"],["kuDjRPJFV@OD@Xt@EJIUGREGCHG?CEB]KDSu@"],["_qDrR?DEHCKDE"],["urDdRP?Dm@TXAFM@?ZKJCVGFEE?KEBCWEA?K"],["gsDnUDIFFE`@EC"],["oqDrUALWB?O"],["ogD`^E^CG@Q"],["_qDdVAJCG"],["czBh`BBBCHIAAEBE"],["wwBrsAATIFAYBG"],["owBxuAE^KT"],["kwBnxA?HGHCMFI"],["ewB|vABGBPATKFCM"],["guBboA?m@F@@D@PC\\EHG?AE"],["}|DpoCJJKf@Oy@"],["gyC`iKHCCNGA"],["csCn}JBHKA"],["wsCx}JAFGC"],["cwCt~JDDCDD?EHEI"],["kvCx~JAHG??E"],["qvCl_KBCCNI@AC"],["ouC`~JLEEAHMD@GPODGJMKDGHN"],["yyC~bKCRQZBU"],["wwCp`KENOL"],["kwCv`K?FODDK"],["i{CpeKKBGALI"],["_zCvjKK\\ECE@CIBGHI"],["q{CdfKD@[NIEBIJIBA"],["qeBzpJAJQJAC"],["myAnpJBBUJEC?C"],["_iBbvJ?JIH?QBI"],["oiBruJDa@DXCFEB"],["igBxpJDC?LMJ"],["s`C~}E@BKA"],["_{BtfFNJC?QO"],["s}BxfF?DIEAKD@"],["}cBhiE@JIO"],["i`Ch{EDZCBIS"],["u`Cr}EBHSI"],["}_CtyEAXCQGA"],["_mBxkFFP?@EK"],["aoBjkF@@ID@GB?"],["kuBljF?Bi@["],["cmB`kF@NEO]EQ@^C"],["gkB`nFKEQW"],["_wAjmH@BECQc@B@"],["itAfoHUE]W"],["azA~gHSU?E"],["wpAtnHB?SFq@Le@Af@A"],["s{AhhGBHCJ@KKY"],["y_Bl}FXBQ@"],["_}AxuGB?AJIO"],["e{Az}GKRAKFK"],["c|AptG@BMCMBJC"],["wjAtqFFHBGIEFEZCJDAR[FQLE]"],["scAtqFBDOR@["],["sdAxrFCNIHAK"],["oeAvtF@[FG?XCLC@"],["}oAhpFKPMO_@CGB[ZEh@CGB_@T[B?HSRAHJ"],["_fAlfFDBEPK@"],["ejApgFHF?DMCAE"],["gaAdcFTLBp@C@K?IOB[OQ@C"],["mdAzfFBFEA[c@KFGAAKDBLCPL"],["snAnnFL]RUp@BQN?I]ESRKX@NME"],["ihAlkFMd@GA"],["qfAzhFOLIVCGE?g@P^UPCNU"],["sjAhjFD??RKIg@`@AA?EXM"],["cdAjrFGNICNO"],["uqAj_G@HIDFG"],["elA|qFV?P\\UH@JMPAIBAEGIDOKIAQD?EJQF?"],["{kAz}F?FGGDA"],["gtApyFF?QFo@P"],["mbA~`GL\\?HAHMJDKEGSHMGB["],["_rAn_GD?SF"],["yeA|vFEPGH"],["orAhtF@KCk@BARpAQVHQGOMC"],["qmAdzFPR[UE?CI"],["_w@zqG@BYI?C"],["mu@pqGLDMAKGDA"],["ky@n}G?LIW@C"],["i\\~_GB?GFAE"],["m{@f}F?UBC@\\I@"],["m~@tnG@DI@ICGEAO"],["{t@vbEIRCA@I"],["ej@h}DHDEHG@WQ"],["il@`}DFBEB@NEBGGEJQFCIJSF@"],["u^t}DDN@fAQYAMa@AKPKy@?OPJP?NG"],["}d@btEHDYHDM"],["}a@z|D@DCAGICQD@"],["is@daED@ADIA"],["{g@|xDAJS@ACNQ"],["ya@nfELAJHIn@GEAKFI?IOK"],["}w@zcEBNGM?C"],["qd@z_E@DQEEE@EN@"],["}u@|_EAHI@BK"],["sp@j~DAFE?CGFC"],["gt@z_EB@AJG@EEDM"],["sn@n~D@H]HKAJQ"],["wq@r~D@RU?ECLKHQ"],["_q@l_EBHIFWBEEFQ"],["ch@d~DCHGAGKN?"],["aeAfcFH]@BEHAZGC"],["ud@zuE@BIRONG?BGHEFS"],["_cA|~ECPC??Q"],["ebAzbFBJE@CE"],["gcAr_FAFID?G"],["icA`aFDSBR"],["avDzuN@NIDMi@"],["oqDb}M@NHLEFKI@a@@C"],["s{D`zM?BMI?E"],["wuDn{MENGQ?IB?"],["ysDz}MBDMT@Q"],["mmDbeN@JADIM"],["koDjbN@HGEIS@G"],["soDz`NALCAASD?"],["{{DnhM@]Np@MHGM"],["q{DndM?NEO"],["}yDvbM?DMQES"],["}yDtlM@HABGE[o@QOFURb@PP"],["uzDpmM?XECCODO"],["}{DllMVFBFEA@FG@OI@CEG"],["a}DhmMAPGA?E@G"],["qjDd~KAG@OTFAHY^ULCNG?AKHS"],["spDtaLDE?GJIFJZ@PDBVKDUCCKKTCAIHK?GIAM"],["qlDp_LBAVd@OAGHCI"],["ckDlyKPI?RI?CH@DUA@Q"],["soDx}K?LCDWIJQHI"],["inDz{KN@?TKHARKBCIYU@EVY"],["wnD|}KAJILIM@YJ?"],["}tDvbL@LIRCM"],["ccD|qKD@MRSHLY"],["giDbxKEBIE@M"],["kaDlxKEFM?DG"],["sgD~uKJLIVHBGBOYBK"],["ceDvtKAHc@x@IE@EPm@RQ"],["{_DvnKCPKBEMJG"],["wbDbpK@FIAU@GG?K"],["sdDbsKAFOJ?E"],["_eDrrKANSGFE"],["uZr}D@DI?MMFGD@"],["hHlyFB@AJWEIMDQJR"],["nC~`D@HYMKKU?UMGKAOJIb@J^b@"],["yX`vFDDIA"],["}BpuF@DEBEI"],["}FbsFAFGA"],["q[`}DBJGCAG?G"],["dH`jCHHYCEG"],["bCfkCFFADKC@I"],["YlzCBCTL@FEh@I?IE@OGW"],["aEd|C@NIBI?AO"],["Lh}CPXIJKCCO?Q"],["JnyC@XCLKKEU@IDA"],["Mp|CL@EPM?KOWCCC`@C"],["g@v{CBHO@EAESJA"],["lAhyGIRI?EGCSDGJ@"],["zAlvGBJGDOQCMBA"],["}U~}FCPGFMCAIHCH@"],["l@t|GARO@AQDE"],["dCpyGCHGCFI"],["Af|GDEPCRSPANOPHFVAZMFOOGSEAQJIJYD@LCBIIAM"],["`@`zG@BCPCDKGJU"],["qbAxkIHBCDMB@I"],["qy@ryI@DEFGG"],["cmAnxIHA?DQH"],["ojAbvICFM@"],["yyAr`JW`@KFO?HOLCBQ"],["abBleJCFC?"],["uvA|fJ@?EPKIK@ACPI"],["gkA`|ID@S\\?O"],["ipAdzIB?ABNFSCCG"],["syAr}IVFGV_@ECCCM"],["ukAd}IKHE@EJq@MDAd@D"],["w`EnmEFADRMp@"],["w`EtbHBE@D?VHGFQZz@B@HEBRNAt@j@DDBRFKl@LdA?PH@FBQLI@IJO@Mh@D_@MKGCa@D{@VGrBaAZPJPKa@?ODDY{B@s@VoANaBb@iAj@{@h@sDXm@XLMMEO@u@E{@HeAAWFK@[FQDIPGl@RJ?RQTIRDb@CHHJBFCLWd@i@FABBHR@c@Tq@^e@ZMXh@Qe@@e@HYh@q@i@f@WIMMEODGHUXMQCKK[VQO]e@EFQBOPI@ICQP}@RE@IGAIILEGIVEIITa@VGJa@{B[eAc@}@a@g@IIYKa@Ao@Dy@^YXUf@c@xAGDUG]e@Q]IHIKIA?KHYILKMKBIIE\\EK[TKQCTEFQSBZC\\a@i@GCS@KUSh@WN?aPNLG[F[NQHPIc@DUBALV@UFHP_@HeA?k@BKLE@IE]KG?KRINVRJLALKJDDZ?dABCDwAHILERJLABa@JJHCTJBHMLHFH\\Fe@Sq@Ay@N_@XO^LFHJn@DHO}@KMUIGE?IPMNPMSKINGV?UKUu@E]]c@@KJMTIMGWJAQGDEG?MC@?QCOETIH?IMGBIOD?MH]Ob@IFMCCOBYELE@c@WGKF_@FGN`@Co@FILAHDGOPMJOJT@CBOD?EM?ILKJT@`@BQCw@BDHGDDAURQTp@LNMa@@G@@Gg@@MNFJLPj@Ik@Ca@PQDa@DEHHHEB@Ld@?NDy@BGLLDc@N[NDPA@NCr@E\\GEBRDITaADXBEDs@FZB@@c@PEBLBYHI?GIO@ID?DMHCGG@MLDNSJNNHLNQg@Em@BEDA@WV\\JHe@y@DY\\UDe@CQCAAWHCDIJi@NNDL@l@FDDTPR?ZRx@?^HVLFEXP]FRB?@CFDCQS_@Mq@a@aAKgAAd@CBCEAIDmAb@[Pd@DMHC[q@A_@?ELIBWHOXOTHJGLDHGHr@Dy@DCDFCVN_@BAZ`@l@~A?n@B\\H^@j@r@~@Zl@FRHDDR@fALzAMREnA?h@DHG|@D^EjBDp@CRHNAd@Tj@f@\\L@JJLxADEF^JJJXV^RLP\\?POr@I~@HQ?a@P_AFGb@T^j@ZXTh@JLJp@?JJ^FDRh@F\\FBDJ^`@@VT^CZH_@HALd@R`@WaAO[ASUIe@]Oi@QW[{@K_A[iAa@m@y@y@_@q@a@iAq@cDIi@CaADcAH[P]JEC^L[L@LFD\\NPPj@ATMj@FNAb@HXCa@Ls@VWO{@BB?OFQNNRDXf@DKCO@SPDPG@I^GBGFAF}@DGFTNc@ASJSASBg@HD@[Ws@LGDIA[HMLGFP@c@BEDD?Pz@hEC\\LEDDCTKPNHID@JJDHEBHj@n@LT?NDFJ@AFBDCXWLAHFDGF_@FUISWAFLRECKQE]GKDTEEc@kAMm@CCCBBIN@@KHIKBGGMiAEzBHLCLABIIMYUWBNMNJCPP@Jf@`BITIGFNFGBBJ\\CFFb@GBARPCH@DKLTANDRFHAPJD?DFHKH?JDHEFVFGZIIAFKCLRH?VHJNAJHPGBHDKBLDEFL?CFBHGAHTFFDEZ^RJDHXFNGAKD?DTTRJ]PKDBBKLABIBKI]UJCJ?MJKZCDl@FXQ??BPZDPOBIEDLKJHCDDP@FFH~A?j@X`AXf@]IK?EFHCT?f@`@DA?WDA|@HUA@Bb@NFF?DN@DN^TDJ?BSEEV]d@I?QIIYIGFHJZLJN?ROPALGLMBILBBD@INCDBE?@BLB@DPLh@VFALVXJIDMAUIa@UARIEGJSEFROREBICAWMRADFDKCCMGFBHIA?MGCC?DFM@OOASCJIK@HGA@HJBDJE@JBGDPFCNLOFDAFJERBRCPIGPQHFAFARWPEIJG\\MHH@MJBVMAWSI@H?PTRDDGASNMHc@R[TF?Ni@j@EPp@y@FWBDBIL?ALF?@DU\\PMP]FCDJMRGBIb@?XLy@LCFMDAEWBWdAWf@U[Pw@TPDb@QO^L@CJDEANJH?FEJMDXAAaAZ@AGQAEKJIR@Zf@C\\MHFD@HG\\DEPm@RHFNO\\LIFWC[BIHFL\\?f@HNADKDTCVd@LHRDUBVD?d@Rj@^\\NDGBGAFDLEBDL\\HBJPCLHCDBNh@AZHOD?FHKDDDIHF?LIHLPFDRHEFLFCFH?GNJ@FHIFFAFF@^DbB[jAa@v@e@RDd@K[Na@APHKBKEEFI@ADd@ItBs@JIZE~ADCBXLZDJJDX@d@GBGAFQCAIPo@VMb@OH]BCHSMJN?Da@@EC@NH?CJ}@h@AG_@WEBBDKL@BFGND@FMH_AQg@?QHg@t@m@f@Q`@BXNF?PJVHr@GHG?FIKBW^?EEBIEBLF@ABU`A?a@IL?PHVDr@IUM@FFCHRHBRICLP@d@ESMJK?MH`@J?v@ERFh@JJDLId@INAHHJLFJWOk@DGJNFG@IOM@ITCBPDD@C@JDBRSFa@LOD?JLEFHLIAKFIPCPKFGZHI\\FBFOFCRNXMt@EE@GMFI?BHCPQNALGFLVFG@@BPCh@Qp@@r@BJIDCGICAFNHLC?R\\`AOW?XKEI@?HFBALNANKTXF@JJ^x@Nd@OUAb@DDKL@DTK@IJXGHTDBDEBFTFACIJBHHBXNOb@N?FMVPEBUJ?NFn@Kh@UBGX@hA`@~@N|@FpA?^Jr@I\\QVYZFGBSESTYNh@KJKjAa@tAgAr@QZ]NEHMALJ]?CGJDM@e@JODU`@Y@GC[W}@@k@CWEKICE[Cm@FIFDBABK@YOYI?GFIADHC?[o@SUc@CUS}@Ak@K[u@M}AMi@Cm@NiAGIA@@JEDCW@GPUXCNBTHZ\\XRLBVAFLLHFCAULDFPH?EIBEdBb@YR_@AJNF?ZL?SLE|@RFGRFb@A^D`@VDLTPJ@L]GEKDXm@QYCQ@GHMCSFe@Au@Qi@EBJq@A_@EQHa@FGAMEHDYd@o@GR?HJ@?QPOCQBGMLJ[NEFMPJGDFFFKf@K`@VXFh@DxAC@FE@YAH@JLTIX@CFJ?FDBKPCFFXJNARKDIv@[`Aw@BORWTC?ONDHOA]QJJQRQBQC]EUS]Ki@g@u@Dm@JQ@k@Ni@PWPMVc@LGf@g@DDHA?KEC_@BMBKHg@_A[MIKGKAYGCQF[GK?GEC@HLQM]KOS_@g@Je@AKDNF@HKw@YBm@Ac@i@{@Ok@]MEOQYAKHa@PIJAZZRt@LATIPS@H`@MTD`@\\ZNXMTURAHKKe@QOc@AM@]PKJ[JWBEGK?CSSk@Qy@MMFUCGEAMBDd@YFUGGSJMd@IRKCg@Fi@Zi@ZKFBJAPO@YMyAAiADMH?TWPiAAYc@cA@a@EIEJA\\BFID?oAIoABm@Cc@DBB^HL?t@BGF?LOFALFEMI?@Ch@WIIDEO??GJQTOQ@?MGCX[F[RUHBHPv@T?d@P_@EIAOIWD_@GM?QFQNM@QZm@`@e@h@a@Z?RH`@BHDEGOCWMAKH_@^e@JEDSHK\\Eb@@i@KEIJgAF]HCS?EGAaBFo@H]RAVJEGYIGEAGTe@Lw@f@k@FON@GILORINBGGSC?Eh@ON?YK?GHMJIh@Mz@GtA_@FBBKZMB[JUVGX@^f@|@l@FRPLBP^Jb@\\X@NRPDBBCRRj@?a@FKEYc@_A[g@HEFFHGXENIJ@X]Qg@F[Qg@lAVLFOQy@WIUa@[?KLMIACIGJG@IGGBIMG@USCGDGIODKEKHMK@?QHMB]RSDg@D??QFENa@@Qb@MUMCIX]@EDDEK^KNJBHJIMGGMREBLPD|@LY[g@MEG@KH@NHBAUY@GGMAYKGFk@`@eA?WEKPg@@OMsADs@t@}AXa@DSp@k@d@i@J_@RKFc@?liCa@Ta@Ey@o@y@sAy@WUH]@FDZAJB@JSC`@ZGPUTENOJIQMA]FYC]HIEM[YIBQCHUHc@a@OIYAc@DSa@?KGOMw@IGOBONMEGODUMAMD]AKQAc@UQ?EOMO@CMYM?Ey@[DFCHO@JFKDQA@JQO_@GKDo@BI@KLMUIGg@TI@?G]CKF?Fk@Zg@d@c@ROBCMCAI@MMHIL[QXQFHJEBCLHCBBYJ_@j@EJ?b@LVTLBEXb@DVDHL?h@e@NEDH@NLNDf@ED}@NBHRBBDIVi@TGX@PCDG@BJC^FPN@[VUBGJCPROH?G\\MLQKW@KH]n@Ib@GFMAKFa@r@L?FGFSJGNPD@@BWRG\\WPOBI?WQI?OVGMIAYTg@p@q@f@aAnAE@GIJOAGM?CFOFGAC`@J?HJ@F?NKp@HOI`@Sh@Gr@KPUp@A`AGVUj@a@j@y@t@{AnBUl@DBRi@On@APA@IIABDPG?EHLJFU@`@R^ZjAB\\EZQd@Ex@Wd@Id@WVQ|AS^[pAm@jA]^?\\In@YhAq@n@o@dBcAt@g@PKKAOEKG?IDCR_@[e@CKVc@Ra@?]Ny@z@cAt@{@pAJW?AK@E\\GLOD]XDMAIA@_@~@OFDVGBAGOIJR@JCHGF_@BYUBGIHQDQR@ZQLSBG`@ORa@LSIEVBNGRi@b@IRa@XSTWDGNSBk@^_@Fq@\\W?CGI?Ox@K@IJEPHD@Lg@nAHINEHDd@BRKl@K`@A^WHSd@i@XUPCAKJE@KZIHUz@M\\i@`@KHSJ?JKNAHI?EQJKAPWx@U`@CRODId@MZUZDVGV]IEI@CENWVSLILCDQJG^FV^@PIFa@HYPMXc@h@Ud@WX@JMBOVSBu@Ea@J]RIZYb@MHUBLJ?LFPWVANKJK^UH]l@IBDm@I[H?HO?GOJGAAH[OSEQHkAnAETa@r@QDADa@@KPe@DQVUBc@^M?CDAII?MTSFML]FCB@Dk@FSLi@|@A`@KAOH?`@I\\CHI@O`@EvAINu@@GRUBYd@o@d@QTWBOMK@GFEZSVQ?OHW@AG@EJADEJUo@\\CEEoAEr@DJGVBFXA@DWh@FDWAHIG@ILMFINc@h@U@WHOCYD_@XOTKBK@UIAABCYGq@EYFEFSAMLYDSAWLs@SGM@F]M_ACGEc@@oAMw@@GBB]CODK?QKV?|@_@CNIUEGRKBI[GZF@eAV_@Zg@BTgABcACMFQESXKLJEBVVRFCU?LGAc@k@GA?CNADJFA?DNKN@AJHDKDDHLH@_@CIKEIQg@BWOOPHAEHG@GKKLAJC?AOYBCLULELHJGBGC?JK@C[IEFLAXa@IHLJ@DRIb@IJEBGE@GLIIW@PGJW@IKIH?DHGJJD?HN@ZWb@[NEHE@USW?DFN?LJBLAZCBI@PHCL?^A\\EBKu@@|@C?KMALICIBLJDh@G\\U`@QAYYIgA?~@@HRTSRM?QM?LSEOc@CSFE@QV[WTGPGFGAQUKBJ@DB\\l@H^n@XUHONO_@M@GK?HPVk@MKGH\\EHYDILKh@QHIEEI?OLBLc@CQBULUCBOV?^GNQFGCCQENHRADRVTDFRFHOXMHANMXYYOCIi@Dl@ITMLWGGMi@_@]a@@LKHVBXRCDYKa@JQGTJb@IVPJAJLFRE\\c@RGEGWCJe@DURC@GIRhABBFARL?PSFQSUOC[C^MLCNSPAJK?M^O@K~@OAUHGHEGLk@Uf@E@CA?_@Cb@FH?DW^S?WOZ^Ux@QNKBGNg@RQ@HD@DHG?HJKhA_@HBARKLCL@^QCWPGU@ROLTCDHGVIHGj@FEDJ?QFYHSFD@YLOH@Bd@FLa@|Ac@n@M`@CPCAGb@[xAA@GQGIMDKEFQXESEAWEXKR?FTf@Fp@Ah@Ov@IKKJHBDVM|BFvBEEGHEl@KXSGKKZt@I`AQU?l@GB?FBVAFIQERKBECE_@AH@RLf@ATFNGRHH@LGRYWLZ@\\DDASNLDTH]H@BTFLIs@HOFTV@BLLHB^Ib@BLIL^RMJDFHAATFCLV?f@LFPXEVD?Dv@GRKEMo@Yc@Jh@C\\GHSK]a@QGYB]{AF_@Ao@Fw@EDEl@Ql@EOKOMi@?J@XRZ@p@CFHd@JTNx@FBFAFVNZD@DCDHH\\Eb@Pc@FCBBFHFl@BSHFBXE?ADHV@EJNL^RHRkAFIJJPh@FNLDDR@GJBB`@D?Bh@LLLl@PP@THD?PFRBBJGRT?NPb@@\\NL?ZBNBDBOFp@JL@QHIJR?BG@ADRPNhAJBFHS@AHRz@HJAJFNCJLZ?ZG@GE?UGN?NDLNFX`@F\\AFACIFCLRABDBPGLAJL@FR[EGO?Us@iAQm@Ko@?CBB@AC]D?DHJSAEG@AEFg@E?MV_@WWs@Kq@Sc@DA@UWAYa@Uo@@e@CJMJe@GGEEc@EZOBU]IWCDc@WX`@XhBAHURMG@a@I`@?HNNEJFAPFRGF?BPs@fAHVGVORPl@Fh@LJBf@Ad@Oi@UDGM@XEFMBMMOE{@h@IPa@[ES?RZ^LTDOFALFANNn@BbAIVI?M`@OP?LKXGCC`@Sa@MKAIJo@DEJJOe@@INQGSIIIn@C_@ENHXGnBADO_@@TCDEABNCDGEDJJA?PSLCNEBIICBBXGDG?Cc@IZEm@MJ"],["ycDh{FCb@QhAGRMSAeAZe@FC"],["w`E|vFb@^BHQj@GFM?"],["cqCnnD?FEG"],["kaD`wFEXEc@"],["mnDhuF?HWKEMP@"],["ynDtuFd@VCHUMGB`@^FX]YABVb@CHg@o@UEHAXHIM_@KP_@HE"],["mpDpxF?FGC@G"],["wrDbxF?DF@CBKI"],["snD|xFAHEAQo@LH"],["iyDzyFABCAAM"],["qeDxxF@DEFAI"],["yyDdyF@HIG?Q"],["apDnwF@DO?DG"],["w|DltF?JECCe@"],["g{DftEAJE?WUAOLOHH"],["w~DriESv@GBC_@@a@DKJB"],["k`EfjE?GJK@FEVEFEAAI"],["g`EvaHGNAKDG"],["a`DhlDNJDl@JC?QNALFLTPHRXH@ZXJ@JFLAq@_ADEJBGWDOAYFFRl@FHE[HBJPEYFMC]HCCEI?@EHA^NCIGACEEOBCYo@?CRAIKAc@Ja@DEJ@X^HXC]JHBYLHJ^Ko@BGGMGg@J@JHBRNX@CH?D\\?UVTJI@GIQYUMc@@Ed@\\T?DCIQSO@EREJ@^VJC\\PBHGNFXq@@\\f@@HEFSGc@Y_@LITl@Z@FOGLP@RRVLBLPBl@ENIAMi@[]Ma@GGBNCh@NFBLGZBXIYU?DNAHJLHr@KzCE?JZB^?PELUHGAo@iAIY?pAC?Q_@FDDQg@UGIHg@IHMKCTK@OSDO?EUJoAo@IIAOGJOWGEGBIUUMUaA?KDC@OICAM"],["o}CplD?FEAAM"],["}yCniDFTGF@KGQ"],["caD~kDADCAEK"],["mzC`hDFKD\\K?BG"],["kqCxnD@JICQ@@GJB"],["gsClhDBDCBSS"],["cnDr}DARGKBK"],["{rD|_EBGHA?NKT"],["owDbwEFD?LQE?I"],["s{DfhEDBG\\CDGBAS"],["w`EtbCLAFJD`@BY|@^\\FV^GvAB@BIFu@BGDEZCLRA\\G`@N]BVATGE@RANIBOUEECBX^?FQjAQAGe@SUN^D\\Q`AOH_@YK?@DHFLv@L\\B`@EV@`@HG?HCb@CDECMi@?z@M?GJEh@WJEVIGEJODIY?p@"],["mr@jkGDDGACG"],["_pDnqOB[DN"],["s}@`bFDAG^CO"],["eOrNCZDF@]JtA`@zA\\x@@VUz@o@vAeBpBWp@MDUl@g@j@]hAOCKFICDHAJIN_@HEDAJSLEADQSQ?PBHKBMACMITI@ICWPKJ?LIC[@BF?DGLQF@LKV]PU?FFYHAHNH?BUFKCHNK??HEFK?CECLGEIa@EBAJDPOFIG?SCKCABHAXPd@AJOA@TMPQGBROZKDGICWKNJH@BC@s@?SDGEEIPIBMAWIAGiACLDx@HTAFIHUBUPMMBPI?]PGHOFGP?FD@IHOg@e@]k@Yu@C_@G}Ae@a@C_ABo@Lc@\\EMIGBL]Ok@Ek@RCJH@CDk@XCBFFVBEDgBOYMKKEOYOWESMEDeAk@C@NPOGW_@g@g@EMQMcAIs@[WCIEOYESYe@{Ag@YWS_BYu@a@c@a@{@iA}@]SYCc@XKCy@C]Kc@a@q@IcAgAKUYiA_@aAqAu@cBk@C]IU@KBDJ?`@a@kB?HVVJAFF@DNEPIVWPQBCJGBSS@HDFKHWd@GAFJBr@N`@KjAFf@g@Q]AUFUGYF@UILFh@UBGWYGGMDNZPBTCJE?k@KI@SWy@]EBG?q@S_@Ao@LI@CE?FEBQI?HO?QQ?JMGEFO?BTE?MKERKJE?MEO]@UG]CKIBCAQw@@SLWBSCaBCWNsA"],["rGpwOHGCF@EEF"],["vKfcNCD?E"],["kaA~mGBA?@C@C@?A@A"],["ukAp~F?@A@AE?A@?"]],"lakes":[["k|CbqHLZAZ_@Fw@f@CAJMMDGJ[LIRHNQ@EMLQCEI?HIZM[D?MHGT?JQNLL@Tq@VY"],["i`DnvHBHMNKCSF\\@ABMFc@B]OSDIVDB@ELC@BOLQBCL@DHCHD@LE@?FEFI?KHCMBE?QGSXsAj@?VNVIJDJAGMPA"],["s_DhtELCXh@ZH[B_@f@SCOH@KQERCGO@OEOKGR?BMEKNH","s_DduEG@JOQ?IRBVPXLGJa@I["],["urDdrHHI@SDHRND\\T\\ALJT@`@F@IHCMSU@OKMNAAKKAEOMCCOUHICFC?CK["],["usC|jIBBI?SJCFLH@XFBCBBHC\\D^T\\O@CX?WFKKOCB@YEK?i@C@Ia@IAEMBKDBHI"],["gyDx{KAD]V[v@WZ@ITa@H[JO"],["cgDruETBALJBDNA@OMGKEBEIMVAVGIBGCE"],["ciDnzEFPGHBIGS?YMCEB?DECBGPEDGBP"],["gvDxdNBRDQ@PGPAn@GFAW"],["e{DjwMGI@ONWDDM\\"],["ykB|pGC[Pe@HI@DSb@Ad@"],["skDzkHOq@BIDDFb@"],["ecDh}DHQJK?BS^G`@AO"],["qoDbwETGT[Yd@I@GFMO"]],"borders":["muAbZ?Ll@EFBB|@T^?FETDTM\\ARL~@LGH@NPd@RH`@rBd@b@v@p@^Pl@HJz@RlAJl@h@HAXLDTEhBF~A","qvCzdKVyAB_@AOOWWHMWU^","aEnoDDb@CPIHDRDHPJFj@JDE\\HDBHN@?NFLILGZ_@\\CJI?EHe@?GJ_@J_@Aa@MW@KQWK[POCILE\\SIa@COLAHFTAZ","ekDpUFNXPDb@HOJb@D?LWDAFY?[IOEBISFKHGDOH?Ai@","qT|b@a@Ws@}@_@EIU]G","sVnYCEBQs@WGBITSACSBUFGCEUBGDEPSAIOILWA@LIHo@@QO","gFtiDCFG@ANMHJb@BBBb@KTXPTUN?BHIl@","we@pb@G?GFe@Ei@VCJFF_@TWIIDU?YRQCOH","gFtiDJQF]We@DABWGOLKA_@MSOKaAYQOa@O]WEI","s|@h_FVER@JIPNJEJ?JJ@LPKFK\\?","}i@pxGI?EEa@q@OBAU","al@fvGBW`@i@DQJCK_@HO?SDG\\DDCDF","qg@|oGAa@UGESm@BCi@UQEKHEJSACKEc@q@QAGKOECKLU@QESCA@GEI?GIa@IIAe@","HfjFO`@ANYZITBHLB@F?^K\\CZWDGPKD@JMb@_@p@QP","oI~rDCBK?ORQDMLQ@o@UOFECKOAe@GCIIMJSK","kI~gDYGo@b@mAJQAa@]","esBbVg@HME[YCOME?L[VYEQWOCGP_@NSRAi@KMUGMLQUIBa@AUFu@eAIFCVS@EDCr@FDDRCr@DVGDKIKH?BF^JR","q_@fPc@EYBIOWGMC]DKKES","k^rNSHGN?JIL","sVnYBCt@MPB\\XBOLOB]BIXGLa@ZEV@TF@DXBl@E","sVnYKH?Fh@TBVOLCR[I_ANMN@DGBJZIFBL","q_@fPB^PRCNCBKC_@DBNJ?IV^B?XFBFCBDK`@G@IJ@NPNFP","ea@~m@w@c@EUIS?]GUY?QRC?IWOASB","we@pb@RJPS?IOMAK\\WCGSOGQRs@KIK]EAMDAQFQn@UV?DIHENYb@X@EEKBMr@GNYN?","cp@trGv@hAFPTFXCPP","aZxpFNHr@[LLL@LP@BOJ?DNAHFTF","gOx|DiA`A[[c@FKECSCE@OWc@OA?VEDICUJ[S?MWa@MGCKE?WP","gOx|DBETGJFLTLH@ZJRJFFXH`@EXL\\`@BFH?Ha@d@BPCL@b@SPAd@ML?DBBTOj@k@d@?r@UPBBKBu@XDTv@^JHFDH?PRX?FNZVXNJ@FOCGBEJRd@@Zm@t@","mi@vr@?iBMGEOAW\\}@Ci@DKLAHf@AR]fANJFt@N@?nAHJ","ia@pfGGb@JRWbAJN","gX~aGKBMHKOQ?IDQSGDENe@?OMHOGG","yB~oEm@H{@VK?[`@KDCLBHIAi@o@ICk@`@_ARmAC[Q[EGIICOBEFC\\J|@Cl@@LFPCH@DsAdAAXKb@Jd@Ep@BZCHEF[JCRIFk@CKGSBI@WVo@LCNKHDL?Ny@c@gAMa@O[YGSm@[S_A","sf@zi@?rCPd@DXA\\Jd@AR","we@pb@?`ADb@Kf@GLDJO@C~@","ozDpqLGJYI@z@L\\Kn@FDGn@oD?","}iDdwK_@g@YSi@HQIQBCB@JCRKDANGHE`@Sp@@VUBEVOEE\\KIqBtBGA[h@Sn@QLSp@OLMAUh@RrADGFH?JP?JJ?VX|@AFGCUJw@fBKDIb@","cxCj`K?_A","up@xtG?`@_EG","HfjFDRCLn@c@b@A?HCD|@Pz@p@h@z@h@tBd@^HA@DGD?Dd@Ft@XLAH@NTL@HJC\\WNM@GJ@NQ`@NVAHWKCJM@CE@MKKm@HCB","fLryEi@d@BPGTeBaAI@m@tAJV@RQb@NTFV@PETB^KTSCWFM\\Y@SLCRQRCPKH[FSRGLIBALKRAFDD","yB~oEBRs@Bi@ZBNZXDJCHSNLDJG?pBETF\\~@@?u@ROR?BJIRJ^@XfA@POP[LCJ@NGFIRCnHv@","fLryED@BFED@JMN@f@PPLtAZr@TV","_`Aft@I@i@IAiKsCLQK[i@CWMc@}F??mI_C?","gtAbZbFaK","muAbZiBA}@aBESUa@Dq@IKOCAo@Kw@SY]U","gtAbZe@?","gm@je@k@x@UFOXk@RGH?b@[TOTGVAl@@HD@J~@En@`@Rb@H","cmA`N?pDjYaBZYlAN?lJANO@DDN@Fp@En@@ZXR?Bo@v@TXh@JJDLNEP","g[ph@?QEIOEKSo@YCGAMBMCUG??_A@G`Aq@TBBKRAPI`@T@OOO?K","udB~lJQoFTJtB{J?yGm@?@qD\\]vAyBj@WZEZUXi@^gACOQSi@OKK?MIMDa@?m@DOv@}@bAi@PCLQl@c@PYn@C\\W^K^qAFo@Ni@EIAM","ml@f_HOGY?KGSJoAm@?aC_@AKTQFOXg@h@?g@w@A?uDOAAGFOCIo@[CE?ODE?ST?@U","ia@pfGRQBWCSMG","cxCj~J?_uAc@?D]\\ERIDGFw@Lc@CWEG?e@Pq@NGEWBQVo@?MMm@?GHIA_AHI@I?k@]kBjC}IXIPUGi@^ELICc@JOPLn@gBnDi@p@Xl@LV^FTNDN?LKN_@?Ys@sBOgBk@wBIKKHYBQJKa@Ee@@cDk@c@W]K[c@o@Sg@AM?mI]SBQGMDMKEAKM@Q[OKc@EQQYEkAkABQLADIKeAXk@rBCRBHS@ODADFHGHDHK@W","aEnoDITgAf@IHs@H@\\","gFtiDMUc@S_@?QK"],"states":["ilBnfGYECSMEIKEc@Us@OK@EGKAGDEOY@WQOEOYG","g`ClhFDJLHNRLCFHP?j@k@P`@","skCn~EH?JHPEFBTj@`@Fd@Vt@JNDLG","awB`aGA@","cwBdaG@C","itBb_GCLIPi@\\GBWC","itBb_Gf@fAVTLXNp@","{_BlwGXHJANMVG@G","qnCvlHa@Bc@P[?IBw@B{@Xq@?_@H","{gBzdHAN@NGJ","m{BtjFATJL","{lBj|FHC","slBtaGKi@","ozD~uJfR?JIFO@PHALU@[NMDWIAFSXO@OPMF@LMH?COEEFWBAFFBCHSAYj@g@GWb@e@JCHUHCNe@DCBDL]NMAIBIPU`@KF@RCNHBOLAPSDQJKB?","ozD|aKCRGASPMBCPORC@GKQF?THFDj@Ix@HHENFL@v@]FANCGK?ULGj@GRIRIBCNQR","usCttENVJj@","_uChrEDCFUE]@IECEU","gbC~uJ?dL","ajC`zIW^@DPDAhAFLA`@HLGL[LCRIJKA[X]HIRT\\ITIAM@GKMFK?q@M?TGH?Hq@t@Sh@EEQD_@^cB?","ajC`zIxF?","ajC`zIq@??}T","gbCtlJ?hH","gbCtlJ?iH","gbC`zI?hH","gbC`zIbBA?gE","gbCjcJrN?","srBjcJ?sN","srBvsIvP?","c_CvsI?uN","c_CvsInK?","srBz`I?zQ","qnC`dIqH@","skCbdIAC{A@","keC`dIgE@","qnCvlH?hV","c_C`dIgE?","_|Bx}HcB??fE","srBx}HkH?","_|B|hH?zS","aqBz`Iq@?","srBx}H?`B","chBffHETYr@FN?LEFFPANNd@KZE?BLIRTREDI?DROVJR?FIBEHIB?XDHGLEv@OHGHDBAZO^_E??jH","srBtfH?bV","}fCllH?LNEH@JIb@NVM","cyBtfHnE?","gyBtfHB?","srBtfHp@?","{}BfjHAqKV]","efBzdHu@?","aqBtfHnBQlDB","aqBtfH?}LJGF?\\\\?cA","_~BrzFgD?","c{BjwF?fB{A?","u|AbdHMGUBUCYMUCM@e@VWBSReB?","efBzdH?aH","klBdyG?sE","{_BrhG?bGL?TSXF","klBtbG","ilBnfGA`C","klBvbG@vB","slBtaGF`@","qlBf|FEINMLA@oBzAmB","_mBj`GB_C","ibCj_F?i@TCHI","mbCrdFDcAAcB","ibCj_Fp@?PB","itBb_GD@NIJ]MUFQEYIG@KEU@CEMKGEBGC[Yu@a@JWAO]SCQQ[OM]K^o@SK","c{BjwF?qJ","c{BjwFp@?","c{BxkF|BG?aA","suBlkFCCCg@","gxBtoFGGMHFF","g`ClhFEDGTIFWBOX?vLu@?","sdC|cFbAV@A","mbCrdFjADFEJVHG","g`ClhFb@mA","qdClaFAnA","sdC|cFoAAEHBFUC[BQISAMFg@A","_eCf|E?PP`@CpB","seC`|Ee@TwDJ","}fCllHsD?MVQNQWME","}fCb|G?hO","iaC~gGCeCUa@","wrCbxGgAm@","oaCpoGiAQ","{cChzG@iJ","eyB`hGcGA","oaCpoG?qFD?","ycC~nGqAJa@Ak@IiA_@SQQ[Wr@?`@PJHPJBERKDME?TUGG?M^EAEDIbAIZSbBOJGPeAm@","{_Bl}G?_E","aqBrvG?F","klBdeJmG|IaCzDkH?","_uChrE?p@F??X`@?","ozD|aK?rn@","ozD~uJ?|J","ynCbgEPZ","m{D|hEBTJUHXJUHLZ@FIEa@B?FJP@HCHOAl@@DF?Fu@HIIo@HUJx@FA?QHCHXT\\BAFOVQAGHOASNNNAFDHC`@LPTTSFTHAFUJHFi@@AFLD?X[FYPCRh@D@JG`@TI~@AdCOREZc@|@@@FGH@^GDDSj@KLAHH@b@YHJC^H?TGPVX[P?F_@JGDMZBNFN?FWCMUEGSJKVJVAJDJE@EMEHQHEBOCI@SKKB_@`@s@FFLIK]KBWEIMSCQFY?GSQGAQLOP?HOHp@HNP]VI?JBA@ySv@?","ozDv}HwE?","ozDv}H?~W","ozD~uJ?g^","ozDvvIja@?","upD|tGxCrF|C~EzAxCxI?","ozDv}H?qU","ozDv}H`L?hT_A","wnChlJ?rEZdCFbAG|@Jt@Aj@EFk@TEP@H","wnChlJWBOHcG?","gbCtlJuD?e@IITCDI?m@a@iAe@GB[d@","klBdeJRE^QJUFCT\\NF\\@LFBHX?FEHMDCLDDR","klBdeJc@AQDe@@IDIGCOJ_@MMqA?","aqBz`I?B`M@?fJPIDK","_|B|hHJU@SJALPHA\\[FO","{}BfjHVIHMXQ","{cCnlHHIZG^UZAFKd@I`@@LI","{cCnlHQ^Oj@Al@FXSn@?lP","efBx{GFCPBBCHBJCTO\\TRTXJP@DHPAHD","klBdyGH@PT\\HDJPLL@DLN?LLDABBLGL@FERB","ooBhwGFAVXFAPL\\FJN","aqBzvGJ?DDBCDHJCHD","aqBrvGEDD@","aqBpvG?@","srBruGPCRFBRFD","e}Bv|GZDb@Kb@m@n@a@CIHa@x@TRQPc@V]RET@PK@EEAFK","{cChzGh@q@T@^XRz@N@PIZLR\\L?@B","}fCb|GHADIVB^IH[DIHA","}fCb|G]BSHSl@ST_@dAc@Bc@KIFELE?WSQg@y@?IQBOy@aC@eA","auBbrGFFNAFHH\\ZAIf@?NFHH@","eyB`hGNBFGB@Jb@AVPDVV@F\\VEPMNDHVLIXPZKVCRJDEFANJD@H","cwBdaGILQJF^@NGPDLUt@WTAX@J","_~BrzFFLREdAZZd@APJTRLLABJKHDFRJJANLDPAJ","auBbrGIDYMI@EIQSYOO@YHUImFA?]","klBprGDInHf@vCG","klBpjG?~F","kqBldGEzG@dCEXRC?jC","mqBd~F@fE","gqB`lFEbQ","{_BrhGZKNgGNC@GIIY@GGFm@","{_BrhG]H[C]DYGMKGD{@TkEh@","klBvbGRRHBP]FUh@Yp@y@^ULSl@SBGPKRCFEFS","uxB~oFDGFA","}yBzqFJWH?Pc@","qyBjwFYg@@IOSFI?QGIEUF_@XM","a`DnwFlK?FBl@S|@y@TmBJ]NMHS?IGA?I`@YBM@i@DIUgB?[FQVFHM"]};
async function getMetarTaf(station, ua) {
  const code = (station || "").trim().toUpperCase();
  if (!code) throw new Error("ICAO airport code required (e.g., KBHM, KHSV)");
  const [metarR, tafR] = await Promise.all([
    fetch(`https://aviationweather.gov/api/data/metar?ids=${code}&format=json&taf=false&hours=3`, {
      headers: { "User-Agent": ua, "Accept": "application/json" },
      cf: { cacheTtl: 300, cacheEverything: true },
      signal: upstreamSignal()
    }),
    fetch(`https://aviationweather.gov/api/data/taf?ids=${code}&format=json`, {
      headers: { "User-Agent": ua, "Accept": "application/json" },
      cf: { cacheTtl: 1800, cacheEverything: true },
      signal: upstreamSignal()
    })
  ]);
  const metar = metarR.ok ? await metarR.json().catch(() => []) : [];
  const taf = tafR.ok ? await tafR.json().catch(() => []) : [];
  return JSON.stringify({
    station: code,
    metar: (Array.isArray(metar) ? metar : []).slice(0, 3).map((m) => ({
      obsTime: m.reportTime,
      raw: m.rawOb,
      temp_c: m.temp,
      dewp_c: m.dewp,
      wdir_deg: m.wdir,
      wspd_kt: m.wspd,
      wgst_kt: m.wgst,
      visib_sm: m.visib,
      altim_hpa: m.altim,
      wxString: m.wxString,
      clouds: m.clouds
    })),
    taf: (Array.isArray(taf) ? taf : []).map((t) => ({
      issueTime: t.issueTime,
      raw: t.rawTAF,
      validFrom: t.validTimeFrom,
      validTo: t.validTimeTo
    }))
  }, null, 2);
}
__name(getMetarTaf, "getMetarTaf");
async function getStormReports(office, hours, ua) {
  const o = (office || "").trim().toUpperCase();
  const h = Math.min(Math.max(hours || 24, 1), 168);
  const url = o ? `https://mesonet.agron.iastate.edu/json/lsr.py?wfo=${o}&hours=${h}` : `https://mesonet.agron.iastate.edu/json/lsr.py?state=US&hours=${h}`;
  const data = await fetchJSON(url, ua, 300);
  const reports = (data.features || []).map((f) => {
    const p = f.properties || {};
    return {
      time: p.valid,
      event: p.typetext,
      magnitude: p.magnitude,
      city: p.city,
      county: p.county,
      state: p.st || p.state,
      remark: p.remark,
      source: p.source,
      lat: f.geometry?.coordinates?.[1],
      lon: f.geometry?.coordinates?.[0]
    };
  });
  return JSON.stringify({
    scope: o || "all US",
    hours: h,
    count: reports.length,
    reports: reports.slice(0, 60)
  }, null, 2);
}
__name(getStormReports, "getStormReports");
function getRadarImageUrl(siteCode) {
  const raw = (siteCode || "").trim().toUpperCase();
  const s = raw.startsWith("K") ? raw.slice(1) : raw;
  if (!s || s.length !== 3) throw new Error("Provide a 3-letter NEXRAD radar site code (e.g., BMX, HTX, TLX)");
  const full = `K${s}`;
  return JSON.stringify({
    site: full,
    base_reflectivity_loop: `https://radar.weather.gov/ridge/standard/${full}_loop.gif`,
    base_reflectivity_static: `https://radar.weather.gov/ridge/standard/${full}_0.gif`,
    interactive: `https://radar.weather.gov/station/${full.toLowerCase()}/standard`,
    note: "Loop GIF auto-updates every ~5 minutes. Embed _loop.gif as <img> for a live feed."
  }, null, 2);
}
__name(getRadarImageUrl, "getRadarImageUrl");
async function getAstronomy(lat, lon, ua) {
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const url = `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lon}&date=${today}&formatted=0`;
  let solar = null;
  try {
    const d = await fetchJSON(url, ua, 21600);
    solar = d?.results || null;
  } catch (e) {
    solar = { error: e.message };
  }
  const now = /* @__PURE__ */ new Date();
  const synodic = 2551443;
  const referenceNewMoon = Date.UTC(2000, 0, 6, 18, 14, 0) / 1e3;
  const elapsed = (now.getTime() / 1e3 - referenceNewMoon) % synodic;
  const phaseFrac = (elapsed < 0 ? elapsed + synodic : elapsed) / synodic;
  const phaseName = phaseFrac < 0.0625 || phaseFrac >= 0.9375 ? "New Moon" : phaseFrac < 0.1875 ? "Waxing Crescent" : phaseFrac < 0.3125 ? "First Quarter" : phaseFrac < 0.4375 ? "Waxing Gibbous" : phaseFrac < 0.5625 ? "Full Moon" : phaseFrac < 0.6875 ? "Waning Gibbous" : phaseFrac < 0.8125 ? "Last Quarter" : "Waning Crescent";
  const illumination = Math.round((1 - Math.cos(phaseFrac * 2 * Math.PI)) / 2 * 100);
  return JSON.stringify({
    point: { lat, lon },
    date: today,
    sun: solar ? {
      sunrise_UTC: solar.sunrise,
      sunset_UTC: solar.sunset,
      solar_noon_UTC: solar.solar_noon,
      day_length_seconds: solar.day_length,
      civil_twilight_begin_UTC: solar.civil_twilight_begin,
      civil_twilight_end_UTC: solar.civil_twilight_end,
      nautical_twilight_begin_UTC: solar.nautical_twilight_begin,
      nautical_twilight_end_UTC: solar.nautical_twilight_end,
      astronomical_twilight_begin_UTC: solar.astronomical_twilight_begin,
      astronomical_twilight_end_UTC: solar.astronomical_twilight_end
    } : null,
    moon: {
      phase: phaseName,
      phaseFraction: Math.round(phaseFrac * 1e3) / 1e3,
      illumination_pct: illumination
    }
  }, null, 2);
}
__name(getAstronomy, "getAstronomy");

// src/tools.ts
var TOOLS = [
  {
    type: "function",
    function: {
      name: "get_forecast",
      description: "NWS 7-day forecast (12h periods) for a lat/lon. Returns named periods (Tonight, Wednesday, Wednesday Night, ...) with temps, winds, short and detailed text. Uses /points then /gridpoints/.../forecast.",
      parameters: {
        type: "object",
        properties: {
          lat: { type: "number", description: "Latitude. Omit to use default location." },
          lon: { type: "number", description: "Longitude. Omit to use default location." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_hourly_forecast",
      description: "NWS hourly forecast for a lat/lon. Returns hourly temperature, wind, sky, precip probability. Pass `hours` to limit how many are returned.",
      parameters: {
        type: "object",
        properties: {
          lat: { type: "number" },
          lon: { type: "number" },
          hours: { type: "number", description: "Number of hours to return (default 36, max 156)." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_active_alerts",
      description: "Active NWS alerts for a lat/lon: tornado / severe thunderstorm / flash flood / winter / red flag / fire weather warnings, watches, advisories, and statements. Returns event, severity, urgency, certainty, issuance/expiry, headline, areas, and full description.",
      parameters: {
        type: "object",
        properties: {
          lat: { type: "number" },
          lon: { type: "number" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_afd",
      description: "Latest Area Forecast Discussion (AFD) from a local NWS WFO. Contains forecaster reasoning, synoptic analysis, model trends, key messages. Pass 3-letter office identifier (BMX=Birmingham, HUN=Huntsville, OUN=Norman, FWD=Fort Worth, LZK=Little Rock, MEG=Memphis, JAN=Jackson, etc).",
      parameters: {
        type: "object",
        properties: {
          office: { type: "string", description: "3-letter NWS WFO identifier" }
        },
        required: ["office"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_product",
      description: "Latest NWS text product of a given type from a specific office. Use for products beyond AFD: HWO (Hazardous Weather Outlook), PNS (Public Information Statement), LSR (Local Storm Reports), RER (Record Event Report), CLI (Climate report), NOW (Short Term Forecast), SPS (Special Weather Statement), FWF (Fire Weather Forecast), ESF (Hydrologic Outlook), HLS (Hurricane Local Statement), etc. NHC products use the storm's bin from get_nhc_tropical as the office (e.g. type TCD, office AT4): TCP public advisory, TCD forecast discussion, TCM forecast advisory, PWS wind speed probabilities.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", description: "Product type code, e.g. HWO, LSR, FWF, SPS" },
          office: { type: "string", description: "3-letter office identifier, or an NHC storm bin such as AT4 / EP2" }
        },
        required: ["type", "office"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_spc_convective_outlook",
      description: "SPC Day 1/2/3 convective outlook. Returns: full forecaster discussion text, AND the categorical risk + tornado/wind/hail probability AT the supplied lat/lon (computed via point-in-polygon against SPC GeoJSON). Categorical labels: TSTM, MRGL, SLGT, ENH, MDT, HIGH. Tornado/wind/hail return percentage + significant (hatched) flag.",
      parameters: {
        type: "object",
        properties: {
          day: { type: "number", enum: [1, 2, 3], description: "Forecast day" },
          lat: { type: "number" },
          lon: { type: "number" }
        },
        required: ["day"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_spc_day48_outlook",
      description: "SPC Day 4-8 Convective Outlook (SWOD48): the discussion of severe potential 4-8 days out, with any 15%/30% areas it describes. Use for setups multiple days out.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "get_spc_mesoscale_discussions",
      description: "List of recent SPC Mesoscale Discussions (MDs). MDs are short-fuse products discussing watch potential or ongoing severe weather over a specific area. Returns MD number, issuance time, areas, concern. Use get_spc_mesoscale_discussion to fetch full text of a specific MD.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "How many recent MDs to return (default 10, max 30)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_spc_mesoscale_discussion",
      description: "Full text of a specific SPC Mesoscale Discussion by MD number.",
      parameters: {
        type: "object",
        properties: { number: { type: "number" } },
        required: ["number"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_spc_active_watches",
      description: "Currently active SPC watches (Tornado Watch, Severe Thunderstorm Watch) nationwide. Returns event type, watch number (when available), headline, affected areas, expiry. Sourced from NWS alerts feed filtered to watch events.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "get_spc_fire_weather_outlook",
      description: "SPC fire weather outlook for Day 1 or Day 2. Returns the forecaster discussion text covering elevated / critical / extremely critical fire weather areas.",
      parameters: {
        type: "object",
        properties: { day: { type: "number", enum: [1, 2] } },
        required: ["day"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_wpc_qpf",
      description: "WPC Quantitative Precipitation Forecast discussion and excessive rainfall outlook. Covers expected rainfall amounts and flash flood risk over the next 1\u20133 days.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "get_cpc_outlook",
      description: "Climate Prediction Center 6-10 day or 8-14 day outlook: the prognostic discussion for that period, its valid dates, and CPC's temperature and precipitation category (above/near/below normal) for the point's state. Useful for medium-range pattern questions.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["6-10day", "8-14day"] },
          lat: { type: "number", description: "Latitude for the state category (defaults to the user's location)" },
          lon: { type: "number", description: "Longitude for the state category (defaults to the user's location)" }
        },
        required: ["period"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_drought_monitor",
      description: "U.S. Drought Monitor classification (None/D0/D1/D2/D3/D4) at the supplied lat/lon, plus current valid date.",
      parameters: {
        type: "object",
        properties: {
          lat: { type: "number" },
          lon: { type: "number" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_current_observations",
      description: "Most recent surface observations from the nearest NWS observation station (METAR-equivalent). Returns temperature, dewpoint, humidity, wind speed/gust/dir, visibility, barometric pressure, recent precip, heat index, wind chill. Use this for 'what is it doing RIGHT NOW' questions — do not infer current conditions from the forecast.",
      parameters: {
        type: "object",
        properties: {
          lat: { type: "number" },
          lon: { type: "number" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_air_quality",
      description: "Current AirNow air-quality readings within 25 mi of a lat/lon. Returns AQI per pollutant (O3, PM2.5, PM10) plus category (Good/Moderate/Unhealthy for Sensitive Groups/Unhealthy/Very Unhealthy/Hazardous) and reporting area. Useful for respiratory/health-sensitive planning.",
      parameters: {
        type: "object",
        properties: {
          lat: { type: "number" },
          lon: { type: "number" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_river_gauges",
      description: "USGS active stream gauges within a radius (default 25 mi) of a lat/lon. Returns latest discharge (cfs) and gauge height (ft) per site. Use for flood monitoring and creek/river status during heavy rain events.",
      parameters: {
        type: "object",
        properties: {
          lat: { type: "number" },
          lon: { type: "number" },
          radius_mi: { type: "number", description: "Search radius in miles (default 25, max 100)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_nhc_tropical",
      description: "Active tropical cyclones from the National Hurricane Center (Atlantic + East/Central Pacific), nearest first. Returns each storm's status (TD/TS/hurricane category), intensity in kt and mph, central pressure, position, motion, the full NHC forecast track (valid time, position, wind, gust, status), active watch/warning types, and relative to the given point: distance and bearing to the center now, whether the point is inside the forecast cone, and the closest forecast approach (distance, direction, time, intensity). Also names the storm's NHC bin for get_product (TCP/TCD/TCM/PWS). Empty list when no active storms. WeatherNet's live map draws each storm's cone, track and coastal watches/warnings.",
      parameters: {
        type: "object",
        properties: {
          lat: { type: "number", description: "Latitude of the point to measure from (defaults to the user's location)" },
          lon: { type: "number", description: "Longitude of the point to measure from (defaults to the user's location)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_metar_taf",
      description: "Raw METAR (current conditions) and TAF (terminal aerodrome forecast) for an ICAO airport. Returns last ~3 METARs and current TAF. Common AL airports: KBHM (Birmingham), KHSV (Huntsville), KMOB (Mobile), KMGM (Montgomery), KTCL (Tuscaloosa). Useful when an airport is closer to the user than the nearest NWS observation station.",
      parameters: {
        type: "object",
        properties: {
          station: { type: "string", description: "4-letter ICAO airport identifier, e.g. KBHM" }
        },
        required: ["station"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_local_storm_reports",
      description: "Ground truth near a point: NWS Local Storm Reports within a radius, newest first, with type (tornado, wind damage, hail, flood, rain total, gust...), magnitude, place, distance/direction from the point, source (trained spotter, emergency manager, law enforcement, public, broadcast media, social media, or automated station) and the reporter's remarks. Use whenever severe weather, flooding or damage is occurring or just occurred.",
      parameters: {
        type: "object",
        properties: {
          lat: { type: "number" },
          lon: { type: "number" },
          radius_mi: { type: "number", description: "Search radius in miles (default 50, max 250)" },
          hours: { type: "number", description: "Look-back window in hours (default 24, max 168)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_area_observations",
      description: "Readings from every surface station around a point (airports, state mesonet, co-op and rain gauges) within a radius, nearest first: temperature, dewpoint, wind and gust, today's peak gust, altimeter, 1-hour and today's rain, visibility, weather. Plus a summary (temperature/dewpoint/altimeter spread, highest gust, wettest gauges). Use to see gradients, outflow boundaries, where rain is falling and how observations compare with the forecast.",
      parameters: {
        type: "object",
        properties: {
          lat: { type: "number" },
          lon: { type: "number" },
          radius_mi: { type: "number", description: "Radius in miles (default 60, max 150)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_local_experts",
      description: "Recent X posts from local broadcast meteorologists (default: James Spann, ABC 33/40 Birmingham): their read on timing, mode and hazards, and damage or flooding reports they relay. Read only when weather is active at the point (alert, SPC Day 1 MRGL+, tropical threat, or nearby storm reports); non-weather posts are filtered out. Expert commentary, not observations.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Posts per account (default 10, max 50)" },
          include_x: { type: "boolean", description: "Read X even when nothing is active at the point. Only when the user explicitly asks for these posts — X reads are billed per post." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_storm_reports",
      description: "Local Storm Reports (LSRs) for a whole NWS WFO or nationwide. Pass office (3-letter WFO) for that office's CWA, or omit for US-wide. Hours defaults to 24 (max 168). For reports near a point, prefer get_local_storm_reports.",
      parameters: {
        type: "object",
        properties: {
          office: { type: "string", description: "3-letter NWS WFO identifier; omit for nationwide" },
          hours: { type: "number", description: "Look-back window in hours (default 24, max 168)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_radar_image_url",
      description: "Returns ready-to-display NEXRAD radar image URLs for a 3-letter site code (e.g. BMX = Birmingham AL, HTX = Huntsville AL, MXX = Maxwell AFB, EOX = Fort Rucker). Loop GIF auto-updates every ~5 min. The UI will render the loop inline.",
      parameters: {
        type: "object",
        properties: {
          site: { type: "string", description: "3-letter NEXRAD site code (with or without leading K)" }
        },
        required: ["site"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_astronomy",
      description: "Sun and moon data for a lat/lon: sunrise, sunset, solar noon, civil/nautical/astronomical twilight (all UTC), plus moon phase name, fraction, and illumination percent. Use for golden-hour, twilight planning, dark-sky, or nocturnal wildlife/storm-spotting questions.",
      parameters: {
        type: "object",
        properties: {
          lat: { type: "number" },
          lon: { type: "number" }
        }
      }
    }
  }
];
async function executeToolCall(name, input, defaultLoc, env2) {
  const ua = env2.NWS_USER_AGENT || "WeatherChatBot/1.0 (contact@example.com)";
  const lat = typeof input.lat === "number" ? input.lat : defaultLoc.lat;
  const lon = typeof input.lon === "number" ? input.lon : defaultLoc.lon;
  switch (name) {
    case "get_forecast":
      return getForecast(lat, lon, ua);
    case "get_hourly_forecast":
      return getHourlyForecast(lat, lon, input.hours || 36, ua);
    case "get_active_alerts":
      return getActiveAlerts(lat, lon, ua);
    case "get_afd":
      return getAFD(String(input.office), ua);
    case "get_product":
      return getProduct(String(input.type), String(input.office), ua);
    case "get_spc_convective_outlook":
      return getSPCConvectiveOutlook(Number(input.day), lat, lon, ua);
    case "get_spc_day48_outlook":
      return getSPCDay48Outlook(ua);
    case "get_spc_mesoscale_discussions":
      return getSPCMesoscaleDiscussions(input.limit || 10, ua);
    case "get_spc_mesoscale_discussion":
      return getSPCMesoscaleDiscussion(Number(input.number), ua);
    case "get_spc_active_watches":
      return getSPCActiveWatches(ua);
    case "get_spc_fire_weather_outlook":
      return getSPCFireWeatherOutlook(Number(input.day), ua);
    case "get_wpc_qpf":
      return getWPCQPF(ua);
    case "get_cpc_outlook":
      return getCPCOutlook(String(input.period), ua, lat, lon);
    case "get_drought_monitor":
      return getDroughtMonitor(lat, lon, ua);
    case "get_current_observations":
      return getCurrentObservations(lat, lon, ua);
    case "get_air_quality":
      return getAirQuality(lat, lon, ua, env2.AIRNOW_API_KEY);
    case "get_river_gauges":
      return getRiverGauges(lat, lon, input.radius_mi || 25, ua);
    case "get_nhc_tropical":
      return getNHCTropical(ua, lat, lon);
    case "get_metar_taf":
      return getMetarTaf(String(input.station || ""), ua);
    case "get_local_storm_reports":
      return getLocalStormReports(lat, lon, ua, input.radius_mi, input.hours);
    case "get_area_observations":
      return getAreaObservations(lat, lon, ua, input.radius_mi);
    case "get_local_experts":
      return getLocalExperts(env2, ua, lat, lon, input.limit, input.include_x === true);
    case "get_storm_reports":
      return getStormReports(input.office ? String(input.office) : "", input.hours || 24, ua);
    case "get_radar_image_url":
      return getRadarImageUrl(String(input.site || defaultLoc.office));
    case "get_astronomy":
      return getAstronomy(lat, lon, ua);
    default:
      // WeatherNet: tools registered from src/index.js (registerTools).
      if (EXTRA_TOOL_HANDLERS[name]) {
        return EXTRA_TOOL_HANDLERS[name](input, { lat, lon, loc: defaultLoc, env: env2, ua });
      }
      return `Unknown tool: ${name}`;
  }
}
__name(executeToolCall, "executeToolCall");

// WeatherNet: extra chat tools (national stories, cameras, satellite, climate
// history) live in their own modules and register here at startup, so this
// file stays close to weatherchat. `prompt` is appended to the system prompt.
var EXTRA_TOOL_HANDLERS = {};
var EXTRA_PROMPT = [];
function registerTools(schemas, handlers, prompt) {
  for (const s of schemas) {
    if (!TOOLS.some((t) => t.function.name === s.function.name)) TOOLS.push(s);
  }
  Object.assign(EXTRA_TOOL_HANDLERS, handlers);
  if (prompt && !EXTRA_PROMPT.includes(prompt)) EXTRA_PROMPT.push(prompt);
}
__name(registerTools, "registerTools");


// src/speech.ts — ElevenLabs STT (Scribe) + TTS, ported from ha-mcp-gateway.
// Same voice model and settings: Rachel (21m00Tcm4TlvDq8ikWAM) on
// eleven_flash_v2_5 @ mp3_22050_32; STT on scribe_v2 with keyterm biasing.
var STT_CONFIG = {
  model_id: "scribe_v2",
  language_code: "eng",
  temperature: "0"
};
var STT_KEYTERMS = [
  "NWS", "NOAA", "SPC", "WPC", "NHC", "AFD", "QPF", "CAPE", "GOES",
  "derecho", "bow echo", "haboob", "mesoscale", "mesocyclone", "supercell",
  "dryline", "dry slot", "virga", "wraparound", "upslope", "downslope",
  "warm front", "cold front", "squall line", "outflow boundary", "cap",
  "millibars", "radiosonde", "sounding", "water vapor"
];
var TTS_CONFIG = {
  defaultVoiceId: "21m00Tcm4TlvDq8ikWAM", // Rachel - change me once
  model_id: "eleven_flash_v2_5",
  output_format: "mp3_22050_32",
  maxChars: 900,
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0,
  use_speaker_boost: true
};
function cleanForSpeech(s) {
  if (!s) return "";
  let t = " " + String(s) + " ";
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/`([^`]*)`/g, "$1");
  t = t.replace(/\*\*(.+?)\*\*/g, "$1");
  t = t.replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1");
  t = t.replace(/https?:\/\/\S+/g, " ");
  t = t.replace(/°\s*F\b/gi, " degrees Fahrenheit ");
  t = t.replace(/°\s*C\b/gi, " degrees Celsius ");
  t = t.replace(/°/g, " degrees ");
  t = t.replace(/(\d)\s*%/g, "$1 percent ");
  t = t.replace(/\b&\b/g, " and ");
  t = t.replace(/\+/g, " plus ");
  t = t.replace(/\|/g, ", ");
  t = t.replace(/[\-–—]{3,}/g, " ");
  t = t.replace(/[#>*`_~]/g, " ");
  t = t.replace(/[⚡✓✗▶▼▲•]/g, " ");
  t = t.replace(/\n\s*[-0-9]+\.?\s*/g, ". ");
  t = t.replace(/\n+/g, ". ");
  t = t.replace(/\s{2,}/g, " ").trim();
  if (t.length > TTS_CONFIG.maxChars) {
    const cut = t.slice(0, TTS_CONFIG.maxChars);
    const dot = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    t = dot > 200 ? cut.slice(0, dot + 1) : cut;
  }
  return t;
}
__name(cleanForSpeech, "cleanForSpeech");
async function handleTranscribe(request, env2) {
  const audioBlob = await request.blob();
  if (audioBlob.size === 0) {
    return Response.json({ error: "Empty audio body" }, { status: 400 });
  }
  const ct = (request.headers.get("Content-Type") || "audio/webm").toLowerCase();
  let filename = "audio.webm";
  if (ct.includes("mp4") || ct.includes("aac") || ct.includes("m4a")) filename = "audio.m4a";
  else if (ct.includes("mpeg")) filename = "audio.mp3";
  else if (ct.includes("wav")) filename = "audio.wav";
  else if (ct.includes("ogg")) filename = "audio.ogg";
  const buildForm = (withKeyterms) => {
    const form = new FormData();
    form.append("file", audioBlob, filename);
    form.append("model_id", STT_CONFIG.model_id);
    form.append("no_verbatim", "true");
    form.append("tag_audio_events", "false");
    form.append("language_code", STT_CONFIG.language_code);
    form.append("temperature", STT_CONFIG.temperature);
    if (withKeyterms) form.append("keyterms", JSON.stringify(STT_KEYTERMS));
    return form;
  };
  const callScribe = (withKeyterms) => fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": env2.ELEVENLABS_API_KEY },
    body: buildForm(withKeyterms)
  });
  const sttStart = Date.now();
  let usedKeyterms = true;
  let elevResp = await callScribe(usedKeyterms);
  let respText = await elevResp.text();
  if (!elevResp.ok && usedKeyterms && elevResp.status >= 400 && elevResp.status < 500) {
    console.warn("transcribe: keyterms rejected (" + elevResp.status + "), retrying without");
    usedKeyterms = false;
    elevResp = await callScribe(false);
    respText = await elevResp.text();
  }
  const sttMs = Date.now() - sttStart;
  if (!elevResp.ok) {
    return Response.json({
      error: "ElevenLabs error",
      status: elevResp.status,
      body: respText.slice(0, 500),
      stt_ms: sttMs
    }, { status: 502 });
  }
  let data;
  try {
    data = JSON.parse(respText);
  } catch (e) {
    data = { text: respText };
  }
  return new Response(JSON.stringify({
    text: data.text || "",
    language_code: data.language_code,
    stt_ms: sttMs,
    keyterms: usedKeyterms ? STT_KEYTERMS.length : 0
  }), {
    headers: {
      "Content-Type": "application/json",
      "Server-Timing": "elevenlabs;dur=" + sttMs
    }
  });
}
__name(handleTranscribe, "handleTranscribe");
async function handleTTS(request, env2) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response("bad json", { status: 400 });
  }
  const text = cleanForSpeech(body.text || "").slice(0, 1000);
  if (!text) return new Response("empty", { status: 400 });
  const voiceId = body.voice || env2.ELEVENLABS_VOICE_ID || TTS_CONFIG.defaultVoiceId;
  const elevResp = await fetch(
    "https://api.elevenlabs.io/v1/text-to-speech/" + encodeURIComponent(voiceId) + "?output_format=" + TTS_CONFIG.output_format,
    {
      method: "POST",
      headers: {
        "xi-api-key": env2.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg"
      },
      body: JSON.stringify({
        text,
        model_id: TTS_CONFIG.model_id,
        voice_settings: {
          stability: TTS_CONFIG.stability,
          similarity_boost: TTS_CONFIG.similarity_boost,
          style: TTS_CONFIG.style,
          use_speaker_boost: TTS_CONFIG.use_speaker_boost
        }
      })
    }
  );
  if (!elevResp.ok || !elevResp.body) {
    const detail = await elevResp.text().catch(() => "");
    return Response.json({
      error: "ElevenLabs TTS error",
      detail: detail.slice(0, 500)
    }, { status: 502 });
  }
  const audioBuf = await elevResp.arrayBuffer();
  return new Response(audioBuf, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" }
  });
}
__name(handleTTS, "handleTTS");

// src/index.ts
var MAX_TOOL_ITERATIONS = 12;
// Model-call deadlines (see callLLM / readSSE).
var LLM_CONNECT_MS = 45e3;
var LLM_IDLE_MS = 60e3;
var LLM_BUFFERED_MS = 95e3;
var index_default = {
  async fetch(request, env2, ctx) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/chat") {
      return handleChat(request, env2, ctx);
    }
    if (request.method === "POST" && url.pathname === "/api/transcribe") {
      if (!env2.ELEVENLABS_API_KEY) {
        return Response.json({ error: "ELEVENLABS_API_KEY not configured" }, { status: 500 });
      }
      return handleTranscribe(request, env2);
    }
    if (request.method === "POST" && url.pathname === "/api/tts") {
      if (!env2.ELEVENLABS_API_KEY) {
        return Response.json({ error: "ELEVENLABS_API_KEY not configured" }, { status: 500 });
      }
      return handleTTS(request, env2);
    }
    if (request.method === "GET" && url.pathname === "/api/geocode") {
      return handleGeocode(request, env2);
    }
    if (request.method === "GET" && url.pathname === "/api/geosearch") {
      return handleGeoSearch(request, env2);
    }
    if (request.method === "GET" && url.pathname === "/api/summary") {
      return handleSummary(request, env2);
    }
    if (request.method === "GET" && url.pathname === "/api/dashboard") {
      return handleDashboard(request, env2);
    }
    if (request.method === "GET" && url.pathname === "/api/tropical") {
      return handleTropical(request, env2);
    }
    if (request.method === "GET" && url.pathname === "/api/basemap") {
      return handleBasemap();
    }
    if (request.method === "GET" && url.pathname === "/api/ground") {
      return handleGround(request, env2);
    }
    if (request.method === "GET" && url.pathname === "/api/health") {
      const p = resolveProvider(env2);
      return Response.json({
        ok: true,
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        provider: p.name,
        model: env2.MODEL || p.defaultModel,
        keyConfigured: !!p.apiKey
      });
    }
    return new Response("Not found", { status: 404 });
  }
};
function defaultLocation(env2) {
  return {
    lat: parseFloat(env2.DEFAULT_LAT || "33.21"),
    lon: parseFloat(env2.DEFAULT_LON || "-86.65"),
    office: env2.DEFAULT_OFFICE || "BMX",
    name: env2.DEFAULT_LOCATION_NAME || "Shelby County, Alabama"
  };
}
__name(defaultLocation, "defaultLocation");

// ── Meta Responses API adapter (Muse Spark) ─────────────────────────────────
// Translation only, ported from ha-mcp-gateway's src/llm-providers.js:
// canonical Chat-Completions-shaped messages/tools in, Meta Responses API
// (api.meta.ai, POST /v1/responses) request out; Responses output in,
// Chat-Completions-shaped {choices,usage} out. Keeps handleChat's tool loop
// and discussionFromModel's parsing unchanged below this line.
function chatToolsToResponsesTools(tools) {
  if (!Array.isArray(tools)) return [];
  return tools.map((t) => {
    const fn = (t && t.function) || {};
    return {
      type: "function",
      name: fn.name,
      description: fn.description,
      parameters: fn.parameters,
      // strict:true (the Responses API default) demands every property be
      // required with additionalProperties:false; TOOLS has ordinary
      // permissive schemas, so every request 400s without this.
      strict: false
    };
  });
}
__name(chatToolsToResponsesTools, "chatToolsToResponsesTools");

// System messages become `instructions` (the dedicated slot, kept out of the
// per-turn input array). Assistant turns can carry reasoning + text + tool
// calls at once, which Chat Completions packs into one message and the
// Responses API splits into separate items; `_reasoning_items` is where the
// adapter stashes the provider's own reasoning objects so they can be
// replayed verbatim next round — the model needs its prior reasoning back to
// continue a tool chain coherently.
function chatMessagesToResponsesInput(messages) {
  const input = [];
  const instructionParts = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || typeof m !== "object") continue;
    if (m.role === "system" || m.role === "developer") {
      if (typeof m.content === "string" && m.content) instructionParts.push(m.content);
      continue;
    }
    if (m.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: m.tool_call_id,
        output: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")
      });
      continue;
    }
    if (m.role === "assistant") {
      for (const item of Array.isArray(m._reasoning_items) ? m._reasoning_items : []) {
        input.push(normalizeReasoningItem(item));
      }
      const toolCalls = Array.isArray(m.tool_calls) ? m.tool_calls : [];
      if (typeof m.content === "string" && m.content.trim()) {
        const msg = {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: m.content }]
        };
        // Text preceding a function_call is intermediate commentary; the API
        // rejects it (400) replayed as an ordinary final answer. Text with no
        // call following it IS the final answer and carries no phase.
        if (toolCalls.length) msg.phase = "commentary";
        input.push(msg);
      }
      for (const tc of toolCalls) {
        input.push({
          type: "function_call",
          call_id: tc.id,
          name: tc.function && tc.function.name,
          arguments: (tc.function && tc.function.arguments) || "{}"
        });
      }
      continue;
    }
    input.push({
      type: "message",
      role: m.role || "user",
      content: [{
        type: "input_text",
        text: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")
      }]
    });
  }
  return {
    instructions: instructionParts.join("\n\n"),
    input: dropOrphanReasoning(input)
  };
}
__name(chatMessagesToResponsesInput, "chatMessagesToResponsesInput");

// A reasoning input item must carry a `summary` array even when empty; `id`
// is optional on replay since `encrypted_content` carries the state. Anything
// else is dropped — a bare id without the encrypted content is rejected as a
// missing/expired reference.
function normalizeReasoningItem(item) {
  const out = { type: "reasoning", summary: Array.isArray(item?.summary) ? item.summary : [] };
  if (item && typeof item.encrypted_content === "string") out.encrypted_content = item.encrypted_content;
  if (item && typeof item.id === "string") out.id = item.id;
  return out;
}
__name(normalizeReasoningItem, "normalizeReasoningItem");

// Every reasoning item must be immediately followed by an assistant message
// or a function_call, or the request 400s. Rather than fabricate a turn the
// model never produced, drop the orphan — allowed, and it only costs that
// turn's chain of thought.
function dropOrphanReasoning(input) {
  const out = [];
  for (let i = 0; i < input.length; i++) {
    const item = input[i];
    if (item && item.type === "reasoning") {
      const next = input[i + 1];
      const ok = next && (
        next.type === "function_call" ||
        (next.type === "message" && next.role === "assistant") ||
        next.type === "reasoning"
      );
      if (!ok) continue;
    }
    out.push(item);
  }
  // A run of reasoning items is only valid if the run itself ends in a
  // message or a call; walk backwards once to clear a trailing run.
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] && out[i].type === "reasoning") out.splice(i, 1);
    else break;
  }
  return out;
}
__name(dropOrphanReasoning, "dropOrphanReasoning");

function buildResponsesBody({ model, messages, tools, maxTokens, effort, summary, cacheKey }) {
  const { instructions, input } = chatMessagesToResponsesInput(messages);
  const body = {
    model,
    input,
    // Stateless: nothing persists on Meta's side; `include` returns the
    // encrypted reasoning blob that makes replay work without it. Cannot be
    // combined with previous_response_id.
    store: false,
    include: ["reasoning.encrypted_content"],
    parallel_tool_calls: true
  };
  if (instructions) body.instructions = instructions;
  if (Array.isArray(tools) && tools.length) body.tools = chatToolsToResponsesTools(tools);
  if (Number.isFinite(maxTokens)) body.max_output_tokens = maxTokens;
  // Muse Spark rejects effort "none" outright; omitting the block entirely is
  // the documented way to leave reasoning at the model's own default.
  if (effort && effort !== "none") {
    body.reasoning = { effort };
    // The raw chain of thought is encrypted and carries no visible text, so
    // without a summary there is nothing human-readable to show for it.
    if (summary) body.reasoning.summary = summary;
  }
  // Groups requests so the long, byte-identical system+tools prefix stays
  // warm in the provider's prompt cache. The default in-memory cache evicts
  // after short idle gaps — exactly this app's usage — and ha-mcp-gateway
  // measured cold first rounds ~600 ms slower; "24h" is a documented hint
  // (dev.meta.ai/docs/prompt-caching) to keep the prefix up to a day.
  if (cacheKey) {
    body.prompt_cache_key = cacheKey;
    body.prompt_cache_retention = "24h";
  }
  // temperature/top_p deliberately NOT set — Muse Spark is tuned for its
  // defaults (1.0/1.0) and performs best there.
  return body;
}
__name(buildResponsesBody, "buildResponsesBody");

// Responses output messages carry no `reasoning_content` (a Chat Completions
// concept) — it's synthesized here from the reasoning items' summaries. The
// tool loop reads choices[0].message and usage.{prompt,completion}_tokens, so
// normalize to exactly that; raw reasoning items are kept on
// `_reasoning_items` for replay next round.
function responsesToChatCompletion(data) {
  const output = Array.isArray(data && data.output) ? data.output : [];
  const toolCalls = [];
  const reasoningItems = [];
  const textParts = [];
  const reasoningParts = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "function_call") {
      toolCalls.push({
        id: item.call_id,
        type: "function",
        function: {
          name: item.name,
          arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {})
        }
      });
      continue;
    }
    if (item.type === "reasoning") {
      reasoningItems.push(item);
      for (const sroot of Array.isArray(item.summary) ? item.summary : []) {
        if (sroot && typeof sroot.text === "string") reasoningParts.push(sroot.text);
      }
      for (const c of Array.isArray(item.content) ? item.content : []) {
        if (c && typeof c.text === "string") reasoningParts.push(c.text);
      }
      continue;
    }
    if (item.type === "message") {
      const content = item.content;
      if (typeof content === "string") {
        textParts.push(content);
      } else {
        for (const c of Array.isArray(content) ? content : []) {
          if (c && typeof c.text === "string") textParts.push(c.text);
        }
      }
    }
  }
  let text = textParts.join("");
  if (!text && typeof data?.output_text === "string") text = data.output_text;
  const message = { role: "assistant", content: text || "" };
  if (toolCalls.length) message.tool_calls = toolCalls;
  if (reasoningParts.length) message.reasoning_content = reasoningParts.join("\n");
  if (reasoningItems.length) message._reasoning_items = reasoningItems;
  // ha-mcp-gateway's adapter always reports "stop" here (its calls rarely hit
  // the ceiling). weatherchat's summary caller relies on knowing when output
  // was cut short, so — unlike the upstream version — map the Responses
  // API's own incomplete-response signal through instead of always "stop".
  let finishReason = toolCalls.length ? "tool_calls" : "stop";
  if (!toolCalls.length && data?.status === "incomplete" && data?.incomplete_details?.reason === "max_output_tokens") {
    finishReason = "length";
  }
  const u = (data && data.usage) || {};
  return {
    choices: [{ message, finish_reason: finishReason }],
    usage: {
      prompt_tokens: u.input_tokens || 0,
      completion_tokens: u.output_tokens || 0,
      total_tokens: u.total_tokens || 0,
      prompt_tokens_details: {
        cached_tokens: (u.input_tokens_details && u.input_tokens_details.cached_tokens) || 0
      },
      completion_tokens_details: {
        reasoning_tokens: (u.output_tokens_details && u.output_tokens_details.reasoning_tokens) || 0
      }
    }
  };
}
__name(responsesToChatCompletion, "responsesToChatCompletion");

// Strip provider-internal reasoning before a message is returned to the
// client: Meta's encrypted blobs and GLM's reasoning_content are both large and
// only meaningful inside the turn that produced them.
function stripProviderInternals(message) {
  if (!message || typeof message !== "object") return message;
  const { _reasoning_items, reasoning_content, ...rest } = message;
  return rest;
}
__name(stripProviderInternals, "stripProviderInternals");

// ── Providers ───────────────────────────────────────────────────────────────
// PROVIDER picks the wire format; MODEL must be one that provider serves.
//   fireworks — Chat Completions (api.fireworks.ai). Default: GLM 5.3 Fast,
//     Fireworks' high-throughput tier of the same model. GLM reasons in the
//     open (`reasoning_content`) and its interleaved thinking needs that text
//     replayed on the assistant message within a turn, which the canonical
//     messages already carry.
//   meta — Responses API (api.meta.ai), Muse Spark; see the adapter above.
// Efforts each provider accepts; clampEffort moves anything else to the
// nearest supported level, never silently to "none".
var PROVIDERS = {
  fireworks: {
    label: "Fireworks",
    keyEnv: "FIREWORKS_API_KEY",
    url: "https://api.fireworks.ai/inference/v1/chat/completions",
    defaultModel: "accounts/fireworks/routers/glm-5p3-fast",
    chatEffort: "low",
    efforts: ["none", "low", "medium", "high", "xhigh", "max"]
  },
  meta: {
    label: "Meta Model API",
    keyEnv: "MODEL_API_KEY",
    url: "https://api.meta.ai/v1/responses",
    defaultModel: "muse-spark-1.3-contributor",
    chatEffort: "minimal",
    efforts: ["none", "minimal", "low", "medium", "high", "xhigh"]
  }
};
function resolveProvider(env2) {
  const name = String(env2.PROVIDER || "fireworks").trim().toLowerCase();
  const p = PROVIDERS[name] || PROVIDERS.fireworks;
  return { name: PROVIDERS[name] ? name : "fireworks", ...p, apiKey: env2[p.keyEnv] };
}
__name(resolveProvider, "resolveProvider");
function clampEffort(provider, effort) {
  if (!effort || provider.efforts.includes(effort)) return effort;
  const ladder = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
  const i = ladder.indexOf(effort);
  if (i === -1) return provider.chatEffort;
  for (let d = 1; d < ladder.length; d++) {
    if (ladder[i + d] && provider.efforts.includes(ladder[i + d])) return ladder[i + d];
    if (i - d > 0 && provider.efforts.includes(ladder[i - d])) return ladder[i - d];
  }
  return provider.chatEffort;
}
__name(clampEffort, "clampEffort");

// ── Upstream call, optionally streamed ──────────────────────────────────────
// One entry point for both providers. With hooks.onDelta it asks for the
// provider's SSE stream so answer text reaches the browser token by token;
// without, the plain buffered call. Resolves to { ok, resp } where resp is
// Chat-Completions-shaped ({ choices:[{message, finish_reason}], usage }), or
// { ok:false, status, errText }. Every way a stream can misbehave degrades to
// the buffered call rather than breaking chat: a 4xx on the streamed request,
// a JSON body where SSE was asked for, or a stream that ends without a usable
// result. A fallback that then succeeds turns streaming off for that provider
// for the rest of the isolate's life. (Meta's streaming was unverified live
// when this was written; Fireworks' is documented, but gets the same net.)
var streamDisabled = { fireworks: false, meta: false };
async function callLLM(provider, req, hooks) {
  const onDelta = hooks && hooks.onDelta;
  const wantStream = typeof onDelta === "function" && !streamDisabled[provider.name];
  const isMeta = provider.name === "meta";
  const payload = isMeta ? buildResponsesBody(req) : buildChatBody(req);
  const headers = {
    "Authorization": `Bearer ${provider.apiKey}`,
    "Content-Type": "application/json"
  };
  // Fireworks routes a session to the same replica (and its prompt cache) by
  // this header — the counterpart of Meta's prompt_cache_key.
  if (!isMeta && req.cacheKey) headers["x-session-affinity"] = req.cacheKey;
  // A stalled provider must end the turn with an error, not hang it: a
  // stream has LLM_CONNECT_MS to answer (then readSSE's idle watchdog takes
  // over); a buffered call, which only answers once generation is done, gets
  // the whole window Cloudflare allows a silent response.
  const ac = new AbortController();
  const deadline = wantStream ? LLM_CONNECT_MS : LLM_BUFFERED_MS;
  const timer = setTimeout(() => ac.abort(), deadline);
  const timedOut = /* @__PURE__ */ __name(() => ({ ok: false, status: 504, errText: `${provider.label} did not answer within ${deadline / 1e3} s` }), "timedOut");
  let r;
  try {
    r = await fetch(provider.url, {
      method: "POST",
      headers,
      body: JSON.stringify(wantStream ? { ...payload, stream: true } : payload),
      signal: ac.signal
    });
  } catch (e) {
    clearTimeout(timer);
    if (ac.signal.aborted) return timedOut();
    throw e;
  }
  const fallback = /* @__PURE__ */ __name(async () => {
    const res = await callLLM(provider, req, null);
    if (res.ok) streamDisabled[provider.name] = true;
    return res;
  }, "fallback");
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    clearTimeout(timer);
    // A client error the buffered request could avoid (400/406/415/422…);
    // auth and rate limits would fail the same way, so don't double them.
    if (wantStream && r.status >= 400 && r.status < 500 && ![401, 403, 429].includes(r.status)) return fallback();
    return { ok: false, status: r.status, errText };
  }
  const ct = r.headers.get("content-type") || "";
  if (!wantStream || !ct.includes("text/event-stream") || !r.body) {
    let data;
    try {
      data = await r.json();
    } catch (e) {
      if (ac.signal.aborted) return timedOut();
      throw e;
    } finally {
      clearTimeout(timer);
    }
    return { ok: true, resp: isMeta ? responsesToChatCompletion(data) : data };
  }
  clearTimeout(timer);
  let emitted = false;
  let resp = null;
  try {
    const forward = /* @__PURE__ */ __name((t) => {
      emitted = true;
      onDelta(t);
    }, "forward");
    if (isMeta) {
      const data = await readResponsesStream(r.body, forward);
      resp = data ? responsesToChatCompletion(data) : null;
    } else {
      resp = await readChatStream(r.body, forward);
    }
  } catch (e) {
    // An in-stream error event is the provider refusing the request — surface
    // it like any other upstream error instead of retrying. A stalled stream
    // isn't retried either: the buffered fallback would wait all over again.
    if (e && e.upstream) return { ok: false, status: 502, errText: e.message };
    if (e && e.stalled) return { ok: false, status: 504, errText: e.message };
    resp = null;
  }
  if (resp) return { ok: true, resp };
  if (emitted && hooks.onReset) hooks.onReset();
  return fallback();
}
__name(callLLM, "callLLM");

// Chat Completions request body (Fireworks). No temperature/top_p: Fireworks
// applies the model's own published sampling defaults when they're omitted.
function buildChatBody({ model, messages, tools, maxTokens, effort }) {
  const body = {
    model,
    messages: messages.map((m) => {
      if (!m || m.role !== "assistant" || !m._reasoning_items) return m;
      const { _reasoning_items, ...rest } = m;
      return rest;
    })
  };
  if (Array.isArray(tools) && tools.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  if (Number.isFinite(maxTokens)) body.max_tokens = maxTokens;
  if (effort) body.reasoning_effort = effort;
  return body;
}
__name(buildChatBody, "buildChatBody");

// Yields each SSE event's parsed `data:` JSON. Tolerates \n or \r\n framing
// and events split across network chunks; skips `[DONE]` and non-JSON lines.
async function readSSE(body, onEvent, idleMs = LLM_IDLE_MS) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  // Idle watchdog: a provider that opens the stream and then goes silent
  // would otherwise hold the turn open forever.
  const read = /* @__PURE__ */ __name(() => {
    let t;
    return Promise.race([
      reader.read().finally(() => clearTimeout(t)),
      new Promise((_, rej) => {
        t = setTimeout(() => {
          const err = new Error(`model stream stalled (nothing for ${idleMs / 1e3} s)`);
          err.stalled = true;
          rej(err);
        }, idleMs);
      })
    ]);
  }, "read");
  const handle = /* @__PURE__ */ __name((block) => {
    const data = block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
    if (!data || data === "[DONE]") return;
    let ev;
    try {
      ev = JSON.parse(data);
    } catch {
      return;
    }
    onEvent(ev);
  }, "handle");
  try {
    for (;;) {
      const { value, done } = await read();
      if (value) buf += decoder.decode(value, { stream: true });
      let m;
      while (m = /\r?\n\r?\n/.exec(buf)) {
        const block = buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
        handle(block);
      }
      if (done) break;
    }
    if (buf.trim()) handle(buf);
  } catch (e) {
    try {
      await reader.cancel();
    } catch {
    }
    throw e;
  }
}
__name(readSSE, "readSSE");
function upstreamError(msg) {
  const err = new Error(msg || "stream error");
  err.upstream = true;
  return err;
}
__name(upstreamError, "upstreamError");

// Chat Completions stream → one Chat-Completions response. Content deltas are
// forwarded as they arrive; reasoning_content is accumulated (it must be
// replayed next round) but never shown; tool calls arrive as index-keyed
// fragments — id and name once, arguments piecewise. A stream that never
// reports a finish_reason was cut off, so it's treated as unusable (null).
async function readChatStream(body, onDelta) {
  let content = "";
  let reasoning = "";
  let finish = null;
  let usage = null;
  const calls = [];
  await readSSE(body, (ev) => {
    if (ev && ev.error) throw upstreamError(ev.error.message || String(ev.error));
    if (ev && ev.usage) usage = ev.usage;
    const ch = ev && Array.isArray(ev.choices) ? ev.choices[0] : null;
    if (!ch) return;
    const d = ch.delta || {};
    if (typeof d.content === "string" && d.content) {
      content += d.content;
      onDelta(d.content);
    }
    if (typeof d.reasoning_content === "string") reasoning += d.reasoning_content;
    for (const tc of Array.isArray(d.tool_calls) ? d.tool_calls : []) {
      const i = Number.isInteger(tc.index) ? tc.index : calls.length;
      const slot = calls[i] || (calls[i] = { id: "", type: "function", function: { name: "", arguments: "" } });
      if (tc.id) slot.id = tc.id;
      if (tc.function && tc.function.name) slot.function.name = tc.function.name;
      if (tc.function && typeof tc.function.arguments === "string") slot.function.arguments += tc.function.arguments;
    }
    if (ch.finish_reason) finish = ch.finish_reason;
  });
  if (!finish) return null;
  const toolCalls = calls.filter(Boolean);
  const message = { role: "assistant", content };
  if (toolCalls.length) message.tool_calls = toolCalls;
  if (reasoning) message.reasoning_content = reasoning;
  return { choices: [{ message, finish_reason: finish }], usage: usage || {} };
}
__name(readChatStream, "readChatStream");

// Responses API typed stream → the raw Responses object. Text deltas are
// forwarded; the authoritative result is `response.completed`'s full response
// (reasoning items with encrypted_content included, so replay works exactly
// as in buffered mode). If the stream ends without one, the finished output
// items are reassembled into the same shape; null means nothing usable.
async function readResponsesStream(body, onDelta) {
  const items = [];
  let final = null;
  await readSSE(body, (ev) => {
    const type = ev && ev.type;
    if (type === "response.output_text.delta" && typeof ev.delta === "string") {
      onDelta(ev.delta);
    } else if (type === "response.output_item.done" && ev.item) {
      if (Number.isInteger(ev.output_index)) items[ev.output_index] = ev.item;
      else items.push(ev.item);
    } else if ((type === "response.completed" || type === "response.incomplete" || type === "response.done") && ev.response) {
      final = ev.response;
    } else if (type === "response.failed" || type === "error") {
      throw upstreamError(ev.response?.error?.message || ev.error?.message || ev.message);
    }
  });
  const collected = items.filter(Boolean);
  if (final) {
    if ((!Array.isArray(final.output) || !final.output.length) && collected.length) final = { ...final, output: collected };
    return final;
  }
  return collected.length ? { output: collected, status: "completed" } : null;
}
__name(readResponsesStream, "readResponsesStream");

// `/api/chat` answers in one of two shapes. Plain JSON (the original contract)
// unless the body says `stream: true`, in which case it's text/event-stream:
// `data: {type, ...}` events as the turn progresses —
//   delta  {text}             answer text as the model writes it
//   reset  {}                 discard streamed text (it was commentary before
//                             a tool call, not the answer)
//   tools  {calls:[{name,input}]}  a round of tool calls starting
//   tool   {trace entry}      one tool finished
//   done   {response, trace, stop_reason, usage}   final, authoritative
//   error  {error, details?, trace}
// Errors before the loop starts (bad JSON, no API key) stay plain JSON with a
// status code in both modes.
async function handleChat(request, env2, ctx) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const provider = resolveProvider(env2);
  if (!provider.apiKey) {
    return Response.json({
      error: `${provider.keyEnv} is not configured.`,
      details: `Set it with: wrangler secret put ${provider.keyEnv}`
    }, { status: 500 });
  }
  if (body.stream !== true) {
    const { status, payload } = await runChatLoop(body, env2, null);
    return Response.json(payload, { status });
  }
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  let closed = false;
  const send = /* @__PURE__ */ __name((obj) => {
    if (closed) return;
    // A rejected write means the browser went away; stop spending model calls.
    writer.write(enc.encode("data: " + JSON.stringify(obj) + "\n\n")).catch(() => {
      closed = true;
    });
  }, "send");
  // An SSE comment every 15 s while the turn runs: long tool rounds and
  // reasoning otherwise send nothing, and the browser's stall watchdog can't
  // tell a slow turn from a dead connection.
  const ping = setInterval(() => {
    if (closed) return;
    writer.write(enc.encode(": ping\n\n")).catch(() => {
      closed = true;
    });
  }, 15e3);
  const done = (async () => {
    try {
      const { status, payload } = await runChatLoop(body, env2, { send, isClosed: () => closed });
      // `messages` (full history incl. raw tool output) is only useful to
      // non-browser callers; the UI keeps its own history.
      const { messages: _omit, ...rest } = payload;
      send({ type: status === 200 ? "done" : "error", ...rest });
    } catch (e) {
      send({ type: "error", error: e.message });
    } finally {
      clearInterval(ping);
      closed = true;
      try {
        await writer.close();
      } catch {
      }
    }
  })();
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(done);
  return new Response(readable, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no"
    }
  });
}
__name(handleChat, "handleChat");

// The agent loop shared by both response shapes. `stream` is null for plain
// JSON, else { send, isClosed } for progress events. Resolves to
// { status, payload } — the payload is exactly the old JSON response body.
async function runChatLoop(body, env2, stream) {
  const userTurns = Array.isArray(body.messages) ? body.messages : [];
  const location = { ...defaultLocation(env2), ...body.location || {} };
  const provider = resolveProvider(env2);
  const model = body.model || env2.MODEL || provider.defaultModel;
  const messages = [
    { role: "system", content: buildSystemPrompt(location) },
    ...userTurns
  ];
  const trace3 = [];
  const send = stream ? stream.send : () => {
  };
  // Each tool round is its own model call, so reasoning depth is paid for
  // several times per turn. Per-provider default: "low" on GLM 5.3 (Fireworks
  // has no "minimal"), "minimal" on Muse Spark (ha-mcp-gateway's Quick tier).
  // REASONING_EFFORT overrides, clamped to what the provider accepts.
  const reasoningEffort = clampEffort(provider, env2.REASONING_EFFORT || provider.chatEffort);
  const maxTokens = parseInt(env2.MAX_TOKENS || "8192", 10);
  const cacheKey = "weatherchat-chat-" + (location.office || "default");
  const history = /* @__PURE__ */ __name(() => messages.slice(1).map((m) => m.role === "assistant" ? stripProviderInternals(m) : m), "history");
  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      if (stream && stream.isClosed()) {
        return { status: 499, payload: { error: "Client disconnected", trace: trace3 } };
      }
      // No reasoning.summary (Meta): it was only ever wanted for a reasoning
      // panel this UI doesn't have, and "detailed" costs output tokens.
      const req = {
        model,
        messages,
        tools: TOOLS,
        maxTokens,
        effort: reasoningEffort,
        cacheKey
      };
      let streamed = false;
      const up = await callLLM(provider, req, stream ? {
        onDelta: (t) => {
          streamed = true;
          send({ type: "delta", text: t });
        },
        onReset: () => {
          streamed = false;
          send({ type: "reset" });
        }
      } : null);
      if (!up.ok) {
        return {
          status: 502,
          payload: {
            error: `${provider.label} error (HTTP ${up.status})`,
            details: String(up.errText || "").slice(0, 1000),
            trace: trace3
          }
        };
      }
      const resp = up.resp;
      const choice = resp?.choices?.[0];
      if (!choice) {
        return { status: 502, payload: { error: "No choice in AI response", raw: resp, trace: trace3 } };
      }
      const msg = choice.message;
      const finishReason = choice.finish_reason;
      const assistantMsg = {
        role: "assistant",
        content: msg.content ?? null
      };
      if (msg.tool_calls && msg.tool_calls.length) {
        assistantMsg.tool_calls = msg.tool_calls;
      }
      // Kept only so the next round can replay it — Meta's encrypted
      // reasoning items, GLM's interleaved-thinking text. Stripped before any
      // response leaves this function (stripProviderInternals) so neither
      // reaches the client or gets resent as history on the next turn.
      if (msg._reasoning_items) {
        assistantMsg._reasoning_items = msg._reasoning_items;
      }
      if (provider.name !== "meta" && msg.reasoning_content) {
        assistantMsg.reasoning_content = msg.reasoning_content;
      }
      messages.push(assistantMsg);
      const hasToolCalls = msg.tool_calls && msg.tool_calls.length > 0;
      if (!hasToolCalls || finishReason !== "tool_calls" && finishReason !== "function_call") {
        return {
          status: 200,
          payload: {
            response: typeof msg.content === "string" ? msg.content : "",
            messages: history(),
            // drop system on return
            trace: trace3,
            stop_reason: finishReason,
            usage: resp.usage
          }
        };
      }
      // Text streamed this round preceded a tool call — commentary, not the
      // answer — so the client clears it before the tools run.
      if (streamed) send({ type: "reset" });
      const parsed = msg.tool_calls.map((tc) => {
        const name = tc.function?.name;
        let args = {};
        let argErr = null;
        try {
          args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch (e) {
          args = {};
          argErr = e;
        }
        return { tc, name, args, argErr };
      });
      send({ type: "tools", calls: parsed.map((p) => ({ name: p.name, input: p.args })) });
      const results = await Promise.all(
        parsed.map(async ({ tc, name, args, argErr }) => {
          if (argErr) {
            const entry2 = { name, error: `Invalid JSON args: ${argErr.message}`, ok: false };
            trace3.push(entry2);
            send({ type: "tool", ...entry2 });
          }
          const started = Date.now();
          try {
            const out = await executeToolCall(name, args, location, env2);
            const text = typeof out === "string" ? out : JSON.stringify(out);
            const entry = {
              name,
              input: args,
              ms: Date.now() - started,
              preview: text.slice(0, 280),
              ok: true
            };
            trace3.push(entry);
            send({ type: "tool", ...entry });
            return {
              role: "tool",
              tool_call_id: tc.id,
              content: text
            };
          } catch (e) {
            const entry = { name, input: args, ms: Date.now() - started, error: e.message, ok: false };
            trace3.push(entry);
            send({ type: "tool", ...entry });
            return {
              role: "tool",
              tool_call_id: tc.id,
              content: `Error: ${e.message}`
            };
          }
        })
      );
      for (const r of results) messages.push(r);
    }
    return {
      status: 500,
      payload: {
        error: "Hit max tool iterations",
        trace: trace3,
        messages: history()
      }
    };
  } catch (e) {
    return { status: 500, payload: { error: e.message, stack: e.stack, trace: trace3 } };
  }
}
__name(runChatLoop, "runChatLoop");
async function handleGeocode(request, env2) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return Response.json({ error: "missing q" }, { status: 400 });
  const ua = env2.NWS_USER_AGENT || "WeatherChatBot/1.0 (contact@example.com)";
  let lat = null, lon = null, matchedAddress = null, source = null;
  const errors = [];
  try {
    const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1`;
    const r = await fetch(photonUrl, {
      headers: { "User-Agent": ua, "Accept": "application/json" },
      cf: { cacheTtl: 86400, cacheEverything: true },
      signal: upstreamSignal()
    });
    if (r.ok) {
      const data = await r.json();
      const f = data?.features?.[0];
      if (f?.geometry?.coordinates) {
        lon = f.geometry.coordinates[0];
        lat = f.geometry.coordinates[1];
        const pp = f.properties || {};
        matchedAddress = [pp.name, pp.city, pp.state, pp.country].filter(Boolean).join(", ") || pp.name;
        source = "photon";
      } else {
        errors.push("photon: no results");
      }
    } else {
      errors.push(`photon: HTTP ${r.status}`);
    }
  } catch (e) { errors.push(`photon: ${e.message}`); }
  if (lat == null) {
    try {
      const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
      const r = await fetch(nomUrl, {
        headers: { "User-Agent": ua, "Accept": "application/json", "Accept-Language": "en" },
        cf: { cacheTtl: 86400, cacheEverything: true },
        signal: upstreamSignal()
      });
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data) && data[0]) {
          lat = parseFloat(data[0].lat);
          lon = parseFloat(data[0].lon);
          matchedAddress = data[0].display_name;
          source = "nominatim";
        } else {
          errors.push("nominatim: no results");
        }
      } else {
        errors.push(`nominatim: HTTP ${r.status}`);
      }
    } catch (e) { errors.push(`nominatim: ${e.message}`); }
  }
  if (lat == null) {
    try {
      const censusUrl = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`;
      const r = await fetch(censusUrl, {
        headers: { "User-Agent": ua, "Accept": "application/json" },
        cf: { cacheTtl: 86400, cacheEverything: true },
        signal: upstreamSignal()
      });
      if (r.ok) {
        const data = await r.json();
        const match = data?.result?.addressMatches?.[0];
        if (match?.coordinates) {
          lon = match.coordinates.x;
          lat = match.coordinates.y;
          matchedAddress = match.matchedAddress;
          source = "census";
        } else {
          errors.push("census: no matches (street-address only)");
        }
      } else {
        errors.push(`census: HTTP ${r.status}`);
      }
    } catch (e) { errors.push(`census: ${e.message}`); }
  }
  if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) {
    return Response.json({
      error: `Could not geocode '${q}'. Try a more specific query like 'Madison, AL' or a full street address.`,
      tried: errors
    }, { status: 404 });
  }
  let office = null, displayName = matchedAddress;
  try {
    const la = Math.round(lat * 1e4) / 1e4;
    const lo = Math.round(lon * 1e4) / 1e4;
    const pt = await nwsJSON(`https://api.weather.gov/points/${la},${lo}`, ua, 86400);
    office = pt.properties?.gridId || null;
    const city = pt.properties?.relativeLocation?.properties?.city;
    const state2 = pt.properties?.relativeLocation?.properties?.state;
    if (city && state2) displayName = `${city}, ${state2}`;
  } catch (e) {
    return Response.json({
      lat, lon, matchedAddress, source,
      warning: "Outside NWS coverage (US only) — lat/lon set but no WFO/forecast available",
      office: null
    });
  }
  return Response.json({
    lat: Math.round(lat * 1e4) / 1e4,
    lon: Math.round(lon * 1e4) / 1e4,
    office,
    displayName,
    matchedAddress,
    source
  });
}
__name(handleGeocode, "handleGeocode");
async function handleGeoSearch(request, env2) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2) return Response.json({ results: [] });
  const ua = env2.NWS_USER_AGENT || "WeatherChatBot/1.0 (contact@example.com)";
  let results = [];
  try {
    const photonUrl = `https://photon.komoot.io/api/?limit=8&lang=en&q=${encodeURIComponent(q)}`;
    const data = await fetchJSON(photonUrl, ua, 3600);
    results = (data?.features || []).map((f) => {
      const p = f.properties || {};
      const c = f.geometry?.coordinates || [];
      const name = p.name || [p.housenumber, p.street].filter(Boolean).join(" ") || p.city || "";
      const locality = p.city || p.county || p.district || p.locality || "";
      const region = p.state || "";
      const cc = (p.countrycode || "").toUpperCase();
      const labelParts = [name, locality && locality !== name ? locality : null, region, cc && cc !== "US" ? cc : null].filter(Boolean);
      return { label: labelParts.join(", ") || name, lat: c[1], lon: c[0], city: locality || name, state: region, country: cc };
    }).filter((r) => r.lat != null && r.lon != null && r.label);
    const us = results.filter((r) => r.country === "US" || r.country === "");
    if (us.length) results = us;
  } catch (e) {
    results = [];
  }
  if (!results.length) {
    try {
      const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=8&countrycodes=us&q=${encodeURIComponent(q)}`;
      const data = await fetchJSON(nomUrl, ua, 3600);
      results = (Array.isArray(data) ? data : []).map((d) => {
        const a = d.address || {};
        const city = a.city || a.town || a.village || a.hamlet || a.county || "";
        return { label: d.display_name, lat: parseFloat(d.lat), lon: parseFloat(d.lon), city, state: a.state || "", country: "US" };
      }).filter((r) => !isNaN(r.lat) && !isNaN(r.lon));
    } catch (e) {
    }
  }
  return Response.json({ results: results.slice(0, 6) });
}
__name(handleGeoSearch, "handleGeoSearch");
async function spcCategoricalAtPoint(day, lat, lon, ua) {
  const gj = await fetchSPCLayer(`https://www.spc.noaa.gov/products/outlook/day${day}otlk_cat.lyr.geojson`, ua);
  if (!gj) return null;
  return findHighestRiskAtPoint(gj, [lon, lat]);
}
__name(spcCategoricalAtPoint, "spcCategoricalAtPoint");
async function spcDay1AtPoint(lat, lon, ua) {
  const pt = [lon, lat];
  const base = "https://www.spc.noaa.gov/products/outlook/day1otlk";
  const layerUrls = {
    categorical: `${base}_cat.lyr.geojson`,
    tornado: `${base}_torn.lyr.geojson`,
    wind: `${base}_wind.lyr.geojson`,
    hail: `${base}_hail.lyr.geojson`
  };
  const entries = await Promise.all(
    Object.entries(layerUrls).map(async ([k, url]) => [k, await fetchSPCLayer(url, ua)])
  );
  const atPoint = {};
  for (const [k, gj] of entries) {
    const hit = gj ? findHighestRiskAtPoint(gj, pt) : null;
    if (k === "categorical") {
      atPoint.categorical = hit ? { label: hit.label, rank: hit.rank } : { label: "none", rank: 0 };
    } else {
      atPoint[k] = hit ? { probability: `${hit.label}%`, significant: hit.sig } : null;
    }
  }
  return atPoint;
}
__name(spcDay1AtPoint, "spcDay1AtPoint");
function briefPeriod(p) {
  if (!p) return null;
  return { name: p.name, isDaytime: p.isDaytime, temp: p.temp, sky: p.short, precipPct: p.pop };
}
__name(briefPeriod, "briefPeriod");
function nextPrecipWindow(periods) {
  for (const p of periods || []) {
    if (p && p.precipPct != null && p.precipPct > 0) {
      return { period: p.name, pct: p.precipPct };
    }
  }
  return null;
}
__name(nextPrecipWindow, "nextPrecipWindow");
function localTimeInfo(tz) {
  const now = /* @__PURE__ */ new Date();
  let hour = now.getUTCHours();
  let timeStr = null;
  try {
    timeStr = new Intl.DateTimeFormat("en-US", {
      timeZone: tz || "UTC",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short"
    }).format(now);
    const h = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", hour: "numeric", hour12: false }).format(now), 10);
    if (Number.isFinite(h)) hour = h % 24;
  } catch (e) {
  }
  let partOfDay;
  if (hour < 5) partOfDay = "overnight";
  else if (hour < 12) partOfDay = "morning";
  else if (hour < 17) partOfDay = "afternoon";
  else if (hour < 21) partOfDay = "evening";
  else partOfDay = "night";
  return { hour, timeStr, partOfDay };
}
__name(localTimeInfo, "localTimeInfo");
function deterministicSummary(brief, spcLabel) {
  const parts = [];
  const ps = brief.periods || [];
  for (let i = 0; i < Math.min(3, ps.length); i++) {
    const p = ps[i];
    if (!p) continue;
    let s = `${p.name || (p.isDaytime ? "Day" : "Night")} ${p.temp || ""}`.trim();
    if (p.sky) s += ", " + p.sky;
    if (p.precipPct != null && p.precipPct >= 20) s += ` (${p.precipPct}% precip)`;
    parts.push(s);
  }
  if (spcLabel && spcLabel !== "none") parts.push(`SPC ${spcLabel} risk`);
  const npc = brief.nextPrecipChance;
  parts.push(npc ? `next rain chance ${npc.period} (${npc.pct}%)` : "no measurable rain chance in the outlook given");
  return parts.filter(Boolean).join(" \xB7 ");
}
__name(deterministicSummary, "deterministicSummary");
// ── Home-screen forecast discussion ─────────────────────────────────────────
// Every app open shows an original discussion written from essentially all
// the data the chat agent can reach, gathered in parallel here rather than via
// tool calls (one model call, no agent rounds). The model is asked to
// synthesize — weigh the gridded forecast against the WFO's AFD, SPC, WPC —
// not to paraphrase any one product, and it reasons at high effort: the result
// is edge-cached per location per hour and the client keeps the previous
// discussion on screen while a new one generates, so depth costs no visible
// wait on most opens.
var DISCUSSION_SYS = `You are the forecaster on shift, writing the forecast discussion for ONE weather-literate reader at one point location. It is the first thing on the home screen of their weather app. After these instructions come labeled data sections: surface observations and how they compare with the gridded forecast for this hour; the other surface stations within 50 miles; NWS local storm reports within 50 miles over the last 24 hours; the NWS point forecast (7 days); a 72-hour, 3-hourly table from the NWS gridded forecast, with the window it covers; active alerts; the local WFO's Area Forecast Discussion (AFD) with its issuance time; SPC convective outlooks (days 1-3 with the category and probabilities AT THE POINT plus the national text, days 4-8, active watches, mesoscale discussions); WPC QPF and excessive-rainfall discussions; NHC active tropical systems; drought status; CPC 6-10 and 8-14 day outlooks; air quality; sun and moon. UNAVAILABLE names sources that failed — never mention them.

HOW TO WORK, before you write:
1. Pattern: establish the synoptic setup and how it evolves from what the AFD, SPC and WPC text actually say.
2. Point detail: scan the grid table for what changes — dewpoint and moisture trend, wind shifts, POP ramps, QPF timing, apparent temperature. Note where its window ends; beyond it only the point forecast and the discussions speak.
3. Cross-check: compare the point forecast and grid against the AFD, SPC and WPC — timing, coverage, amounts, risk. Weigh product age: newer data outranks an older discussion on timing.
4. Now: read the observed-versus-forecast comparison. A departure of about 3\xB0F or more in temperature or dewpoint is worth a sentence on what it may mean for today.
5. Decide the one or two things that matter most to this reader over the coming week and build the discussion around them.
6. Before finishing, verify each of these and fix what fails: every number matches the data and sits in its exact period (Saturday is not Saturday Night); every synoptic feature is named by a supplied product; there is no HAZARDS paragraph unless a real hazard signal exists; and the total is under 380 words — if it isn't, cut the least important sentences.

WHAT TO WRITE — plain text only: no markdown, bullets, tables, headers or links.
- Line 1 is a single headline sentence: the governing pattern and the operative story. The app renders it bold, so it must stand on its own.
- Then short paragraphs separated by one blank line, each opening with an uppercase label followed by " — ", in this order:
  NOW — observed conditions and any departure from the forecast. Observations only; no forecast content.
  NEAR TERM — the rest of today and tonight.
  SHORT TERM — the next two to three days.
  EXTENDED — day 4 onward: how the pattern evolves and the trend, not a day-by-day list.
  HAZARDS — only when there is an actual hazard signal: an alert, an SPC severe risk (MRGL or higher) or WPC excessive-rainfall risk at or near the point, or a real heat, wind, fire-weather, tropical or air-quality concern. A general-thunder (TSTM) area or a "no severe expected" statement is not a hazard signal — mention it in the period paragraph where it applies. Otherwise omit the paragraph entirely; never write one to say there are no hazards.
  CONFIDENCE — one or two sentences: what could bust the forecast, and in which direction.
- Aim for 260 to 340 words; 380 is a hard ceiling. Always end on a complete sentence.

EVIDENCE RULES — these override everything else:
- Every number must appear in the supplied data exactly as given. Do not round (26 percent stays 26, not 30), average, or estimate new values.
- Tie each point-forecast value to its exact period: "Saturday" and "Saturday Night" are different periods with different numbers.
- Name a synoptic feature (shortwave, trough, ridge, low, front, jet) only if a supplied product names it, and place it where that product places it. Processes the grid plainly shows — moisture return, diurnal heating, a wind shift — may be stated without a product naming them.
- Describe a trend only where the data shows more than one value: a single pressure reading is not "steady" or "falling".
- No climatological claims — normals, records, "first of the season", "unusually" — because no climatology is supplied.
- When a claim rests on one product, attribute it briefly ("the AFD", "SPC", "WPC"); don't attribute what every source agrees on.
- Where sources disagree, name the disagreement and say which way you lean and why. That is the most valuable sentence you can write.
- Anchor to the given local time and part of day: never describe a period that has ended as current or upcoming; in the evening or overnight the day's high is over.

STYLE: the register of an NWS Area Forecast Discussion, for an expert reader. Name convective coverage precisely (isolated / scattered / numerous) and mode (pulse or diurnal vs organized) when convection is in play; name SPC and WPC categories when the point is in one. Spend words on what changes, not on what stays the same. Explain what a feature does to the weather at the point — the mechanism, then the effect — rather than just saying weather arrives. Do not restate the location name, the observing station's name, or the clock time. No preamble, no sign-off.`;

// Race a source against a deadline so one slow upstream can't hold the
// discussion hostage; a timed-out source is just reported as unavailable.
function withTimeout(p, ms, label) {
  let t;
  return Promise.race([
    Promise.resolve(p).finally(() => clearTimeout(t)),
    new Promise((_, rej) => {
      t = setTimeout(() => rej(new Error(`${label} timed out`)), ms);
    })
  ]);
}
__name(withTimeout, "withTimeout");
function capText(s, n) {
  if (s == null) return null;
  s = String(s).trim();
  return s.length > n ? s.slice(0, n) + "\n[…truncated]" : s;
}
__name(capText, "capText");

// 72 hours of the gridded forecast at 3-hour steps, labeled in local time:
// the only source with dewpoint, apparent temperature, gusts and QPF on one
// time axis. QPF is summed over each step (qpf_in is already a per-hour
// share of each accumulation interval, so summing it never double-counts);
// POP is the step's max.
function gridTable(series, tz) {
  if (!series || !Array.isArray(series.times)) return null;
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", weekday: "short", hour: "numeric", hour12: true });
  const n = Math.min(series.times.length, 72);
  const cell = (v) => v == null ? "-" : String(Math.round(v));
  const lines = [
    `Window: ${fmt.format(new Date(series.times[0]))} to ${fmt.format(new Date(series.times[n - 1]))} local; later periods appear only in the point forecast.`.replace(/\s+/g, " "),
    "time      T  Td  AT  RH POP sky wind(dir) gust  QPF3h"
  ];
  let qpf72 = 0;
  for (let i = 0; i < n; i++) qpf72 += series.qpf_in[i] || 0;
  for (let i = 0; i < n; i += 3) {
    let q = 0, pop = null;
    for (let j = i; j < Math.min(i + 3, n); j++) {
      q += series.qpf_in[j] || 0;
      if (series.pop[j] != null && (pop == null || series.pop[j] > pop)) pop = series.pop[j];
    }
    lines.push([
      fmt.format(new Date(series.times[i])).replace(/\s+/g, " "),
      cell(series.temp_F[i]), cell(series.dewpoint_F[i]), cell(series.apparent_F[i]), cell(series.rh[i]),
      cell(pop), cell(series.sky[i]),
      `${cell(series.wind_mph[i])}(${cell(series.windDir[i])}\xB0)`, cell(series.gust_mph[i]),
      q.toFixed(2)
    ].join("  "));
  }
  lines.push(`QPF totals: next 24h ${series.qpf24_in ?? "-"} in, next 48h ${series.qpf48_in ?? "-"} in, next 72h ${qpf72.toFixed(2)} in. Max POP: 24h ${series.popMax24 ?? "-"}%, 48h ${series.popMax48 ?? "-"}%.`);
  return lines.join("\n");
}
__name(gridTable, "gridTable");

// Everything the discussion reads, fetched in parallel. Returns the prompt
// packet as labeled text sections plus the pieces handleSummary needs for its
// cache entry and the deterministic fallback.
async function gatherDiscussionInputs(lat, lon, env2) {
  const ua = env2.NWS_USER_AGENT || "WeatherChatBot/1.0 (contact@example.com)";
  const T = 9e3;
  const office = pointInfo(lat, lon, ua).then((pt) => pt?.properties?.gridId || pt?.properties?.cwa || null);
  const jobs = {
    forecast: getForecast(lat, lon, ua),
    grid: getGridpointSeries(lat, lon, ua, 72),
    observations: getCurrentObservations(lat, lon, ua),
    alerts: getActiveAlerts(lat, lon, ua),
    afd: office.then((o) => o ? getAFD(o, ua) : null),
    spc1: getSPCConvectiveOutlook(1, lat, lon, ua),
    spc2: getSPCConvectiveOutlook(2, lat, lon, ua),
    spc3: getSPCConvectiveOutlook(3, lat, lon, ua),
    spc48: getSPCDay48Outlook(ua),
    watches: getSPCActiveWatches(ua),
    mds: getSPCMesoscaleDiscussions(5, ua),
    wpc: getWPCQPF(ua),
    tropical: getNHCTropical(ua, lat, lon),
    drought: getDroughtMonitor(lat, lon, ua),
    cpc610: getCPCOutlook("6-10day", ua, lat, lon),
    cpc814: getCPCOutlook("8-14day", ua, lat, lon),
    airQuality: env2.AIRNOW_API_KEY ? getAirQuality(lat, lon, ua, env2.AIRNOW_API_KEY) : Promise.resolve(null),
    astronomy: getAstronomy(lat, lon, ua),
    reports: localStormReports(lat, lon, ua, 50, 24),
    stations: areaObservations(lat, lon, ua, 50)
  };
  const names = Object.keys(jobs);
  const settled = await Promise.allSettled(names.map((k) => withTimeout(jobs[k], T, k)));
  const raw = {};
  const unavailable = [];
  names.forEach((k, i) => {
    const s = settled[i];
    const v = s.status === "fulfilled" ? s.value : null;
    // Tools report upstream failures as text rather than throwing.
    if (v == null || typeof v === "string" && /unable to retrieve|^Error/i.test(v)) {
      if (!(k === "airQuality" && !env2.AIRNOW_API_KEY)) unavailable.push(k);
      return;
    }
    raw[k] = v;
  });
  const parse = (v) => {
    if (v == null || typeof v !== "string") return v;
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  };
  const fc = parse(raw.forecast);
  if (!fc || !Array.isArray(fc.periods) || !fc.periods.length) return { fc: null };
  const tzInfo = localTimeInfo(fc.timeZone);
  const spcSection = (v, day) => {
    const o = parse(v);
    if (!o) return null;
    return `Day ${day} at point: ${JSON.stringify(o.atPoint || null)}\n${capText(o.discussion, 3500) || ""}`;
  };
  const wpc = parse(raw.wpc);
  const afd = parse(raw.afd);
  // Observed vs gridded forecast for the observation's hour: a forecaster's
  // first nowcast check, done here so the model doesn't do arithmetic.
  let obsVsGrid = null;
  const obs = parse(raw.observations);
  const grid = raw.grid;
  if (obs && grid && Array.isArray(grid.times) && obs.observed) {
    const obsMs = Date.parse(obs.observed);
    const i = Math.round((obsMs - Date.parse(grid.times[0])) / 36e5);
    if (Number.isFinite(i) && i >= -1 && i < grid.times.length && Date.now() - obsMs < 2 * 36e5) {
      const k = Math.max(0, i);
      const d = (o, f) => o == null || f == null ? null : Math.round(o - f);
      const sgn = (v) => v == null ? "n/a" : (v > 0 ? "+" : "") + v;
      const dT = d(obs.temperature_F, grid.temp_F[k]);
      const dTd = d(obs.dewpoint_F, grid.dewpoint_F[k]);
      const r = (v) => v == null ? "n/a" : Math.round(v);
      obsVsGrid = `Observed ${r(obs.temperature_F)}\xB0F / dewpoint ${r(obs.dewpoint_F)}\xB0F vs gridded forecast ${r(grid.temp_F[k])} / ${r(grid.dewpoint_F[k])} for that hour: temperature ${sgn(dT)}, dewpoint ${sgn(dTd)} (observed minus forecast).`;
    }
  }
  const sections = [
    ["LOCATION", `${fc.location || ""} (lat ${lat}, lon ${lon}), WFO ${fc.office || "?"}. Local time: ${tzInfo.timeStr}. Part of day: ${tzInfo.partOfDay}.`],
    ["SURFACE OBSERVATIONS", capText(raw.observations, 1200)],
    ["OBSERVED VS GRIDDED FORECAST, this hour", obsVsGrid],
    ["NEARBY STATIONS (within 50 mi, last 2 h)", stationsBrief(raw.stations, fc.timeZone)],
    ["LOCAL STORM REPORTS (within 50 mi, last 24 h)", reportsBrief(raw.reports, fc.timeZone)],
    ["NWS POINT FORECAST (7 days)", capText(raw.forecast, 6e3)],
    ["NWS GRIDDED FORECAST, next 72h at 3h steps (T/Td/AT \xB0F, RH %, POP %, sky %, wind mph, gust mph, QPF in)", gridTable(raw.grid, fc.timeZone)],
    ["ACTIVE ALERTS", capText(raw.alerts, 6e3)],
    ["WFO AREA FORECAST DISCUSSION", afd ? `Issued ${afd.issuanceTime}\n${capText(afd.text, 14e3)}` : null],
    ["SPC DAY 1", spcSection(raw.spc1, 1)],
    ["SPC DAY 2", spcSection(raw.spc2, 2)],
    ["SPC DAY 3", spcSection(raw.spc3, 3)],
    ["SPC DAY 4-8", capText(parse(raw.spc48)?.text, 2500)],
    ["SPC ACTIVE WATCHES", capText(raw.watches, 2e3)],
    ["SPC MESOSCALE DISCUSSIONS", capText(raw.mds, 2500)],
    ["WPC QPF DISCUSSION", wpc?.qpf_discussion ? capText(wpc.qpf_discussion.text, 4500) : null],
    ["WPC EXCESSIVE RAINFALL DISCUSSION", wpc?.excessive_rainfall_discussion ? capText(wpc.excessive_rainfall_discussion.text, 4500) : null],
    ["NHC ACTIVE TROPICAL SYSTEMS", capText(tropicalBrief(parse(raw.tropical), fc.timeZone), 3e3)],
    ["DROUGHT MONITOR", capText(raw.drought, 600)],
    ["CPC 6-10 DAY OUTLOOK", cpcSection(parse(raw.cpc610))],
    ["CPC 8-14 DAY OUTLOOK", cpcSection(parse(raw.cpc814))],
    ["AIR QUALITY", capText(raw.airQuality, 1500)],
    ["SUN AND MOON", capText(raw.astronomy, 800)]
  ];
  const packet = sections.filter(([, body]) => body).map(([h, body]) => `=== ${h} ===\n${body}`).join("\n\n") + (unavailable.length ? `\n\nUNAVAILABLE: ${unavailable.join(", ")}` : "");
  const spc1 = parse(raw.spc1);
  const cat = spc1?.atPoint?.categorical;
  const spcLabel = cat && cat.rank >= 1 ? cat.label : null;
  const periods = fc.periods.slice(0, 14).map(briefPeriod).filter(Boolean);
  const brief = { location: fc.location, periods, nextPrecipChance: nextPrecipWindow(periods) };
  return { fc, packet, spcLabel, brief, unavailable };
}
__name(gatherDiscussionInputs, "gatherDiscussionInputs");

// Packet sections for the area stations and storm reports: one compact
// line each, nearest/newest first, local times.
function stationsBrief(o, tz) {
  if (!o || !Array.isArray(o.stations) || !o.stations.length) return null;
  const s = o.summary || {};
  const head = [
    s.temp_F_range ? `Temperatures ${s.temp_F_range[0]}-${s.temp_F_range[1]}\u00B0F` : null,
    s.dewpoint_F_range ? `dewpoints ${s.dewpoint_F_range[0]}-${s.dewpoint_F_range[1]}\u00B0F` : null,
    s.altimeter_inHg_range ? `altimeter ${s.altimeter_inHg_range[0]}-${s.altimeter_inHg_range[1]} inHg` : null,
    s.highest_peak_gust_today ? `highest gust today ${s.highest_peak_gust_today}` : null,
    s.wettest_today ? `wettest today ${s.wettest_today}` : null
  ].filter(Boolean).join("; ");
  const lines = o.stations.filter((x) => x.temp_F != null || x.wind).slice(0, 12).map((x) => [
    `${x.name} (${x.distance_mi} mi ${x.direction})`,
    x.temp_F != null ? `${x.temp_F}/${x.dewpoint_F ?? "-"}\u00B0F` : null,
    x.wind, x.altimeter_inHg != null ? `${x.altimeter_inHg}"` : null,
    x.precip_1h_in ? `${x.precip_1h_in} in/1h` : null, x.weather
  ].filter(Boolean).join(", "));
  return capText((head ? head + ".\n" : "") + lines.join("\n"), 1800);
}
__name(stationsBrief, "stationsBrief");
function reportsBrief(o, tz) {
  if (!o || !Array.isArray(o.reports)) return null;
  if (!o.reports.length) return "None.";
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", weekday: "short", hour: "numeric", minute: "2-digit" });
  return capText(o.reports.slice(0, 15).map((r) => `${r.time ? fmt.format(new Date(r.time)) : "?"}: ${r.type}${r.magnitude ? " " + r.magnitude : ""}, ${r.place} (${r.distance_mi} mi ${r.direction}), ${r.source}${r.remark ? " \u2014 " + r.remark.slice(0, 120) : ""}`).join("\n"), 2e3);
}
__name(reportsBrief, "reportsBrief");

// CPC section of the discussion packet: valid dates and the point's state
// category first, so the 2.5k cap only ever trims the national prose.
function cpcSection(o) {
  if (!o || !o.text || /unable to retrieve/.test(o.text)) return null;
  const head = [];
  if (o.valid) head.push(`Valid ${o.valid}.`);
  for (const a of o.atPoint || []) head.push(`${a.region} (state average): temperature ${a.temperature}, precipitation ${a.precipitation}.`);
  return capText((head.length ? head.join(" ") + "\n" : "") + o.text, 2500);
}
__name(cpcSection, "cpcSection");

// The NHC section of the discussion packet: one line per storm (nearest
// first) with where it is relative to the point, then — for storms within
// ~1500 mi — the forecast track in local time. Compact, so the cap never cuts
// the nearest storm's track.
function tropicalBrief(t, tz) {
  if (!t) return null;
  if (t.error) return null;
  const storms = Array.isArray(t.storms) ? t.storms : [];
  if (!storms.length) return "No active tropical cyclones in NHC's areas of responsibility.";
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", weekday: "short", hour: "numeric", hour12: true, timeZoneName: "short" });
  const when = (iso) => {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? fmt.format(new Date(ms)).replace(/\s+/g, " ") : iso;
  };
  const lines = [];
  for (const s of storms) {
    const r = s.relativeToPoint;
    let line = `${s.name}: ${s.status}, ${s.intensity_kt} kt, ${s.pressure_mb} mb, ${s.position?.lat}N ${Math.abs(s.position?.lon)}W, moving ${s.movement || "n/a"} (advisory ${s.advisory?.num || "?"}).`;
    if (r) {
      line += ` Center now ${r.centerNow}.`;
      if (r.pointInsideForecastCone != null) line += r.pointInsideForecastCone ? " The point is INSIDE the forecast cone." : " The point is outside the forecast cone.";
      if (r.closestForecastApproach) line += ` Closest forecast approach: ${r.closestForecastApproach.replace(/around (\S+Z)/, (m, iso) => "around " + when(iso))}.`;
    }
    if (s.watchesWarnings && s.watchesWarnings.length) line += ` In effect: ${s.watchesWarnings.join(", ")}.`;
    lines.push(line);
    const far = r && /^(\d+) mi/.test(r.centerNow) && +r.centerNow.match(/^(\d+)/)[1] > 1500;
    if (!far && Array.isArray(s.forecastTrack)) {
      lines.push("  Track: " + s.forecastTrack.map((f) => `${f.hour}h ${when(f.valid)} ${f.lat}N ${Math.abs(f.lon)}W ${f.wind_kt} kt ${f.status}`).join("; "));
    }
  }
  return lines.join("\n");
}
__name(tropicalBrief, "tropicalBrief");

async function discussionFromModel(packet, model, provider, env2) {
  const req = {
    model,
    messages: [
      { role: "system", content: DISCUSSION_SYS },
      { role: "user", content: packet }
    ],
    // Reasoning shares this cap with the prose on both providers, so high
    // effort needs real headroom — but not unbounded: Cloudflare drops a
    // response that sends nothing for 100 s, and at Fast-tier speeds this
    // keeps the worst case well inside that.
    maxTokens: 1e4,
    effort: clampEffort(provider, env2.SUMMARY_EFFORT || "high"),
    cacheKey: "weatherchat-discussion"
  };
  const up = await callLLM(provider, req, null);
  if (!up.ok) throw new Error(`${provider.label} HTTP ${up.status}`);
  const choice = up.resp?.choices?.[0];
  // Keep paragraph breaks (the client renders them); tidy everything else.
  let text = String(choice?.message?.content || "").replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n\n").replace(/^["'`]+|["'`]+$/g, "").trim();
  if (choice?.finish_reason === "length") {
    const end = Math.max(text.lastIndexOf("."), text.lastIndexOf("!"), text.lastIndexOf("?"));
    if (end < 80) throw new Error("discussion truncated");
    text = text.slice(0, end + 1);
  }
  if (!text) throw new Error("empty discussion");
  return text;
}
__name(discussionFromModel, "discussionFromModel");

async function handleSummary(request, env2) {
  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get("lat"));
  const lon = parseFloat(url.searchParams.get("lon"));
  if (isNaN(lat) || isNaN(lon)) return Response.json({ error: "lat and lon required" }, { status: 400 });
  const la = Math.round(lat * 100) / 100;
  const lo = Math.round(lon * 100) / 100;
  const bucket = Math.floor(Date.now() / 36e5);
  const cache = caches.default;
  // v9: nearby stations + local storm reports (v8: SPC D4-8 + CPC restored; v7: point-relative NHC section; v6: explicit final self-check; v2: first long-form prompt; v1: short briefing).
  const cacheKey = new Request(`https://wx-summary.internal/v9?lat=${la}&lon=${lo}&h=${bucket}`);
  // ?fresh= (sent when the user starts a new chat) skips the cached copy and
  // regenerates; the result still overwrites the hourly cache key below.
  const wantFresh = url.searchParams.has("fresh");
  if (!wantFresh) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    } catch (e) {
    }
  }
  const g = await gatherDiscussionInputs(la, lo, env2);
  if (!g.fc) {
    return new Response(JSON.stringify({ summary: null, error: "forecast unavailable" }), {
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
  }
  let summary = null;
  let source = "model";
  const provider = resolveProvider(env2);
  const model = env2.SUMMARY_MODEL || env2.MODEL || provider.defaultModel;
  if (provider.apiKey) {
    try {
      summary = await discussionFromModel(g.packet, model, provider, env2);
    } catch (e) {
      summary = null;
    }
  }
  if (!summary) {
    summary = deterministicSummary(g.brief, g.spcLabel);
    source = "fallback";
  }
  const resp = new Response(JSON.stringify({
    summary,
    location: g.fc.location,
    spc: g.spcLabel || null,
    source,
    unavailable: g.unavailable,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString()
  }), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=1800, s-maxage=3600" }
  });
  // A fallback is cached for minutes, not the hour, so a transient model
  // failure doesn't pin the terse line on screen.
  const toCache = source === "model" ? resp.clone() : new Response(await resp.clone().text(), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=120, s-maxage=300" }
  });
  try {
    await cache.put(cacheKey, toCache);
  } catch (e) {
  }
  return resp;
}
__name(handleSummary, "handleSummary");
async function handleDashboard(request, env2) {
  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get("lat"));
  const lon = parseFloat(url.searchParams.get("lon"));
  if (isNaN(lat) || isNaN(lon)) return Response.json({ error: "lat and lon required" }, { status: 400 });
  const ua = env2.NWS_USER_AGENT || "WeatherChatBot/1.0 (contact@example.com)";
  const la = Math.round(lat * 100) / 100;
  const lo = Math.round(lon * 100) / 100;
  const bucket = Math.floor(Date.now() / (10 * 60 * 1e3));
  const cache = caches.default;
  const cacheKey = new Request(`https://wx-dashboard.internal/v1?lat=${la}&lon=${lo}&h=${bucket}`);
  try {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  } catch (e) {
  }
  const airKey = env2.AIRNOW_API_KEY;
  // Each source gets its own deadline (some chain 2-3 fetches) so one slow
  // upstream renders as a missing card instead of a dashboard that never
  // arrives.
  const D = 1e4;
  const settled = await Promise.allSettled([
    withTimeout(getForecast(lat, lon, ua), D, "forecast"),
    withTimeout(getHourlyForecast(lat, lon, 24, ua), D, "hourly"),
    withTimeout(getCurrentObservations(lat, lon, ua), D, "observations"),
    withTimeout(getActiveAlerts(lat, lon, ua), D, "alerts"),
    withTimeout(getAstronomy(lat, lon, ua), D, "astronomy"),
    airKey ? withTimeout(getAirQuality(lat, lon, ua, airKey), D, "airQuality") : Promise.resolve(null),
    withTimeout(spcDay1AtPoint(lat, lon, ua), D, "spc"),
    withTimeout(getGridpointSeries(lat, lon, ua, 72), D, "grid")
  ]);
  const val = /* @__PURE__ */ __name((s) => s.status === "fulfilled" ? s.value : null, "val");
  const parse = /* @__PURE__ */ __name((s) => {
    const v = val(s);
    if (v == null) return null;
    try {
      return typeof v === "string" ? JSON.parse(v) : v;
    } catch {
      return null;
    }
  }, "parse");
  const fc = parse(settled[0]);
  const hr = parse(settled[1]);
  const obs = parse(settled[2]);
  const al = parse(settled[3]);
  const ast = parse(settled[4]);
  const aq = parse(settled[5]);
  const spc = val(settled[6]);
  const series = val(settled[7]);

  const toNum = /* @__PURE__ */ __name((t) => {
    if (t == null) return null;
    const m = String(t).match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }, "toNum");

  let current = null;
  if (obs && !obs.error) {
    const feels = obs.heatIndex_F != null ? obs.heatIndex_F : obs.windChill_F != null ? obs.windChill_F : obs.temperature_F;
    current = {
      observed: obs.observed,
      station: obs.station,
      textDescription: obs.textDescription,
      temperature_F: obs.temperature_F,
      feelsLike_F: feels,
      dewpoint_F: obs.dewpoint_F,
      humidity_pct: obs.humidity_pct,
      windSpeed_mph: obs.windSpeed_mph,
      windGust_mph: obs.windGust_mph,
      windDir_deg: obs.windDir_deg,
      pressure_inHg: obs.pressure_inHg,
      visibility_mi: obs.visibility_mi,
      precipLastHour_in: obs.precipLastHour_in
    };
  }

  const hourly = hr && Array.isArray(hr.periods) ? hr.periods.slice(0, 24).map((p) => ({
    time: p.t,
    temp_F: toNum(p.temp),
    pop: p.pop,
    short: p.short,
    wind: p.wind
  })) : [];

  const daily = fc && Array.isArray(fc.periods) ? fc.periods.map((p) => ({
    name: p.name,
    isDaytime: p.isDaytime,
    temp_F: toNum(p.temp),
    short: p.short,
    detailed: p.detailed,
    pop: p.pop,
    wind: p.wind
  })) : [];

  const alerts = al && Array.isArray(al.alerts) ? al.alerts.map((a) => ({
    event: a.event,
    severity: a.severity,
    urgency: a.urgency,
    headline: a.headline,
    onset: a.onset,
    effective: a.effective,
    expires: a.expires,
    ends: a.ends,
    areaDesc: a.areaDesc
  })) : [];

  let airQuality = null;
  if (aq && Array.isArray(aq.observations) && aq.observations.length) {
    airQuality = { worst: aq.worst || null, observations: aq.observations };
  }

  let severe = null;
  if (spc && spc.categorical) {
    severe = { day1: spc };
  }

  const location = {
    name: fc?.location || null,
    office: fc?.office || null,
    lat: la,
    lon: lo,
    timeZone: fc?.timeZone || null,
    elevation_m: fc?.elevation_m ?? null
  };

  let hourlySeries = null;
  let precipOutlook = null;
  if (series && Array.isArray(series.temp_F)) {
    hourlySeries = {
      start: series.start,
      hours: series.hours,
      times: series.times,
      temp_F: series.temp_F,
      dewpoint_F: series.dewpoint_F,
      apparent_F: series.apparent_F,
      pop: series.pop,
      sky: series.sky,
      wind_mph: series.wind_mph,
      gust_mph: series.gust_mph,
      windDir: series.windDir,
      rh: series.rh,
      qpf_in: series.qpf_in
    };
    precipOutlook = {
      qpf24_in: series.qpf24_in,
      qpf48_in: series.qpf48_in,
      popMax24: series.popMax24,
      popMax48: series.popMax48
    };
  }

  const body = {
    location,
    current,
    hourly,
    hourlySeries,
    precipOutlook,
    daily,
    alerts,
    astronomy: ast ? { sun: ast.sun || null, moon: ast.moon || null } : null,
    airQuality,
    severe,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  // A dashboard missing its forecast or grid (an upstream timed out) is
  // cached for a minute, not the full 10, so the next load retries.
  const complete = !!(fc && series);
  const ttl = complete ? 600 : 60;
  const resp = new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttl}, s-maxage=${ttl}` }
  });
  try {
    await cache.put(cacheKey, resp.clone());
  } catch (e) {
  }
  return resp;
}
__name(handleDashboard, "handleDashboard");
function buildSystemPrompt(loc) {
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  return `You are a senior operational meteorologist with deep expertise in severe convective weather, mesoscale analysis, fire weather, hydrology, winter weather, and seasonal climate. You are advising a technically sophisticated user who wants substantive, jargon-appropriate discussion.

Today is ${today}. Default location: ${loc.name} (lat ${loc.lat}, lon ${loc.lon}). Local NWS WFO: ${loc.office}. If the user does not specify a location, assume this one.

You have live-data tools for NWS, SPC, WPC, CPC, NHC, USGS, AirNow, and aviation weather. Be aggressive and parallel about calling them. Never guess at current conditions, observed values, active watches/MDs, AQI, river stage, or AFD content when you can fetch them. It is normal and expected to call 3\u20136 tools per turn in parallel.

Tool selection (call in parallel where independent):
- "What's it doing right now?" \u2192 get_current_observations FIRST, plus get_active_alerts. Add get_metar_taf if a closer airport exists or aviation context matters.
- "Today / this week" forecast \u2192 get_forecast + get_active_alerts (+ get_hourly_forecast if timing matters).
- "Severe risk?" \u2192 get_spc_convective_outlook (days 1-3 as appropriate), get_spc_active_watches, get_spc_mesoscale_discussions, get_active_alerts. Multi-day setup: include get_spc_day48_outlook.
- Active severe event \u2192 get_active_alerts + get_local_storm_reports (ground truth near the user) + get_area_observations + get_spc_mesoscale_discussions \u2192 then get_spc_mesoscale_discussion for the relevant MD number. Add get_local_experts for the local broadcast read. Offer get_radar_image_url for the nearest site.
- "What's happening / what should I expect / how bad could it get?" \u2192 a synthesis (below): get_current_observations + get_area_observations + get_local_storm_reports + get_active_alerts + get_hourly_forecast + get_afd, plus the outlook tools that fit the hazard, and get_local_experts.
- "What is BMX/HUN/OUN saying?" \u2192 get_afd for that office.
- Fire weather \u2192 get_spc_fire_weather_outlook + relevant AFD.
- Rain / flood / heavy precip \u2192 get_wpc_qpf + get_active_alerts + get_river_gauges (during/after the event).
- Drought / long-range / seasonal \u2192 get_cpc_outlook + get_drought_monitor.
- Tropics / hurricane season \u2192 get_nhc_tropical (track, intensity, cone, watches/warnings, closest approach to the user). For NHC's reasoning and wording, get_product with type TCD/TCP/PWS and the storm's bin as office (e.g. AT4). When a storm threatens the user, pair it with get_active_alerts, get_wpc_qpf, get_afd and get_spc_convective_outlook (landfalling tropical cyclones bring tornadoes in the right-front quadrant). WeatherNet's live map draws each storm's cone, track and coastal watches/warnings (WeatherNet: this replaced weatherchat's in-chat storm card) \u2014 point the reader there instead of describing the cone geometry in prose.
- Air quality / smoke / asthma \u2192 get_air_quality (often paired with get_current_observations).
- Sunrise/sunset/twilight/moon \u2192 get_astronomy.
- Radar embed request \u2192 get_radar_image_url (default to the user's local office's radar site).

Style:
- Use real meteorological terminology: CAPE/MUCAPE/MLCAPE, 0\u20131 km / 0\u20136 km bulk shear, SRH, EHI, STP, EML, dryline, warm sector, LLJ, RAP/HRRR/NAM/GFS guidance, LCL/LFC, hodograph curvature, etc.
- Quote SPC category codes explicitly (TSTM, MRGL, SLGT, ENH, MDT, HIGH) and quote tornado/wind/hail probability percentages with hatched (significant) status when present.
- For AQI, state both the number and the category (e.g., "AQI 112 \u2014 Unhealthy for Sensitive Groups, PM2.5").
- For current obs, state temperature, dewpoint, wind, and pressure as a one-line headline; only expand when asked.
- When summarizing an AFD, preserve forecaster reasoning and explicit uncertainty/confidence statements \u2014 don't strip the nuance.
- Be direct and quantify. Cite product/MD numbers and issuance times when relevant.
- Do not over-explain basic concepts unless asked. Be candid about forecast uncertainty rather than hedging.
- Use Markdown headings, bullet lists, and short tables when they aid scanability. The UI renders Markdown.

Synthesis (when the user wants the overall picture or what could happen):
1. Readings first: what is happening now, from observations and storm reports, with times, places and distances from the user. Compare them with the forecast for this hour (temperature/dewpoint running ahead or behind, pressure falling faster, rain already exceeding QPF, a boundary sitting somewhere the forecast didn't expect) \u2014 those departures are the evidence.
2. Then possibilities, each tied to that evidence and to the official products: the most likely outcome at the user's location (timing, hazard, magnitude); a reasonable worst case and what would have to happen for it; what would make it a non-event. Say which observations to watch and what values would tip it one way or the other.
3. Provenance: storm reports are what people and instruments reported (weigh trained spotters and emergency managers above public or social-media reports); broadcaster posts are expert opinion \u2014 attribute them by name, use them for local nuance, and say where they agree or disagree with NWS/SPC/WPC. Never present a post or an unverified report as an observation.` + (EXTRA_PROMPT.length ? "\n\n" + EXTRA_PROMPT.join("\n\n") : "");
}
__name(buildSystemPrompt, "buildSystemPrompt");

// WeatherNet: the surface src/index.js and src/sources/* build on.
export {
  index_default as brainWorker,
  registerTools,
  defaultLocation,
  resolveProvider,
  callLLM,
  getActiveAlerts,
  getTropicalStorms,
  getSPCMesoscaleDiscussions,
  spcOutlookText,
  localStormReports,
  getCurrentObservations,
  getForecast,
  pointInGeometry,
  nwsJSON
};
