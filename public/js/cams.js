// Cameras that follow the weather: tiles near the top stories and the
// visitor's point, a viewer (live HLS where the DOT streams, refreshing stills
// otherwise), and live storm coverage from YouTube.
import { $, el, clear, getJSON, ago, openSheet, sheetTitle, plural } from "./util.js";
import { state } from "./state.js";

let refreshTimer = null;

// A still that refreshes: cache-bust per minute for sources that allow it
// (tokenized URLs, e.g. Windy, must stay untouched).
function stillUrl(c) {
  if (!c.snapshot) return "";
  if (c.source === "windy" || /[?&](token|sig|signature|expires)=/i.test(c.snapshot)) return c.snapshot;
  const bucket = Math.floor(Date.now() / ((c.refreshSec || 60) * 1000));
  return c.snapshot + (c.snapshot.includes("?") ? "&" : "?") + "t=" + bucket;
}

// Some licenses forbid cropping or stretching (ALERTCalifornia is CC BY-NC-ND,
// Windy forbids stretching): show those letterboxed.
const UNCROPPED = new Set(["alertca", "windy"]);

export function camTile(c, onClick) {
  const img = c.snapshot
    ? el("img", { alt: c.name, loading: "lazy", src: stillUrl(c), dataset: { cam: "1" }, style: UNCROPPED.has(c.source) ? { objectFit: "contain" } : null })
    : el("div", { class: "broken", text: "▶ Live video" });
  const tile = el("div", { class: "cam", title: c.name, tabindex: 0, on: { click: onClick, keydown: (e) => { if (e.key === "Enter") onClick(); } } },
    img,
    el("div", { class: "tag" }, c.hls ? el("span", { class: "badge live", text: "LIVE" }) : null, c.kind === "sky" || c.kind === "fire" ? el("span", { class: "badge", text: c.kind === "fire" ? "FIRE CAM" : "SKY CAM" }) : null),
    el("div", { class: "label" },
      el("b", { text: c.name }),
      el("span", { class: "muted", text: [c.city && c.state ? `${c.city}, ${c.state}` : c.state, c.distMi != null ? `${Math.round(c.distMi)} mi ${c.bearing || ""}`.trim() : null].filter(Boolean).join(" · ") }),
    ),
  );
  // A dead still: fall back to the stream if there is one, else drop the
  // tile (some networks have a third of their cameras dark at any moment).
  if (c.snapshot) {
    img.addEventListener("error", () => {
      if (c.hls) img.replaceWith(el("div", { class: "broken", text: "▶ Live video" }));
      else tile.remove();
    }, { once: true });
    img._cam = c;
  }
  return tile;
}

function refreshStills() {
  for (const img of document.querySelectorAll("img[data-cam]")) {
    if (img._cam && img.isConnected) img.src = stillUrl(img._cam);
  }
}

let hlsLoading = null;
function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (!hlsLoading) {
    hlsLoading = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "/vendor/hls/hls.light.min.js";
      s.onload = () => res(window.Hls);
      s.onerror = rej;
      document.head.append(s);
    });
  }
  return hlsLoading;
}

export function openCam(c) {
  let hls = null;
  let timer = null;
  const frame = el("div", { class: "video-frame" });
  const note = el("div", { class: "muted", style: { fontSize: "12.5px" } });
  if (c.hls) {
    const video = el("video", { muted: true, autoplay: true, playsInline: true, controls: true });
    video.muted = true;
    frame.append(video);
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = c.hls;
    } else {
      loadHls().then((Hls) => {
        if (!Hls || !Hls.isSupported()) throw new Error("no hls");
        hls = new Hls({ liveDurationInfinity: true });
        hls.loadSource(c.hls);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_, d) => {
          if (d.fatal) {
            note.textContent = "Live stream unavailable right now; showing the latest still.";
            hls.destroy();
            hls = null;
            showStill();
          }
        });
      }).catch(showStill);
    }
  } else {
    showStill();
  }
  function showStill() {
    if (!c.snapshot) {
      clear(frame).append(el("div", { class: "broken", text: "This camera's stream isn't available right now." }));
      return;
    }
    clear(frame).append(el("img", { src: stillUrl(c), alt: c.name }));
    timer = setInterval(() => {
      const img = frame.querySelector("img");
      if (img) img.src = stillUrl(c);
    }, Math.max(30, c.refreshSec || 60) * 1000);
  }
  const body = [
    frame,
    note,
    el("div", { class: "item" },
      el("b", { text: c.name }),
      el("div", { text: [c.city, c.state].filter(Boolean).join(", ") }),
      el("div", { class: "muted", text: `${c.lat?.toFixed?.(3)}, ${c.lon?.toFixed?.(3)} · ${c.kind || "camera"} · ${c.attribution || c.source}` }),
      c.page ? el("a", { href: c.page, target: "_blank", rel: "noopener", text: "Open on the source site ↗" }) : null,
    ),
  ];
  openSheet(sheetTitle(c.hls ? "Live camera" : "Camera", c.name, c.distMi != null ? `${Math.round(c.distMi)} mi from the story` : ""), body, {
    onClose: () => {
      if (hls) hls.destroy();
      if (timer) clearInterval(timer);
      const v = frame.querySelector("video");
      if (v) { v.pause(); v.removeAttribute("src"); v.load(); }
    },
  });
}

// ── The Cams section ────────────────────────────────────────────────────────
export async function renderCams() {
  const board = $("camBoard");
  const stories = (state.stories?.stories || []).filter((s) => s.lane === "us" && Number.isFinite(s.lat) && s.kind !== "records").slice(0, 3);
  const loc = state.loc;
  const jobs = stories.map((s) => getJSON(`/api/cams?lat=${s.lat}&lon=${s.lon}&radius=80&limit=8&prefer=sky`).then((d) => ({ s, d })).catch(() => null));
  const mine = loc ? getJSON(`/api/cams?lat=${loc.lat}&lon=${loc.lon}&radius=40&limit=8&links=1&prefer=sky`).catch(() => null) : Promise.resolve(null);
  // Two smaller calls instead of one: each stays well under Workers' per-
  // request subrequest budget on a cold cache (two feeds per channel).
  const live = Promise.all([getJSON("/api/live?region=AL").catch(() => null), getJSON("/api/live?region=national").catch(() => null)])
    .then(([a, b]) => (a || b ? mergeLive(a, b) : null));
  const [groups, near, yt] = await Promise.all([Promise.all(jobs), mine, live]);

  clear(board);
  for (const g of groups.filter(Boolean)) {
    if (!g.d.cams?.length) continue;
    board.append(el("div", { class: "cam-group" },
      el("h3", {}, el("span", { class: "badge " + ["context", "notable", "major", "extreme"][g.s.tier], text: g.s.kicker }), g.s.title,
        el("span", { class: "muted", text: `· ${plural(g.d.cams.length, "camera")} within 80 mi` })),
      el("div", { class: "cam-grid" }, g.d.cams.map((c) => camTile(c, () => openCam(c)))),
    ));
  }
  if (near?.cams?.length) {
    board.append(el("div", { class: "cam-group" },
      el("h3", {}, "Near you", el("span", { class: "muted", text: `· ${loc.name || "your point"}` })),
      el("div", { class: "cam-grid" }, near.cams.map((c) => camTile(c, () => openCam(c)))),
    ));
  }
  if (!board.childNodes.length) {
    board.append(el("div", { class: "panel empty", text: "No public cameras near the current stories or your location yet." }));
  }
  if (near?.links?.length) {
    board.append(el("div", { class: "cam-group" },
      el("h3", {}, "TV station skycams", el("span", { class: "muted", text: "· open on the station's site" })),
      el("div", { class: "channel-chips" }, near.links.map((l) => el("a", { class: "chip", href: l.url, target: "_blank", rel: "noopener", text: `${l.station}${l.name ? " · " + l.name : ""} ↗` }))),
    ));
  }
  if (yt) board.append(liveCoverage(yt));

  clearInterval(refreshTimer);
  refreshTimer = setInterval(refreshStills, 60000);
}

function mergeLive(a, b) {
  const x = a || {};
  const y = b || {};
  const byTime = (k) => (p, q) => String(q[k] || "").localeCompare(String(p[k] || ""));
  return {
    configured: !!(x.configured || y.configured),
    live: [...(x.live || []), ...(y.live || [])].sort((p, q) => (q.viewers || 0) - (p.viewers || 0)),
    upcoming: [...(x.upcoming || []), ...(y.upcoming || [])],
    recent: [...(x.recent || []), ...(y.recent || [])].filter((v) => !v.short).sort(byTime("published")).slice(0, 24),
    channels: [...(x.channels || []), ...(y.channels || [])],
  };
}

function liveCoverage(yt) {
  const box = el("div", { class: "cam-group" });
  const live = yt.live || [];
  box.append(el("h3", {}, live.length ? el("span", { class: "badge live", text: "LIVE" }) : null, "Live storm coverage",
    el("span", { class: "muted", text: live.length ? `· ${plural(live.length, "stream")} on now` : yt.configured ? "· nobody's live right now" : "· latest from meteorologists & chasers" })));
  const vids = live.length ? live : (yt.recent || []).slice(0, 8);
  if (vids.length) {
    box.append(el("div", { class: "video-grid" }, vids.map((v) => el("div", { class: "video", on: { click: () => openVideo(v) } },
      el("div", { class: "thumb" }, el("img", { src: v.thumb, alt: "", loading: "lazy" }), v.embed && live.length ? el("span", { class: "badge live", text: "LIVE" }) : null),
      el("div", { class: "meta" }, el("b", { text: v.title }), el("div", { class: "muted", text: [v.channelName, v.published ? ago(v.published) : v.startedAt ? `live since ${ago(v.startedAt)}` : null].filter(Boolean).join(" · ") })),
    ))));
  }
  // Without live detection, each channel's newest live-stream entry is the
  // best bet (the channel-level live embed only resolves when exactly one
  // stream is running).
  const chans = (yt.channels || []).filter((c) => c.region === "AL" || c.kind === "chaser").slice(0, 18);
  if (chans.length && !live.length) {
    box.append(el("div", { class: "muted", style: { margin: "14px 0 8px", fontSize: "12.5px" }, text: "Each channel's most recent live stream:" }),
      el("div", { class: "channel-chips" }, chans.map((c) => el("button", {
        class: "chip", text: c.name, title: c.latestStream?.title || "",
        on: { click: () => openVideo(c.latestStream ? { title: c.latestStream.title, videoId: c.latestStream.videoId, channelName: c.name, url: `https://www.youtube.com/watch?v=${c.latestStream.videoId}` } : { title: `${c.name} — live`, embed: c.liveEmbed, channelName: c.name, url: c.url }) },
      }))));
  }
  return box;
}

function openVideo(v) {
  const src = v.embed || (v.videoId ? `https://www.youtube-nocookie.com/embed/${v.videoId}?autoplay=1&mute=1` : null);
  const body = [
    src ? el("div", { class: "video-frame" }, el("iframe", { src, allow: "autoplay; encrypted-media; picture-in-picture", allowFullscreen: true, title: v.title || "Video" })) : null,
    el("div", { class: "muted", text: [v.channelName, v.published ? ago(v.published) : null].filter(Boolean).join(" · ") }),
    v.url ? el("a", { href: v.url, target: "_blank", rel: "noopener", text: "Open on YouTube ↗" }) : null,
  ];
  openSheet(sheetTitle("Video", v.title || "Live coverage"), body);
}
