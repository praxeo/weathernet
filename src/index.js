// WeatherNet worker entry. Workers Static Assets serves public/ before this
// runs; everything under /api/ lands here. WeatherNet's own endpoints are
// routed first; everything else falls through to the weatherchat brain
// (/api/chat, /api/summary, /api/dashboard, /api/tropical, /api/ground, …).
import { brainWorker, registerTools, defaultLocation, resolveProvider } from "./brain.js";
import { json } from "./lib/cache.js";
import { handleStories, storiesForChat } from "./sources/stories.js";
import { satelliteCatalog } from "./sources/satellite.js";
import { camsNear, camSnapshot, SKYCAM_LINKS } from "./sources/cams.js";
import { climateHistory } from "./sources/history.js";
import { liveStreams } from "./sources/youtube.js";
import {
  ARCHIVE_INDEX, archivedProduct, dailySeries, dayHistory, listProducts, pointInfo, productsAt, tornadoesNear,
} from "./sources/archive.js";
import { PLACES } from "./data/places.js";

const num = (v) => (v == null || v === "" ? NaN : Number(v));

function point(url) {
  const lat = num(url.searchParams.get("lat"));
  const lon = num(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

const bad = (msg) => json({ error: msg }, { status: 400, maxAge: 0 });

// Cameras near a point. preferSky puts sky/fire/scenic cameras first (they
// look at the weather; traffic cams look at the road), then the nearest of
// everything else. Both lists are edge-cached by the cams module.
async function nearCams(lat, lon, { radiusMi, limit, env, ctx, preferSky }) {
  if (!preferSky) return camsNear(lat, lon, { radiusMi, limit, env, ctx });
  const [sky, all] = await Promise.all([
    camsNear(lat, lon, { radiusMi, limit: Math.min(4, limit), env, ctx, kinds: ["sky", "fire", "scenic"] }),
    camsNear(lat, lon, { radiusMi, limit, env, ctx }),
  ]);
  const seen = new Set();
  const cams = [...(sky.cams || []), ...(all.cams || [])].filter((c) => !seen.has(c.id) && seen.add(c.id)).slice(0, limit);
  return { ...all, cams, notes: [...new Set([...(sky.notes || []), ...(all.notes || [])])] };
}

// Errors carrying status 400 are the caller's (bad parameters); anything else
// is an upstream failure.
async function safe(fn) {
  try {
    return await fn();
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, { status: (e && e.status) || 502, maxAge: 0 });
  }
}

// An archive request names its office directly or by a point inside it.
async function officeFor(url, env, ctx) {
  const office = url.searchParams.get("office");
  if (office) return office;
  const pt = point(url);
  if (!pt) throw Object.assign(new Error("office (BMX, KBMX, SPC) or lat and lon required"), { status: 400 });
  return (await pointInfo(pt.lat, pt.lon, { env, ctx })).office;
}

// Past days don't change: let browsers and the edge keep them.
const archiveAge = (iso) => (iso && iso < new Date(Date.now() - 3 * 86400e3).toISOString().slice(0, 10) ? 86400 : 300);

const ROUTES = {
  "GET /api/config": (req, env) => {
    const p = resolveProvider(env);
    return json({
      defaultLocation: defaultLocation(env),
      features: {
        llm: !!p.apiKey,
        youtube: !!env.YOUTUBE_API_KEY,
        windy: !!env.WINDY_API_KEY,
        x: !!env.X_BEARER_TOKEN,
        voice: !!env.ELEVENLABS_API_KEY,
      },
    }, { maxAge: 300 });
  },
  "GET /api/stories": (req, env, ctx) => safe(() => handleStories(req, env, ctx)),
  // Map labels: US places, largest first ([name, state, lat, lon, population]).
  "GET /api/places": () => json({ places: PLACES }, { maxAge: 86400 }),
  "GET /api/satellite": (req, env, ctx) => safe(async () => json(await satelliteCatalog(env, ctx), { maxAge: 120 })),
  "GET /api/cams": (req, env, ctx, url) => {
    const pt = point(url);
    if (!pt) return bad("lat and lon required");
    const radiusMi = Math.min(150, Math.max(5, num(url.searchParams.get("radius")) || 50));
    const limit = Math.min(40, Math.max(1, num(url.searchParams.get("limit")) || 12));
    return safe(async () => {
      const d = await nearCams(pt.lat, pt.lon, { radiusMi, limit, env, ctx, preferSky: url.searchParams.get("prefer") === "sky" });
      const out = url.searchParams.has("links") ? { ...d, links: SKYCAM_LINKS } : d;
      return json(out, { maxAge: 60 });
    });
  },
  // Stills for camera networks that refuse hotlinking (Texas): proxied and
  // edge-cached for a minute.
  "GET /api/cams/snapshot": (req, env, ctx, url) => safe(() => camSnapshot(url.searchParams.get("id") || "", env, ctx)),
  "GET /api/live": (req, env, ctx, url) =>
    safe(async () => json(await liveStreams(env, { region: url.searchParams.get("region") || undefined, ctx }), { maxAge: 60 })),
  "GET /api/history": (req, env, ctx, url) => {
    const pt = point(url);
    if (!pt) return bad("lat and lon required");
    const d = url.searchParams.get("date") || "";
    const date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined;
    return safe(async () => json(await climateHistory(pt.lat, pt.lon, { date, env, ctx }), { maxAge: 1800 }));
  },
  // Historical API (src/sources/archive.js); GET /api/archive describes it.
  "GET /api/archive": () => json(ARCHIVE_INDEX, { maxAge: 3600 }),
  "GET /api/archive/products": (req, env, ctx, url) =>
    safe(async () => {
      const q = url.searchParams;
      const d = await listProducts({ office: await officeFor(url, env, ctx), type: q.get("type"), date: q.get("date"), days: q.get("days"), env, ctx });
      return json(d, { maxAge: archiveAge(d.to) });
    }),
  "GET /api/archive/product": (req, env, ctx, url) =>
    safe(async () => {
      const q = url.searchParams;
      if (q.get("id")) return json(await archivedProduct(q.get("id"), { env, ctx }), { maxAge: 86400 });
      const d = await productsAt({ office: await officeFor(url, env, ctx), type: q.get("type"), at: q.get("at"), count: q.get("count"), env, ctx });
      return json(d, { maxAge: q.get("at") ? archiveAge(d.at.slice(0, 10)) : 300 });
    }),
  "GET /api/archive/day": (req, env, ctx, url) => {
    const pt = point(url);
    if (!pt) return bad("lat and lon required");
    return safe(async () => {
      const d = await dayHistory(pt.lat, pt.lon, { date: url.searchParams.get("date"), radiusMi: num(url.searchParams.get("radius")), env, ctx });
      return json(d, { maxAge: d.unavailable.length ? 0 : archiveAge(d.date) });
    });
  },
  "GET /api/archive/daily": (req, env, ctx, url) =>
    safe(async () => {
      const q = url.searchParams;
      const pt = point(url);
      const d = await dailySeries(pt?.lat, pt?.lon, { start: q.get("start"), end: q.get("end"), sid: q.get("sid"), env, ctx });
      return json(d, { maxAge: archiveAge(d.end) });
    }),
  "GET /api/archive/tornadoes": (req, env, ctx, url) => {
    const pt = point(url);
    if (!pt) return bad("lat and lon required");
    const q = url.searchParams;
    return safe(async () => json(await tornadoesNear(pt.lat, pt.lon, {
      radiusMi: num(q.get("radius")), since: q.get("since"), until: q.get("until"), minRating: q.get("min"), limit: q.get("limit"), env,
    }), { maxAge: 86400 }));
  },
};

// ── Chat tools WeatherNet adds to the weatherchat agent ─────────────────────
const tool = (name, description, properties = {}) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties } },
});

const TOOL_SCHEMAS = [
  tool(
    "get_national_stories",
    "WeatherNet's live national story board: the most significant weather happening anywhere in the US right now, ranked by tier (3 extreme, 2 major, 1 notable), from NWS warnings and their impact-based damage tags (Tornado/Flash Flood Emergencies, PDS warnings, Extreme Wind Warnings, destructive storms), SPC watches (incl. PDS) and the Day 1 outlook, NHC active storms, nationwide Local Storm Reports (6 h), NWS Record Event Reports, and GDACS red alerts outside the US. Each story has a place, lat/lon, summary, badges and the nearest radar. Use for 'what's going on / anything interesting / biggest weather story' questions, then drill into a story with the regular tools at its lat/lon.",
  ),
  tool(
    "get_cams_near",
    "Public traffic and sky cameras near a point (state DOT networks and other open camera feeds), nearest first, with name, place, distance/direction and whether a live video stream exists. WeatherNet shows the cameras you find as thumbnails under your answer, so name the best few briefly instead of listing URLs.",
    {
      lat: { type: "number", description: "Latitude. Omit for the user's location." },
      lon: { type: "number", description: "Longitude. Omit for the user's location." },
      radius_mi: { type: "number", description: "Search radius in miles (default 50, max 150)." },
      limit: { type: "number", description: "Max cameras (default 8)." },
    },
  ),
  tool(
    "get_satellite_status",
    "GOES-East/West imagery status: where the 1-minute mesoscale sectors are currently pointed (NOAA aims them at the most important weather: severe storms, landfalling hurricanes, fires), the latest frame times, and which views and bands WeatherNet shows with what each band reveals.",
  ),
  tool(
    "get_climate_history",
    "Climate records for a date at the nearest long-period threaded station (NOAA ACIS): record highs/lows with years, record precipitation/snow, 1991-2020 normals, every year's high and low on that date, and tornadoes on that date within 150 mi plus violent/deadly ones nationally (SPC database since 1950). Use for records, 'this day in weather history', and how today compares.",
    {
      lat: { type: "number" },
      lon: { type: "number" },
      date: { type: "string", description: "YYYY-MM-DD (default today)." },
    },
  ),
  tool(
    "get_archived_discussion",
    "Archived NWS text products from any office at any past time (IEM's AFOS archive, from about 2000): by default the Area Forecast Discussion(s) issued most recently before `at`, full text. Use for 'what were forecasters saying before X', how a forecast evolved, or how an event was anticipated. `type` reaches other products: HWO, PNS (damage survey results), LSR, and the national centers' (office SPC: SWODY1 Day 1 outlook text, SWOMCD mesoscale discussions; WPC: QPFERD excessive rainfall discussion, PMDSPD short range, PMDEPD extended, FFGMPD mesoscale precipitation discussions; NHC: TCDAT1-5 / TCDEP1-5 forecast discussions).",
    {
      office: { type: "string", description: "3-letter NWS office (BMX, OUN) or SPC/WPC/NHC. Omit to use the office covering lat/lon or the user's location." },
      lat: { type: "number" },
      lon: { type: "number" },
      type: { type: "string", description: "AFOS product id or 3-letter prefix (default AFD)." },
      at: { type: "string", description: "ISO time (UTC unless an offset is given), or YYYY-MM-DD for the end of that UTC day. Default now." },
      count: { type: "number", description: "How many issuances back from `at` (1-3, default 1)." },
    },
  ),
  tool(
    "get_weather_on_date",
    "What happened at a point on any past local date: the climate station's observed high/low/precip/snow vs 1991-2020 normal, the nearest ASOS's hourly observations and summary (high, low, peak gust, precip, weather codes), the SPC/WPC outlooks in force, every warning and watch that covered the point (with whether it was inside the polygon), storm reports and tornado tracks within the radius, and the list of that day's AFDs (read them with get_archived_discussion). Archives are thin before ~2005.",
    {
      lat: { type: "number", description: "Omit for the user's location." },
      lon: { type: "number" },
      date: { type: "string", description: "YYYY-MM-DD (local calendar date)." },
      radius_mi: { type: "number", description: "Radius for storm reports and tornadoes (default 25, max 100)." },
    },
  ),
  tool(
    "get_tornado_history",
    "Every SPC-recorded tornado track (1950 to the latest final year) that passed within a radius of a point, with counts by rating and decade, the strongest, deadliest and closest, and the newest tracks first. Use for 'has a tornado ever hit here', 'tornadoes near X since 1990', local tornado climatology. Distances are closest approach of a straight start-to-end track.",
    {
      lat: { type: "number", description: "Omit for the user's location." },
      lon: { type: "number" },
      radius_mi: { type: "number", description: "Default 25, max 100." },
      since: { type: "number", description: "First year." },
      until: { type: "number", description: "Last year." },
      min_rating: { type: "number", description: "Minimum F/EF rating, 0-5." },
    },
  ),
  tool(
    "get_daily_climate",
    "Daily observed max/min temperature, precipitation, snowfall and snow depth with 1991-2020 daily normals at the nearest long-record climate station, over any date range up to 10 years, plus a summary (means vs normal, extremes with dates, totals vs normal, 90°F and freezing day counts). Use for 'how wet was last spring', 'coldest day of the 2021 freeze', streaks and comparisons. Day-by-day rows are included for ranges up to 62 days.",
    {
      lat: { type: "number", description: "Omit for the user's location." },
      lon: { type: "number" },
      start: { type: "string", description: "YYYY-MM-DD." },
      end: { type: "string", description: "YYYY-MM-DD (default today)." },
    },
  ),
  tool(
    "get_live_coverage",
    "Which broadcast meteorologists, storm chasers and agencies are live-streaming on YouTube right now (Alabama TV stations and national severe-weather streamers), plus their latest uploads. Live detection needs WeatherNet's YouTube key.",
  ),
];

const TOOL_HANDLERS = {
  get_national_stories: (input, { env }) => storiesForChat(env),
  // Same list the page attaches under the reply (sky cams first).
  get_cams_near: async (input, { lat, lon, env }) => {
    const d = await nearCams(lat, lon, {
      radiusMi: Math.min(150, Math.max(5, Number(input.radius_mi) || 60)),
      limit: Math.min(8, Math.max(1, Number(input.limit) || 6)),
      env,
      preferSky: true,
    });
    return {
      point: { lat, lon },
      count: (d.cams || []).length,
      cams: (d.cams || []).map((c) => ({
        name: c.name,
        place: [c.city, c.state].filter(Boolean).join(", "),
        distance_mi: c.distMi != null ? Math.round(c.distMi) : null,
        direction: c.bearing || null,
        live_video: !!c.hls,
        kind: c.kind,
        source: c.attribution || c.source,
      })),
      sources: d.sources,
      notes: d.notes,
    };
  },
  get_satellite_status: async (input, { env }) => {
    const cat = await satelliteCatalog(env);
    const newest = (bands) => (bands || []).map((b) => b.frames?.[b.frames.length - 1]?.t).filter(Boolean).sort().pop() || null;
    return {
      generated: cat.generated,
      satellites: cat.sats,
      mesoscale: (cat.meso || []).map((m) => ({
        satellite: m.sat === "west" ? "GOES-West" : "GOES-East",
        sector: m.id,
        center: m.center,
        where: m.label,
        latest: m.updated || newest(m.bands),
      })),
      views: (cat.views || []).map((v) => ({ id: v.id, title: v.title, region: v.region, latest: newest(v.bands) })),
      bands: ((cat.views || [])[0]?.bands || []).map((b) => ({ id: b.id, title: b.title, shows: b.explain })),
      notes: cat.notes,
    };
  },
  get_climate_history: (input, { lat, lon, env }) =>
    climateHistory(lat, lon, { date: /^\d{4}-\d{2}-\d{2}$/.test(String(input.date || "")) ? input.date : undefined, env }),
  get_archived_discussion: async (input, { lat, lon, env }) => {
    const office = input.office ? String(input.office) : (await pointInfo(lat, lon, { env })).office;
    const n = Math.min(3, Math.max(1, Number(input.count) || 1));
    const d = await productsAt({ office, type: input.type, at: input.at, count: n, env });
    const cap = Math.floor(24e3 / Math.max(1, d.products.length));
    return {
      ...d,
      products: d.products.map((p) => ({
        id: p.id, pil: p.pil, issued: p.issued, correction: p.correction,
        text: p.text.length > cap ? p.text.slice(0, cap) + "\n[… truncated]" : p.text,
      })),
    };
  },
  get_weather_on_date: async (input, { lat, lon, env }) => {
    const d = await dayHistory(lat, lon, { date: String(input.date || ""), radiusMi: Number(input.radius_mi) || 25, env });
    const h = d.hourly;
    return {
      ...d,
      hourly: h && {
        station: h.station,
        summary: h.summary,
        // Routine hourly reports plus any special with weather or a gust
        // (AWOS sites report every 5 minutes).
        obs: h.obs
          .filter((o) => h.station.routineMinute == null || Number(o.local.slice(14, 16)) === h.station.routineMinute || o.wx || o.gustKt)
          .slice(0, 80)
          .map((o) => [o.local.slice(11, 16), o.tempF, o.dewF, o.windDir, o.windKt, o.gustKt, o.visMi, o.wx, o.sky, o.precipIn].map((v) => v ?? "").join(" | ")),
        obsCols: "local time | temp °F | dewpoint °F | wind dir | wind kt | gust kt | vis mi | weather | sky | precip in",
      },
      stormReports: d.stormReports && d.stormReports.slice(0, 40),
      warnings: d.warnings && d.warnings.slice(0, 40).map(({ link, ...w }) => w),
    };
  },
  get_tornado_history: (input, { lat, lon, env }) =>
    tornadoesNear(lat, lon, { radiusMi: Number(input.radius_mi) || 25, since: input.since, until: input.until, minRating: input.min_rating, limit: 40, env }),
  get_daily_climate: async (input, { lat, lon, env }) => {
    const d = await dailySeries(lat, lon, { start: input.start, end: input.end, env });
    return d.rows.length > 62 ? { ...d, rows: undefined, cols: undefined, note: "Rows omitted (over 62 days); the summary covers the whole range." } : d;
  },
  // Same two region-scoped walls the page loads, so a warm edge cache serves
  // both (and each cold build stays a modest number of subrequests).
  get_live_coverage: async (input, { env }) => {
    const walls = await Promise.all(["AL", "national"].map((region) => liveStreams(env, { region }).catch(() => null)));
    const all = (k) => walls.flatMap((w) => (w && w[k]) || []);
    return {
      configured: walls.some((w) => w && w.configured),
      live: all("live").map((v) => ({ channel: v.channelName, title: v.title, since: v.startedAt, viewers: v.viewers })),
      upcoming: all("upcoming").slice(0, 5).map((v) => ({ channel: v.channelName, title: v.title, at: v.scheduledStart })),
      recent: all("recent").filter((v) => !v.short).sort((x, y) => String(y.published).localeCompare(String(x.published))).slice(0, 8)
        .map((v) => ({ channel: v.channelName, title: v.title, published: v.published })),
      notes: [...new Set(walls.flatMap((w) => (w && w.notes) || []))],
    };
  },
};

const PROMPT = `WeatherNet:
You are the resident meteorologist on WeatherNet, a nationwide live-weather site for weather enthusiasts. Scope is the whole US: the reader may ask about their own location or about anything happening anywhere in the country; go outside the US only for the truly extraordinary.
- "What's going on / anything interesting / what's the big story?" → get_national_stories first, then drill into the top story at its lat/lon (get_active_alerts, get_local_storm_reports, get_area_observations, SPC tools, get_nhc_tropical for tropical systems).
- Cameras → get_cams_near at the story's or the user's lat/lon. The site shows the cameras you find under your reply.
- Satellite → get_satellite_status, especially where the 1-minute mesoscale sectors are aimed and why that matters.
- Records, "this day in weather", how today compares → get_climate_history.
- The past: "what happened here on <date>" → get_weather_on_date; "what were forecasters thinking before <event>" → get_archived_discussion (several issuances to show how the forecast evolved; quote the forecasters' own words sparingly and say when each was issued); "has a tornado ever hit here / tornadoes near X" → get_tornado_history; a season, month or range → get_daily_climate. Say which station or office the numbers come from and how far away it is.
- Live streams → get_live_coverage.
- Teach as you go: when a product or phenomenon is central to the answer (a PDS watch, a debris signature, an Extreme Wind Warning, a meso sector), add one or two sentences on what it means and why, because WeatherNet readers are here to learn. Don't lecture on basics nobody asked about.
- The site's map, story board, satellite loops and cameras sit beside this chat; point to them ("the radar loop on the story card") rather than describing imagery you can't see.`;

registerTools(TOOL_SCHEMAS, TOOL_HANDLERS, PROMPT);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const route = ROUTES[`${request.method} ${url.pathname}`];
    if (route) return route(request, env, ctx, url);
    return brainWorker.fetch(request, env, ctx);
  },
};
