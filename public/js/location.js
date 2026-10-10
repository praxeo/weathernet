// Location picker: search (weatherchat's /api/geosearch), the browser's
// geolocation, or the site default.
import { el, clear, getJSON, openSheet, closeSheet, sheetTitle } from "./util.js";
import { state, setLocation } from "./state.js";

export function openLocationPicker() {
  const input = el("input", { type: "search", placeholder: "City, ZIP or address", autocomplete: "off", "aria-label": "Search for a place" });
  const results = el("div", { class: "loc-results" });
  const status = el("div", { class: "muted", style: { fontSize: "12.5px" } });
  let t = null;
  let seq = 0;
  input.addEventListener("input", () => {
    clearTimeout(t);
    const q = input.value.trim();
    if (q.length < 2) {
      clear(results);
      return;
    }
    t = setTimeout(async () => {
      const my = ++seq;
      try {
        const d = await getJSON(`/api/geosearch?q=${encodeURIComponent(q)}`);
        if (my !== seq) return;
        clear(results);
        for (const r of (d.results || []).slice(0, 8)) {
          results.append(el("button", { on: { click: () => choose({ lat: r.lat, lon: r.lon, name: shortName(r) }) } },
            el("b", { text: r.label })));
        }
        if (!d.results?.length) results.append(el("div", { class: "muted", text: "No matches." }));
      } catch {
        status.textContent = "Search is unavailable right now.";
      }
    }, 280);
  });
  const geo = el("button", { class: "btn", text: "📍 Use my location", on: { click: () => {
    if (!navigator.geolocation) {
      status.textContent = "This browser can't share its location.";
      return;
    }
    status.textContent = "Locating…";
    navigator.geolocation.getCurrentPosition(
      (p) => choose({ lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4), name: null }),
      () => { status.textContent = "Location permission was denied."; },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  } } });
  const def = state.config?.defaultLocation;
  const body = [
    el("div", { class: "loc-search" }, input),
    results,
    el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, geo,
      def ? el("button", { class: "btn ghost", text: `Default: ${def.name}`, on: { click: () => choose(def) } }) : null),
    status,
  ];
  openSheet(sheetTitle("Your location", "Where should WeatherNet focus?", "Used for your forecast, history, nearby cameras and as the chat's default location."), body);
  setTimeout(() => input.focus(), 150);
}

function shortName(r) {
  if (r.city && r.state) {
    const first = String(r.label || "").split(",")[0].trim();
    return `${first}, ${r.state}`;
  }
  return r.label;
}

function choose(loc) {
  setLocation(loc);
  closeSheet();
}
