# WeatherNet

**The atmosphere, live.** A nationwide live-weather site for people who love weather. It combines live GOES satellite loops, radar, warnings, cameras that follow the weather, the record books, and plain-language explainers. An AI meteorologist reads all of the same data.

WeatherNet grew out of [weatherchat](https://github.com/praxeo/weatherchat). It keeps weatherchat's whole backend: the NWS/SPC/WPC/NHC data tools, the forecast-discussion writer and the chat agent. On top of that it adds a national story engine, satellite, cameras, history and a new front end.

## What's on the page

- **Your weather.** The page opens here, laid out like weatherchat's home screen: alerts for your point, then observations, an original AFD-style forecast discussion for your point, a 48-hour chart, the 7-day, and storm reports and stations around you (moved up under the conditions while something is happening nearby). On a major or extreme national day, a one-line strip above it names the lead US story.
- **Across the US.** A GOES-East CONUS loop with every live story pinned on it, beside the lead story and national counts.
- **Story board.** What's significant across the US right now, ranked:
  - **Tier 3 (extreme):** Tornado and Flash Flood Emergencies, Extreme Wind Warnings, PDS watches, SPC High Risk, major hurricanes at the coast.
  - **Tier 2 (major):** PDS tornado warnings, confirmed tornadoes, destructive storms, Moderate Risk, blizzards.
  - **Tier 1 (notable).**
  - Related warnings, watches and storm reports group into one story. Events outside the US appear only on a GDACS red alert.
- **Live map.** NEXRAD composite with a 50-minute loop and an optional GOES IR layer. Also NWS warning polygons, SPC watches and Day 1 risk areas, storm reports, heat/fire/winter hazards, NHC cones/tracks/coastal warnings, and cameras.
- **Cams.** Live storm coverage on YouTube leads while anyone is on air. Then DOT and sky cameras nearest you and nearest each top story. Some are live video, the rest are refreshing stills.
- **Satellite.** GOES-East/West CONUS, regional sectors, the 1-minute mesoscale sectors (with where NOAA has aimed them) and full disk. Each comes with several bands and an explanation of what that band shows.
- **This day in weather.** Records and normals at the nearest long-record station, with a dot plot of every year's high and low. Also tornadoes on this date, nearby and nationally.
- **Learn.** Explainers for every product and phenomenon the site shows, linked from the stories.
- **Ask WeatherNet.** The weatherchat agent plus WeatherNet tools (national stories, cameras, satellite status, climate history, live coverage).

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
NODE_USE_ENV_PROXY=1 node scripts/dev-server.mjs      # local harness for headless browser checks
```

See `CLAUDE.md` for how the pieces fit together.
