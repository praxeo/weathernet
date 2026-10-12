// GOES-East / GOES-West imagery catalog for WeatherNet.
//
// Imagery comes from NOAA/NESDIS STAR's CDN (cdn.star.nesdis.noaa.gov), which
// serves every view as JPEGs named "<scan start>_<sat>-ABI-<sector>-<band>-<size>.jpg"
// plus nginx directory listings, fixed-name "latest" aliases and, for most
// bands, ready-made MP4/GIF loops. Meso-sector positions come from the GOES
// netCDF metadata NOAA publishes on AWS (exact), falling back to STAR's
// whole-degree directory names.
//
// Three things keep an uncached build cheap (~1.5 s, ~25 subrequests, ~1 MB
// gzipped transfer):
//  1. Scan times are shared. Every band and every regional sector cut from the
//     same ABI scan (the 5-min CONUS scan or the 10-min full disk) carries the
//     same timestamps, so one small listing per scan family indexes them all.
//  2. Listings hold ~10 days (1-3.4 MB). Only the tail matters — names sort by
//     time — so the body is streamed and just the last ~100 KB is kept.
//  3. The catalog is edge-cached for 3 minutes.

import { upstreamSignal, userAgent, withDeadline, haversineMi, bearingDeg, compass, round } from "../lib/net.js";
import { edgeJSON, memo } from "../lib/cache.js";

const CDN = "https://cdn.star.nesdis.noaa.gov/";
const GUIDES = "https://www.star.nesdis.noaa.gov/GOES/documents/";
const CACHE_KEY = "satellite/catalog/v1";
const CACHE_TTL = 180;

// lon is where the satellite sits (netCDF nominal_satellite_subpoint_lon);
// gridLon is the ABI fixed-grid origin the imagery is resampled to
// (longitude_of_projection_origin). GOES-19 parks at 75.2°W on a 75.0°W grid;
// projecting with 75.2 shifts CONUS pins 2-5 px east at 1250x750. GOES-18's
// own files report 137.0°W for both (not the often-quoted 137.2°W).
const SATS = {
  east: { id: "GOES19", name: "GOES-East", lon: -75.2, gridLon: -75.0, aws: "noaa-goes19", tag: "G19" },
  west: { id: "GOES18", name: "GOES-West", lon: -137.0, gridLon: -137.0, aws: "noaa-goes18", tag: "G18" },
};

// ── Bands / products ─────────────────────────────────────────────────────────
// STAR has no loops for band 10 (nor 09), and meso sectors carry no Air Mass.
const BANDS = [
  {
    id: "GEOCOLOR",
    title: "GeoColor",
    short: "True color by day, infrared at night",
    explain:
      "By day CIRA's GeoColor shows Earth about as your eye would (ABI has no green band, so green is synthesized); at night it switches to infrared, where fog and low stratus glow blue and higher ice clouds turn gray-white. The city lights are a static VIIRS map for orientation, not live.",
    guide: "QuickGuide_CIRA_Geocolor_20171019.pdf",
  },
  {
    id: "13",
    title: "Clean IR (Band 13, 10.3 µm)",
    short: "Cloud-top temperature, day and night",
    explain:
      "Band 13 (10.3 µm) is a 'clean' infrared window with little water-vapor absorption, so each pixel is the brightness temperature of ground, sea or cloud top, day and night. Colder tops mean taller clouds; STAR colors only the cold end. An enhanced-V or cold/warm couplet around an overshooting top often precedes severe weather by 20-30 minutes.",
    guide: "ABIQuickGuide_Band13.pdf",
  },
  {
    id: "08",
    title: "Upper-level water vapor (Band 8, 6.2 µm)",
    short: "Upper-tropospheric moisture, jets and troughs",
    explain:
      "Water vapor absorbs strongly at 6.2 µm, so Band 8 senses a moist layer high in the troposphere, not the surface. Dry, sinking air looks warm (red-yellow in STAR's palette) and moist air cool (white-blue, clouds green), outlining jet streams, troughs, ridges and dry slots; animated, it shows the flow steering storms.",
    guide: "ABIQuickGuide_Band08.pdf",
  },
  {
    id: "10",
    title: "Low-level water vapor (Band 10, 7.3 µm)",
    short: "Lower-mid tropospheric moisture and dry air",
    explain:
      "The least-absorbed of ABI's three water-vapor bands, Band 10 (7.3 µm) senses down to around 500-750 hPa in clear air. It shows low- to mid-level moisture plumes, drylines, dry intrusions and lake-effect bands that the upper-level band misses, plus SO₂-rich volcanic plumes. Same palette as Band 8.",
    guide: "ABIQuickGuide_Band10.pdf",
  },
  {
    id: "Sandwich",
    title: "Sandwich RGB",
    short: "Storm-top texture plus IR temperature",
    explain:
      "Color-enhanced Band 13 cloud-top temperatures laid over Band 3's fine visible texture show how cold a storm top is and its shape at once. Severe-storm signatures pop: overshooting tops, above-anvil cirrus plumes, gravity waves, and the cold-U, cold-V or cold-ring patterns of strong updrafts. The texture needs sunlight.",
    guide: "SandwichProduct.pdf",
  },
  {
    id: "AirMass",
    title: "Air Mass RGB",
    short: "Air masses, jet streaks, stratospheric intrusions",
    explain:
      "Water-vapor and ozone channel differences color warm, moist tropical air green and cold polar air blue-purple. Red-orange marks dry, ozone-rich stratospheric air descending behind troughs and along jet streaks: a potential-vorticity (PV) anomaly that often precedes rapid cyclogenesis. Thick high cloud is white; the disk edge reads falsely blue-violet.",
    guide: "QuickGuide_GOESR_AirMassRGB_final.pdf",
  },
  {
    id: "DayNightCloudMicroCombo",
    title: "Day Cloud Phase / Night Microphysics",
    short: "Cloud phase by day, fog by night",
    explain:
      "Day Cloud Phase Distinction in daylight, Nighttime Microphysics after dark. By day glaciating towers turn green and thick ice tops yellow while low water clouds stay cyan or lavender, tracking convection as it grows (snow is green too). By night fog is dull aqua to gray, very low warm cloud aqua, thick high cloud dark red.",
    guide: "ABIQuickGuide_DayNightCloudMicroCombo.pdf",
  },
  {
    id: "FireTemperature",
    title: "Fire Temperature RGB",
    short: "Active fires, color-coded by intensity",
    explain:
      "Hotter fires emit more at shorter wavelengths, so 3.9 µm (red), 2.2 µm (green) and 1.6 µm (blue) grade intensity: small or cool fires show only at 3.9 µm and look red, hotter ones run orange, yellow, then near-white. Burn scars are maroon. Clouds hide fires, and some hot desert ground looks falsely red.",
    guide: "QuickGuide_Fire_Temperature_RGB.pdf",
  },
];
const MESO_BANDS = BANDS.filter((b) => b.id !== "AirMass");
// RGBs that STAR thins when two meso sectors stack into 30-second imaging.
const MESO_GAPPY = new Set(["Sandwich", "FireTemperature", "DayNightCloudMicroCombo"]);

// ── Views ────────────────────────────────────────────────────────────────────
// kind: conus | sector | fd. family = which ABI scan the view is cut from
// (decides its timestamps). size = frame/latest size; loopSize = the size STAR
// names its MP4/GIF loop by (the CONUS MP4 is actually 1250x750 inside).
const CONUS = [
  { id: "conus-east", sat: "east", kind: "conus", sector: "CONUS", title: "CONUS (GOES-East)",
    region: "The Lower 48 with southern Canada, Mexico, the Gulf and the Caribbean", size: "1250x750", loopSize: "625x375" },
  { id: "conus-west", sat: "west", kind: "conus", sector: "CONUS", title: "Pacific U.S. (GOES-West CONUS)",
    region: "The northeast Pacific from Hawaii to the West Coast, the western states and Baja", size: "1250x750", loopSize: "625x375" },
];
// [code, sat, family, title, region, size, loopSize] — STAR's US-relevant sectors.
const SECTORS = [
  ["ne", "east", "conus", "Northeast", "New England, New York, Pennsylvania and the Mid-Atlantic", "1200x1200", "600x600"],
  ["cgl", "east", "conus", "Great Lakes", "All five Great Lakes, the Ohio Valley and southern Ontario", "1200x1200", "600x600"],
  ["umv", "east", "conus", "Upper Mississippi Valley", "Minnesota, Iowa, Wisconsin, Illinois and Missouri", "1200x1200", "600x600"],
  ["nr", "east", "conus", "Northern Rockies", "Montana, Wyoming, Idaho and the Dakotas", "1200x1200", "600x600"],
  ["sr", "east", "conus", "Southern Rockies", "Colorado, Utah, Arizona and New Mexico", "1200x1200", "600x600"],
  ["sp", "east", "conus", "Southern Plains", "Texas, Oklahoma and Kansas", "1200x1200", "600x600"],
  ["smv", "east", "conus", "Southern Mississippi Valley", "Louisiana, Mississippi, Arkansas, Tennessee and Alabama", "1200x1200", "600x600"],
  ["se", "east", "conus", "Southeast", "Georgia, Florida, the Carolinas and Alabama", "1200x1200", "600x600"],
  ["eus", "east", "conus", "U.S. Atlantic Coast", "The East Coast from Maine to Florida and the western Atlantic", "1000x1000", "1000x1000"],
  ["ga", "east", "conus", "Gulf of America", "The Gulf, Florida, Cuba and the Yucatán", "1000x1000", "1000x1000"],
  ["car", "east", "fd", "Caribbean", "The Caribbean Sea, the Antilles and Central America", "1000x1000", "1000x1000"],
  ["pr", "east", "fd", "Puerto Rico", "Puerto Rico, the Virgin Islands and nearby islands", "1200x1200", "600x600"],
  ["taw", "east", "fd", "Tropical Atlantic", "The tropical Atlantic from the Caribbean to Africa", "1800x1080", "900x540"],
  ["pnw", "west", "conus", "Pacific Northwest", "Washington, Oregon, Idaho and northern California", "1200x1200", "600x600"],
  ["psw", "west", "conus", "Pacific Southwest", "California, Nevada and Arizona", "1200x1200", "600x600"],
  ["wus", "west", "fd", "U.S. Pacific Coast", "The West Coast from British Columbia to Baja, with the eastern Pacific", "1000x1000", "1000x1000"],
  ["np", "west", "fd", "Northern Pacific", "The North Pacific storm track from the Aleutians to the West Coast", "1800x1080", "900x540"],
  ["ak", "west", "fd", "Alaska", "Alaska, the Gulf of Alaska and the Aleutians", "1000x1000", "1000x1000"],
  ["hi", "west", "fd", "Hawaii", "The Hawaiian Islands and the surrounding central Pacific", "1200x1200", "600x600"],
  ["tpw", "west", "fd", "Tropical Pacific", "The eastern and central tropical Pacific, Mexico to Hawaii", "1800x1080", "900x540"],
].map(([code, sat, family, title, region, size, loopSize]) => ({
  id: code, sat, kind: "sector", sector: code, family, title, region, size, loopSize,
}));
const FULL_DISK = [
  { id: "fd-east", sat: "east", kind: "fd", sector: "FD", title: "Full Disk (GOES-East)",
    region: "The whole Earth disk from 75.2°W: the Americas and the Atlantic", size: "1808x1808" },
  { id: "fd-west", sat: "west", kind: "fd", sector: "FD", title: "Full Disk (GOES-West)",
    region: "The whole Earth disk from 137.0°W: the Pacific from Alaska to the South Pacific", size: "1808x1808" },
];

// One small listing per scan family (a 4-size sector directory, the smallest
// listings on the CDN), read for scan times only. It is a GeoColor listing
// because RGB composites finish last: in the full-disk family single bands
// often land a scan earlier, so an IR index would promise composite frames
// that don't exist yet. GeoColor on the full CONUS and full-disk images runs
// a further 1-3 scans behind, so those two get a HEAD probe as well.
const INDEX = {
  east: { conus: ["SECTOR/se/GEOCOLOR", "1200x1200"], fd: ["SECTOR/pr/GEOCOLOR", "1200x1200"] },
  west: { conus: ["SECTOR/pnw/GEOCOLOR", "1200x1200"], fd: ["SECTOR/hi/GEOCOLOR", "1200x1200"] },
};

// Frames per band: the views that animate in-page get them; the rest ship
// `latest` + STAR's own MP4/GIF loop, which keeps the JSON to a few hundred KB.
const FRAMES = { conus: 24, meso: 24, fd: 12, sector: 12 };
const FD_FRAME_BANDS = new Set(["GEOCOLOR", "13"]);
const SECTOR_FRAME_BANDS = new Set(["GEOCOLOR"]);

// ── Projection (GOES-R PUG Vol. 3, 5.1.2.8) ──────────────────────────────────
// x0..x1 / y0..y1 are the outer edges (x_image_bounds / y_image_bounds from the
// GOES-19/18 CONUS netCDF files; full disk is the PUG's ±0.151872 rad) of the
// scan-angle grid the STAR images span; y runs north (top) to south. Checked
// by registering projected Natural Earth coastlines on the images: best-fit
// shift ≤ 0.25 px at 1250x750 (CONUS) and ≤ 0.33 px at 1808 (full disk).
const PROJECTION = {
  "conus-east": { satLon: -75.0, x0: -0.10136, x1: 0.03864, y0: 0.12824, y1: 0.04424, width: 1250, height: 750 },
  "conus-west": { satLon: -137.0, x0: -0.07, x1: 0.07, y0: 0.12824, y1: 0.04424, width: 1250, height: 750 },
  "fd-east": { satLon: -75.0, x0: -0.151872, x1: 0.151872, y0: 0.151872, y1: -0.151872, width: 1808, height: 1808 },
  "fd-west": { satLon: -137.0, x0: -0.151872, x1: 0.151872, y0: 0.151872, y1: -0.151872, width: 1808, height: 1808 },
};
const GEO = { h: 35786023, req: 6378137, rpol: 6356752.31414 };

// lat/lon (degrees) → pixel in a projection entry's image, or null when the
// point is on the far side of the Earth. Scale x/y by displayedWidth / width
// for other sizes of the same view (every size spans the same grid). `inside`
// is false for points that are on the disk but outside this image.
export function goesProject(lat, lon, proj) {
  if (!proj || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const { req, rpol } = GEO;
  const H = GEO.h + req;
  const e2 = 1 - (rpol * rpol) / (req * req);
  const phi = (lat * Math.PI) / 180;
  const lam = ((lon - proj.satLon) * Math.PI) / 180;
  const phiC = Math.atan(((rpol * rpol) / (req * req)) * Math.tan(phi)); // geocentric latitude
  const rc = rpol / Math.sqrt(1 - e2 * Math.cos(phiC) ** 2);
  const sx = H - rc * Math.cos(phiC) * Math.cos(lam);
  const sy = -rc * Math.cos(phiC) * Math.sin(lam);
  const sz = rc * Math.sin(phiC);
  if (H * (H - sx) < sy * sy + ((req * req) / (rpol * rpol)) * sz * sz) return null; // not visible
  const x = Math.asin(-sy / Math.hypot(sx, sy, sz));
  const y = Math.atan(sz / sx);
  const px = ((x - proj.x0) / (proj.x1 - proj.x0)) * proj.width;
  const py = ((y - proj.y0) / (proj.y1 - proj.y0)) * proj.height;
  return { x: round(px, 1), y: round(py, 1), inside: px >= 0 && px <= proj.width && py >= 0 && py <= proj.height };
}

// ── Catalog ──────────────────────────────────────────────────────────────────
export async function satelliteCatalog(env, ctx) {
  // memo shares one in-flight build between concurrent misses in an isolate.
  return edgeJSON(CACHE_KEY, CACHE_TTL, () => memo(CACHE_KEY, 60e3, () => buildCatalog(env)), ctx);
}

async function buildCatalog(env) {
  const notes = [];
  const fail = (what, err) => notes.push(`${what} unavailable (${String((err && err.message) || err).slice(0, 120)})`);

  // Everything independent starts at once; each piece has its own deadline and
  // a failure only drops that piece (bands keep `latest` and loops).
  const famJobs = [];
  for (const sat of ["east", "west"]) {
    for (const fam of ["conus", "fd"]) famJobs.push({ sat, fam });
  }
  const famP = Promise.allSettled(famJobs.map(({ sat, fam }) => familyStamps(env, sat, fam)));
  const mesoJobs = [];
  for (const sat of ["east", "west"]) for (const m of ["M1", "M2"]) mesoJobs.push({ sat, m });
  const mesoP = Promise.allSettled(mesoJobs.map(({ sat, m }) => mesoListing(env, sat, m)));
  const rootP = Promise.allSettled(["east", "west"].map((sat) => mesoRoot(env, sat)));
  const modeP = Promise.allSettled(["east", "west"].map((sat) => scanMode(env, sat)));
  const modes = {};
  (await modeP).forEach((r, i) => (modes[["east", "west"][i]] = r.status === "fulfilled" ? r.value : null));
  const awsP = withDeadline(mesoCenters(env, modes), 8e3, "meso centers").catch((e) => {
    fail("Exact meso centers (AWS netCDF)", e);
    return {};
  });

  // Family stamps, then probe the laggy GEOCOLOR views (newest frames that
  // aren't rendered yet would 404 at the end of the loop).
  const fam = {};
  (await famP).forEach((r, i) => {
    const { sat, fam: f } = famJobs[i];
    if (r.status === "fulfilled") fam[`${sat}:${f}`] = r.value;
    else fail(`${SATS[sat].name} ${f === "conus" ? "CONUS" : "full-disk"} frame index`, r.reason);
  });
  const viewSpecs = [...CONUS, ...SECTORS, ...FULL_DISK];
  const laggyStamps = {};
  await withDeadline(
    Promise.all(
      viewSpecs
        .filter((v) => v.kind !== "sector")
        .map(async (v) => {
          const stamps = fam[`${v.sat}:${v.kind === "fd" ? "fd" : "conus"}`];
          if (!stamps) return;
          const want = stamps.slice(-(frameCount(v, "GEOCOLOR") + 3));
          laggyStamps[`${v.id}:GEOCOLOR`] = await trimUnrendered(env, want, (s) => frameUrl(v, "GEOCOLOR", s), 3);
        })
    ),
    5e3,
    "GeoColor probes"
  ).catch(() => notes.push("GeoColor freshness probe timed out; the newest GeoColor frame may 404 briefly"));

  const views = [];
  const fullDisk = [];
  for (const v of viewSpecs) {
    const family = v.kind === "fd" ? "fd" : v.family || "conus";
    const stamps = fam[`${v.sat}:${family}`] || [];
    const bands = BANDS.map((b) => {
      const n = frameCount(v, b.id);
      const s = laggyStamps[`${v.id}:${b.id}`] || stamps;
      return bandEntry(b, v, n ? s.slice(-n) : []);
    });
    const entry = {
      id: v.id, sat: v.sat, sector: v.sector, title: v.title, region: v.region,
      cadenceMin: family === "fd" ? 10 : 5, bands,
    };
    if (v.kind === "fd") fullDisk.push(entry);
    else views.push(entry);
  }

  // Meso sectors: STAR listings give imagery + whole-degree location; AWS
  // netCDF headers give the exact center.
  const roots = {};
  (await rootP).forEach((r, i) => (roots[["east", "west"][i]] = r.status === "fulfilled" ? r.value : {}));
  const listings = {};
  (await mesoP).forEach((r, i) => {
    const { sat, m } = mesoJobs[i];
    if (r.status === "fulfilled") listings[`${sat}:${m}`] = r.value;
    else fail(`${SATS[sat].name} ${m} listing`, r.reason);
  });
  const gappy = await withDeadline(gappyMesoStamps(env, listings), 6e3, "meso RGB listings").catch((e) => {
    fail("30-second meso RGB frame lists", e);
    return {};
  });
  const centers = await awsP;
  const meso = mesoJobs.map(({ sat, m }) => mesoEntry(sat, m, listings, centers, roots[sat], gappy, notes));
  // Stacked sectors are one 30-second image stream (NOAA files it under one
  // sector, STAR in one directory): keep the imagery on the sector whose
  // netCDF stream is live and point its twin there instead of duplicating it.
  for (const sat of ["east", "west"]) {
    const pair = meso.filter((e) => e.sat === sat && e.coLocated);
    if (pair.length !== 2) continue;
    const [primary, twin] = centers[`${sat}:M2`] && !centers[`${sat}:M1`] ? [pair[1], pair[0]] : pair;
    twin.coLocatedWith = primary.id;
    twin.bands = [];
  }

  const sats = {};
  for (const [k, s] of Object.entries(SATS)) {
    sats[k] = { id: s.id, name: s.name, lon: s.lon, gridLon: s.gridLon, mode: modes[k] };
  }
  notes.push(
    "Frame URLs are built from one scan-time index per ABI scan (all bands and sectors of a scan share its timestamps); skip any frame that fails to load.",
    "STAR's CDN sends Access-Control-Allow-Origin: * and does not check Referer, so <img>/<video> (and canvas reads with crossorigin=anonymous) work from any origin; STAR supports the site Monday-Friday only.",
    "Images carry a caption bar over their bottom ~25 px (at 1250x750); projected pins there are hidden."
  );
  return {
    generated: new Date().toISOString(),
    sats,
    views,
    meso,
    fullDisk,
    projection: PROJECTION,
    notes,
  };
}

function frameCount(v, band) {
  if (v.kind === "conus") return FRAMES.conus;
  if (v.kind === "fd") return FD_FRAME_BANDS.has(band) ? FRAMES.fd : 0;
  return SECTOR_FRAME_BANDS.has(band) ? FRAMES.sector : 0;
}

function viewDir(v, band) {
  const s = SATS[v.sat].id;
  if (v.kind === "conus") return `${CDN}${s}/ABI/CONUS/${band}/`;
  if (v.kind === "fd") return `${CDN}${s}/ABI/FD/${band}/`;
  return `${CDN}${s}/ABI/SECTOR/${v.sector}/${band}/`;
}

// File names use the sector code as the directory does (lowercase for
// regional sectors); loop names use it uppercased.
function frameUrl(v, band, stamp) {
  const s = SATS[v.sat].id;
  return `${viewDir(v, band)}${stamp}_${s}-ABI-${v.sector}-${band}-${v.size}.jpg`;
}

function bandEntry(b, v, stamps) {
  const [width, height] = v.size.split("x").map(Number);
  const frames = stamps.map((s) => ({ t: stampISO(s), url: frameUrl(v, b.id, s) }));
  const dir = viewDir(v, b.id);
  const loopBase =
    v.loopSize && b.id !== "10" ? `${dir}${SATS[v.sat].id}-${v.sector.toUpperCase()}-${b.id}-${v.loopSize}` : null;
  return {
    id: b.id,
    title: b.title,
    short: b.short,
    explain: b.explain,
    guide: GUIDES + b.guide,
    // Timestamped (immutable) newest frame when we have frames; otherwise the
    // fixed-name alias, which always holds STAR's newest image.
    latest: frames.length ? frames[frames.length - 1].url : `${dir}${v.size}.jpg`,
    latestTime: frames.length ? frames[frames.length - 1].t : null,
    frames,
    width,
    height,
    loop: loopBase ? { mp4: `${loopBase}.mp4`, gif: `${loopBase}.gif` } : null,
  };
}

// ── Listings ─────────────────────────────────────────────────────────────────
// Stream a directory listing and keep only its tail: names sort by scan time,
// so the newest entries are last, and the rest of a 1-3 MB page is never
// decoded. The runtime negotiates gzip, so the transfer is ~10% of that.
//
// STAR's CDN stalls now and then (a request hangs or the TLS handshake drops
// while the next one answers at once), so a listing that fails or hasn't
// finished in 2.5 s gets one duplicate request and the first to finish wins.
// The duplicate skips Cloudflare's cache, which could otherwise fold it into
// the stalled fetch of the same URL.
function listingTail(env, path, { keep = 96 * 1024, ttl = 60, timeoutMs = 6e3 } = {}) {
  return hedged((signal, retry) => readTail(env, CDN + path, keep, retry ? null : ttl, signal), 2500, timeoutMs);
}

// Both attempts share one deadline, so a late duplicate never stretches the wait.
function hedged(run, hedgeMs, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempts = [];
    let failed = 0;
    let done = false;
    let timer;
    const start = () => {
      const ac = new AbortController();
      attempts.push(ac);
      run(eitherSignal(ac.signal, upstreamSignal(Math.max(1e3, deadline - Date.now()))), attempts.length > 1).then(
        (v) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          for (const a of attempts) if (a !== ac) a.abort(); // drop the slower twin
          resolve(v);
        },
        (e) => {
          failed++;
          if (done) return;
          if (attempts.length < 2) {
            clearTimeout(timer);
            start();
          } else if (failed === attempts.length) {
            done = true;
            reject(e);
          }
        }
      );
    };
    start();
    timer = setTimeout(() => !done && attempts.length < 2 && start(), hedgeMs);
  });
}

// AbortSignal.any where the runtime has it, hand-wired otherwise.
function eitherSignal(a, b) {
  if (typeof AbortSignal.any === "function") return AbortSignal.any([a, b]);
  const ac = new AbortController();
  for (const s of [a, b]) {
    if (s.aborted) {
      ac.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => ac.abort(s.reason), { once: true });
  }
  return ac.signal;
}

// ttl null = straight to origin. Errors are never cached.
async function readTail(env, url, keep, ttl, signal) {
  const init = { headers: { "User-Agent": userAgent(env), Accept: "text/html,*/*" }, signal };
  if (ttl == null) init.cache = "no-store";
  else init.cf = { cacheEverything: true, cacheTtlByStatus: { "200-299": ttl, "400-599": -1 } };
  const r = await fetch(url, init);
  if (!r.ok || !r.body) throw new Error(`${r.status} on ${url}`);
  const reader = r.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    while (chunks.length > 1 && size - chunks[0].byteLength >= keep) size -= chunks.shift().byteLength;
  }
  const buf = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) {
    buf.set(c, o);
    o += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

// Unique scan stamps (oldest → newest) of files of one size in a listing.
function stampsOf(html, size, digits = 11) {
  const re = new RegExp(`href="(\\d{${digits}})_[^"]*-${size}\\.jpg"`, "g");
  const seen = new Set();
  for (const m of html.matchAll(re)) seen.add(m[1]);
  return [...seen].sort();
}

async function familyStamps(env, sat, family) {
  const [dir, size] = INDEX[sat][family];
  const html = await listingTail(env, `${SATS[sat].id}/ABI/${dir}/`);
  const stamps = stampsOf(html, size);
  if (stamps.length < 2) throw new Error(`no frames in ${dir}`);
  return stamps.slice(-40);
}

// HEAD frames newest-first and drop those not rendered yet, so the loop ends
// on a real image; usually the first probe hits. Only a 404 drops a frame — a
// network error trusts the index. Not cached: a fresh 404 must not stick.
async function trimUnrendered(env, stamps, urlFor, probe) {
  let keep = stamps.length;
  for (let i = 0; i < probe && keep > 0; i++) {
    const r = await fetch(urlFor(stamps[keep - 1]), {
      method: "HEAD",
      headers: { "User-Agent": userAgent(env) },
      cache: "no-store",
      signal: upstreamSignal(2e3),
    }).catch(() => null);
    if (!r || r.status !== 404) break;
    keep--;
  }
  return stamps.slice(0, keep);
}

async function scanMode(env, sat) {
  const r = await fetch(`${CDN}${SATS[sat].id}/ABI/mode.txt`, {
    headers: { "User-Agent": userAgent(env) },
    cf: { cacheTtl: 300, cacheEverything: true },
    signal: upstreamSignal(3e3),
  });
  if (!r.ok) throw new Error(`${r.status} on mode.txt`);
  const n = parseInt(await r.text(), 10);
  return Number.isFinite(n) ? n : null;
}

// ── Mesoscale sectors ────────────────────────────────────────────────────────
// STAR's MESO/M1 and MESO/M2 are links to a directory named for the sector's
// center truncated to whole degrees ("28N-86W"); files carry it too. When both
// sectors are stacked on one spot (30-second imaging) both links point to the
// same directory.
async function mesoListing(env, sat, m) {
  const id = SATS[sat].id;
  const html = await listingTail(env, `${id}/ABI/MESO/${m}/GEOCOLOR/`, { ttl: 30 });
  const re = /href="(\d{13})_[^"]*-MESO-GEOCOLOR-(\d{1,2}[NS]-\d{1,3}[EW])-1000x1000\.jpg"/g;
  let loc = null;
  const seen = new Set();
  for (const mm of html.matchAll(re)) {
    seen.add(mm[1]);
    loc = mm[2];
  }
  const stamps = [...seen].sort();
  if (!stamps.length || !loc) throw new Error(`no frames in MESO/${m}`);
  return { loc, stamps: stamps.slice(-40) };
}

// MESO/ root: one directory per position, its mtime ≈ when imaging began there.
async function mesoRoot(env, sat) {
  const html = await listingTail(env, `${SATS[sat].id}/ABI/MESO/`, { ttl: 60, timeoutMs: 5e3 });
  const out = {};
  const re = /href="(\d{1,2}[NS]-\d{1,3}[EW])\/">[^<]*<\/a>\s+(\d{2})-(\w{3})-(\d{4}) (\d{2}):(\d{2})/g;
  const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  for (const m of html.matchAll(re)) {
    out[m[1]] = new Date(Date.UTC(+m[4], MON[m[3]], +m[2], +m[5], +m[6])).toISOString().replace(".000Z", "Z");
  }
  return out;
}

// For stacked (30-second) sectors STAR drops 9-24% of the RGB frames, so those
// bands get their own listing instead of the GeoColor index.
async function gappyMesoStamps(env, listings) {
  const jobs = [];
  for (const sat of ["east", "west"]) {
    const a = listings[`${sat}:M1`];
    const b = listings[`${sat}:M2`];
    const l = a && b && a.loc === b.loc ? a : null;
    if (!l || cadenceSec(l.stamps) >= 60) continue;
    for (const band of MESO_GAPPY) {
      jobs.push(
        listingTail(env, `${SATS[sat].id}/ABI/MESO/${l.loc}/${band}/`, { ttl: 30 }).then((html) => [
          `${sat}:${l.loc}:${band}`,
          stampsOf(html, "1000x1000", 13),
        ])
      );
    }
  }
  const out = {};
  for (const r of await Promise.allSettled(jobs)) if (r.status === "fulfilled") out[r.value[0]] = r.value[1];
  return out;
}

function cadenceSec(stamps) {
  const t = stamps.slice(-11).map((s) => Date.parse(stampISO(s)));
  const d = t.slice(1).map((v, i) => (v - t[i]) / 1000).sort((x, y) => x - y);
  return d.length ? d[Math.floor(d.length / 2)] : null;
}

function mesoEntry(sat, m, listings, centers, roots, gappy, notes) {
  const twin = m === "M1" ? "M2" : "M1";
  const l = listings[`${sat}:${m}`];
  const other = listings[`${sat}:${twin}`];
  const entry = {
    id: m, sat, center: null, centerSource: null, label: null, updated: null, since: null,
    active: false, coLocated: false, coLocatedWith: null, cadenceSec: null, starSector: null, bands: [],
  };
  if (!l) {
    // No STAR imagery, but the netCDF center alone still says where NOAA is looking.
    const c = centers[`${sat}:${m}`];
    if (c) {
      entry.center = { lat: round(c.lat, 2), lon: round(c.lon, 2) };
      entry.centerSource = "netcdf";
      entry.updated = c.time;
      entry.label = placeLabel(c.lat, c.lon);
      entry.active = Date.now() - Date.parse(c.time) < 20 * 60e3;
    }
    return entry;
  }
  entry.updated = stampISO(l.stamps[l.stamps.length - 1]);
  entry.active = Date.now() - Date.parse(entry.updated) < 20 * 60e3;
  entry.coLocated = !!(other && other.loc === l.loc);
  entry.cadenceSec = cadenceSec(l.stamps);
  entry.starSector = l.loc;
  entry.since = (roots && roots[l.loc]) || null;
  // Exact center from this sector's netCDF, else its twin's when that lies in
  // the same STAR cell (stacked imagery is all filed under one sector, and
  // STAR keeps one directory per cell), else the middle of the 1° cell. An
  // exact center outside the cell means the sector just moved and STAR's
  // imagery hasn't caught up, so the cell (what the pictures show) wins.
  const mine = centers[`${sat}:${m}`];
  const exact = [mine, centers[`${sat}:${twin}`]].find((c) => c && cellOf(c.lat, c.lon) === l.loc);
  if (!exact && mine) notes.push(`${SATS[sat].name} ${m} just moved; its imagery still shows ${l.loc}`);
  entry.center = exact ? { lat: round(exact.lat, 2), lon: round(exact.lon, 2) } : cellCenter(l.loc);
  entry.centerSource = exact ? "netcdf" : "star-1deg";
  entry.label = entry.center ? placeLabel(entry.center.lat, entry.center.lon) : null;
  entry.bands = MESO_BANDS.map((b) => {
    const own = MESO_GAPPY.has(b.id) ? gappy[`${sat}:${l.loc}:${b.id}`] : null;
    const frames = (own || l.stamps)
      .slice(-FRAMES.meso)
      .map((s) => ({ t: stampISO(s), url: mesoUrl(sat, l.loc, b.id, s) }));
    const last = frames[frames.length - 1];
    return {
      id: b.id, title: b.title, short: b.short, explain: b.explain, guide: GUIDES + b.guide,
      latest: last ? last.url : `${CDN}${SATS[sat].id}/ABI/MESO/${m}/${b.id}/1000x1000.jpg`,
      latestTime: last ? last.t : null,
      frames, width: 1000, height: 1000, loop: null,
    };
  });
  return entry;
}

function mesoUrl(sat, loc, band, stamp) {
  const id = SATS[sat].id;
  return `${CDN}${id}/ABI/MESO/${loc}/${band}/${stamp}_${id}-ABI-MESO-${band}-${loc}-1000x1000.jpg`;
}

// STAR truncates toward zero: 28.72N 86.47W → "28N-86W".
function cellOf(lat, lon) {
  return `${Math.trunc(Math.abs(lat))}${lat < 0 ? "S" : "N"}-${Math.trunc(Math.abs(lon))}${lon < 0 ? "W" : "E"}`;
}

function cellCenter(loc) {
  const m = /^(\d+)([NS])-(\d+)([EW])$/.exec(loc || "");
  if (!m) return null;
  return { lat: (+m[1] + 0.5) * (m[2] === "S" ? -1 : 1), lon: (+m[3] + 0.5) * (m[4] === "W" ? -1 : 1) };
}

// Exact meso centers from the newest Level-2 band-13 file of each sector on
// NOAA's AWS buckets: list this hour's keys, then read the first 96 KB, where
// the HDF5 header holds geospatial_lat_center / geospatial_lon_center (the
// attributes sit ~56 KB in). Two small requests per sector.
async function mesoCenters(env, modes) {
  const jobs = [];
  for (const sat of ["east", "west"]) {
    for (const m of ["M1", "M2"]) {
      jobs.push(
        newestMesoKey(env, sat, m, modes[sat] || 6)
          .then((key) => (key ? netcdfCenter(env, sat, key) : null))
          .then((c) => [`${sat}:${m}`, c])
      );
    }
  }
  const out = {};
  const settled = await Promise.allSettled(jobs);
  for (const r of settled) if (r.status === "fulfilled" && r.value[1]) out[r.value[0]] = r.value[1];
  const failed = settled.find((r) => r.status === "rejected");
  if (failed && settled.every((r) => r.status === "rejected")) throw failed.reason;
  return out;
}

async function newestMesoKey(env, sat, m, mode) {
  const s = SATS[sat];
  const now = new Date();
  const recent = new Date(now.getTime() - 6 * 60e3);
  const hourOf = (d) => `ABI-L2-CMIPM/${d.getUTCFullYear()}/${pad(doy(d), 3)}/${pad(d.getUTCHours(), 2)}/`;
  for (const back of [0, 1]) {
    const hour = hourOf(new Date(now.getTime() - back * 3600e3));
    const prefix = `${hour}OR_ABI-L2-CMIP${m}-M${mode}C13_${s.tag}_s`;
    const q = new URLSearchParams({ "list-type": "2", "max-keys": "200", prefix });
    // Keys sort by scan start, so starting 6 minutes back keeps the XML tiny.
    if (hourOf(recent) === hour) q.set("start-after", prefix + stamp11(recent));
    const r = await fetch(`https://${s.aws}.s3.amazonaws.com/?${q}`, {
      headers: { "User-Agent": userAgent(env) },
      signal: upstreamSignal(5e3),
    });
    if (!r.ok) throw new Error(`${r.status} listing ${s.aws}`);
    const keys = [...(await r.text()).matchAll(/<Key>([^<]+)<\/Key>/g)].map((x) => x[1]);
    if (keys.length) return keys.sort().pop();
    // Nothing in the last 6 minutes: a stacked or idle sector — unless the
    // hour just turned, in which case the newest file is in the last hour.
    if (now.getUTCMinutes() >= 6) return null;
  }
  return null;
}

async function netcdfCenter(env, sat, key) {
  const r = await fetch(`https://${SATS[sat].aws}.s3.amazonaws.com/${key}`, {
    headers: { "User-Agent": userAgent(env), Range: "bytes=0-98303" },
    signal: upstreamSignal(5e3),
  });
  if (!r.ok) throw new Error(`${r.status} reading ${key}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  const lat = h5FloatAttr(bytes, "geospatial_lat_center");
  const lon = h5FloatAttr(bytes, "geospatial_lon_center");
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  // Scan start from the key: ..._s20262822259559_e... (YYYYDDDHHMMSS + tenths).
  const s = /_s(\d{13})\d_/.exec(key);
  return { lat, lon, key, time: s ? stampISO(s[1]) : null };
}

// Read a scalar float attribute out of raw HDF5 header bytes by finding its
// name and decoding the attribute message around it. Handles message
// versions 3 (what the GOES ground system writes: no padding) and 1 (8-byte
// aligned). Returns null if the layout doesn't check out.
function h5FloatAttr(bytes, name) {
  const pat = new TextEncoder().encode(name + "\0");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pad8 = (n) => (n + 7) & ~7;
  for (let i = 9; i + pat.length < bytes.length; i++) {
    if (bytes[i] !== pat[0]) continue;
    let k = 1;
    while (k < pat.length && bytes[i + k] === pat[k]) k++;
    if (k < pat.length) continue;
    let dt, data;
    if (bytes[i - 9] === 3 && dv.getUint16(i - 7, true) === pat.length) {
      const dtSize = dv.getUint16(i - 5, true);
      const dsSize = dv.getUint16(i - 3, true);
      dt = i + pat.length;
      data = dt + dtSize + dsSize;
    } else if (bytes[i - 8] === 1 && dv.getUint16(i - 6, true) === pat.length) {
      const dtSize = dv.getUint16(i - 4, true);
      const dsSize = dv.getUint16(i - 2, true);
      dt = i + pad8(pat.length);
      data = dt + pad8(dtSize) + pad8(dsSize);
    } else continue;
    if (dt + 8 > bytes.length) return null;
    if ((bytes[dt] & 0x0f) !== 1) return null; // not a floating-point datatype
    const size = dv.getUint32(dt + 4, true);
    const little = (bytes[dt + 1] & 1) === 0;
    if (data + size > bytes.length) return null;
    if (size === 4) return dv.getFloat32(data, little);
    if (size === 8) return dv.getFloat64(data, little);
    return null;
  }
  return null;
}

// ── Time helpers ─────────────────────────────────────────────────────────────
// STAR stamps are scan start times: YYYYDDDHHMM (CONUS, FD, sectors) or
// YYYYDDDHHMMSS (meso), DDD = day of year, UTC.
function stampISO(s) {
  const n = (a, b) => +s.slice(a, b);
  const d = new Date(Date.UTC(n(0, 4), 0, n(4, 7), n(7, 9), n(9, 11), s.length >= 13 ? n(11, 13) : 0));
  return d.toISOString().replace(".000Z", "Z");
}

function doy(d) {
  const y = d.getUTCFullYear();
  return Math.floor((Date.UTC(y, d.getUTCMonth(), d.getUTCDate()) - Date.UTC(y, 0, 0)) / 86400e3);
}

function stamp11(d) {
  return `${d.getUTCFullYear()}${pad(doy(d), 3)}${pad(d.getUTCHours(), 2)}${pad(d.getUTCMinutes(), 2)}`;
}

function pad(n, w) {
  return String(n).padStart(w, "0");
}

// ── Labels ───────────────────────────────────────────────────────────────────
// "near Tulsa, OK" / "45 mi SSW of Pensacola, FL" / "over the eastern Pacific,
// 640 mi SW of Los Cabos, Mexico". Reference points are airport coordinates
// from aviationweather.gov's station table, spread so most of North America
// is within ~100 mi of one.
const PLACES_RAW =
  "Birmingham|AL|33.57|-86.74;Montgomery|AL|32.3|-86.41;Mobile|AL|30.69|-88.25;Huntsville|AL|34.64|-86.79;" +
  "Anchorage|AK|61.17|-150.03;Fairbanks|AK|64.8|-147.88;Juneau|AK|58.35|-134.56;Nome|AK|64.51|-165.44;" +
  "Utqiagvik|AK|71.28|-156.78;Bethel|AK|60.79|-161.83;Kodiak|AK|57.75|-152.49;Cold Bay|AK|55.22|-162.73;" +
  "King Salmon|AK|58.68|-156.66;Yakutat|AK|59.51|-139.67;Kotzebue|AK|66.89|-162.61;Sitka|AK|57.05|-135.36;" +
  "Ketchikan|AK|55.36|-131.72;Adak|AK|51.88|-176.64;Phoenix|AZ|33.43|-112;Tucson|AZ|32.13|-110.96;" +
  "Flagstaff|AZ|35.14|-111.67;Yuma|AZ|32.66|-114.61;Little Rock|AR|34.73|-92.24;Fort Smith|AR|35.33|-94.37;" +
  "Jonesboro|AR|35.84|-90.64;Los Angeles|CA|33.94|-118.39;San Diego|CA|32.74|-117.2;San Francisco|CA|37.62|-122.37;" +
  "Sacramento|CA|38.7|-121.59;Fresno|CA|36.78|-119.72;Redding|CA|40.51|-122.3;Eureka|CA|40.98|-124.1;" +
  "Bakersfield|CA|35.43|-119.06;Palm Springs|CA|33.82|-116.5;Santa Barbara|CA|34.42|-119.84;" +
  "Bishop|CA|37.37|-118.36;Crescent City|CA|41.78|-124.24;Denver|CO|39.85|-104.66;Grand Junction|CO|39.13|-108.54;" +
  "Colorado Springs|CO|38.81|-104.69;Alamosa|CO|37.44|-105.86;Steamboat Springs|CO|40.48|-107.23;" +
  "Hartford|CT|41.94|-72.68;Dover|DE|39.13|-75.47;Washington|DC|38.85|-77.03;Miami|FL|25.79|-80.32;" +
  "Tampa|FL|27.96|-82.54;Orlando|FL|28.42|-81.32;Jacksonville|FL|30.5|-81.69;Tallahassee|FL|30.39|-84.35;" +
  "Pensacola|FL|30.48|-87.19;Key West|FL|24.56|-81.76;Fort Myers|FL|26.54|-81.76;Panama City|FL|30.35|-85.79;" +
  "Melbourne|FL|28.1|-80.64;Gainesville|FL|29.69|-82.28;Atlanta|GA|33.63|-84.44;Savannah|GA|32.13|-81.2;" +
  "Macon|GA|32.69|-83.65;Augusta|GA|33.37|-81.96;Albany|GA|31.54|-84.2;Honolulu|HI|21.32|-157.92;" +
  "Hilo|HI|19.72|-155.05;Lihue|HI|21.98|-159.34;Kahului|HI|20.89|-156.43;Boise|ID|43.57|-116.24;" +
  "Pocatello|ID|42.92|-112.57;Lewiston|ID|46.37|-117.02;Idaho Falls|ID|43.52|-112.07;Chicago|IL|41.96|-87.93;" +
  "Springfield|IL|39.85|-89.68;Peoria|IL|40.67|-89.68;Indianapolis|IN|39.73|-86.28;Evansville|IN|38.05|-87.51;" +
  "Fort Wayne|IN|40.97|-85.21;Des Moines|IA|41.53|-93.65;Sioux City|IA|42.39|-96.38;Davenport|IA|41.61|-90.59;" +
  "Waterloo|IA|42.55|-92.4;Mason City|IA|43.15|-93.33;Wichita|KS|37.65|-97.43;Dodge City|KS|37.77|-99.97;" +
  "Goodland|KS|39.37|-101.69;Topeka|KS|39.07|-95.63;Salina|KS|38.78|-97.64;Louisville|KY|38.18|-85.73;" +
  "Lexington|KY|38.03|-84.61;Paducah|KY|37.07|-88.78;Jackson|KY|37.59|-83.31;New Orleans|LA|30|-90.28;" +
  "Lake Charles|LA|30.13|-93.23;Shreveport|LA|32.45|-93.82;Baton Rouge|LA|30.54|-91.15;Monroe|LA|32.52|-92.03;" +
  "Lafayette|LA|30.2|-91.99;Portland|ME|43.64|-70.3;Caribou|ME|46.87|-68.02;Bangor|ME|44.8|-68.82;" +
  "Baltimore|MD|39.17|-76.68;Salisbury|MD|38.34|-75.51;Boston|MA|42.36|-71.01;Hyannis|MA|41.67|-70.27;" +
  "Detroit|MI|42.23|-83.33;Grand Rapids|MI|42.88|-85.52;Marquette|MI|46.53|-87.55;Traverse City|MI|44.74|-85.57;" +
  "Alpena|MI|45.07|-83.56;Minneapolis|MN|44.89|-93.23;Duluth|MN|46.84|-92.19;International Falls|MN|48.56|-93.4;" +
  "Rochester|MN|43.9|-92.49;Bemidji|MN|47.51|-94.93;St. Cloud|MN|45.54|-94.05;Jackson|MS|32.32|-90.08;" +
  "Tupelo|MS|34.26|-88.77;Gulfport|MS|30.41|-89.08;Greenwood|MS|33.5|-90.09;St. Louis|MO|38.75|-90.37;" +
  "Kansas City|MO|39.3|-94.73;Springfield|MO|37.24|-93.39;Columbia|MO|38.82|-92.21;Cape Girardeau|MO|37.23|-89.58;" +
  "Billings|MT|45.81|-108.55;Great Falls|MT|47.47|-111.38;Missoula|MT|46.92|-114.09;Glasgow|MT|48.21|-106.62;" +
  "Helena|MT|46.6|-111.99;Miles City|MT|46.43|-105.88;Bozeman|MT|45.79|-111.16;Havre|MT|48.54|-109.76;" +
  "Omaha|NE|41.31|-95.9;North Platte|NE|41.12|-100.67;Scottsbluff|NE|41.87|-103.6;Grand Island|NE|40.96|-98.31;" +
  "Lincoln|NE|40.85|-96.76;Valentine|NE|42.86|-100.55;Las Vegas|NV|36.07|-115.16;Reno|NV|39.51|-119.77;" +
  "Elko|NV|40.82|-115.79;Ely|NV|39.3|-114.85;Winnemucca|NV|40.9|-117.81;Tonopah|NV|38.05|-117.09;" +
  "Concord|NH|43.2|-71.5;Atlantic City|NJ|39.45|-74.57;Albuquerque|NM|35.04|-106.62;Roswell|NM|33.31|-104.51;" +
  "Farmington|NM|36.74|-108.23;Tucumcari|NM|35.18|-103.6;Las Cruces|NM|32.29|-106.91;Santa Fe|NM|35.61|-106.1;" +
  "New York|NY|40.78|-73.97;Albany|NY|42.75|-73.8;Buffalo|NY|42.94|-78.74;Syracuse|NY|43.11|-76.1;" +
  "Binghamton|NY|42.21|-75.98;Rochester|NY|43.12|-77.68;Watertown|NY|43.99|-76.03;Charlotte|NC|35.22|-80.95;" +
  "Raleigh|NC|35.89|-78.78;Wilmington|NC|34.27|-77.9;Asheville|NC|35.43|-82.54;Cape Hatteras|NC|35.23|-75.62;" +
  "Greensboro|NC|36.1|-79.94;Bismarck|ND|46.78|-100.76;Fargo|ND|46.92|-96.81;Minot|ND|48.25|-101.27;" +
  "Williston|ND|48.17|-103.64;Grand Forks|ND|47.94|-97.18;Dickinson|ND|46.8|-102.8;Columbus|OH|39.99|-82.88;" +
  "Cleveland|OH|41.41|-81.85;Cincinnati|OH|39.04|-84.67;Toledo|OH|41.59|-83.81;Dayton|OH|39.91|-84.22;" +
  "Oklahoma City|OK|35.38|-97.6;Tulsa|OK|36.2|-95.88;Lawton|OK|34.56|-98.42;Guymon|OK|36.68|-101.51;" +
  "Woodward|OK|36.44|-99.52;McAlester|OK|34.88|-95.78;Portland|OR|45.6|-122.61;Medford|OR|42.38|-122.88;" +
  "Pendleton|OR|45.7|-118.83;Eugene|OR|44.13|-123.22;North Bend|OR|43.42|-124.24;Burns|OR|43.59|-118.96;" +
  "Redmond|OR|44.26|-121.14;Astoria|OR|46.16|-123.88;Philadelphia|PA|39.87|-75.23;Pittsburgh|PA|40.48|-80.21;" +
  "State College|PA|40.85|-77.84;Scranton|PA|41.33|-75.72;Erie|PA|42.08|-80.18;Harrisburg|PA|40.2|-76.77;" +
  "Providence|RI|41.72|-71.43;Columbia|SC|33.94|-81.12;Charleston|SC|32.9|-80.04;Greenville|SC|34.88|-82.22;" +
  "Myrtle Beach|SC|33.68|-78.93;Sioux Falls|SD|43.58|-96.75;Rapid City|SD|44.05|-103.05;Aberdeen|SD|45.44|-98.41;" +
  "Pierre|SD|44.38|-100.29;Mobridge|SD|45.54|-100.4;Nashville|TN|36.11|-86.69;Memphis|TN|35.06|-89.99;" +
  "Knoxville|TN|35.82|-83.99;Chattanooga|TN|35.03|-85.2;Bristol|TN|36.48|-82.4;Dallas-Fort Worth|TX|32.9|-97.02;" +
  "Houston|TX|29.65|-95.28;San Antonio|TX|29.54|-98.48;Austin|TX|30.18|-97.68;El Paso|TX|31.81|-106.38;" +
  "Amarillo|TX|35.22|-101.72;Lubbock|TX|33.67|-101.82;Midland|TX|31.95|-102.21;Corpus Christi|TX|27.77|-97.51;" +
  "Brownsville|TX|25.91|-97.42;Abilene|TX|32.41|-99.68;San Angelo|TX|31.35|-100.49;Del Rio|TX|29.38|-100.93;" +
  "Wichita Falls|TX|33.98|-98.49;Tyler|TX|32.36|-95.4;Laredo|TX|27.55|-99.46;Waco|TX|31.62|-97.23;" +
  "Beaumont|TX|29.95|-94.03;Victoria|TX|28.86|-96.93;Childress|TX|34.43|-100.28;Fort Stockton|TX|30.91|-102.92;" +
  "Galveston|TX|29.27|-94.86;Salt Lake City|UT|40.77|-111.97;Cedar City|UT|37.71|-113.1;Vernal|UT|40.44|-109.51;" +
  "Moab|UT|38.75|-109.76;Provo|UT|40.22|-111.73;Burlington|VT|44.47|-73.15;Richmond|VA|37.51|-77.32;" +
  "Norfolk|VA|36.9|-76.19;Roanoke|VA|37.32|-79.97;Lynchburg|VA|37.32|-79.21;Seattle|WA|47.44|-122.31;" +
  "Spokane|WA|47.62|-117.53;Yakima|WA|46.56|-120.53;Quillayute|WA|47.94|-124.56;Bellingham|WA|48.8|-122.54;" +
  "Wenatchee|WA|47.4|-120.2;Pasco|WA|46.27|-119.12;Charleston|WV|38.38|-81.59;Elkins|WV|38.89|-79.86;" +
  "Milwaukee|WI|42.95|-87.9;Green Bay|WI|44.48|-88.14;La Crosse|WI|43.88|-91.25;Madison|WI|43.14|-89.35;" +
  "Eau Claire|WI|44.87|-91.49;Rhinelander|WI|45.63|-89.48;Cheyenne|WY|41.16|-104.81;Casper|WY|42.9|-106.47;" +
  "Riverton|WY|43.06|-108.45;Sheridan|WY|44.76|-106.97;Rock Springs|WY|41.59|-109.05;Jackson|WY|43.61|-110.74;" +
  "Cody|WY|44.52|-109.03;San Juan|PR|18.43|-66.01;St. Thomas|VI|18.34|-64.98;Vancouver|BC|49.18|-123.17;" +
  "Calgary|AB|51.12|-114.01;Edmonton|AB|53.31|-113.59;Regina|SK|50.43|-104.67;Saskatoon|SK|52.17|-106.69;" +
  "Winnipeg|MB|49.92|-97.25;Thunder Bay|ON|48.37|-89.33;Toronto|ON|43.68|-79.63;Ottawa|ON|45.31|-75.66;" +
  "Montreal|QC|45.47|-73.74;Quebec City|QC|46.79|-71.4;Halifax|NS|44.88|-63.51;St. John's|NL|47.63|-52.75;" +
  "Whitehorse|YT|60.71|-135.06;Yellowknife|NT|62.48|-114.45;Moncton|NB|46.11|-64.68;" +
  "Sault Ste. Marie|ON|46.48|-84.5;Sudbury|ON|46.62|-80.8;Prince George|BC|53.88|-122.68;Victoria|BC|48.64|-123.43;" +
  "London|ON|43.04|-81.16;Gander|NL|48.95|-54.58;Prince Rupert|BC|54.29|-130.45;Monterrey|Mexico|25.77|-100.1;" +
  "Chihuahua|Mexico|28.7|-105.97;Hermosillo|Mexico|29.1|-111.05;Mazatlán|Mexico|23.16|-106.27;" +
  "Guadalajara|Mexico|20.52|-103.31;Mexico City|Mexico|19.44|-99.07;Veracruz|Mexico|19.14|-96.19;" +
  "Mérida|Mexico|20.94|-89.66;Cancún|Mexico|21.04|-86.86;Los Cabos|Mexico|23.16|-109.72;" +
  "La Paz|Mexico|24.08|-110.36;Acapulco|Mexico|16.76|-99.75;Manzanillo|Mexico|19.15|-104.56;" +
  "Tampico|Mexico|22.29|-97.86;Puerto Vallarta|Mexico|20.68|-105.25;Tijuana|Mexico|32.54|-116.98;" +
  "Torreón|Mexico|25.56|-103.41;Campeche|Mexico|19.82|-90.5;Guaymas|Mexico|27.96|-110.93;León|Mexico|21|-101.48;" +
  "Havana|Cuba|22.99|-82.41;Camagüey|Cuba|21.42|-77.85;Nassau|Bahamas|25.04|-77.47;Freeport|Bahamas|26.55|-78.7;" +
  "Kingston|Jamaica|17.94|-76.8;Port-au-Prince|Haiti|18.58|-72.31;Santo Domingo|Dominican Republic|18.43|-69.67;" +
  "Bermuda|Bermuda|32.36|-64.68;Barbados|Barbados|13.07|-59.49;Grand Cayman|Cayman Islands|19.29|-81.36;" +
  "Curaçao|Curaçao|12.19|-68.96;Martinique|Martinique|14.59|-61;Guadeloupe|Guadeloupe|16.27|-61.53;" +
  "Trinidad|Trinidad|10.59|-61.35;Belize City|Belize|17.54|-88.31;Guatemala City|Guatemala|14.59|-90.53;" +
  "Tegucigalpa|Honduras|14.06|-87.22;Managua|Nicaragua|12.14|-86.18;San José|Costa Rica|9.99|-84.22;" +
  "Panama City|Panama|9.06|-79.39;Barranquilla|Colombia|10.88|-74.78;Caracas|Venezuela|10.6|-66.99;" +
  "Providenciales|Turks and Caicos|21.77|-72.27;St. Maarten|St. Maarten|18.04|-63.11";

let PLACES = null;
function places() {
  if (!PLACES) {
    PLACES = PLACES_RAW.split(";").map((r) => {
      const [name, region, lat, lon] = r.split("|");
      return { name: region === name ? name : `${name}, ${region}`, lat: +lat, lon: +lon };
    });
  }
  return PLACES;
}

function placeLabel(lat, lon) {
  let best = null;
  for (const p of places()) {
    const d = haversineMi(lat, lon, p.lat, p.lon);
    if (!best || d < best.d) best = { p, d };
  }
  if (!best) return null;
  if (best.d < 20) return `near ${best.p.name}`;
  const step = best.d < 300 ? 5 : 10;
  const dir = compass(bearingDeg(best.p.lat, best.p.lon, lat, lon));
  const rel = `${Math.round(best.d / step) * step} mi ${dir} of ${best.p.name}`;
  const sea = best.d > 150 ? openWater(lat, lon) : null;
  return sea ? `over the ${sea}, ${rel}` : rel;
}

// Coarse ocean names for points far (>150 mi) from every reference place —
// which in practice means open water.
function openWater(lat, lon) {
  if (lat >= 51 && lon >= -158 && lon <= -130) return "Gulf of Alaska";
  if (lat >= 52 && lon < -158) return "Bering Sea";
  if (lon < -140) return lat < 35 ? "central Pacific" : "North Pacific";
  if (lon < -100) return lat < 35 ? "eastern Pacific" : "northeast Pacific";
  if (lat >= 18 && lat <= 31 && lon >= -98 && lon <= -81) return "Gulf of America";
  if (lat < 22 && lon > -88 && lon < -60) return "Caribbean Sea";
  if (lon >= -82) return "Atlantic";
  return null;
}
