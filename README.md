# WeatherNet

**The atmosphere, live.** A nationwide live-weather site for people who love weather. It combines live GOES satellite loops, radar, warnings, cameras that follow the weather, the record books, and plain-language explainers. An AI meteorologist reads all of the same data.

WeatherNet grew out of [weatherchat](https://github.com/praxeo/weatherchat). It keeps weatherchat's whole backend: the NWS/SPC/WPC/NHC data tools, the forecast-discussion writer and the chat agent. On top of that it adds a national story engine, satellite, cameras, history and a new front end.

## What's on the page

- **Now.** A GOES-East CONUS loop with every live story pinned on it, beside the lead story and national counts.
- **Story board.** What's significant across the US right now, ranked:
  - **Tier 3 (extreme):** Tornado and Flash Flood Emergencies, Extreme Wind Warnings, PDS watches, SPC High Risk, major hurricanes at the coast.
  - **Tier 2 (major):** PDS tornado warnings, confirmed tornadoes, destructive storms, Moderate Risk, blizzards.
  - **Tier 1 (notable).**
  - Related warnings, watches and storm reports group into one story. Events outside the US appear only on a GDACS red alert.
- **Live map.** NEXRAD composite with a 50-minute loop and an optional GOES IR layer. Also NWS warning polygons, SPC watches and Day 1 risk areas, storm reports, heat/fire/winter hazards, NHC cones/tracks/coastal warnings, and cameras.
- **Satellite.** GOES-East/West CONUS, regional sectors, the 1-minute mesoscale sectors (with where NOAA has aimed them) and full disk. Each comes with several bands and an explanation of what that band shows.
- **Cams.** DOT and sky cameras nearest each top story and nearest you. Some are live video, the rest are refreshing stills. Plus live storm coverage on YouTube.
- **Your weather.** Observations, an original AFD-style forecast discussion for your point, a 48-hour chart, the 7-day, and storm reports and stations around you.
- **This day in weather.** Records and normals at the nearest long-record station, with a dot plot of every year's high and low. Also tornadoes on this date, nearby and nationally.
- **Learn.** Explainers for every product and phenomenon the site shows, linked from the stories.
- **Ask WeatherNet.** The weatherchat agent plus WeatherNet tools (national stories, cameras, satellite status, climate history, the historical archive, live coverage).

## Historical data API

Every endpoint returns JSON with open CORS, so scripts and other sites can call it directly. `GET /api/archive` describes the endpoints and their parameters. Coverage is the US, with the continental US the best covered.

| Endpoint | What it returns |
|---|---|
| `/api/archive/products?office=BMX&type=AFD&date=2011-04-27[&days=1-7]` | Archived NWS text products from one office over 1–7 UTC days, newest first. `type` defaults to AFD (Area Forecast Discussion). Any AFOS id also works, such as HWO, PNS (damage surveys) or LSR. Use `office=SPC`/`WPC`/`NHC` for the national centers (SWODY1, SWOMCD, QPFERD, FFGMPD, TCDAT1 …). `lat`+`lon` can stand in for `office`. |
| `/api/archive/product?id=…` or `?office=BMX&at=2011-04-27T15:00Z&count=3` | One product's full text, plus AFD sections, by id. Or the latest `count` issuances at or before a time: "what was the forecast discussion saying then". |
| `/api/archive/day?lat&lon&date=2011-04-27[&radius=25]` | Everything recorded at a point on one local date: the climate station's high/low/precip/snow against normal, the nearest ASOS's hourly observations, the SPC/WPC outlooks in force, every warning and watch that covered the point (and whether it was inside the polygon), storm reports and tornado tracks within the radius, and that day's AFDs. |
| `/api/archive/daily?lat&lon&start&end` (or `sid=BHMthr`) | Daily max/min, precipitation, snowfall and snow depth with 1991–2020 normals at the nearest long-record climate station, up to 10 years per call, with a summary. |
| `/api/archive/tornadoes?lat&lon[&radius=25&since&until&min]` | Every SPC tornado track since 1950 that passed within the radius (up to 100 mi), with closest approach, counts by rating and decade, and the strongest, deadliest and closest. |
| `/api/history?lat&lon&date` | Records and normals for a calendar date, every year's high and low on it, and tornadoes on that date. |

Forecast discussions go back to about 1999–2001, depending on the office. Warnings, storm reports and outlooks are reliable from about 2005, daily climate records reach back to the 1800s, and tornado tracks to 1950. Sources:
- Iowa Environmental Mesonet: the NWS text archive, VTEC warnings, LSRs, SPC/WPC outlooks, ASOS observations.
- NOAA ACIS: daily climate data and normals.
- The SPC severe weather database: tornado tracks.

The chat agent uses the same data through `get_archived_discussion`, `get_weather_on_date`, `get_tornado_history` and `get_daily_climate`.

## Run it

```sh
npm install
npx wrangler dev          # http://localhost:8787
```

Secrets for local dev go in `.dev.vars` (gitignored):

```
FIREWORKS_API_KEY=...
YOUTUBE_API_KEY=...
```

## Deploy

WeatherNet is a single Cloudflare Worker with Static Assets (`public/`).

1. Connect this repository in the Cloudflare dashboard: **Workers & Pages → Create → Import a repository**. Pushes to `main` then deploy automatically, the same way weatherchat does. Alternatively, run `npx wrangler deploy`.
2. Set secrets with `wrangler secret put NAME` or in the dashboard:

| Secret | What it enables |
|---|---|
| `FIREWORKS_API_KEY` | Chat and forecast discussions (GLM 5.3 Fast on Fireworks). Required for anything AI. |
| `YOUTUBE_API_KEY` | Detecting who is live right now. It's free; the site uses about 1 quota unit per refresh. |
| `WINDY_API_KEY` | Nationwide scenic/sky webcams (Windy Webcams API, free tier). It's also the only camera coverage in Florida, which has no keyless DOT feed. |
| `X_BEARER_TOKEN` | Local meteorologists' X posts in "Around you". Pay-per-use, and only read while weather is active. |
| `AIRNOW_API_KEY` | Air quality. |
| `ELEVENLABS_API_KEY` | Voice endpoints carried over from weatherchat. |

Everything optional degrades to a "not configured" state. Location defaults and the model are set in `wrangler.toml` under `[vars]`.

## Checks

```sh
npm run check                                        # wrangler bundle dry run
NODE_USE_ENV_PROXY=1 node scripts/check-stories.mjs   # live national story board
NODE_USE_ENV_PROXY=1 node scripts/check-archive.mjs   # historical API against known events
NODE_USE_ENV_PROXY=1 node scripts/dev-server.mjs      # local harness for headless browser checks
```

See `CLAUDE.md` for how the pieces fit together.
