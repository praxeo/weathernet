// Live map (Leaflet): radar composite with an optional 50-minute loop, GOES
// IR underlay, NWS warnings, SPC watches and Day 1 risk areas, storm reports,
// long-fuse hazards, hurricanes and cameras. Vector layers come from the
// /api/stories payload (`map`), so the map and the story board always agree.
import { $, el, getJSON, fmtTime, ago, store, closeSheet } from "./util.js";
import { state } from "./state.js";
import { openLearn } from "./learn.js";
import { openCam } from "./cams.js";
import { openStory } from "./stories.js";

const L = window.L;
let map = null;
const layers = {};
let radarFrames = [];
let radarIdx = 0;
let radarTimer = null;
let looping = false;

const WARN_COLOR = {
  "Tornado Warning": "#ff2d55", "Severe Thunderstorm Warning": "#ffd60a", "Flash Flood Warning": "#30d158",
  "Extreme Wind Warning": "#ff3df5", "Dust Storm Warning": "#d4a373", "Snow Squall Warning": "#9bd3ff",
};
const WARN_LEARN = {
  "Tornado Warning": "tornado-warning", "Severe Thunderstorm Warning": "severe-thunderstorm-warning",
  "Flash Flood Warning": "flash-flood-warning", "Extreme Wind Warning": "extreme-wind-warning", "Dust Storm Warning": "haboob",
};
const SPC_COLOR = { MRGL: "#66a366", SLGT: "#ffe066", ENH: "#ffa366", MDT: "#e06666", HIGH: "#ee99ee" };
const RPT_COLOR = (t) => /TORNADO|FUNNEL/.test(t) ? "#ff2d55" : /HAIL/.test(t) ? "#7CFC00" : /TROPICAL/.test(t) ? "#b388ff" : /FLOOD/.test(t) ? "#20c997" : /WND|WIND/.test(t) ? "#4aa3ff" : "#9aa5b8";
const HAZ_ICON = { "Red Flag Warning": "🔥", "Extreme Heat Warning": "🌡️", "Extreme Cold Warning": "🥶", "Blizzard Warning": "❄️", "Ice Storm Warning": "🧊" };
const RADAR_OFFSETS = [50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 0];

const TOGGLES = [
  ["radar", "Radar", true], ["geocolor", "GOES GeoColor", false], ["sat", "GOES infrared", false], ["warnings", "Warnings", true], ["watches", "Watches", true],
  ["outlook", "SPC Day 1 risk", true], ["reports", "Storm reports (6 h)", true], ["hazards", "Heat · fire · winter", true],
  ["storms", "Tropical systems", true], ["cams", "Cameras (zoom in)", true],
];

export function initMap() {
  if (map || !L) return map;
  map = L.map("leaflet", { zoomControl: false, minZoom: 3, maxZoom: 11, worldCopyJump: true, preferCanvas: true })
    .setView([38.3, -95.5], 4);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  map.createPane("sat").style.zIndex = 250;
  map.createPane("radar").style.zIndex = 350;
  const lp = map.createPane("labels");
  lp.style.zIndex = 640;
  lp.style.pointerEvents = "none";
  const lines = map.createPane("lines");
  lines.style.zIndex = 420;
  lines.style.pointerEvents = "none";

  // Basemap: NASA GIBS (public, keyless) night lights or shaded relief, place
  // labels on top, and Natural Earth state/country/coast lines drawn as
  // vectors from the brain's /api/basemap so borders stay crisp over radar.
  const attribution = 'Imagery <a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a> · Radar &amp; IR <a href="https://mesonet.agron.iastate.edu/">IEM</a> · NWS · SPC · NHC · Natural Earth';
  layers.baseNight = L.tileLayer(gibs("VIIRS_Black_Marble", "2016-01-01", "GoogleMapsCompatible_Level8", "png"), { maxNativeZoom: 8, maxZoom: 12, attribution });
  layers.baseRelief = L.tileLayer(gibs("BlueMarble_ShadedRelief_Bathymetry", null, "GoogleMapsCompatible_Level8", "jpeg"), { maxNativeZoom: 8, maxZoom: 12, attribution, className: "relief-tiles" });
  const base = store.get("wn.mapBase", "night");
  if (base === "relief") layers.baseRelief.addTo(map);
  else if (base !== "plain") layers.baseNight.addTo(map);
  // GIBS' label tiles come back as opaque black squares at these zooms, so
  // place names are drawn here from /api/places instead.
  layers.lines = L.layerGroup().addTo(map);
  layers.places = L.layerGroup().addTo(map);
  drawLines();
  loadPlaces();
  map.on("zoomend", drawPlaces);
  layers.geocolor = L.tileLayer(gibs("GOES-East_ABI_GeoColor", "default", "GoogleMapsCompatible_Level7", "png"), { pane: "sat", opacity: 0.85, maxNativeZoom: 7 });
  layers.sat = L.tileLayer(iem("goes-east-ir-4km-900913"), { pane: "sat", opacity: 0.55, maxNativeZoom: 8 });
  layers.radar = L.layerGroup();
  layers.radarNow = radarLayer(0, 0.82);
  layers.radar.addLayer(layers.radarNow);
  for (const k of ["warnings", "watches", "outlook", "reports", "hazards", "storms", "cams", "me"]) layers[k] = L.layerGroup();

  const on = store.get("wn.mapLayers", null);
  for (const [key, , def] of TOGGLES) {
    const want = on ? on.includes(key) : def;
    if (want) layers[key].addTo(map);
  }
  layers.me.addTo(map);
  buildControls(on);
  map.on("moveend", debounce(loadCams, 600));
  setInterval(refreshRadar, 5 * 60 * 1000);
  loadTropical();
  setInterval(loadTropical, 10 * 60 * 1000);
  if (state.stories) updateMap(state.stories);
  drawMe();
  return map;
}

// IEM's NEXRAD/GOES tiles are web-mercator; a 5-minute bucket in the query
// keeps the browser from showing a stale "latest" tile.
function iem(name) {
  return `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/${name}/{z}/{x}/{y}.png?_=${Math.floor(Date.now() / 300000)}`;
}

// GIBS REST tiles; static layers have no time segment.
function gibs(layer, time, tms, ext) {
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${time ? time + "/" : ""}${tms}/{z}/{y}/{x}.${ext}`;
}

async function drawLines() {
  let b;
  try {
    b = await getJSON("/api/basemap?v=1", { timeout: 30000 });
  } catch {
    return;
  }
  const q = b.precision || 50;
  const style = (w, o) => ({ pane: "lines", color: "#c8d6f0", weight: w, opacity: o, interactive: false });
  for (const rings of b.land || []) for (const s of rings) L.polyline(ll(decodeLine(s, q)), style(0.8, 0.45)).addTo(layers.lines);
  for (const s of b.borders || []) L.polyline(ll(decodeLine(s, q)), style(1.1, 0.6)).addTo(layers.lines);
  for (const s of b.states || []) L.polyline(ll(decodeLine(s, q)), style(0.7, 0.42)).addTo(layers.lines);
}

// City labels thin out by population as you zoom out.
let places = [];
async function loadPlaces() {
  try {
    places = (await getJSON("/api/places", { timeout: 20000 })).places || [];
  } catch {
    places = [];
  }
  drawPlaces();
}

function drawPlaces() {
  if (!map) return;
  layers.places.clearLayers();
  const z = map.getZoom();
  const floor = z <= 4 ? 1500000 : z === 5 ? 600000 : z === 6 ? 200000 : z === 7 ? 60000 : 0;
  // Largest first, skipping any label that would overlap one already
  // placed (world-pixel boxes at this zoom, so panning doesn't matter).
  const boxes = [];
  for (const [name, st, lat, lon, pop] of places) {
    if (pop < floor) break;
    const p = map.project([lat, lon], z);
    const w = name.length * 6.6 + 8;
    const box = [p.x - w / 2, p.y - 9, p.x + w / 2, p.y + 9];
    if (boxes.some((o) => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1])) continue;
    boxes.push(box);
    L.marker([lat, lon], {
      pane: "labels", interactive: false, keyboard: false,
      icon: L.divIcon({ className: "place-label", html: `<span>${escapeHtml(name)}</span>`, iconSize: [0, 0] }),
    }).addTo(layers.places);
  }
}

// Google-polyline decode (the brain stores the basemap at 1/precision degree).
function decodeLine(s, q) {
  const pts = [];
  let i = 0, lat = 0, lon = 0;
  while (i < s.length) {
    let b, shift = 0, res = 0;
    do { b = s.charCodeAt(i++) - 63; res |= (b & 31) << shift; shift += 5; } while (b >= 32 && i < s.length);
    lat += res & 1 ? ~(res >> 1) : res >> 1;
    shift = 0;
    res = 0;
    do { b = s.charCodeAt(i++) - 63; res |= (b & 31) << shift; shift += 5; } while (b >= 32 && i < s.length);
    lon += res & 1 ? ~(res >> 1) : res >> 1;
    pts.push([lon / q, lat / q]);
  }
  return pts;
}

function radarLayer(offsetMin, opacity) {
  const name = offsetMin ? `nexrad-n0q-900913-m${String(offsetMin).padStart(2, "0")}m` : "nexrad-n0q-900913";
  return L.tileLayer(iem(name), { pane: "radar", opacity, maxNativeZoom: 9 });
}

function refreshRadar() {
  if (!map) return;
  if (looping) stopLoop();
  layers.radar.removeLayer(layers.radarNow);
  layers.radarNow = radarLayer(0, 0.82);
  layers.radar.addLayer(layers.radarNow);
  layers.sat.setUrl(iem("goes-east-ir-4km-900913"));
  layers.geocolor.redraw();
}

function startLoop() {
  looping = true;
  layers.radar.removeLayer(layers.radarNow);
  radarFrames = RADAR_OFFSETS.map((m) => radarLayer(m, 0));
  radarFrames.forEach((f) => layers.radar.addLayer(f));
  radarIdx = 0;
  stepLoop();
}

function stepLoop() {
  if (!looping) return;
  radarFrames.forEach((f, i) => f.setOpacity(i === radarIdx ? 0.82 : 0));
  const m = RADAR_OFFSETS[radarIdx];
  $("radarTime").textContent = m ? `−${m} min` : "Latest";
  const last = radarIdx === radarFrames.length - 1;
  radarIdx = (radarIdx + 1) % radarFrames.length;
  radarTimer = setTimeout(stepLoop, last ? 1500 : 450);
}

function stopLoop() {
  looping = false;
  clearTimeout(radarTimer);
  radarFrames.forEach((f) => layers.radar.removeLayer(f));
  radarFrames = [];
  layers.radar.addLayer(layers.radarNow);
  layers.radarNow.setOpacity(0.82);
  $("radarTime").textContent = "Latest";
}

function buildControls(saved) {
  const wrap = $("mapWrap");
  const loopBtn = el("button", { class: "chip", text: "▶ Loop radar", on: { click: () => {
    if (looping) { stopLoop(); loopBtn.textContent = "▶ Loop radar"; } else { startLoop(); loopBtn.textContent = "❚❚ Stop loop"; }
  } } });
  wrap.append(el("div", { class: "map-ui tl" },
    el("div", { class: "glass", style: { display: "flex", gap: "8px", alignItems: "center" } }, loopBtn, el("span", { class: "radar-time", id: "radarTime", text: "Latest" })),
  ));
  const toggles = el("div", { class: "glass layer-toggles" });
  for (const [key, label, def] of TOGGLES) {
    const input = el("input", { type: "checkbox", checked: saved ? saved.includes(key) : def });
    input.addEventListener("change", () => {
      if (input.checked) layers[key].addTo(map); else map.removeLayer(layers[key]);
      if (key === "cams" && input.checked) loadCams();
      store.set("wn.mapLayers", TOGGLES.filter(([k]) => map.hasLayer(layers[k])).map(([k]) => k));
    });
    toggles.append(el("label", {}, input, label));
  }
  const baseSel = el("select", { "aria-label": "Basemap", style: { marginTop: "6px", width: "100%", background: "var(--panel-solid)", color: "var(--text)", border: "1px solid var(--border-strong)", borderRadius: "8px", padding: "4px" } },
    el("option", { value: "night", text: "Base: night lights" }), el("option", { value: "relief", text: "Base: shaded relief" }), el("option", { value: "plain", text: "Base: plain" }));
  baseSel.value = store.get("wn.mapBase", "night");
  baseSel.addEventListener("change", () => {
    map.removeLayer(layers.baseNight);
    map.removeLayer(layers.baseRelief);
    if (baseSel.value === "night") layers.baseNight.addTo(map);
    if (baseSel.value === "relief") layers.baseRelief.addTo(map);
    store.set("wn.mapBase", baseSel.value);
  });
  toggles.append(baseSel);
  const details = el("details", { class: "glass", open: window.innerWidth > 740 }, el("summary", { text: "Layers", style: { cursor: "pointer", fontWeight: 700, fontSize: "12.5px" } }), toggles);
  toggles.classList.remove("glass");
  wrap.append(el("div", { class: "map-ui tr" }, details));
  wrap.append(el("div", { class: "map-ui bl" }, el("div", { class: "glass legend" },
    sw("#ff2d55"), "Tornado warning", sw("#ffd60a"), "Severe thunderstorm", sw("#30d158"), "Flash flood", sw("#ff3df5"), "Extreme wind",
    sw("#ffcc00", true), "Tornado watch", sw("#ff77aa", true), "Svr tstm watch",
  )));
}

function sw(color, dashed) {
  return el("i", { style: dashed ? { border: `2px dashed ${color}`, background: "transparent" } : { background: color } });
}

export function updateMap(data) {
  if (!map || !data?.map) return;
  const m = data.map;
  layers.outlook.clearLayers();
  for (const a of m.outlook || []) {
    const c = SPC_COLOR[a.label] || "#888";
    L.geoJSON(a.geometry, { style: { color: c, weight: 1.2, fillColor: c, fillOpacity: 0.13 }, interactive: true })
      .bindPopup(popup(`SPC Day 1: ${a.name}`, "Convective outlook risk area", "spc-outlook"))
      .addTo(layers.outlook);
  }
  layers.watches.clearLayers();
  for (const w of m.watches || []) {
    const c = w.type === "TOR" ? "#ffcc00" : "#ff77aa";
    L.geoJSON(w.geometry, { style: { color: c, weight: w.pds ? 3.5 : 2, dashArray: "6 5", fill: false } })
      .bindPopup(popup(`${w.pds ? "PDS " : ""}${w.type === "TOR" ? "Tornado" : "Severe Thunderstorm"} Watch ${w.number}`, `Until ${fmtTime(w.expires)}`, w.pds ? "pds-watch" : "tornado-watch"))
      .addTo(layers.watches);
  }
  layers.warnings.clearLayers();
  for (const w of [...(m.warnings || [])].sort((a, b) => a.tier - b.tier)) {
    const c = WARN_COLOR[w.event] || "#ff8f3a";
    L.geoJSON(w.geometry, { style: { color: c, weight: w.tier >= 2 ? 3.2 : 2, fillColor: c, fillOpacity: w.tier >= 2 ? 0.22 : 0.12 } })
      .bindPopup(popup(w.label, `${w.area || ""}${w.expires ? ` · until ${fmtTime(w.expires)}` : ""}`, WARN_LEARN[w.event]))
      .addTo(layers.warnings);
  }
  layers.hazards.clearLayers();
  for (const h of m.hazards || []) {
    if (h.geometry) L.geoJSON(h.geometry, { style: { color: "#ff9f43", weight: 1, fillOpacity: 0.06, dashArray: "3 4" }, interactive: false }).addTo(layers.hazards);
    if (!Number.isFinite(h.lat)) continue;
    L.marker([h.lat, h.lon], { icon: L.divIcon({ className: "wn-icon", html: HAZ_ICON[h.event] || "⚠️", iconSize: [22, 22] }) })
      .bindPopup(popup(h.label, h.area || "", h.event === "Red Flag Warning" ? "red-flag-warning" : h.event === "Extreme Heat Warning" ? "heat-risk" : h.event === "Blizzard Warning" ? "blizzard" : h.event === "Ice Storm Warning" ? "ice-storm" : null))
      .addTo(layers.hazards);
  }
  layers.reports.clearLayers();
  for (const r of m.reports || []) {
    L.circleMarker([r.lat, r.lon], { radius: r.tier >= 2 ? 7 : 5, color: "#000", weight: 1, fillColor: RPT_COLOR(r.type), fillOpacity: 0.95 })
      .bindPopup(popup(`${r.label}`, `${r.type.toLowerCase()} · ${r.place || ""} · ${ago(r.time)}`, "local-storm-reports"))
      .addTo(layers.reports);
  }
  if (tropicalLoaded) return;
  layers.storms.clearLayers();
  for (const s of m.storms || []) {
    const label = `🌀 ${s.name}${s.cat ? " · Cat " + s.cat : ""}`;
    L.marker([s.lat, s.lon], { icon: L.divIcon({ className: "storm-icon", html: escapeHtml(label), iconSize: [120, 18], iconAnchor: [10, 9] }) })
      .bindPopup(popup(`${s.classification === "HU" ? "Hurricane" : "Tropical system"} ${s.name}`, `${s.kt ? Math.round(s.kt * 1.15078) + " mph" : ""}${s.cat ? " · Category " + s.cat : ""}`, s.cat ? "saffir-simpson" : "nhc-cone"))
      .addTo(layers.storms);
  }
}

// NHC geometry from the brain's /api/tropical: cone, wind field, past and
// forecast track, coastal watches/warnings, current position.
let tropicalLoaded = false;
const TCWW_COLOR = { HWR: "#ff1744", HWA: "#ff80ab", TWR: "#2979ff", TWA: "#ffd54f", SSR: "#d500f9", SSA: "#ea80fc" };
const ll = (pts) => pts.map(([x, y]) => [y, x]);

async function loadTropical() {
  let d;
  try {
    d = await getJSON("/api/tropical", { timeout: 30000 });
  } catch {
    return;
  }
  if (!d?.storms) return;
  tropicalLoaded = true;
  layers.storms.clearLayers();
  for (const s of d.storms) {
    for (const ring of s.cone || []) L.polygon(ll(ring), { color: "#ffffff", weight: 1.2, dashArray: "4 4", fillColor: "#ffffff", fillOpacity: 0.07, interactive: false }).addTo(layers.storms);
    const wf = { 34: ["#ffd54f", 0.07], 50: ["#ff9800", 0.1], 64: ["#ff1744", 0.14] };
    for (const w of s.windField || []) for (const ring of w.rings) L.polygon(ll(ring), { color: wf[w.kt]?.[0] || "#ffd54f", weight: 1, fillOpacity: wf[w.kt]?.[1] || 0.06, interactive: false }).addTo(layers.storms);
    for (const w of s.warnings || []) for (const line of w.lines) L.polyline(ll(line), { color: TCWW_COLOR[w.code] || "#fff", weight: 5, opacity: 0.95 }).bindTooltip(w.label).addTo(layers.storms);
    if (s.past?.length > 1) L.polyline(s.past.map((p) => [p.lat, p.lon]), { color: "#9aa5b8", weight: 2, opacity: 0.8, interactive: false }).addTo(layers.storms);
    if (s.forecast?.length > 1) L.polyline(s.forecast.map((p) => [p.lat, p.lon]), { color: "#fff", weight: 2, dashArray: "2 6", interactive: false }).addTo(layers.storms);
    for (const f of (s.forecast || []).slice(1)) {
      L.circleMarker([f.lat, f.lon], { radius: 4, color: "#000", weight: 1, fillColor: "#fff", fillOpacity: 0.9 })
        .bindTooltip(`${f.label || ""} · ${f.code || ""} ${f.wind_kt ? Math.round(f.wind_kt * 1.15078) + " mph" : ""}`.trim())
        .addTo(layers.storms);
    }
    if (Number.isFinite(s.lat)) {
      const cat = /Cat (\d)/.exec(s.kind || "")?.[1];
      L.marker([s.lat, s.lon], { icon: L.divIcon({ className: "storm-icon", html: escapeHtml(`🌀 ${s.name}${cat ? " · Cat " + cat : ""}`), iconSize: [130, 18], iconAnchor: [10, 9] }) })
        .bindPopup(popup(s.label, `${s.wind_mph ? s.wind_mph + " mph" : ""}${s.pressure_mb ? " · " + s.pressure_mb + " mb" : ""}${s.movement ? " · moving " + s.movement.text : ""}`, s.wind_kt >= 64 ? "saffir-simpson" : "nhc-cone"))
        .addTo(layers.storms);
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function popup(title, sub, learnKey) {
  return el("div", {},
    el("b", { text: title }),
    sub ? el("div", { class: "muted", text: sub }) : null,
    learnKey ? el("button", { class: "chip learn", style: { marginTop: "8px" }, text: "What does this mean?", on: { click: () => openLearn(learnKey) } }) : null,
  );
}

async function loadCams() {
  if (!map || !map.hasLayer(layers.cams)) return;
  layers.cams.clearLayers();
  if (map.getZoom() < 7) return;
  const c = map.getCenter();
  const b = map.getBounds();
  const radius = Math.min(120, Math.max(15, c.distanceTo(b.getNorthEast()) / 1609.34));
  try {
    const d = await getJSON(`/api/cams?lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}&radius=${Math.round(radius)}&limit=40`);
    layers.cams.clearLayers();
    for (const cam of d.cams || []) {
      L.marker([cam.lat, cam.lon], { icon: L.divIcon({ className: "wn-icon", html: cam.hls ? "🎥" : "📷", iconSize: [22, 22] }), title: cam.name })
        .on("click", () => openCam(cam))
        .addTo(layers.cams);
    }
  } catch {
    // cameras are a bonus layer
  }
}

function drawMe() {
  if (!map || !state.loc) return;
  layers.me.clearLayers();
  L.circleMarker([state.loc.lat, state.loc.lon], { radius: 7, color: "#fff", weight: 2, fillColor: "#5cc8ff", fillOpacity: 1 })
    .bindTooltip(state.loc.name || "Your location")
    .addTo(layers.me);
}

export function onLocationForMap() {
  drawMe();
}

export function focusMap(story) {
  closeSheet();
  document.getElementById("map").scrollIntoView({ behavior: "smooth" });
  initMap();
  if (!map || !Number.isFinite(story.lat)) return;
  setTimeout(() => {
    map.invalidateSize();
    map.flyTo([story.lat, story.lon], story.kind === "tropical" ? 6 : story.kind === "outlook" ? 5 : 8, { duration: 1.2 });
  }, 350);
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export { openStory };
