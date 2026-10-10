# WeatherNet — repo guide for Claude

A nationwide, enthusiast-grade, **educational** live-weather site. It's the
"consumer-grade scientific" sibling of
[weatherchat](https://github.com/praxeo/weatherchat), built for one
weather-literate owner in Alabama who wants a polished window on the whole US:
lots of satellite, fancy but honest graphics, cameras that follow interesting
weather, records, explainers, and an AI meteorologist. Favor correctness, real
data and taste. Polish matters here (unlike weatherchat's information-dense
style), but never at the cost of accuracy.

## Layout

- **`src/index.js`**: the Worker entry and router for WeatherNet's own
  endpoints. It also registers WeatherNet's extra chat tools and prompt with
  the brain (`registerTools`). Everything it doesn't route falls through to the
  brain.
- **`src/brain.js`**: weatherchat's backend, carried over intact. That covers
  every NWS/SPC/WPC/CPC/NHC/IEM data function, `/api/chat` (streaming agent
  loop, both providers), `/api/summary` (the AFD-style discussion),
  `/api/dashboard`, `/api/tropical`, `/api/ground`, `/api/basemap`,
  `/api/geocode`, `/api/geosearch` and voice. The `// src/*.ts` markers are
  weatherchat's original module boundaries. WeatherNet changes are marked
  `WeatherNet:`. **Keep it in step with weatherchat**: port fixes both ways
  (e.g. the observation wind-unit fix landed in both repos).
- **`src/sources/`**: WeatherNet's data modules:
  - `stories.js`: the national story engine.
  - `satellite.js`: GOES catalog, loops, mesoscale sectors.
  - `cams.js`: camera registry.
  - `history.js`: ACIS records and SPC tornado history.
  - `youtube.js`: live storm coverage.
- **`src/lib/`**: `net.js` (fetch with deadlines, User-Agent, geo math),
  `cache.js` (`edgeJSON` Cache-API caching, `memo` per-isolate, `json`),
  `places.js` (place labels, nearest radar).
- **`src/data/`**: generated tables. Don't hand-edit; run
  `scripts/build-geodata.mjs`:
  - `places.js`: Natural Earth US places.
  - `radars.js`: WSR-88D sites.
  - `counties.js`: county internal points by FIPS.
- **`public/`**: the whole front end as plain static files served by Workers
  Static Assets:
  - `index.html`, `css/app.css`, and `js/*.js` (native ES modules, **no build
    step, no framework**).
  - `vendor/` holds Leaflet 1.9.4 and hls.js 1.7.3 with their licenses.
  - `data/tornadoes/MM-DD.json` is the SPC tornado database split by day,
    rebuilt by `scripts/build-tornadoes.mjs`.

`wrangler.toml` serves `public/` and runs the worker first only for `/api/*`.

## Routes

- `/api/stories`: the national story board plus compact map layers.
- `/api/satellite`: GOES views, bands, frames, meso sectors, projection.
- `/api/cams?lat&lon&radius&limit[&links]`: cameras nearest a point.
- `/api/live?region=AL|national`: YouTube live/upcoming/recent.
- `/api/history?lat&lon&date`: records, normals, series, tornadoes.
- `/api/config`: the default location and which optional keys are set.
- Everything else (`/api/chat`, `/api/summary`, `/api/dashboard`,
  `/api/tropical`, `/api/ground`, `/api/basemap`, `/api/geosearch`,
  `/api/health`, …) is the brain.

## The story engine (`src/sources/stories.js`)

All sources are fetched in parallel. Each is raced against 9 s, and a failure
lands in `unavailable` instead of failing the board. The result is
edge-cached for 2 minutes.

- **NWS short-fuse warnings** (TOR/SVR/FFW/EWW/DSW/SQW) with impact-based tags
  from `parameters`: `tornadoDamageThreat`, `thunderstormDamageThreat`,
  `flashFloodDamageThreat`, `tornadoDetection`, `maxWindGust`, `maxHailSize`.
  The descriptions are also searched for "TORNADO EMERGENCY", "FLASH FLOOD
  EMERGENCY" and "PARTICULARLY DANGEROUS SITUATION".
- **Long-fuse hazards** (blizzard, ice storm, extreme heat/cold, red flag)
  are zone-based with **no polygon**. They're placed by their SAME county
  codes through `src/data/counties.js`.
- **Never request every active alert**: that's ~5 MB on a hurricane day. Ask
  only for the event types you need (`?event=` lists, two small calls).
- **SPC watches** come from IEM `json/spcwatch.py`, which carries `is_pds` and
  the watch polygon. The NWS API's watch alerts don't say PDS.
- **SPC Day 1** uses the categorical GeoJSON plus the outlook text.
- **NHC** uses `CurrentStorms.json`, which is light. The full cone/track
  geometry for the map comes from the brain's `/api/tropical`.
- **LSRs** come from IEM `geojson/lsr.geojson?hours=6`, the whole country with
  no bbox.
- **RERs** come from `products/types/RER`. Only the newest ~12 from the last
  18 h are read, in three text formats: prose, `85 (1965)` tables and
  `93 IN 2010` tables.
- **GDACS** red alerts outside the US form the "world" lane. GDACS returns an
  **empty body** when nothing matches.

**Tiers**: 3 extreme, 2 major, 1 notable, 0 context (counted and mapped, not
headlined). Tiers live in `alertRank` / `reportRank` / `tropicalStory` /
`outlookStory` / `watchStory`; tune them there.

**Clustering**: hurricanes and SPC ENH+ areas are anchors (260/320 mi), then
watches, then alerts most-severe-first, then reports. Members can raise a
story's tier, never lower it. 8+ tornado warnings in one cluster counts as
tier 3.

Titles and summaries come from the data itself, mostly the warning's own
"* At …" narrative or "* WHAT…" line. Don't add adjectives the data doesn't
support.

## Satellite (`src/sources/satellite.js`)

All imagery comes from the NOAA/NESDIS STAR CDN (`cdn.star.nesdis.noaa.gov`).
It sends `Access-Control-Allow-Origin: *` with no Referer checks, and is
hotlinked from the browser. STAR supports it on weekdays only. At high
traffic, consider proxying through Cloudflare.

- **Views**:
  - CONUS East/West: 8 bands × 24 frames
  - 20 regional sectors: GeoColor frames; other bands as `latest` plus STAR's
    MP4/GIF loops
  - Full disk: GeoColor and band 13, 12 frames each
  - Mesoscale sectors: 7 bands × 24 frames
- **Frame times come from one index per scan.** All bands and sectors cut
  from the same ABI scan share timestamps. Only the tail of a sector GeoColor
  directory listing is parsed: the listings hold ~10 days and run 1–3 MB.
  Slow listings get one hedged retry.
- **Meso centers are exact.** They're read from the newest AWS Level-2
  band-13 meso file header (`geospatial_lat_center`/`lon_center`, the first
  96 KB). STAR's directory name ("28N-86W") is only the fallback. When both
  sectors are stacked (30-s imaging), one carries `coLocatedWith` and no
  bands.
- An uncached build takes ~1.2–1.5 s and ~26 subrequests, and is edge-cached
  3 min. The JSON is ~380 KB raw, ~23 KB gzipped.

## Cameras (`src/sources/cams.js`)

The cams module covers 18 sources, about 17.6k cameras. Most feeds are
whatever each agency's own public map calls, so **endpoints can change
without notice**. `scripts/check-cams.mjs` checks them against live data.

- **States covered**:
  - ALDOT/ALGO Traffic (live HLS)
  - Castle Rock CARS 511s: IA, MN, KS, NE, IN, CO, MA
  - Caltrans (12 districts), SCDOT, KYTC, ARDOT, OKDOT (stream-only), MoDOT
  - TxDOT
- **Other networks**:
  - ALERTCalifornia fire cams
  - `altv`: Alabama TV-station skycam stills (WBRC, WSFA, WAFF, FOX10,
    Alabama Lightwave), at town-level positions (`approx`)
  - Windy, only with `WINDY_API_KEY`. It's the only Florida coverage: there's
    no keyless FL feed.
- **Texas stills** exist only as base64 inside JSON, so they're served by
  `/api/cams/snapshot?id=txdot:…` (edge-cached 60 s). Everything else is
  hotlinked.
- **Houston and San Antonio are dark** through that endpoint (`null`): those
  cities run their own systems, e.g. Houston TranStar. TxDOT's `isActive` is
  `false` for every camera, so it's no filter.
- `camsNear(…, { kinds })` filters by kind. `/api/cams?prefer=sky` (and the
  chat tool) lists sky/fire/scenic cameras first, then the nearest of
  everything else.
- Stream-only cameras have `snapshot: null`. The client shows a "▶ Live
  video" tile and drops dead stills: about 30% of Texas is dark at any moment.
- **Terms**:
  - ALERTCalifornia is CC BY-NC-ND and Windy forbids stretching, so those
    tiles are letterboxed, never cropped.
  - Windy images must link to their windy.com page, and their URLs expire in
    about 10 minutes.
  - TV skycams carry station credit and a link back.
- Rejected: GA/LA/NC/FL 511 (key or no API), TN (key account), MS (HTML
  scraping), ALERTWildfire (login).
- A cold registry load parses large JSON (tens of ms of CPU). That needs the
  Workers Paid plan; warm searches take 3–6 ms.

## Front end (`public/js`)

- **`app.js`** boots the page. It fetches `/api/stories` (every 2 min) and
  `/api/satellite` (every 5 min) and lazy-starts the map, satellite gallery,
  cams and history when they scroll into view. **`state.js`** holds shared
  state plus a tiny event bus: `stories`, `satellite`, `location`.
- **Build DOM with `el()` + `textContent`** (`util.js`). The only `innerHTML`
  is `markdown.js` output for model text. It escapes everything and only
  allows `http(s)` links. Its line loop must always consume a line, because it
  runs on half-streamed text.
- **Native `Element.append()` prints `null` as the text "null".** When
  children are conditional, use `put(parent, …)` or `el()`, which both skip
  empties.
- **Tier colors** are one scale everywhere: `--t3 --t2 --t1 --t0`
  (`.tier-N` sets `--tier`). Warning colors follow the radar-app convention:
  TOR red, SVR yellow, FFW green, EWW magenta.
- **Map (`map.js`)**:
  - The basemap is NASA GIBS (VIIRS Black Marble or Blue Marble relief).
    Natural Earth lines are drawn as vectors from `/api/basemap`, and city
    labels come from `/api/places`, thinned by population and checked for
    collisions.
  - **Don't add GIBS `Reference_Labels_15m`**: at these zooms its tiles are
    opaque black placeholders that blank the whole map.
  - **Don't switch back to CARTO basemaps**: they now need an API key, and
    keyless tiles carry an "API KEY REQUIRED" watermark.
  - Radar is IEM `nexrad-n0q-900913` with `-mNNm` offsets for the loop. GOES
    layers: GIBS `GOES-East_ABI_GeoColor` and IEM `goes-east-ir-4km-900913`.
  - All vector layers come from `/api/stories` `map`; hurricanes come from
    `/api/tropical`.
- **Hero (`hero.js`)**: a GOES-East CONUS loop with story pins projected
  through the ABI fixed grid (`goes.js`, constants from `/api/satellite`
  `projection`). Under it, thumbnails show where the mesoscale sectors are
  aimed.
  - The projection's `satLon` is the **grid origin** (−75.0 for GOES-19,
    −137.0 for GOES-18), not the satellite's actual 75.2°W; using 75.2 puts
    pins 2–5 px off.
  - STAR images carry a caption bar over the bottom ~25 px, so pins there are
    hidden.
- **Chat (`chat.js`)**: weatherchat's SSE protocol (`delta`/`reset`/`tools`/
  `tool`/`done`/`error`, 75 s stall watchdog). When the model calls
  `get_cams_near`, the client fetches the same cameras and shows them under
  the reply.
- **Explainers (`explainers.js`)** are static content keyed by slug. Stories
  reference them through `learn: [...]`. Keep them accurate and official-
  sourced.

## Conventions

- Every upstream fetch has a deadline (`src/lib/net.js`, 15 s default).
- Optional keys degrade to a "not configured" note: `YOUTUBE_API_KEY`,
  `WINDY_API_KEY`, `X_BEARER_TOKEN`, `AIRNOW_API_KEY`, `ELEVENLABS_API_KEY`.
  The provider key (`FIREWORKS_API_KEY`) gates chat and discussions.
- **Subrequests**: on the Workers Free plan each request gets 50.
  - `/api/live` is split by region, roughly 2 feeds per channel per region.
  - Stories use about 20 subrequests; the satellite catalog's listings are
    bounded.
  - Chat turns that call many tools can exceed 50 on Free; Paid is assumed.
- Static images and streams (STAR, RIDGE, IEM, GIBS, DOT cams, YouTube) are
  hotlinked from the browser, not proxied through the worker.
- Attribution for every source lives in the footer and the map attribution.

## Dev / verify loop

1. `NODE_USE_ENV_PROXY=1 node scripts/dev-server.mjs` (PORT, default 8787)
   serves `public/` and forwards `/api/*` to the worker, using live upstreams.
   `WORKER_ENTRY=path` swaps the entry. Use that to stub sources, or to wrap
   `fetch` and answer `api.fireworks.ai` with a scripted SSE stream so chat
   can be exercised without a key.
2. Render it in headless Chromium (Playwright from the global install,
   browsers in `/opt/pw-browsers`). Collect `pageerror`/console errors and
   screenshot desktop (1440) and mobile (390).
3. `node --check` every `public/js/*.js`, then run
   `npx wrangler deploy --dry-run --outdir dist` to validate the worker
   bundle.
4. Check scripts against live data:
   - `scripts/check-stories.mjs`
   - `check-satellite.mjs`
   - `check-cams.mjs`
   - `check-history.mjs`
   - `check-youtube.mjs`

## Config, secrets, deploy

`wrangler.toml` `[vars]` matches weatherchat (`PROVIDER`, `MODEL`,
`DEFAULT_*`, `NWS_USER_AGENT`, `X_HANDLES`). Deploy by connecting the repo to
Cloudflare Workers Builds (push to `main` deploys), or with
`npx wrangler deploy`. Secrets: `wrangler secret put NAME`.
