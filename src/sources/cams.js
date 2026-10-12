// Skycams that hone in on the weather: live camera stills (and open streams)
// near a point or inside a warning polygon, from state DOT traffic cameras,
// fire-lookout cameras, Alabama TV-station skycams and — with a key — Windy's
// scenic webcams, all in one normalized shape.
//
// Every keyless source here was verified live on 2026-10-09: the camera list
// answers without credentials, and its snapshot URLs return 200 image/* to a
// foreign Referer (the browser hotlinks them straight from the agency; nothing
// is proxied). The exceptions are spelled out where they occur:
//   - Oklahoma and most of Missouri publish streams only → snapshot: null.
//   - Texas stills exist only as base64 inside JSON → camSnapshot() serves
//     them as JPEGs at CAM_SNAPSHOT_PATH (the router has to wire that path).
//   - Windy needs WINDY_API_KEY and is implemented from the v3 docs, untested.
//
// Normalized cam:
//   { id, source, name, city?, state, lat, lon,
//     snapshot,            // JPEG/PNG still URL, or null for stream-only cams
//     hls?,                // live HLS playlist (CORS-open where present)
//     page?,               // human page for the camera (or the source's map)
//     kind,                // "traffic" | "sky" | "scenic" | "fire"
//     attribution, refreshSec,   // refreshSec: null when there is no still
//     views?, approx?, heading?, embed?, expires?, updated? }   // see where each is set
// `state` is the publishing agency's state (KC Scout's Missouri-side cams come
// through Kansas's feed as KS). HLS links can 404 when a camera's encoder is
// down (Caltrans ~40%, a few MnDOT); players should fall back to the still.

import { fetchJSON, haversineMi, bearingDeg, compass, geometryCenter, withDeadline, round } from "../lib/net.js";
import { edgeJSON, memo } from "../lib/cache.js";

const REGISTRY_TTL_SEC = 600; // camera lists change slowly; no tokenized URLs are kept
const NEAR_TTL_SEC = 120;
const SOURCE_DEADLINE_MS = 8e3; // one slow agency drops out instead of holding the response
const SPREAD_MI = 1.5; // cams closer than this to a picked one mostly show the same scene
const STALE_MS = 3 * 3600e3; // a CARS camera whose newest frame is older than this is dead
const MAX_RADIUS_MI = 300;
const WINDY_TOKEN_MS = 10 * 60e3; // free-tier Windy image URLs 401 after 10 minutes

// Texas stills are proxied (see camSnapshot); everything else is hotlinked.
export const CAM_SNAPSHOT_PATH = "/api/cams/snapshot";

// ── Sources ──────────────────────────────────────────────────────────────────
// bbox is [w, s, e, n]: the state (or network) extent with a small margin. It
// does double duty — the search prefilter, and a sanity check that drops
// cameras published with broken coordinates (a few feeds have sign flips).

const CARS = {
  // Castle Rock "CARS" 511 systems share one public camera API.
  iadot: { st: "ia", state: "IA", name: "Iowa DOT (511ia)", bbox: [-96.7, 40.3, -90.0, 43.6], home: "https://511ia.org/", attribution: "Iowa DOT / 511ia" },
  mndot: { st: "mn", state: "MN", name: "MnDOT (511mn)", bbox: [-97.3, 43.4, -89.4, 49.4], home: "https://511mn.org/", attribution: "MnDOT / 511mn" },
  ksdot: { st: "ks", state: "KS", name: "KDOT + KC Scout (KanDrive)", bbox: [-102.1, 36.9, -94.0, 40.1], home: "https://www.kandrive.gov/", attribution: "KDOT / KC Scout / KanDrive" },
  nedot: { st: "ne", state: "NE", name: "Nebraska DOT (511)", bbox: [-104.1, 39.9, -95.3, 43.1], home: "https://new.511.nebraska.gov/", attribution: "Nebraska DOT / 511" },
  indot: { st: "in", state: "IN", name: "INDOT (511in)", bbox: [-88.2, 37.7, -84.7, 41.8], home: "https://511in.org/", attribution: "INDOT / 511in" },
  codot: { st: "co", state: "CO", name: "CDOT (COtrip)", bbox: [-109.1, 36.9, -102.0, 41.1], home: "https://www.cotrip.org/", attribution: "CDOT / COtrip" },
  madot: { st: "ma", state: "MA", name: "MassDOT (Mass511)", bbox: [-73.6, 41.2, -69.8, 42.9], home: "https://mass511.com/", attribution: "MassDOT / Mass511" },
};

export const CAM_SOURCES = [
  { id: "aldot", name: "ALGO Traffic (ALDOT)", states: ["AL"], bbox: [-88.5, 30.1, -84.8, 35.1], kind: "traffic", attribution: "ALDOT / ALGO Traffic", home: "https://algotraffic.com/" },
  { id: "altv", name: "Alabama TV skycams", states: ["AL", "MS"], bbox: [-89.0, 30.1, -84.8, 35.1], kind: "sky", attribution: "WBRC FOX6 · WSFA 12 · WAFF 48 · FOX10 · Alabama Lightwave", home: "https://www.wbrc.com/weather/cams/" },
  ...Object.entries(CARS).map(([id, c]) => ({ id, name: c.name, states: [c.state], bbox: c.bbox, kind: "traffic", attribution: c.attribution, home: c.home })),
  { id: "caltrans", name: "Caltrans CCTV", states: ["CA"], bbox: [-124.5, 32.4, -114.0, 42.1], kind: "traffic", attribution: "Caltrans", home: "https://quickmap.dot.ca.gov/" },
  { id: "scdot", name: "SCDOT (511SC)", states: ["SC"], bbox: [-83.4, 32.0, -78.5, 35.3], kind: "traffic", attribution: "SCDOT / 511SC", home: "https://www.511sc.org/" },
  { id: "kytc", name: "KYTC (GoKY)", states: ["KY"], bbox: [-89.6, 36.4, -81.9, 39.2], kind: "traffic", attribution: "KYTC / TRIMARC", home: "https://goky.ky.gov/" },
  { id: "ardot", name: "ARDOT (IDriveArkansas)", states: ["AR"], bbox: [-94.7, 32.9, -89.6, 36.6], kind: "traffic", attribution: "ARDOT / IDriveArkansas", home: "https://www.idrivearkansas.com/" },
  { id: "okdot", name: "ODOT (OKTraffic)", states: ["OK"], bbox: [-103.1, 33.6, -94.4, 37.1], kind: "traffic", attribution: "Oklahoma DOT / OKTraffic", home: "https://oktraffic.org/", streamOnly: true },
  { id: "modot", name: "MoDOT Traveler Information", states: ["MO"], bbox: [-95.8, 35.9, -89.1, 40.7], kind: "traffic", attribution: "MoDOT", home: "https://traveler.modot.org/map/", note: "mostly streams; a dozen stills" },
  // Texas's rectangle would swallow half of Oklahoma; `boxes` (when present)
  // is the finer prefilter: main body, Red River strip, panhandle.
  { id: "txdot", name: "TxDOT ITS", states: ["TX"], bbox: [-106.7, 25.8, -93.5, 36.6], boxes: [[-106.7, 25.8, -93.5, 32.0], [-103.1, 32.0, -93.9, 34.0], [-103.1, 34.0, -99.9, 36.6]], kind: "traffic", attribution: "TxDOT", home: "https://its.txdot.gov/its/map", proxied: true },
  { id: "alertca", name: "ALERTCalifornia", states: ["CA"], bbox: [-124.5, 32.4, -114.0, 42.1], kind: "fire", attribution: "ALERTCalifornia · UC San Diego (CC BY-NC-ND 4.0)", home: "https://cameras.alertcalifornia.org/" },
  // Windy's own terms: link every image to its windy.com page (cam.page) and
  // show this courtesy line near the cameras.
  { id: "windy", name: "Windy Webcams", states: ["US"], bbox: [-180, 15, -60, 72], kind: "scenic", attribution: "Webcams provided by windy.com — add a webcam", home: "https://www.windy.com/webcams", requiresKey: "WINDY_API_KEY" },
];

const SRC = Object.fromEntries(CAM_SOURCES.map((s) => [s.id, s]));

// ── Helpers ──────────────────────────────────────────────────────────────────

const num = (x) => (x === null || x === undefined || x === "" ? NaN : Number(x));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const inBox = (lat, lon, [w, s, e, n]) => lat >= s && lat <= n && lon >= w && lon <= e;
const boxesMeet = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

function circleBox(lat, lon, mi) {
  const dLat = mi / 69;
  const dLon = mi / (69 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

// An https URL safe to drop into <img src>: spaces and the like get encoded,
// and plain http is refused (mixed content on an https page) unless the host
// is known to serve the same path over https.
function webUrl(u, upgradeHttp = false) {
  if (!u || typeof u !== "string") return undefined;
  let s = u.trim();
  if (upgradeHttp && s.startsWith("http://")) s = "https://" + s.slice(7);
  try {
    const url = new URL(s);
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function titleCase(s) {
  return String(s).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// Build a normalized cam, or null if it has no usable position or media.
function cam(src, f) {
  const lat = num(f.lat);
  const lon = num(f.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inBox(lat, lon, src.bbox)) return null;
  const snapshot = f.snapshot && f.snapshot.startsWith("/") ? f.snapshot : webUrl(f.snapshot, f.upgradeHttp) || null;
  const hls = webUrl(f.hls);
  if (!snapshot && !hls) return null;
  const out = {
    id: `${src.id}:${f.id}`,
    source: src.id,
    name: String(f.name || f.id).replace(/\s+/g, " ").trim(),
    city: f.city || undefined,
    state: f.state,
    lat: round(lat, 5),
    lon: round(lon, 5),
    snapshot,
    hls,
    page: webUrl(f.page) || src.home,
    kind: f.kind || src.kind,
    attribution: f.attribution || src.attribution,
    refreshSec: snapshot ? f.refreshSec || 300 : null,
  };
  for (const k of ["views", "approx", "heading", "embed", "expires", "updated"]) if (f[k] !== undefined) out[k] = f[k];
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

const keep = (arr) => arr.filter(Boolean);
const get = (url, env, opts = {}) => fetchJSON(url, { env, ttl: 300, timeoutMs: SOURCE_DEADLINE_MS + 4e3, ...opts });

// ── Loaders (one per source; each returns normalized cams) ───────────────────

// ALGO Traffic: ALDOT's statewide system. Wowza HLS is CORS-open.
async function loadAldot(env) {
  const rows = await get("https://api.algotraffic.com/v4.0/Cameras", env);
  return keep(rows.map((c) => {
    if (c.accessLevel !== "Public") return null; // a few are ALDOT/first-responder only
    const loc = c.location || {};
    return cam(SRC.aldot, {
      id: c.id,
      name: [loc.displayRouteDesignator, loc.displayCrossStreet].filter(Boolean).join(" at "),
      city: loc.city,
      state: "AL",
      lat: loc.latitude,
      lon: loc.longitude,
      snapshot: c.snapshotImageUrl,
      hls: c.playbackUrls && c.playbackUrls.hls,
      page: c.permLink,
      refreshSec: 300,
    });
  }));
}

// CARS: one record per camera site with 1–9 views (RWIS sites look several
// ways). The first still is the snapshot; all stills ride along in `views`.
function carsLoader(id) {
  const c = CARS[id];
  return async (env) => {
    const rows = await get(`https://${c.st}tg.carsprogram.org/cameras_v1/api/cameras`, env);
    const now = Date.now();
    return keep(rows.map((r) => {
      if (r.public === false) return null;
      const views = r.views || [];
      const newest = Math.max(0, ...views.map((v) => v.imageTimestamp || 0));
      if (newest && now - newest > STALE_MS) return null;
      const stills = keep(views.map((v) => {
        const url = webUrl(v.type === "STILL_IMAGE" ? v.url : v.videoPreviewUrl);
        return url && { name: v.name, snapshot: url };
      }));
      // Streams only when they need no token (Kansas's skyvdn links carry a
      // 5-minute JWT, which a cached registry would serve expired) and sit on
      // 443 (Iowa's :8888 servers couldn't be verified from here).
      const stream = views.find((v) => {
        if (v.type !== "WMP" || !v.url) return false;
        try {
          const u = new URL(v.url);
          return u.protocol === "https:" && u.pathname.endsWith(".m3u8") && !u.searchParams.has("token") && (!u.port || u.port === "443");
        } catch {
          return false;
        }
      });
      const loc = r.location || {};
      return cam(SRC[id], {
        id: r.id,
        name: r.name,
        city: (loc.cityReference || "").replace(/^in /, "") || undefined,
        state: c.state,
        lat: loc.latitude,
        lon: loc.longitude,
        snapshot: stills[0] && stills[0].snapshot,
        hls: stream && stream.url,
        refreshSec: 120,
        views: stills.length > 1 ? stills : undefined,
        updated: newest ? new Date(newest).toISOString() : undefined,
      });
    }));
  };
}

// Caltrans publishes one JSON file per district (68 KB – 2.4 MB each), so the
// source is partitioned: a search loads only the districts it overlaps.
const CALTRANS_DISTRICTS = [
  [1, [-124.3, 38.6, -122.5, 42.1]], [2, [-123.1, 39.7, -119.9, 42.1]], [3, [-122.3, 38.0, -119.9, 39.9]],
  [4, [-122.9, 36.8, -121.4, 38.6]], [5, [-122.1, 34.3, -119.4, 37.2]], [6, [-120.8, 34.7, -118.7, 37.4]],
  [7, [-119.4, 33.6, -117.6, 34.9]], [8, [-117.8, 33.3, -114.4, 35.7]], [9, [-119.6, 34.9, -117.8, 38.5]],
  [10, [-121.8, 36.9, -119.8, 38.5]], [11, [-117.5, 32.4, -115.4, 33.4]], [12, [-118.2, 33.3, -117.5, 34.0]],
];

async function loadCaltransDistrict(n, env) {
  const nn = String(n).padStart(2, "0");
  const doc = await get(`https://cwwp2.dot.ca.gov/data/d${n}/cctv/cctvStatusD${nn}.json`, env);
  return keep((doc.data || []).map(({ cctv: c }) => {
    if (!c || c.inService !== "true") return null;
    const loc = c.location || {};
    const img = c.imageData || {};
    const st = img.static || {};
    const every = Number(st.currentImageUpdateFrequency); // minutes
    return cam(SRC.caltrans, {
      id: `d${n}-${c.index}`,
      name: loc.locationName,
      city: loc.nearbyPlace,
      state: "CA",
      lat: loc.latitude,
      lon: loc.longitude,
      snapshot: st.currentImageURL,
      hls: img.streamingVideoURL,
      refreshSec: every > 0 ? every * 60 : 300,
    });
  }));
}

// SCDOT's 511 map reads a CDN GeoJSON; PNG stills, CORS-open HLS.
async function loadScdot(env) {
  const doc = await get("https://sc.cdn.iteris-atis.com/geojson/icons/metadata/icons.cameras.geojson", env);
  return keep((doc.features || []).map((f) => {
    const p = f.properties || {};
    const [lon, lat] = (f.geometry && f.geometry.coordinates) || [];
    if (!p.active) return null;
    return cam(SRC.scdot, {
      id: p.id || p.name,
      name: p.description || p.name,
      city: p.jurisdiction,
      state: "SC",
      lat,
      lon,
      snapshot: p.image_url,
      hls: p.problem_stream ? undefined : p.https_url,
      refreshSec: 60,
    });
  }));
}

// KYTC's public ArcGIS layer (what GoKY reads). Stills come from TRIMARC and
// are big (0.4–1.2 MB). A handful point at a dead Indiana host — dropped.
async function loadKytc(env) {
  const q = "https://services2.arcgis.com/CcI36Pduqd0OR4W9/ArcGIS/rest/services/trafficCamerasCur_Prd/FeatureServer/0/query" +
    "?where=1%3D1&outFields=OBJECTID,id,name,description,snapshot,status,latitude,longitude,county&returnGeometry=false&f=json";
  const doc = await get(q, env);
  return keep((doc.features || []).map(({ attributes: a }) => {
    if (!a || a.status !== "Online" || !/^https?:\/\/www\.trimarc\.org\//.test(a.snapshot || "")) return null;
    return cam(SRC.kytc, {
      id: a.name || a.id || a.OBJECTID,
      name: a.description,
      city: a.county ? `${a.county} Co.` : undefined,
      state: "KY",
      lat: a.latitude,
      lon: a.longitude,
      snapshot: a.snapshot,
      upgradeHttp: true, // trimarc.org serves the same paths over https
      refreshSec: 60,
    });
  }));
}

// IDriveArkansas: stills only (its HLS needs a vended session — 403 otherwise).
// The site's poster URL (actis…/api/cameras/image?camera=ID) 302s to this
// static PNG; linking the PNG directly skips their PHP hop. Large (~400 KB),
// refreshed about every 20 minutes.
async function loadArdot(env) {
  const doc = await get("https://layers.idrivearkansas.com/cameras.geojson", env);
  return keep((doc.features || []).map((f) => {
    const p = f.properties || {};
    const [lon, lat] = (f.geometry && f.geometry.coordinates) || [];
    if (p.status !== "online") return null;
    return cam(SRC.ardot, {
      id: p.id,
      name: p.name,
      state: "AR",
      lat,
      lon,
      snapshot: `https://layers.idrivearkansas.com/cameras/${p.id}.jpg`,
      refreshSec: 900,
    });
  }));
}

// OKTraffic: the public map's own LoopBack query (same filter it sends), so
// login-only and out-of-service cameras stay out. Streams only — even the
// site's thumbnails are video players.
async function loadOkdot(env) {
  const filter = {
    include: [{
      relation: "mapCameras",
      scope: { include: "streamDictionary", where: { status: { neq: "Out Of Service" }, type: "Web", blockAtis: { neq: "1" } } },
    }],
  };
  const rows = await get(`https://oktraffic.org/api/CameraPoles?filter=${encodeURIComponent(JSON.stringify(filter))}`, env);
  const out = [];
  for (const pole of rows) {
    for (const m of pole.mapCameras || []) {
      const sd = m.streamDictionary;
      out.push(cam(SRC.okdot, {
        id: m.id,
        name: m.location || pole.name,
        city: m.city,
        state: "OK",
        lat: m.latitude,
        lon: m.longitude,
        hls: sd && sd.streamSrc,
        page: `https://oktraffic.org/cameras/locations/${pole.id}`,
      }));
    }
  }
  return keep(out);
}

// MoDOT: ~560 open HLS streams plus a dozen stills. The Kansas City streams
// (traveler.modot.org/tisvc/…) answer 403 to any other Referer, so they're
// skipped — KC Scout's stills arrive through the Kansas feed anyway.
async function loadModot(env) {
  const [streams, snaps] = await Promise.all([
    get("https://traveler.modot.org/timconfig/feed/desktop/StreamingCams2.json", env),
    get("https://traveler.modot.org/map/js/snapshot.json", env).catch(() => ({ cameras: [] })),
  ]);
  const out = streams.map((s) => {
    if (!s.html || s.html.includes("/tisvc/")) return null;
    const m = /\/([^/]+)\/playlist\.m3u8/.exec(s.html);
    return cam(SRC.modot, { id: m ? m[1] : s.location, name: s.location, state: "MO", lat: s.y, lon: s.x, hls: s.html });
  });
  for (const c of snaps.cameras || []) {
    const loc = c.location || {};
    out.push(cam(SRC.modot, {
      id: `still-${c.id}`,
      name: c.caption,
      state: "MO",
      lat: loc.y,
      lon: loc.x,
      snapshot: new URL(c.url, "https://traveler.modot.org/").href,
      refreshSec: 300,
    }));
  }
  return keep(out);
}

// TxDOT ITS: 4,300+ cameras, but a snapshot is only ever base64 inside JSON
// (GetCctvSnapshotByIcdId), so stills route through camSnapshot(). About a
// third have no current image at any moment; that route 404s for those.
async function loadTxdot(env) {
  const rows = await get("https://its.txdot.gov/its/Map/GetIconModelsOfType?type=camera", env);
  return keep(rows.map((r) => r.owner && cam(SRC.txdot, {
    id: r.owner,
    name: r.name,
    state: "TX",
    lat: r.lat,
    lon: r.lon,
    snapshot: `${CAM_SNAPSHOT_PATH}?id=${encodeURIComponent(`txdot:${r.owner}`)}`,
    refreshSec: 120,
  })));
}

// ALERTCalifornia: fire-lookout PTZ cameras (most of California's ridgelines,
// HPWREN's included). CC BY-NC-ND 4.0 — fine for a non-commercial site with
// the attribution, shown unaltered. `heading` is where the camera points now.
async function loadAlertca(env) {
  const doc = await get("https://cameras.alertcalifornia.org/public-camera-data/all_cameras-v3.json", env);
  const fresh = Date.now() / 1000 - 3600;
  return keep((doc.features || []).map((f) => {
    const p = f.properties || {};
    const [lon, lat] = (f.geometry && f.geometry.coordinates) || [];
    if (p.state !== "CA" || !(p.last_frame_ts > fresh)) return null;
    const id = encodeURIComponent(p.id);
    return cam(SRC.alertca, {
      id: p.id,
      name: p.name || p.id,
      city: p.county ? `${titleCase(p.county)} Co.` : undefined,
      state: "CA",
      lat,
      lon,
      snapshot: `https://cameras.alertcalifornia.org/public-camera-data/${id}/latest-frame.jpg`,
      page: `https://cameras.alertcalifornia.org/?id=${id}`,
      refreshSec: 60,
      heading: Number.isFinite(p.az_current) ? Math.round(p.az_current) : undefined,
    });
  }));
}

// Alabama TV skycams with stable, hotlinkable stills (checked live
// 2026-10-09). Stations name places, not coordinates, so each sits at its
// town's Census Gazetteer 2024 internal point and carries approx: true.
// Left out: names that don't resolve to a place (Craneworks, Bear Creek,
// Eoline, Sixmile, Boondocks at Lake Martin, Calhoun CC, East Limestone, FOX10
// "Beach Cam"), WAFF's Monte Sano (404) and FOX10's Dauphin Island (hours
// stale). ABC 33/40, WHNT and WKRG can't be embedded — see SKYCAM_LINKS.
const TOWN = {
  homewood: [33.45855, -86.80965], oneonta: [33.947038, -86.489793], hoover: [33.375128, -86.809416],
  cullman: [34.17687, -86.840656], gardendale: [33.674039, -86.80846], glencoe: [33.948339, -85.933606],
  hamilton: [34.138713, -87.970833], jacksonville: [33.810066, -85.755217], jasper: [33.85111, -87.268348],
  northport: [33.257565, -87.596396], tuscaloosa: [33.234404, -87.5283], montevallo: [33.126053, -86.847702],
  nectar: [33.979779, -86.620614], oakgrove: [33.190359, -86.303727], bessemer: [33.370858, -86.971522],
  reform: [33.37826, -88.017273], sumiton: [33.749269, -87.046903], vernon: [33.758816, -88.114291],
  centreville: [32.958967, -87.132043], fayette: [33.694215, -87.831169], birmingham: [33.527174, -86.797036],
  centre: [34.153059, -85.671683], jemison: [32.970705, -86.73307], woodstock: [33.217498, -87.148433],
  montgomery: [32.348503, -86.267307], selma: [32.416983, -87.035702], troy: [31.80196, -85.96713],
  tuskegee: [32.418723, -85.682509], wetumpka: [32.540376, -86.206999], huntsville: [34.69772, -86.67667],
  guntersville: [34.367947, -86.252323], florence: [34.82981, -87.662202], muscleshoals: [34.742657, -87.633767],
  decatur: [34.572995, -86.989901], madison: [34.710533, -86.76228], athens: [34.779021, -86.950799],
  mobile: [30.668246, -88.107853], diberville: [30.443519, -88.895358],
};

const STATIONS = {
  wbrc: { attribution: "WBRC FOX6 SkyVision", page: "https://www.wbrc.com/weather/cams/", refreshSec: 300, base: "https://webpubcontent.gray.tv/wbrc/cameras/" },
  lightwave: { attribution: "Alabama Lightwave (via WBRC FOX6)", page: "https://www.wbrc.com/weather/cams/", refreshSec: 300, base: "https://alabamalightwave.com/cameras/alabama/" },
  wsfa: { attribution: "WSFA 12 News", page: "https://www.wsfa.com/weather/cams/", refreshSec: 60, base: "https://g1.ipcamlive.com/player/snapshot.php?alias=" },
  waff: { attribution: "WAFF 48", page: "https://www.waff.com/weather/cams/", refreshSec: 60, base: "https://g1.ipcamlive.com/player/snapshot.php?alias=" },
  fox10: { attribution: "FOX10 News (WALA)", page: "https://www.fox10tv.com/weather/cams/", refreshSec: 300, base: "https://webpubcontent.gray.tv/wala/weather/" },
};

// [station, name, town, image path (appended to the station's base)]
const ALTV = [
  ["wbrc", "Baptist Health Brookwood", "homewood", "JEFFERSON_CO_BAPTIST_HEALTH_BROOKWOOD.jpg"],
  ["wbrc", "Appalachian School (Blount Co.)", "oneonta", "BLOUNT_CO_APPALACHIAN_SCHOOL.jpg"],
  ["wbrc", "Bluff Park", "hoover", "JEFFERSON_CO_BLUFF_PARK_DINER.jpg"],
  ["wbrc", "Cullman (WKUL)", "cullman", "CULLMAN_CO_CULLMAN_WKUL.jpg"],
  ["wbrc", "Cullman High School", "cullman", "CULLMAN_CO_CULLMAN_HIGH_SCHOOL_BARON.jpg"],
  ["wbrc", "Gardendale", "gardendale", "JEFFERSON_CO_GARDENDALE_ADAIR_TIRE.jpg"],
  ["wbrc", "Glencoe", "glencoe", "ETOWAH_CO_GLENCOE_BARON.jpg"],
  ["wbrc", "Hamilton", "hamilton", "MARION_CO_HAMILTON_BARON.jpg"],
  ["wbrc", "Jacksonville 911 Tower", "jacksonville", "CALHOUN_CO_911_JSU_1.jpg"],
  ["wbrc", "Jacksonville State University", "jacksonville", "CALHOUN_CO_JSU_2.jpg"],
  ["wbrc", "Jasper", "jasper", "WALKER_CO_JASPER_DOWNTOWN.jpg"],
  ["wbrc", "Lake Tuscaloosa (Pier 43)", "northport", "TUSCALOOSA_CO_LAKE_TUSCALOOSA_PIER_43.jpg"],
  ["wbrc", "Mercedes-Benz Amphitheater", "tuscaloosa", "TUSCALOOSA_CO_MERCEDES_BENZ_AMPHITHEATER.jpg"],
  ["wbrc", "Montevallo", "montevallo", "SHELBY_CO_MONTEVALLO.jpg"],
  ["wbrc", "Nectar", "nectar", "BLOUNT_CO_NECTAR.jpg"],
  ["wbrc", "Northport", "northport", "TUSCALOOSA_CO_NORTHPORT_ERVINS.jpg"],
  ["wbrc", "Oak Grove (Talladega Co.)", "oakgrove", "TALLEDEGA_CO_OAK_GROVE.jpg"],
  ["wbrc", "Bessemer", "bessemer", "JEFFERSON_CO_BESSEMER_PINNACLE_MOTORSPORTS.jpg"],
  ["wbrc", "Reform", "reform", "PICKENS_CO_REFORM_ALA_PROP_DEV.jpg"],
  ["wbrc", "Sumiton", "sumiton", "JEFFERSON_CO_SUMITON.jpg"],
  ["wbrc", "Tuscaloosa River Walk", "tuscaloosa", "TUSCALOOSA_CO_TUSCALOOSA_RIVER_WALK.jpg"],
  ["wbrc", "Vernon", "vernon", "LAMAR_CO_VERNON_AVADIAN_CREDIT_UNION.jpg"],
  ["lightwave", "Centreville", "centreville", "bibb/centreville.jpg"],
  ["lightwave", "Fayette (DCH Fayette Medical Center)", "fayette", "fayette/dch-fayette-medical-center.jpg"],
  ["lightwave", "Tuscaloosa (DCH Regional Medical Center)", "tuscaloosa", "tuscaloosa/dch-regional-medical-center.jpg"],
  ["lightwave", "Downtown Birmingham", "birmingham", "jefferson/birmingham.jpg"],
  ["lightwave", "Downtown Centre", "centre", "cherokee/downtowncentre.jpg"],
  ["lightwave", "Jemison", "jemison", "chilton/jemison.jpg"],
  ["lightwave", "Tuscaloosa (Regency Retirement)", "tuscaloosa", "tuscaloosa/tuscaloosa.jpg"],
  ["lightwave", "Woodstock", "woodstock", "bibb/woodstock.jpg"],
  ["wsfa", "Alabama State University", "montgomery", "5d700c1a3db67"],
  ["wsfa", "Auburn University Montgomery", "montgomery", "5d418c759e925"],
  ["wsfa", "Dexter Avenue", "montgomery", "5cb493c8b4da9"],
  ["wsfa", "Montgomery Regional Airport", "montgomery", "6408a11f6fb74"],
  ["wsfa", "RSA Tower", "montgomery", "5d53356c0df94"],
  ["wsfa", "WSFA Roof", "montgomery", "5ea2124cc02c5"],
  ["wsfa", "Selma", "selma", "650ae7fdd325b"],
  ["wsfa", "Troy University", "troy", "5cb49403d7612"],
  ["wsfa", "Tuskegee", "tuskegee", "5ed8f6dbc530c"],
  ["wsfa", "Wind Creek Casino, Wetumpka", "wetumpka", "61d34a3246bfa"],
  ["waff", "U.S. Space & Rocket Center", "huntsville", "spaceandrocket"],
  ["waff", "Memorial Parkway", "huntsville", "lanierford"],
  ["waff", "I-565 in Madison", "madison", "7800building"],
  ["waff", "Guntersville", "guntersville", "guntersville2"],
  ["waff", "Florence", "florence", "florence"],
  ["waff", "Muscle Shoals", "muscleshoals", "muscleshoals"],
  ["waff", "Decatur 1", "decatur", "decatur"],
  ["waff", "Decatur 2", "decatur", "decatur2"],
  ["waff", "Athens", "athens", "athens"],
  ["fox10", "Downtown Mobile (Dauphin's)", "mobile", "DauphinsCam-Skycam.jpg"],
  ["fox10", "Admiral Hotel, Mobile", "mobile", "admiral-skycam.jpg"],
  ["fox10", "Bankhead Tunnel, Mobile", "mobile", "SocialExperiment-Skycam.jpg"],
  ["fox10", "USS Alabama Battleship", "mobile", "battleship-skycam.jpg"],
  ["fox10", "D'Iberville (Scarlet Pearl)", "diberville", "DIberville-Skycam.jpg"],
];

async function loadAltv() {
  return keep(ALTV.map(([st, name, town, path]) => {
    const s = STATIONS[st];
    const [lat, lon] = TOWN[town];
    return cam(SRC.altv, {
      id: `${st}-${path.replace(/\.jpg$/i, "").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}`,
      name,
      state: town === "diberville" ? "MS" : "AL",
      lat,
      lon,
      snapshot: s.base + path,
      page: s.page,
      attribution: s.attribution,
      refreshSec: s.refreshSec,
      approx: true,
    });
  }));
}

// Windy Webcams API v3 — query-only (the free tier can't enumerate: offset
// ≤ 1000, 50 per page), so it's asked per search. Built from the v3 docs and
// untested without a key. Image URLs carry a token that expires (10 min on
// the free tier), so results are memoized 3 min and stamped with `expires`.
async function windyNear(lat, lon, radiusMi, env) {
  const km = clamp(Math.round(radiusMi * 1.609), 1, 250);
  return memo(`cams:windy:${lat.toFixed(2)},${lon.toFixed(2)},${km}`, 3 * 60e3, async () => {
    const url = "https://api.windy.com/webcams/api/v3/webcams" +
      `?nearby=${lat.toFixed(4)},${lon.toFixed(4)},${km}&limit=50&include=categories,images,location,player,urls`;
    const doc = await get(url, env, { ttl: 60, headers: { "x-windy-api-key": env.WINDY_API_KEY } });
    const expires = new Date(Date.now() + WINDY_TOKEN_MS).toISOString();
    return keep((doc.webcams || []).map((w) => {
      if (w.status && w.status !== "active") return null;
      const loc = w.location || {};
      const cats = (w.categories || []).map((c) => c.id);
      const region = /^US\.([A-Z]{2})$/.exec(loc.region_code || "");
      return cam(SRC.windy, {
        id: w.webcamId,
        name: w.title,
        city: loc.city,
        state: region ? region[1] : loc.region,
        lat: loc.latitude,
        lon: loc.longitude,
        snapshot: windyImage(w.images),
        page: w.urls && w.urls.detail, // required by Windy's terms: link the image here
        embed: w.player && (w.player.live || w.player.day), // iframe player URL
        kind: cats.includes("traffic") ? "traffic" : cats.includes("meteo") ? "sky" : "scenic",
        refreshSec: 600,
        expires,
      });
    }));
  });
}

// images.current maps size names to URLs and images.sizes gives each size's
// width; the docs don't fix the names (free tier gets "only small sizes"), so
// take the widest one offered.
function windyImage(images) {
  const cur = (images && images.current) || {};
  const sizes = (images && images.sizes) || {};
  let best;
  let bestW = -1;
  for (const [k, u] of Object.entries(cur)) {
    const w = (sizes[k] && sizes[k].width) || 0;
    if (typeof u === "string" && w > bestW) [best, bestW] = [u, w];
  }
  return best;
}

const LOADERS = {
  aldot: loadAldot,
  altv: loadAltv,
  ...Object.fromEntries(Object.keys(CARS).map((id) => [id, carsLoader(id)])),
  scdot: loadScdot,
  kytc: loadKytc,
  ardot: loadArdot,
  okdot: loadOkdot,
  modot: loadModot,
  txdot: loadTxdot,
  alertca: loadAlertca,
};
const PARTS = {
  caltrans: CALTRANS_DISTRICTS.map(([n, bbox]) => ({ key: `d${n}`, bbox, load: (env) => loadCaltransDistrict(n, env) })),
};
const QUERY = { windy: windyNear };

// ── Registry ─────────────────────────────────────────────────────────────────

// Two layers: the isolate memo (10 min) and the colo's edge cache, which
// holds the *normalized* list — far smaller than the raw feeds (Caltrans d4
// is 2.4 MB raw), so a fresh isolate skips both the download and the big parse.
function registryPart(id, key, load, env, ctx) {
  return memo(`cams:${id}:${key}`, REGISTRY_TTL_SEC * 1000, () =>
    edgeJSON(`cams/reg/v1/${id}/${key}`, REGISTRY_TTL_SEC, () => load(env), ctx));
}

// All normalized cams for one source. opts.bbox limits a partitioned source
// (Caltrans) to the parts it overlaps. Query-only (Windy) and unconfigured
// keyed sources return [].
export async function camRegistry(sourceId, env, { ctx, bbox } = {}) {
  const src = SRC[sourceId];
  if (!src) throw new Error(`unknown camera source: ${sourceId}`);
  if (src.requiresKey && !(env && env[src.requiresKey])) return [];
  if (PARTS[sourceId]) {
    const parts = PARTS[sourceId].filter((p) => !bbox || boxesMeet(p.bbox, bbox));
    const lists = await Promise.all(parts.map((p) => registryPart(sourceId, p.key, p.load, env, ctx)));
    return lists.flat();
  }
  if (!LOADERS[sourceId]) return [];
  return registryPart(sourceId, "all", LOADERS[sourceId], env, ctx);
}

// ── Search ───────────────────────────────────────────────────────────────────

function enabledKeyed(env) {
  return CAM_SOURCES.filter((s) => s.requiresKey && env && env[s.requiresKey]).map((s) => s.id).join("+") || "base";
}

// kinds may arrive as an array or a query-string value like "sky,fire".
function kindList(kinds) {
  const list = Array.isArray(kinds) ? kinds : typeof kinds === "string" ? kinds.split(",") : [];
  return list.map((k) => String(k).trim()).filter(Boolean).sort();
}

function optsKey({ kinds, requireSnapshot }) {
  return `${kinds.length ? kinds.join("+") : "all"}${requireSnapshot ? "/still" : ""}`;
}

// Every cam within radiusMi of the point, nearest first, each with distMi and
// a compass bearing from the point. Sources whose bbox misses the search box
// are never touched; each one that is gets SOURCE_DEADLINE_MS, and one that
// fails or runs late becomes a note instead of an error.
async function gather(lat, lon, radiusMi, env, ctx, { kinds, requireSnapshot } = {}) {
  const box = circleBox(lat, lon, radiusMi);
  const jobs = [];
  for (const src of CAM_SOURCES) {
    if (src.requiresKey && !(env && env[src.requiresKey])) continue;
    if (!(src.boxes || [src.bbox]).some((b) => boxesMeet(b, box))) continue;
    if (kinds && kinds.length && !kinds.includes(src.kind) && src.id !== "windy") continue; // Windy's kind is per cam
    if (requireSnapshot && src.streamOnly) continue;
    const run = QUERY[src.id] ? QUERY[src.id](lat, lon, radiusMi, env) : camRegistry(src.id, env, { ctx, bbox: box });
    jobs.push({ id: src.id, run });
  }
  const settled = await Promise.allSettled(jobs.map((j) => withDeadline(j.run, SOURCE_DEADLINE_MS, j.id)));
  const cams = [];
  const sources = {};
  const notes = [];
  let partial = false;
  if (!jobs.length) {
    const windy = SRC.windy.requiresKey;
    notes.push(`no camera source covers this area${env && env[windy] ? "" : ` (Windy's nationwide webcams need ${windy})`}`);
  }
  settled.forEach((r, i) => {
    const { id, run } = jobs[i];
    sources[id] = 0;
    if (r.status === "rejected") {
      partial = true;
      notes.push(`${id}: ${(r.reason && r.reason.message) || r.reason}`);
      // Let a late registry finish so the next request finds it cached.
      if (ctx && ctx.waitUntil) ctx.waitUntil(run.catch(() => {}));
      return;
    }
    for (const c of r.value) {
      if (kinds && kinds.length && !kinds.includes(c.kind)) continue;
      if (requireSnapshot && !c.snapshot) continue;
      const d = haversineMi(lat, lon, c.lat, c.lon);
      if (d > radiusMi) continue;
      cams.push({ ...c, distMi: round(d, 1), bearing: compass(bearingDeg(lat, lon, c.lat, c.lon)), _d: d });
    }
  });
  cams.sort((a, b) => a._d - b._d);
  return { cams, sources, notes, partial };
}

// edgeJSON, except an answer missing a failed source isn't cached: the late
// registry is still loading (waitUntil above), so the next request can be whole.
// edgeJSON caches nothing when its producer throws, which is the escape hatch.
const PARTIAL = Symbol("partial");
async function cacheWhole(key, build, ctx) {
  let held;
  try {
    return await edgeJSON(key, NEAR_TTL_SEC, async () => {
      const res = await build();
      if (!res.partial) return res.value;
      held = res.value;
      throw PARTIAL;
    }, ctx);
  } catch (err) {
    if (err === PARTIAL) return held;
    throw err;
  }
}

// Nearest-first, but skip a cam that sits within SPREAD_MI of a picked one of
// the same kind (a dozen views of one interchange tell you little about a
// storm, while a skycam beside a traffic cam is a different view); skipped
// cams backfill only if the limit isn't reached otherwise.
function spread(cams, limit) {
  const picked = [];
  const skipped = [];
  for (const c of cams) {
    if (picked.length >= limit) break;
    if (picked.some((p) => p.kind === c.kind && haversineMi(p.lat, p.lon, c.lat, c.lon) < SPREAD_MI)) skipped.push(c);
    else picked.push(c);
  }
  for (const c of skipped) {
    if (picked.length >= limit) break;
    picked.push(c);
  }
  picked.sort((a, b) => a._d - b._d);
  return picked.map(({ _d, ...c }) => c);
}

function tally(picked, sources) {
  const out = { ...sources };
  for (const c of picked) out[c.source] = (out[c.source] || 0) + 1;
  return out;
}

// Cameras near a point. Options beyond the contract: kinds (e.g. ["sky",
// "fire"]) and requireSnapshot (drop stream-only cams, for an image grid).
// → { cams: [...cam, distMi, bearing], sources: { id: returned count } for
//     every source consulted, notes: [] }
export async function camsNear(lat, lon, { radiusMi = 50, limit = 12, env, ctx, kinds, requireSnapshot = false } = {}) {
  const la = num(lat);
  const lo = num(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
    throw new Error("camsNear: lat/lon required");
  }
  // Searches snap to ~1 km so nearby requests share one cached answer, and
  // distances are measured from that same snapped point.
  const qlat = round(la, 2);
  const qlon = round(lo, 2);
  const r = round(clamp(num(radiusMi) || 50, 1, MAX_RADIUS_MI), 1);
  const n = clamp(Math.round(num(limit) || 12), 1, 50);
  const k = kindList(kinds);
  const key = `cams/near/v1/${qlat},${qlon}/${r}/${n}/${enabledKeyed(env)}/${optsKey({ kinds: k, requireSnapshot })}`;
  return cacheWhole(key, async () => {
    const { cams, sources, notes, partial } = await gather(qlat, qlon, r, env, ctx, { kinds: k, requireSnapshot });
    const picked = spread(cams, n);
    return { partial, value: { cams: picked, sources: tally(picked, sources), notes } };
  }, ctx);
}

// ── Polygons (NWS warnings, watch boxes, hurricane warning zones) ────────────

function polygonsOf(geometry) {
  const g = geometry && geometry.type === "Feature" ? geometry.geometry : geometry;
  if (!g || !g.coordinates) return [];
  if (g.type === "Polygon") return [g.coordinates];
  if (g.type === "MultiPolygon") return g.coordinates;
  return [];
}

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(lon, lat, rings) {
  return inRing(lon, lat, rings[0]) && !rings.slice(1).some((h) => inRing(lon, lat, h));
}

// Miles from a point to the nearest polygon edge, on a local flat projection
// (plenty for buffers of tens of miles).
function edgeMi(lat, lon, polys) {
  const kx = 69.17 * Math.cos((lat * Math.PI) / 180);
  const ky = 69.17;
  let best = Infinity;
  for (const rings of polys) {
    for (const ring of rings) {
      for (let i = 1; i < ring.length; i++) {
        const ax = (ring[i - 1][0] - lon) * kx;
        const ay = (ring[i - 1][1] - lat) * ky;
        const bx = (ring[i][0] - lon) * kx;
        const by = (ring[i][1] - lat) * ky;
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 ? clamp(-(ax * dx + ay * dy) / len2, 0, 1) : 0;
        best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
      }
    }
  }
  return best;
}

// FNV-1a over the rounded coordinates: a short, stable cache key for a shape.
function shapeKey(polys) {
  const s = JSON.stringify(polys, (k, v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

// Cameras inside a GeoJSON Polygon/MultiPolygon (a Feature is unwrapped) or
// within bufferMi of its edge, nearest the centroid first. Each cam carries
// inside: true/false (and outsideMi when outside); distMi/bearing are from
// the centroid. A geometry-less alert (zone-based) returns no cams + a note.
export async function camsInGeometry(geometry, { limit = 12, bufferMi = 10, env, ctx, kinds, requireSnapshot = false } = {}) {
  const polys = polygonsOf(geometry);
  const center = polys.length ? geometryCenter({ coordinates: polys }) : null;
  if (!center) return { cams: [], sources: {}, notes: ["no polygon geometry"] };
  const buf = clamp(num(bufferMi) || 0, 0, 100);
  const n = clamp(Math.round(num(limit) || 12), 1, 50);
  const [w, s, e, nn] = center.bbox;
  const reach = Math.max(...[[s, w], [s, e], [nn, w], [nn, e]].map(([la, lo]) => haversineMi(center.lat, center.lon, la, lo))) + buf;
  const k = kindList(kinds);
  const key = `cams/geom/v1/${shapeKey(polys)}/${buf}/${n}/${enabledKeyed(env)}/${optsKey({ kinds: k, requireSnapshot })}`;
  return cacheWhole(key, async () => {
    const { cams, sources, notes, partial } = await gather(center.lat, center.lon, Math.min(reach, MAX_RADIUS_MI), env, ctx, { kinds: k, requireSnapshot });
    const hits = [];
    for (const c of cams) {
      const inside = polys.some((p) => inPolygon(c.lon, c.lat, p));
      const out = inside ? 0 : edgeMi(c.lat, c.lon, polys);
      if (inside || out <= buf) hits.push(inside ? { ...c, inside } : { ...c, inside, outsideMi: round(out, 1) });
    }
    const picked = spread(hits, n);
    return {
      partial,
      value: { cams: picked, sources: tally(picked, sources), notes, center: { lat: round(center.lat, 4), lon: round(center.lon, 4) } },
    };
  }, ctx);
}

// ── Texas snapshot proxy ─────────────────────────────────────────────────────

function b64bytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// GET CAM_SNAPSHOT_PATH?id=txdot:<camera> → image/jpeg. The router wires it:
//   if (url.pathname === CAM_SNAPSHOT_PATH) return camSnapshot(url.searchParams.get("id"), env, ctx);
// Only cameras in TxDOT's own list are fetched, so the route can't be aimed
// elsewhere; each image (or its absence) is edge-cached 60 s.
export async function camSnapshot(id, env, ctx) {
  const m = /^txdot:(.+)$/.exec(id || "");
  const miss = (status, msg) => new Response(msg, { status, headers: { "cache-control": "public, max-age=60" } });
  if (!m) return miss(404, "unknown camera");
  const cache = globalThis.caches && globalThis.caches.default;
  const cacheKey = new Request(`https://weathernet.internal/cams/snap/v1/${encodeURIComponent(id)}`);
  if (cache) {
    const hit = await cache.match(cacheKey).catch(() => undefined);
    if (hit) return hit;
  }
  const list = await camRegistry("txdot", env, { ctx }).catch(() => []);
  if (!list.some((c) => c.id === id)) return miss(404, "unknown camera");
  let res;
  try {
    const name = encodeURIComponent(m[1]);
    const doc = await get(`https://its.txdot.gov/its/DistrictIts/GetCctvSnapshotByIcdId?icdId=${name}&districtCode=${name}`, env, { ttl: 30, timeoutMs: SOURCE_DEADLINE_MS });
    res = doc && doc.snippet
      ? new Response(b64bytes(doc.snippet), {
          headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=60", "access-control-allow-origin": "*" },
        })
      : miss(404, "no current image");
  } catch (err) {
    return miss(502, `txdot: ${err.message}`);
  }
  if (cache) {
    const put = cache.put(cacheKey, res.clone()).catch(() => {});
    if (ctx && ctx.waitUntil) ctx.waitUntil(put);
    else await put;
  }
  return res;
}

// ── TV skycams that can't be embedded (or only partly) ───────────────────────
// Verified 2026-10-09 (HTTP 200 in a browser; WHNT and WKRG answer 403 to
// non-browser clients). `inSource` marks stations whose stills are in "altv".
// WVTM 13 has no camera page; WAAY 31's site now redirects to WAFF.
export const SKYCAM_LINKS = [
  { station: "ABC 33/40 (WBMA)", name: "Weather Cameras", url: "https://abc3340.com/weather/cameras", market: "Birmingham–Tuscaloosa–Anniston", note: "Sinclair player; HLS clip URLs rotate, so not embeddable" },
  { station: "WBRC FOX6", name: "SkyVision Cams", url: "https://www.wbrc.com/weather/cams/", market: "Birmingham–Tuscaloosa–Anniston", inSource: "altv" },
  { station: "WSFA 12", name: "Cameras", url: "https://www.wsfa.com/weather/cams/", market: "Montgomery–Selma", inSource: "altv" },
  { station: "WAFF 48", name: "Weather Cams", url: "https://www.waff.com/weather/cams/", market: "Huntsville–Decatur–Florence", inSource: "altv" },
  { station: "WHNT 19", name: "Camera Network", url: "https://whnt.com/camera-network/", market: "Huntsville–Decatur–Florence", note: "stills on Nexstar's CDN were weeks stale" },
  { station: "FOX10 (WALA)", name: "Weather Cams", url: "https://www.fox10tv.com/weather/cams/", market: "Mobile–Pensacola", inSource: "altv" },
  { station: "WKRG News 5", name: "Weather Cameras", url: "https://www.wkrg.com/weather/live-cams/", market: "Mobile–Pensacola", note: "per-camera pages with JS players; no stable stills" },
];
