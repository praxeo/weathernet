// Live check for src/sources/youtube.js: each channel's two feeds (uploads and
// the "Live streams" playlist), then the liveStreams() payload the video wall
// gets. Upstream calls are real.
//
//   NODE_USE_ENV_PROXY=1 node scripts/check-youtube.mjs [--region AL|national] [--json]
//
// YOUTUBE_API_KEY in the environment turns on live/upcoming detection.
import proc from "node:process";
import { CHANNELS, channelFeeds, liveStreams } from "../src/sources/youtube.js";

const args = proc.argv.slice(2);
const regionArg = args.includes("--region") ? args[args.indexOf("--region") + 1] : undefined;
const asJSON = args.includes("--json");
const env = { YOUTUBE_API_KEY: proc.env.YOUTUBE_API_KEY || "", NWS_USER_AGENT: proc.env.NWS_USER_AGENT };
const out = (s = "") => proc.stdout.write(s + "\n");

const pad = (s, n) => String(s ?? "").slice(0, n).padEnd(n);
function age(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "?";
  if (ms < 3600e3) return `${Math.max(0, Math.round(ms / 60e3))}m`;
  if (ms < 48 * 3600e3) return `${Math.round(ms / 3600e3)}h`;
  return `${Math.round(ms / 86400e3)}d`;
}

// 1. Channel table. Three channels at a time = six feed fetches in flight.
const t0 = Date.now();
const rows = [];
for (let i = 0; i < CHANNELS.length; i += 3) {
  const chunk = CHANNELS.slice(i, i + 3);
  rows.push(...(await Promise.all(chunk.map(async (c) => ({ c, f: await channelFeeds(env, c) })))));
}
out(`Channels (${CHANNELS.length}) — feeds read in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
out(`${pad("name", 26)} ${pad("id", 24)} ${pad("kind", 7)} ${pad("region", 8)} ${pad("uploads", 16)} ${pad("lives", 9)} latest stream`);
let dead = 0;
for (const { c, f } of rows) {
  // Newest by date, not feed position: a reused live broadcast sits on top with an old <published>.
  const newest = f.uploads && f.uploads.map((e) => e.published).sort().pop();
  const up = f.uploads ? `ok ${f.uploads.length}, ${newest ? age(newest) : "-"}` : "FAILED";
  const lv = f.lives ? (f.lives.length ? `ok ${f.lives.length}` : "none") : "FAILED";
  if (!f.uploads) dead++;
  const latest = f.lives && f.lives[0] ? `${f.lives[0].videoId} ${f.lives[0].title}` : "";
  out(`${pad(c.name, 26)} ${pad(c.id, 24)} ${pad(c.kind, 7)} ${pad(c.region, 8)} ${pad(up, 16)} ${pad(lv, 9)} ${latest.slice(0, 70)}`);
  for (const e of f.errors) out(`    ! ${e}`);
}
out(`\nuploads feeds ok: ${rows.length - dead}/${rows.length}   ("lives none" = channel has no Live streams playlist)`);

// 2. The wall payload (feeds come from the memo filled above).
const t1 = Date.now();
const wall = await liveStreams(env, { region: regionArg });
out(`\nliveStreams(${regionArg ? `{ region: "${regionArg}" }` : ""}) in ${((Date.now() - t1) / 1000).toFixed(1)} s — configured: ${wall.configured}, asOf ${wall.asOf}`);
if (asJSON) {
  out(JSON.stringify(wall, null, 2));
} else {
  out(`\nlive (${wall.live.length}):`);
  for (const v of wall.live) {
    out(`  ${pad(v.channelName, 24)} ${pad(v.viewers ?? "—", 7)} since ${v.startedAt ? age(v.startedAt) : "?"} ${v.embeddable === false ? "[no embed] " : ""}${v.title.slice(0, 60)}`);
  }
  out(`upcoming (${wall.upcoming.length}):`);
  for (const v of wall.upcoming) out(`  ${pad(v.channelName, 24)} ${v.scheduledStart} ${v.title.slice(0, 60)}`);
  out(`recent (${wall.recent.length}):`);
  for (const v of wall.recent) out(`  ${pad(age(v.published), 5)} ${pad(v.channelName, 24)} ${v.short ? "[short] " : ""}${v.title.slice(0, 70)}`);
  out(`channels (${wall.channels.length}): e.g. ${wall.channels[0].name} liveEmbed ${wall.channels[0].liveEmbed}`);
  out(`notes (${wall.notes.length}):`);
  for (const n of wall.notes) out(`  - ${n}`);
}
