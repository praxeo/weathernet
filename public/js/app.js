// WeatherNet front end bootstrap: fetch the national board and the satellite
// catalog, wire sections to state, poll, and lazy-start the heavy sections
// (map, satellite gallery, cams, history) as they scroll into view.
import { $, getJSON, utcStamp, onVisible, closeSheet } from "./util.js";
import { state, on, emit } from "./state.js";
import { renderHero, renderHeroCopy, renderPins } from "./hero.js";
import { renderStories } from "./stories.js";
import { initMap, updateMap, onLocationForMap } from "./map.js";
import { renderSatellite } from "./satellite.js";
import { renderCams } from "./cams.js";
import { renderLocal } from "./local.js";
import { renderHistory } from "./history.js";
import { renderLearn } from "./learn.js";
import { initAsk } from "./chat.js";
import { openLocationPicker } from "./location.js";

const STORIES_MS = 120000;
const SATELLITE_MS = 300000;
const seen = { map: false, sat: false, cams: false, history: false };
// Cams follow the stories: if the section rendered before the board arrived,
// render it again once there are stories to follow.
let camsHadStories = false;

function tickClock() {
  $("clock").textContent = utcStamp();
}

async function loadStories() {
  try {
    state.stories = await getJSON("/api/stories");
    emit("stories", state.stories);
  } catch {
    if (!state.stories) {
      $("storyBoard").textContent = "The national story board is unavailable right now. Retrying…";
    }
  }
}

async function loadSatellite() {
  try {
    state.satellite = await getJSON("/api/satellite");
  } catch {
    state.satellite = state.satellite || null;
  }
  emit("satellite", state.satellite);
}

function wire() {
  on("stories", (d) => {
    renderHeroCopy(d);
    renderPins();
    renderStories(d);
    if (seen.map) updateMap(d);
    if (seen.cams && !camsHadStories) {
      camsHadStories = true;
      renderCams();
    }
  });
  on("satellite", (cat) => {
    renderHero(cat);
    if (seen.sat) renderSatellite(cat);
  });
  on("location", (loc) => {
    $("locName").textContent = loc.name || "Your location";
    renderLocal();
    if (seen.history) renderHistory();
    if (seen.cams) renderCams();
    onLocationForMap();
  });
}

function lazySections() {
  onVisible($("mapWrap"), () => {
    seen.map = true;
    initMap();
    if (state.stories) updateMap(state.stories);
  });
  onVisible($("satGallery"), () => {
    seen.sat = true;
    if (state.satellite) renderSatellite(state.satellite);
  });
  onVisible($("camBoard"), () => {
    seen.cams = true;
    camsHadStories = !!state.stories;
    renderCams();
    setInterval(renderCams, 10 * 60 * 1000);
  });
  onVisible($("historyBoard"), () => {
    seen.history = true;
    renderHistory();
  });
}

function navHighlight() {
  const links = [...document.querySelectorAll(".nav a")];
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      for (const a of links) a.classList.toggle("on", a.getAttribute("href") === `#${e.target.id}`);
    }
  }, { rootMargin: "-45% 0px -50% 0px" });
  for (const a of links) {
    const s = document.querySelector(a.getAttribute("href"));
    if (s) io.observe(s);
  }
}

async function boot() {
  tickClock();
  setInterval(tickClock, 15000);
  $("sheetClose").onclick = closeSheet;
  $("overlay").addEventListener("click", () => {
    if ($("sheet").classList.contains("open")) closeSheet();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSheet();
  });
  $("locBtn").onclick = openLocationPicker;
  $("locBtn2").onclick = openLocationPicker;

  wire();
  renderLearn();
  initAsk();
  navHighlight();

  state.config = await getJSON("/api/config").catch(() => null);
  if (!state.loc) {
    const d = state.config?.defaultLocation || { lat: 33.21, lon: -86.65, name: "Shelby County, Alabama", office: "BMX" };
    state.loc = { lat: d.lat, lon: d.lon, name: d.name, office: d.office };
  }
  $("locName").textContent = state.loc.name || "Your location";

  lazySections();
  await Promise.all([loadStories(), loadSatellite()]);
  renderLocal();
  setInterval(loadStories, STORIES_MS);
  setInterval(loadSatellite, SATELLITE_MS);
}

boot();
