// The front page: a live GOES-East CONUS loop with the national stories
// pinned on it, and the lead story beside it.
import { $, el, svg, clear, put, store, ago, utcStamp, tierClass, TONE } from "./util.js";
import { goesProject } from "./goes.js";
import { state } from "./state.js";
import { openStory } from "./stories.js";
import { openLearn } from "./learn.js";
import { askAbout } from "./chat.js";

const FALLBACK_LATEST = "https://cdn.star.nesdis.noaa.gov/GOES19/ABI/CONUS/GEOCOLOR/1250x750.jpg";
const STEP_MS = 160;
const DWELL_MS = 1600;

let view = null;
let band = null;
let frames = [];
let idx = 0;
let playing = true;
let timer = null;
let loadToken = 0;

export function renderHero(catalog) {
  view = catalog?.views?.find((v) => v.id === "conus-east") || null;
  const bands = view?.bands || [];
  const want = store.get("wn.heroBand", "GEOCOLOR");
  band = bands.find((b) => b.id === want) || bands.find((b) => b.id === "GEOCOLOR") || bands[0] || null;

  const chips = clear($("heroBands"));
  for (const b of bands) {
    chips.append(el("button", {
      class: "chip" + (b === band ? " on" : ""),
      text: b.title,
      title: b.short || b.title,
      on: { click: () => { store.set("wn.heroBand", b.id); band = b; renderHero(catalog); } },
    }));
  }
  $("heroPlay").onclick = () => {
    playing = !playing;
    $("heroPlay").textContent = playing ? "❚❚ Pause" : "▶ Play";
    $("heroPlay").setAttribute("aria-pressed", String(playing));
    if (playing) tick();
  };

  const cap = clear($("heroCaption"));
  if (band) {
    cap.append(el("b", { text: `${band.title}. ` }), band.explain || "", " ",
      el("a", { href: "#satellite", text: "More imagery →" }));
  } else {
    cap.append("Latest GOES-East GeoColor image of the contiguous US. ", el("a", { href: "#satellite", text: "More imagery →" }));
  }
  $("heroCredit").textContent = `${view?.sat === "west" ? "GOES-West" : "GOES-East"} · ${band?.title || "GeoColor"} · NOAA/NESDIS STAR`;

  loadFrames(band ? (band.frames?.length ? band.frames : [{ t: null, url: band.latest }]) : [{ t: null, url: FALLBACK_LATEST }]);
  renderPins();
  renderMesoStrip(catalog);
}

// The 1-minute mesoscale sectors, as thumbnails: where NOAA is looking.
function renderMesoStrip(catalog) {
  const box = clear($("heroMeso"));
  const meso = (catalog?.meso || []).filter((m) => m.bands?.length);
  box.hidden = !meso.length;
  if (!meso.length) return;
  box.append(el("h4", { text: "Where NOAA's 1-minute imagery is aimed" }));
  const row = el("div", { class: "meso-row" });
  box.append(row);
  for (const m of meso.slice(0, 4)) {
    const b = m.bands.find((x) => x.id === "GEOCOLOR") || m.bands[0];
    const src = b.latest || b.frames?.[b.frames.length - 1]?.url;
    if (!src) continue;
    row.append(el("button", {
      class: "meso-card",
      title: `${m.sat === "west" ? "GOES-West" : "GOES-East"} ${m.id}`,
      on: { click: () => { store.set("wn.satView", `meso-${m.sat}-${m.id}`); document.getElementById("satellite").scrollIntoView({ behavior: "smooth" }); window.dispatchEvent(new CustomEvent("wn:satview")); } },
    },
    el("img", { src, alt: "", loading: "lazy" }),
    el("span", {}, el("b", { text: `${m.sat === "west" ? "West" : "East"} · ${stackedWith(catalog, m) ? "Meso 1+2" : m.id.replace("M", "Meso ")}` }), m.label || ""),
    ));
  }
}

function loadFrames(list) {
  const token = ++loadToken;
  clearTimeout(timer);
  frames = [];
  idx = 0;
  const img = $("heroA");
  // Show the newest frame at once, then fill in the loop as frames arrive.
  const newest = list[list.length - 1];
  img.src = newest.url;
  setTime(newest.t);
  let ready = 0;
  const loaded = new Array(list.length).fill(null);
  list.forEach((f, i) => {
    const im = new Image();
    im.decoding = "async";
    im.onload = () => {
      if (token !== loadToken) return;
      loaded[i] = f;
      ready++;
      if (ready === list.length || (ready >= Math.min(6, list.length) && !frames.length)) {
        frames = loaded.filter(Boolean);
        idx = frames.length - 1;
        if (playing) tick();
      } else if (frames.length) {
        frames = loaded.filter(Boolean);
      }
    };
    im.src = f.url;
  });
}

function tick() {
  clearTimeout(timer);
  if (!playing || frames.length < 2) return;
  idx = (idx + 1) % frames.length;
  const f = frames[idx];
  $("heroA").src = f.url;
  setTime(f.t);
  $("heroScrub").style.width = `${((idx + 1) / frames.length) * 100}%`;
  timer = setTimeout(tick, idx === frames.length - 1 ? DWELL_MS : STEP_MS);
}

function setTime(t) {
  $("heroTime").textContent = t ? `${utcStamp(t)} · ${ago(t)}` : "latest";
}

// Story pins, projected into the image's own pixel space.
export function renderPins() {
  const layer = clear($("heroPins"));
  const proj = state.satellite?.projection?.["conus-east"];
  const stories = state.stories?.stories || [];
  if (!proj) return;
  layer.setAttribute("viewBox", `0 0 ${proj.width} ${proj.height}`);
  layer.setAttribute("preserveAspectRatio", "none");
  const scale = proj.width / 1250;
  const placed = [];
  const pins = stories
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))
    .map((s) => ({ s, p: goesProject(s.lat, s.lon, proj) }))
    .filter((x) => x.p)
    .sort((a, b) => a.s.tier - b.s.tier);
  for (const { s, p } of pins) {
    const color = ["#7f8ea8", "#ffd23f", "#ff8f3a", "#ff3b66"][s.tier] || "#7f8ea8";
    const g = svg("g", { class: "pin", tabindex: 0, role: "button", "aria-label": s.title });
    if (s.tier >= 2) g.append(svg("circle", { class: "ring", cx: p.x, cy: p.y, r: 9 * scale, stroke: color }));
    g.append(svg("circle", { class: "core", cx: p.x, cy: p.y, r: (s.tier >= 2 ? 7 : 5.5) * scale, fill: color }));
    const label = pinLabel(s);
    const w = label.length * 7.4 * scale;
    const h = 16 * scale;
    let lx = p.x + 12 * scale;
    let anchor = "start";
    if (lx + w > proj.width) { lx = p.x - 12 * scale; anchor = "end"; }
    const box = anchor === "start" ? [lx, p.y - h / 2, lx + w, p.y + h / 2] : [lx - w, p.y - h / 2, lx, p.y + h / 2];
    if (!placed.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) {
      placed.push(box);
      g.append(svg("text", { x: lx, y: p.y + 4.5 * scale, "text-anchor": anchor, style: `font-size:${13 * scale}px` }, label));
    }
    g.addEventListener("click", () => openStory(s.id));
    g.addEventListener("keydown", (e) => { if (e.key === "Enter") openStory(s.id); });
    layer.append(g);
  }
}

// Both sectors of one satellite stacked on the same spot (30-second imaging).
function stackedWith(catalog, m) {
  return (catalog?.meso || []).some((x) => x !== m && x.sat === m.sat && (x.coLocatedWith === m.id || m.coLocatedWith === x.id));
}

function pinLabel(s) {
  if (s.storm?.name) return s.storm.name;
  const t = String(s.kicker || s.title || "");
  return t.length > 26 ? t.slice(0, 25) + "…" : t;
}

// ── Lead story column ───────────────────────────────────────────────────────
export function renderHeroCopy(data) {
  const box = clear($("heroCopy"));
  const stories = data?.stories || [];
  const us = stories.filter((s) => s.lane === "us");
  const lead = us[0] || stories[0];
  const level = data?.level || "quiet";

  const pill = $("levelPill");
  pill.className = `pill-level lvl-${level}`;
  $("levelText").textContent = { extreme: "Extreme", major: "Major", active: "Active", quiet: "Quiet" }[level] || level;

  box.append(el("div", { class: "status" },
    el("span", { class: "kicker", text: "Across the US right now" }),
    el("span", { class: `pill-level lvl-${level}` }, el("span", { class: "dot" }), `National: ${level}`),
  ));

  if (!lead) {
    put(box,
      el("h1", { text: "A quiet day across the US" }),
      el("p", { class: "lede", text: "No extreme or major hazards are in effect. The map, satellite and your local forecast are below." }),
    );
  } else {
    put(box,
      el("div", { class: `lead-kicker ${tierClass(lead.tier)}`, style: { color: "var(--tier)" }, text: lead.kicker || "" }),
      el("h1", { text: lead.title }),
      lead.place ? el("div", { class: "muted", text: `${lead.place}${lead.time ? " · updated " + ago(lead.time) : ""}` }) : null,
      lead.facts?.length ? el("div", { class: "facts" }, lead.facts.map((f) => el("span", { class: "badge", text: f }))) : null,
      el("p", { class: "lede", text: lead.summary || "" }),
      lead.badges?.length ? el("div", { class: "facts" }, lead.badges.slice(0, 4).map((b) => el("span", { class: `badge ${b.tone}`, text: b.label }))) : null,
      el("div", { class: "hero-actions" },
        el("button", { class: "btn primary", text: "Follow this story", on: { click: () => openStory(lead.id) } }),
        el("a", { class: "btn", href: "#map", text: "Open the map" }),
        el("button", { class: "btn ghost", text: "Ask about it", on: { click: () => askAbout(lead) } }),
        lead.learn?.[0] ? el("button", { class: "chip learn", text: "What's this?", on: { click: () => openLearn(lead.learn[0]) } }) : null,
      ),
    );
  }

  const c = data?.counts || {};
  box.append(el("div", { class: "statline" },
    stat(c.tornadoWarnings ?? 0, "Tornado warnings"),
    stat(c.severeWarnings ?? 0, "Severe warnings"),
    stat(c.flashFloodWarnings ?? 0, "Flash flood"),
    stat(c.reports6hAll ?? c.reports6h ?? 0, "Reports (6 h)"),
  ));

  const rest = stories.filter((s) => s !== lead).slice(0, 5);
  if (rest.length) {
    box.append(el("div", { class: "more-stories" }, rest.map((s) => el("button", { class: tierClass(s.tier), on: { click: () => openStory(s.id) } },
      el("span", { class: "d tbg" }),
      el("span", {}, el("div", { class: "k", text: `${s.lane === "world" ? "World · " : ""}${s.kicker || ""}` }), el("div", { class: "t", text: s.title })),
    ))));
  }
}

function stat(n, label) {
  return el("div", { class: "stat" }, el("b", { text: String(n) }), el("span", { text: label }));
}

export { TONE };
