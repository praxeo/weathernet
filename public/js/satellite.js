// Satellite gallery: GOES-East/West CONUS, regional sectors, the 1-minute
// mesoscale sectors (with where NOAA has aimed them) and full disk, each with
// band choices, a frame loop and an explanation of what the band shows.
import { $, el, clear, put, store, ago, utcStamp } from "./util.js";
import { openLearn } from "./learn.js";

let catalog = null;
let current = null; // { kind, item }
let bandId = null;
let frames = [];
let idx = 0;
let playing = true;
let timer = null;
let token = 0;

// The hero's meso thumbnails jump here with a saved view key.
window.addEventListener("wn:satview", () => {
  current = null;
  if (catalog) renderSatellite(catalog);
});

export function renderSatellite(cat) {
  catalog = cat;
  const box = clear($("satGallery"));
  if (!cat || (!cat.views?.length && !cat.meso?.length)) {
    box.append(el("div", { class: "panel empty", style: { gridColumn: "1 / -1" }, text: "Satellite imagery is unavailable right now." }));
    return;
  }
  const entries = listEntries(cat);
  const saved = store.get("wn.satView", null);
  current = current ? entries.find((e) => e.key === current.key) || entries[0] : entries.find((e) => e.key === saved) || entries[0];

  const list = el("div", { class: "panel sat-views" });
  let lastGroup = null;
  for (const e of entries) {
    if (e.group !== lastGroup) {
      list.append(el("h4", { text: e.group }));
      lastGroup = e.group;
    }
    list.append(el("button", { class: e.key === current.key ? "on" : "", on: { click: () => { current = e; store.set("wn.satView", e.key); renderSatellite(catalog); } } },
      el("b", { text: e.title }), el("span", { text: e.sub || "" })));
  }
  const main = el("div", { class: "panel sat-main" });
  box.append(list, main);
  drawMain(main);
}

function listEntries(cat) {
  const out = [];
  const conus = (cat.views || []).filter((v) => v.sector === "CONUS");
  const regional = (cat.views || []).filter((v) => v.sector !== "CONUS");
  for (const v of conus) out.push({ key: v.id, group: "Continental US", title: v.title, sub: v.region || "", item: v, kind: "view" });
  // A sector with no bands is stacked on its partner (both imaging the same
  // spot every 30 s); show the partner once, labeled as stacked.
  for (const m of (cat.meso || []).filter((x) => x.bands?.length)) {
    const stacked = (cat.meso || []).some((x) => x !== m && x.sat === m.sat && (x.coLocatedWith === m.id || m.coLocatedWith === x.id));
    out.push({
      key: `meso-${m.sat}-${m.id}`, group: "Mesoscale · where NOAA is looking", kind: "meso", item: m, stacked,
      title: `${m.sat === "west" ? "GOES-West" : "GOES-East"} ${stacked ? "Meso 1+2" : m.id.replace("M", "Meso ")}`,
      sub: m.label || (m.center ? `${m.center.lat.toFixed(1)}°, ${m.center.lon.toFixed(1)}°` : ""),
    });
  }
  for (const v of regional) out.push({ key: v.id, group: "Regional", title: v.title, sub: v.region || "", item: v, kind: "view" });
  for (const f of cat.fullDisk || []) {
    if (f && f.bands) out.push({ key: f.id, group: "Full disk", title: f.title, sub: f.region || "", item: f, kind: "fulldisk" });
  }
  return out;
}

function drawMain(main) {
  const item = current.item;
  const bands = item.bands || [];
  const savedBand = bandId || store.get("wn.satBand", "GEOCOLOR");
  const band = bands.find((b) => b.id === savedBand) || bands.find((b) => b.id === "GEOCOLOR") || bands[0];
  if (!band) {
    main.append(el("div", { class: "empty", text: "No imagery for this view right now." }));
    return;
  }
  const hasFrames = (band.frames?.length || 0) > 1;
  const img = el("img", { alt: `${current.title} — ${band.title}`, src: band.latest || band.frames?.[band.frames.length - 1]?.url });
  const media = !hasFrames && band.loop?.mp4
    ? el("video", { src: band.loop.mp4, autoplay: true, loop: true, muted: true, playsInline: true, controls: true, poster: band.latest || "" })
    : img;
  const range = el("input", { type: "range", min: 0, max: Math.max(0, (band.frames?.length || 1) - 1), value: Math.max(0, (band.frames?.length || 1) - 1), "aria-label": "Frame" });
  const time = el("span", { class: "mono muted", style: { fontSize: "12.5px" } });
  const play = el("button", { class: "chip", text: playing ? "❚❚ Pause" : "▶ Play" });
  play.onclick = () => {
    playing = !playing;
    play.textContent = playing ? "❚❚ Pause" : "▶ Play";
    if (playing) step(img, range, time);
  };
  range.oninput = () => {
    playing = false;
    play.textContent = "▶ Play";
    clearTimeout(timer);
    idx = +range.value;
    show(img, range, time);
  };

  put(main,
    el("div", { style: { display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", alignItems: "baseline" } },
      el("div", {}, el("b", { style: { fontSize: "17px" }, text: current.title }), " ", el("span", { class: "muted", text: current.sub || "" })),
      current.kind === "meso" ? el("button", { class: "chip learn", text: "Why meso sectors matter", on: { click: () => openLearn("mesoscale-sectors") } }) : el("button", { class: "chip learn", text: "Satellite bands 101", on: { click: () => openLearn("satellite-bands") } }),
    ),
    el("div", { class: "channel-chips" }, bands.map((b) => el("button", {
      class: "chip" + (b === band ? " on" : ""), text: b.title, title: b.short || "",
      on: { click: () => { bandId = b.id; store.set("wn.satBand", b.id); clear(main); drawMain(main); } },
    }))),
    current.kind === "meso" && item.label ? el("div", { class: "meso-note" },
      el("b", { text: `NOAA has this sector ${/^(over|near|\d)/.test(item.label) ? "" : "at "}${item.label}${current.stacked ? ", with both sectors stacked on it" : ""}, scanning every ${item.cadenceSec === 30 ? "30 seconds" : "minute"}. ` }),
      "Mesoscale sectors get moved to wherever forecasters need rapid imagery (severe storms, landfalling hurricanes, fires), so their position is itself a signal of where the important weather is.",
      item.updated ? el("span", { class: "muted", text: ` Last frame ${ago(item.updated)}.` }) : null) : null,
    el("div", { class: "player" }, media),
    hasFrames ? el("div", { class: "controls" }, play, range, time) : el("div", { class: "muted", style: { fontSize: "12.5px" }, text: band.loop?.mp4 ? "STAR's ready-made loop for this band." : `Latest image${band.latestTime ? " · " + ago(band.latestTime) : ""}.` }),
    el("div", { class: "band-explain" }, el("b", { text: `${band.title}. ` }), band.explain || "",
      band.guide ? el("span", {}, " ", el("a", { href: band.guide, target: "_blank", rel: "noopener", text: "NOAA quick guide (PDF) ↗" })) : null),
  );
  if (hasFrames) loadFrames(band.frames, img, range, time);
  else clearTimeout(timer);
}

function loadFrames(list, img, range, time) {
  const my = ++token;
  clearTimeout(timer);
  frames = list;
  idx = list.length - 1;
  show(img, range, time);
  let loaded = 0;
  for (const f of list) {
    const im = new Image();
    im.onload = im.onerror = () => {
      if (my !== token) return;
      loaded++;
      if (loaded === list.length && playing) step(img, range, time);
    };
    im.src = f.url;
  }
}

function step(img, range, time) {
  clearTimeout(timer);
  if (!playing || frames.length < 2 || !img.isConnected) return;
  idx = (idx + 1) % frames.length;
  show(img, range, time);
  timer = setTimeout(() => step(img, range, time), idx === frames.length - 1 ? 1500 : 140);
}

function show(img, range, time) {
  const f = frames[idx];
  if (!f) return;
  img.src = f.url;
  range.value = idx;
  time.textContent = f.t ? `${utcStamp(f.t)} · ${ago(f.t)}` : "latest";
}
