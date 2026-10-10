// YouTube live storm coverage for the video wall: Alabama TV stations'
// wall-to-wall severe-weather streams, national chasers and networks, and the
// NWS/NOAA channels.
//
// Quota-cheap by design (checked live 2026-10-09, Hurricane Isaias landfall):
//  - Uploads: each channel's public Atom feed, no key, no quota —
//    feeds/videos.xml?channel_id=UC…, the 15 newest uploads (Shorts included).
//  - Live candidates: the channel's auto-generated "Live streams" playlist
//    (UULV + the channel id minus "UC"), through the same keyless feed. The
//    uploads feed alone misses streams on busy channels: FOX10's 11-hour
//    Isaias stream had been pushed out by 15 newer clips, yet sat at #1 of its
//    UULV feed, as did every other stream live at the time (7 channels).
//  - Classification: with YOUTUBE_API_KEY, videos.list (1 quota unit per call
//    of ≤50 ids) says live / upcoming / none. Never search.list (100 units).
//  - Feed order, not <published>, ranks candidates: a reused broadcast keeps
//    its creation date (Ryan Hall's live Isaias stream said April 2026).
//
// Embeds: youtube-nocookie.com/embed/<id> plays live streams (player API
// answers OK / isLive / playableInEmbed). The iframe needs allow="autoplay"
// and must send a Referer — referrerpolicy="no-referrer" gets "Video player
// configuration error" (153). embed/live_stream?channel= resolves only while a
// channel has exactly ONE live stream; with none, or with several (storm-day
// cams: FOX10 had 7, Alabama's 42 had 8) it shows "This video is unavailable".

import { fetchJSON, fetchText, withDeadline } from "../lib/net.js";
import { edgeJSON, memo } from "../lib/cache.js";

// Verified 2026-10-09: channel page canonical id + feed 200 with the expected
// title. Alabama stations' ids come from the YouTube link on the station's own
// site (or its brand handle where the site has none). kind "chaser" covers
// independent streamers: field chasers and the hosts who carry their feeds.
export const CHANNELS = [
  // ── Alabama ──
  { id: "UCIul30v9pU1JxKx6jlI7wBA", name: "ABC 33/40", handle: "@abc3340", kind: "station", region: "AL", market: "Birmingham" }, // WBMA, James Spann
  { id: "UCKWbzT8S4nBdmdx3IeqSsKg", name: "Alabama Weather Network", handle: "@AlabamaWxNet", kind: "network", region: "AL", market: "Statewide" }, // Spann's streaming network (2025)
  { id: "UCBzcofRMvb-Dao4OM-NnxdQ", name: "WBRC 6 News", handle: "@WBRC6NewsOnYourSide", kind: "station", region: "AL", market: "Birmingham" }, // FOX6
  { id: "UC7Vw6oq2LCbzAhdxF_UcIWg", name: "WVTM 13 News", handle: "@WVTM13", kind: "station", region: "AL", market: "Birmingham" },
  { id: "UCeR4TlbmojlqImgr-2SBkJQ", name: "Alabama's 42", handle: "@Alabamas42", kind: "station", region: "AL", market: "Birmingham" }, // WIAT, formerly CBS 42
  { id: "UCJGMzEs9XnBRPcXH1ZE4K-A", name: "WSFA 12 News", handle: "@wsfa12", kind: "station", region: "AL", market: "Montgomery" },
  { id: "UCV8mxYCe-Tauwd09rS9cOVg", name: "WHNT News 19", handle: "@Whntnews19huntsville", kind: "station", region: "AL", market: "Huntsville" },
  { id: "UCpQiwFjomzBHJN-TpdLZxBg", name: "48 News (WAFF/WAAY)", handle: "@48news", kind: "station", region: "AL", market: "Huntsville" }, // waaytv.com 301s to waff.com; WAAY's old channel is this one
  { id: "UC_B1lpgj2DH_wO8T1jJnSYA", name: "FOX10 News", handle: "@FOX10.News.", kind: "station", region: "AL", market: "Mobile" }, // WALA
  { id: "UCFOq-dKCPu3PcmaCMEGDzTA", name: "WKRG News 5", handle: "@WKRGNews", kind: "station", region: "AL", market: "Mobile" },
  { id: "UCzWjzGQ5nHHNYB0ozw_DfuA", name: "WTVY News 4", handle: "@WTVYNews4", kind: "station", region: "AL", market: "Dothan" },
  { id: "UCmazx29ZJhZidGGGNY8eIsA", name: "NWS Mobile", handle: "@NWSMobile", kind: "agency", region: "AL", market: "Mobile" },
  // ── National: chasers and streamers ──
  { id: "UCJHAT3Uvv-g3I8H3GhHWV7w", name: "Ryan Hall, Y'all", handle: "@RyanHallYall", kind: "chaser", region: "national", market: null },
  { id: "UCvBVK2ymNzPLRJrgip2GeQQ", name: "Max Velocity", handle: "@MaxVelocityWX", kind: "chaser", region: "national", market: null },
  { id: "UCV6hWxB0-u_IX7e-h4fEBAw", name: "Reed Timmer", handle: "@ReedTimmerWx", kind: "chaser", region: "national", market: null },
  { id: "UC1nJElGcVcTpeZJVyxEbzJw", name: "Live Storms Media", handle: "@LiveStormsMedia", kind: "chaser", region: "national", market: null }, // Brett Adair, Alabama-based
  { id: "UCRYYy0UrfyGmMKQDU1N1R3g", name: "Convective Chronicles", handle: "@ConvectiveChronicles", kind: "chaser", region: "national", market: null },
  { id: "UCAQpSHsgUcNt6uCOjpgD8kw", name: "Pecos Hank", handle: "@PecosHank", kind: "chaser", region: "national", market: null },
  { id: "UCZSDkxJS7PRw9V0_Sm6U7jg", name: "Freddy McKinney", handle: "@FreddyMcKinney", kind: "chaser", region: "national", market: null },
  { id: "UCD3KREyo3IqCLBC-4khGgIw", name: "WXChasing", handle: "@WxChasing", kind: "chaser", region: "national", market: null }, // Brandon Copic
  { id: "UCb0U1g5r4kH_NDMGiGRhysA", name: "Connor Croff", handle: "@ConnorCroff", kind: "chaser", region: "national", market: null },
  { id: "UCri9Wr8e5rjVNeIwIQVhWcA", name: "Tornado Titans", handle: "@TornadoTitans", kind: "chaser", region: "national", market: null },
  { id: "UCxxWE4Xpsv_UU5QGT7S-jyA", name: "HurricaneTrack", handle: "@hurricanetrack", kind: "chaser", region: "national", market: null }, // Mark Sudduth
  // ── National: networks ──
  { id: "UC1FbPiXx59_ltnFVx7IxWow", name: "FOX Weather", handle: "@Foxweather", kind: "network", region: "national", market: null },
  { id: "UCGTUbwceCMibvpbd2NaIP7A", name: "The Weather Channel", handle: "@TheWeatherChannel", kind: "network", region: "national", market: null },
  { id: "UCuYqi3hOfz6-3Hdp6tEJjAg", name: "AccuWeather", handle: "@accuweather", kind: "network", region: "national", market: null },
  // ── National: agencies ──
  { id: "UC9hQvMjzSxurMirYDgOMezw", name: "National Weather Service", handle: "@noaanationalweatherservice", kind: "agency", region: "national", market: null },
  { id: "UCv0qlvvLtEuCxAoEitAuoFg", name: "National Hurricane Center", handle: "@nwsnhc", kind: "agency", region: "national", market: null },
  { id: "UCf8-aH_b6NuYs9uj64fgNuw", name: "Storm Prediction Center", handle: "@NWSSPC", kind: "agency", region: "national", market: null },
  { id: "UCe9IxQeBttZIYl5c43ycf9g", name: "NOAA", handle: "@noaa", kind: "agency", region: "national", market: null },
].map((c) => ({ ...c, url: `https://www.youtube.com/channel/${c.id}` })); // ids never change; handles can

const FEEDS = "https://www.youtube.com/feeds/videos.xml";
const VIDEOS_API = "https://www.googleapis.com/youtube/v3/videos";

const UPLOADS_MEMO_MS = 10 * 60e3;
// The live-streams feed decides what reaches the wall, so keep it fresher.
const LIVES_MEMO_MS = 2 * 60e3;
const LIVES_EDGE_TTL_S = 60; // Cloudflare's own cache of that feed (fetch cf.cacheTtl)
const RESULT_TTL_S = 120;
const FEED_TIMEOUT_MS = 6e3;
const API_TIMEOUT_MS = 8e3;
const FANOUT_BUDGET_MS = 12e3;
const LANES = 6;
// Ranks per channel sent to videos.list. Big stations stack streams: ABC 33/40
// had a football game at #1 and its Isaias coverage at #3/#4.
const CANDIDATES_PER_CHANNEL = 4;
const IDS_PER_CALL = 50;
const MAX_CALLS = 2; // ≤ 2 quota units per refresh
const ENDED_TTL_MS = 12 * 3600e3;
const ENDED_MAX = 5000;
const RECENT_LIMIT = 24;
const RECENT_PER_CHANNEL = 3; // a station posting a clip every 10 minutes shouldn't fill the list
const UPCOMING_PAST_MS = 2 * 3600e3; // scheduled-but-never-started broadcasts linger as "upcoming"
const UPCOMING_AHEAD_MS = 72 * 3600e3;

const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;
const embedUrl = (id) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1`;
const thumbUrl = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`; // 16:9; the feed's hqdefault is letterboxed 4:3
const liveEmbedUrl = (channelId) => `https://www.youtube.com/embed/live_stream?channel=${channelId}`;
const uploadsFeed = (channelId) => `${FEEDS}?channel_id=${channelId}`;
const livesFeed = (channelId) => `${FEEDS}?playlist_id=UULV${channelId.slice(2)}`;

// ── Atom parsing (no DOMParser in Workers) ──────────────────────────────────

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
    const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });
}

function tag(xml, name) {
  const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
  return m ? m[1] : "";
}

// Entries of a YouTube channel or playlist feed, in feed order.
export function parseFeed(xml) {
  const out = [];
  for (const [, e] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const videoId = tag(e, "yt:videoId");
    if (!videoId) continue;
    const link = (/<link rel="alternate" href="([^"]+)"/.exec(e) || [])[1] || watchUrl(videoId);
    out.push({
      videoId,
      channelId: tag(e, "yt:channelId"),
      title: decode(tag(e, "title")),
      published: tag(e, "published") || null,
      link,
      short: link.includes("/shorts/"),
    });
  }
  return out;
}

// ── Fetching ─────────────────────────────────────────────────────────────────

async function readFeed(env, url, ttlSec, missingIsEmpty) {
  try {
    const xml = await withDeadline(fetchText(url, { env, ttl: ttlSec, timeoutMs: FEED_TIMEOUT_MS }), FEED_TIMEOUT_MS, "feed");
    return parseFeed(xml);
  } catch (err) {
    // A channel that has never streamed has no UULV playlist; YouTube 404s it.
    if (missingIsEmpty && /^404 /.test(err.message)) return [];
    throw err;
  }
}

// Workers allow 6 simultaneous outgoing connections per invocation; more queue
// inside the runtime, where a feed's deadline would tick while it waits. Run
// fetches through 6 lanes so each deadline starts with its fetch, and stop
// starting new ones once the fan-out has spent its budget.
function lanes(n, budgetMs) {
  const stopAt = Date.now() + budgetMs;
  const queue = [];
  let active = 0;
  const pump = () => {
    while (active < n && queue.length) {
      const job = queue.shift();
      if (Date.now() > stopAt) {
        job.reject(new Error("skipped, fan-out budget spent"));
        continue;
      }
      active++;
      Promise.resolve()
        .then(job.fn)
        .then(job.resolve, job.reject)
        .finally(() => {
          active--;
          pump();
        });
    }
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    pump();
  });
}

// Both feeds for one channel, memoized per isolate. Never throws: a dead feed
// comes back null with its error, so one channel can't sink the wall.
export async function channelFeeds(env, channel, { run = (fn) => fn() } = {}) {
  const [uploads, lives] = await Promise.allSettled([
    memo(`yt:up:${channel.id}`, UPLOADS_MEMO_MS, () => run(() => readFeed(env, uploadsFeed(channel.id), UPLOADS_MEMO_MS / 1000, false))),
    memo(`yt:lv:${channel.id}`, LIVES_MEMO_MS, () => run(() => readFeed(env, livesFeed(channel.id), LIVES_EDGE_TTL_S, true))),
  ]);
  const errors = [];
  if (uploads.status === "rejected") errors.push(`uploads feed: ${shortError(uploads.reason)}`);
  if (lives.status === "rejected") errors.push(`live-streams feed: ${shortError(lives.reason)}`);
  return {
    uploads: uploads.status === "fulfilled" ? uploads.value : null,
    lives: lives.status === "fulfilled" ? lives.value : null,
    errors,
  };
}

// Upstream errors end up in the public `notes`: keep them short and URL-free.
// fetchJSON keeps only 160 chars of the body, and Google's quota message
// embeds an HTML link, so name the API's usual failures outright.
function shortError(err) {
  const msg = String((err && err.message) || err);
  const http = /^(\d{3}) on /.exec(msg);
  if (http) {
    const known = !msg.includes("googleapis.com") ? null :
      /exceeded your|quota/i.test(msg) ? "daily quota exceeded; resets midnight Pacific" :
      /API key not valid/i.test(msg) ? "API key not valid" :
      /has not been used|is disabled/i.test(msg) ? "YouTube Data API v3 not enabled for this key's project" :
      /referer|blocked/i.test(msg) ? "key restrictions block this request" : null;
    const reason = known || (/"message":\s*"([^"\\<]{1,100})/.exec(msg) || [])[1];
    return `HTTP ${http[1]}${reason ? ` (${reason.trim()})` : ""}`;
  }
  if (/timed out|due to timeout/i.test(msg)) return "timed out";
  return msg.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
}

// Ended streams and plain VODs never go live again; remembering them per
// isolate keeps most refreshes to one videos.list call.
const ENDED = new Map();
function isEnded(id, now) {
  const exp = ENDED.get(id);
  if (exp === undefined) return false;
  if (exp > now) return true;
  ENDED.delete(id);
  return false;
}
function markEnded(id, now) {
  ENDED.delete(id);
  ENDED.set(id, now + ENDED_TTL_MS);
  if (ENDED.size > ENDED_MAX) ENDED.delete(ENDED.keys().next().value); // oldest first
}

const API_FIELDS = "items(id,snippet(channelId,channelTitle,title,liveBroadcastContent,thumbnails/medium/url)," +
  "liveStreamingDetails(actualStartTime,scheduledStartTime,concurrentViewers),status(embeddable))";

async function videosList(env, ids) {
  const url = `${VIDEOS_API}?part=snippet,liveStreamingDetails,status&id=${ids.join(",")}&fields=${encodeURIComponent(API_FIELDS)}`;
  // Key in a header, never the URL: fetchJSON quotes the URL in its errors.
  const data = await withDeadline(
    fetchJSON(url, { env, ttl: 0, timeoutMs: API_TIMEOUT_MS, headers: { "X-goog-api-key": env.YOUTUBE_API_KEY } }),
    API_TIMEOUT_MS,
    "videos.list",
  );
  return data.items || [];
}

// ── The wall ─────────────────────────────────────────────────────────────────

function pickChannels(region) {
  const r = String(region || "").trim().toLowerCase();
  if (r === "al") return { key: "AL", list: CHANNELS.filter((c) => c.region === "AL") };
  if (r === "national") return { key: "national", list: CHANNELS.filter((c) => c.region === "national") };
  return { key: "all", list: CHANNELS, unknown: r && r !== "all" ? region : null };
}

export async function liveStreams(env = {}, { region, ctx } = {}) {
  const picked = pickChannels(region);
  const configured = !!env.YOUTUBE_API_KEY;
  const key = `youtube/live/v1/${picked.key}/${configured ? "api" : "rss"}`;
  const wall = await edgeJSON(key, RESULT_TTL_S, () => buildWall(env, picked.list, configured), ctx);
  // Outside the cache: an unknown region shares the "all" entry.
  if (picked.unknown) return { ...wall, notes: [`Unknown region "${picked.unknown}"; showing all channels.`, ...wall.notes] };
  return wall;
}

async function buildWall(env, chans, configured) {
  const notes = [];
  if (!configured) {
    notes.push("YOUTUBE_API_KEY not set: live/upcoming detection is off. Each channel's liveEmbed plays only while it has exactly one live stream.");
  }

  const run = lanes(LANES, FANOUT_BUDGET_MS);
  const settled = await Promise.allSettled(chans.map((c) => channelFeeds(env, c, { run })));
  const feeds = settled.map((s, i) => ({ channel: chans[i], ...(s.status === "fulfilled" ? s.value : { uploads: null, lives: null, errors: [shortError(s.reason)] }) }));
  for (const f of feeds) for (const e of f.errors) notes.push(`${f.channel.name}: ${e}`);

  const byChannel = new Map(chans.map((c) => [c.id, c]));
  const live = [];
  const upcoming = [];
  if (configured) {
    const now = Date.now();
    // Interleave by rank (every channel's #1 first) so a cap trims the least
    // likely candidates. The uploads feed stands in when the live feed failed.
    const ranked = feeds.map((f) => (f.lives || f.uploads || []).slice(0, CANDIDATES_PER_CHANNEL).map((e) => e.videoId));
    const ids = [];
    const fromChannel = new Map(); // videoId → the channel whose feed listed it
    for (let rank = 0; rank < CANDIDATES_PER_CHANNEL; rank++) {
      ranked.forEach((list, i) => {
        const id = list[rank];
        if (id && !fromChannel.has(id) && !isEnded(id, now)) {
          fromChannel.set(id, feeds[i].channel);
          ids.push(id);
        }
      });
    }
    const capped = ids.slice(0, IDS_PER_CALL * MAX_CALLS);
    if (capped.length < ids.length) notes.push(`Checked ${capped.length} of ${ids.length} live-stream candidates (quota cap).`);
    const batches = [];
    for (let i = 0; i < capped.length; i += IDS_PER_CALL) batches.push(capped.slice(i, i + IDS_PER_CALL));
    const results = await Promise.allSettled(batches.map((b) => videosList(env, b)));
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        notes.push(`videos.list failed: ${shortError(r.reason)}`);
        return;
      }
      const returned = new Set();
      for (const v of r.value) {
        returned.add(v.id);
        const s = v.snippet || {};
        const d = v.liveStreamingDetails || {};
        const c = byChannel.get(s.channelId) || fromChannel.get(v.id);
        const base = {
          videoId: v.id,
          channelId: (c && c.id) || s.channelId,
          channelName: (c && c.name) || s.channelTitle || "",
          title: s.title || "",
          thumb: (s.thumbnails && s.thumbnails.medium && s.thumbnails.medium.url) || thumbUrl(v.id),
          url: watchUrl(v.id),
        };
        if (s.liveBroadcastContent === "live") {
          live.push({
            ...base,
            startedAt: d.actualStartTime || null,
            viewers: d.concurrentViewers != null ? Number(d.concurrentViewers) : null, // null when the channel hides it
            embed: embedUrl(v.id),
            embeddable: v.status ? v.status.embeddable !== false : null,
            kind: c ? c.kind : null,
            region: c ? c.region : null,
          });
        } else if (s.liveBroadcastContent === "upcoming") {
          const t = Date.parse(d.scheduledStartTime);
          if (t >= now - UPCOMING_PAST_MS && t <= now + UPCOMING_AHEAD_MS) {
            upcoming.push({ ...base, scheduledStart: d.scheduledStartTime });
          }
        } else {
          markEnded(v.id, now);
        }
      }
      // Missing from the response: deleted or private, so not coming back either.
      for (const id of batches[i]) if (!returned.has(id)) markEnded(id, now);
    });
    // Embeddable first (a wall can't play the others), then by audience.
    live.sort((a, b) => (b.embeddable !== false) - (a.embeddable !== false) || (b.viewers ?? -1) - (a.viewers ?? -1));
    upcoming.sort((a, b) => Date.parse(a.scheduledStart) - Date.parse(b.scheduledStart));
  }

  // Newest uploads across channels; live/upcoming items are shown above already.
  const shown = new Set([...live, ...upcoming].map((v) => v.videoId));
  const pool = feeds.flatMap((f) => (f.uploads || []).map((e) => ({ e, c: f.channel })));
  pool.sort((a, b) => (Date.parse(b.e.published) || 0) - (Date.parse(a.e.published) || 0));
  const perChannel = new Map();
  const recent = [];
  for (const { e, c } of pool) {
    const n = perChannel.get(c.id) || 0;
    if (n >= RECENT_PER_CHANNEL || shown.has(e.videoId)) continue;
    perChannel.set(c.id, n + 1);
    recent.push({
      videoId: e.videoId,
      channelId: c.id,
      channelName: c.name,
      title: e.title,
      published: e.published,
      thumb: thumbUrl(e.videoId),
      url: e.link,
      short: e.short,
    });
    if (recent.length >= RECENT_LIMIT) break;
  }

  const channels = feeds.map(({ channel: c, lives }) => ({
    id: c.id,
    name: c.name,
    handle: c.handle,
    kind: c.kind,
    region: c.region,
    market: c.market,
    url: c.url,
    liveEmbed: liveEmbedUrl(c.id),
    // Top of the live-streams playlist: current or most recent stream. Lets a
    // keyless wall embed by id, but it may well be over.
    latestStream: lives && lives[0] ? { videoId: lives[0].videoId, title: lives[0].title } : null,
  }));

  return { configured, asOf: new Date().toISOString(), live, upcoming, recent, channels, notes: [...new Set(notes)] };
}
