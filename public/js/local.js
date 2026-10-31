// "Your weather": the top of the page, in the order weatherchat's home
// screen reads. Alerts for the point come first, full width. Then the
// conditions beside the AI forecast discussion, then the next 48 hours and
// the 7-day. "Around you" (stations, storm reports, broadcasters' flags)
// moves up under the conditions while something is happening nearby, and
// otherwise sits at the end.
import { $, el, svg, clear, getJSON, store, ago, fmtTime } from "./util.js";
import { state, setLocation } from "./state.js";
import { renderMarkdown } from "./markdown.js";

let token = 0;

export async function renderLocal() {
  const loc = state.loc;
  if (!loc) return;
  const my = ++token;
  const board = clear($("localBoard"));
  const alerts = el("div", { class: "local-alerts" });
  const colA = el("div", { class: "local-col" },
    el("div", { class: "panel skeleton o-now", style: { height: "260px" } }),
    el("div", { class: "panel skeleton o-chart", style: { height: "220px" } }));
  const colB = el("div", { class: "local-col" }, discussionCard(loc));
  board.append(alerts, el("div", { class: "local-grid" }, colA, colB));

  const [dash, ground] = await Promise.all([
    getJSON(`/api/dashboard?lat=${loc.lat}&lon=${loc.lon}`).catch(() => null),
    getJSON(`/api/ground?lat=${loc.lat}&lon=${loc.lon}`).catch(() => null),
  ]);
  if (my !== token) return;
  clear(colA);
  if (!dash) {
    colA.append(el("div", { class: "panel empty o-now", text: "Couldn't load the forecast for this point (NWS may be slow). It will retry shortly." }));
    return;
  }
  if (dash.location?.name && (!loc.name || !loc.office)) {
    setLocationQuiet({ ...loc, name: loc.name || dash.location.name, office: dash.location.office });
  }
  $("localDek").textContent = `${dash.location?.name || loc.name || "Your point"} · NWS ${dash.location?.office || ""} · observations from ${dash.current?.station || "the nearest station"}.`;
  if (dash.alerts?.length) alerts.append(alertsCard(dash.alerts));
  const hot = !!ground && groundActive(ground);
  colA.append(nowCard(dash));
  if (hot) colA.append(groundCard(ground, true));
  colA.append(chartCard(dash), dailyCard(dash));
  if (ground && !hot) colB.append(groundCard(ground, false));
}

// weatherchat's rule: a person-made storm report in the last 6 h, or a
// damage/tornado/flooding flag from local broadcasters in the last 3 h.
function groundActive(g) {
  const now = Date.now();
  const recent = (t, h) => t && now - Date.parse(t) < h * 3600e3;
  if ((g.reports?.items || []).some((r) => !r.automated && recent(r.time, 6))) return true;
  const sig = g.signals?.items || g.signals?.signals || [];
  return sig.some((x) => ["damage", "tornado", "flooding"].includes(x.kind) && recent(x.time, 3));
}

// Update the stored name/office without re-triggering every section.
function setLocationQuiet(loc) {
  state.loc = loc;
  store.set("wn.loc", loc);
  const n = $("locName");
  if (n) n.textContent = loc.name || "Your location";
}

function nowCard(d) {
  const c = d.current || {};
  const wind = c.windSpeed_mph == null ? "—" : c.windSpeed_mph === 0 && !c.windGust_mph ? "Calm" : `${compass(c.windDir_deg)} ${c.windSpeed_mph}${c.windGust_mph ? ` G${c.windGust_mph}` : ""} mph`.trim();
  return el("div", { class: "panel now-card o-now" },
    el("div", { class: "now-top" },
      el("div", { class: "now-temp" }, c.temperature_F != null ? Math.round(c.temperature_F) : "—", el("sup", { text: "°F" })),
      el("div", {},
        el("div", { class: "now-desc", text: c.textDescription || "" }),
        el("div", { class: "muted", text: `Feels ${c.feelsLike_F != null ? Math.round(c.feelsLike_F) + "°" : "—"} · ${c.station || ""} ${c.observed ? "· " + ago(c.observed) : ""}` }),
      ),
    ),
    el("div", { class: "obs-grid" },
      obs("Dewpoint", c.dewpoint_F != null ? `${Math.round(c.dewpoint_F)}°F` : "—"),
      obs("Humidity", c.humidity_pct != null ? `${c.humidity_pct}%` : "—"),
      obs("Wind", wind),
      obs("Pressure", c.pressure_inHg != null ? `${c.pressure_inHg.toFixed(2)} in` : "—"),
      obs("Visibility", c.visibility_mi != null ? `${c.visibility_mi} mi` : "—"),
      obs("Rain 24/48 h", d.precipOutlook ? `${d.precipOutlook.qpf24_in ?? 0}" / ${d.precipOutlook.qpf48_in ?? 0}"` : "—"),
    ),
    d.astronomy?.sun ? el("div", { class: "muted", style: { fontSize: "12.5px" }, text: `Sunrise ${fmtTime(d.astronomy.sun.sunrise_UTC, d.location?.timeZone)} · Sunset ${fmtTime(d.astronomy.sun.sunset_UTC, d.location?.timeZone)} · Moon: ${d.astronomy.moon?.phase || ""} (${d.astronomy.moon?.illumination_pct ?? "?"}%)` }) : null,
  );
}

function obs(label, value) {
  return el("div", { class: "obs" }, el("span", { text: label }), el("b", { text: value }));
}

function alertsCard(alerts) {
  return el("div", { class: "panel alerts-card", style: { padding: "14px", display: "grid", gap: "8px" } },
    el("div", { class: "kicker", text: "Alerts for your point" }),
    alerts.slice(0, 6).map((a) => el("div", { class: "alert-row" },
      el("b", { text: a.event }), " ", el("span", { class: "muted", text: a.ends || a.expires ? `until ${fmtTime(a.ends || a.expires)}` : "" }),
      a.headline ? el("div", { style: { fontSize: "12.5px", color: "var(--text-2)" }, text: a.headline }) : null,
    )),
  );
}

function groundCard(g, hot) {
  const items = g.reports?.items || [];
  const sum = g.stations?.summary;
  const sig = g.signals?.items || g.signals?.signals || [];
  return el("div", { class: `panel ${hot ? "o-ground-hot" : "o-ground"}`, style: { padding: "14px", display: "grid", gap: "10px" } },
    el("div", { class: "kicker", text: hot ? "Around you · happening now" : "Around you" }),
    sum ? el("div", { class: "ground-list" },
      sum.highest_peak_gust_today ? el("div", { class: "r", text: `Peak gust today: ${sum.highest_peak_gust_today}` }) : null,
      sum.wettest_today ? el("div", { class: "r", text: `Wettest gauge today: ${sum.wettest_today}` }) : null,
      sum.temp_F_range ? el("div", { class: "r", text: `Temperatures across ${g.stations.items?.length || "nearby"} stations: ${sum.temp_F_range[0]}–${sum.temp_F_range[1]}°F; dewpoints ${sum.dewpoint_F_range?.[0]}–${sum.dewpoint_F_range?.[1]}°F` }) : null,
    ) : null,
    items.length ? el("div", { class: "ground-list" }, items.slice(0, 6).map((r) => el("div", { class: "r" },
      el("b", { text: `${r.type || "Report"}${r.magnitude ? " " + r.magnitude : ""}` }),
      ` · ${r.place || ""} (${r.distance_mi} mi ${r.direction || ""}) · ${ago(r.time)}`,
      r.remark ? el("div", { class: "muted", text: r.remark }) : null))) : el("div", { class: "muted", style: { fontSize: "13px" }, text: "No storm reports within 75 miles in the last 24 hours." }),
    sig.length ? el("div", { class: "ground-list" }, sig.slice(0, 4).map((s) => el("div", { class: "r" }, el("b", { text: s.headline || s.text || "" }), s.place ? ` · ${s.place}` : ""))) : null,
  );
}

// ── Discussion ──────────────────────────────────────────────────────────────
// Collapsible like weatherchat's: the headline and the first section stay,
// the rest folds away. The choice is remembered; phones start folded so the
// 48-hour chart and the 7-day aren't a long scroll away.
function discussionCard(loc) {
  const key = `wn.disc:${loc.lat.toFixed(2)},${loc.lon.toFixed(2)}`;
  const cached = store.get(key, null);
  const md = el("div", { class: "md" });
  const meta = el("div", { class: "muted", style: { fontSize: "12px", marginTop: "6px" } });
  const toggle = el("button", { class: "disc-toggle", type: "button", hidden: true });
  const card = el("div", { class: "panel discussion o-disc" + (cached ? " stale" : "") },
    el("div", { class: "kicker", style: { marginBottom: "10px" }, text: "Forecast discussion" }), md, toggle, meta);
  const folded = () => store.get("wn.discFolded", window.matchMedia("(max-width: 640px)").matches);
  const paint = (text) => {
    md.innerHTML = renderMarkdown(text);
    const long = md.querySelectorAll(":scope > p").length > 2;
    toggle.hidden = !long;
    card.classList.toggle("folded", long && folded());
    toggle.textContent = card.classList.contains("folded") ? "Full discussion ▾" : "Collapse ▴";
  };
  toggle.addEventListener("click", () => {
    const now = !card.classList.contains("folded");
    store.set("wn.discFolded", now);
    card.classList.toggle("folded", now);
    toggle.textContent = now ? "Full discussion ▾" : "Collapse ▴";
  });
  if (cached) {
    paint(cached.summary);
    meta.textContent = `Previous discussion (${ago(cached.at)}). Writing a fresh one…`;
  } else {
    md.append(el("div", { class: "skeleton", style: { height: "140px" } }));
    meta.textContent = "Reading the obs, the gridded forecast, the AFD and every SPC/WPC/NHC product for this point… (up to a minute)";
  }
  getJSON(`/api/summary?lat=${loc.lat}&lon=${loc.lon}`, { timeout: 110000 }).then((d) => {
    if (!d?.summary || !card.isConnected) return;
    card.classList.remove("stale");
    paint(d.summary);
    meta.textContent = `${d.source === "model" ? "Written by WeatherNet's meteorologist model from live NWS/SPC/WPC/NHC data" : "Automatic summary (the model is unavailable)"} · ${ago(d.generatedAt)}`;
    if (d.source === "model") store.set(key, { summary: d.summary, at: d.generatedAt });
  }).catch(() => {
    if (card.isConnected && !cached) meta.textContent = "The discussion couldn't be generated right now.";
  });
  return card;
}

// ── 48-hour chart: temperature, dewpoint, precip chance ─────────────────────
function chartCard(d) {
  const s = d.hourlySeries;
  const card = el("div", { class: "panel chart-card o-chart" }, el("div", { class: "kicker", style: { marginBottom: "8px" }, text: "Next 48 hours" }));
  if (!s?.temp_F?.length) return card;
  const n = Math.min(48, s.temp_F.length);
  const W = 720, H = 230, L = 34, R = 10, T = 12, B = 30;
  const temps = [...s.temp_F.slice(0, n), ...(s.dewpoint_F || []).slice(0, n)].filter((v) => v != null);
  const lo = Math.floor((Math.min(...temps) - 3) / 5) * 5;
  const hi = Math.ceil((Math.max(...temps) + 3) / 5) * 5;
  const x = (i) => L + (i / (n - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const start = Date.parse(s.start);
  const tz = d.location?.timeZone;
  const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "48-hour temperature, dewpoint and precipitation chance" });
  for (let v = lo; v <= hi; v += 5) {
    g.append(svg("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: "rgba(150,172,222,.1)" }));
    if ((v - lo) % 10 === 0) g.append(svg("text", { class: "axis", x: L - 6, y: y(v) + 3, "text-anchor": "end" }, `${v}°`));
  }
  const bw = (W - L - R) / n;
  for (let i = 0; i < n; i++) {
    const p = s.pop?.[i];
    if (p) g.append(svg("rect", { x: x(i) - bw / 2, width: bw * 0.9, y: H - B - (p / 100) * (H - T - B) * 0.45, height: (p / 100) * (H - T - B) * 0.45, fill: "rgba(92,200,255,.22)" }));
    const t = new Date(start + i * 3600e3);
    const hr = Number(t.toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: tz }));
    if (hr % 6 === 0) {
      g.append(svg("line", { x1: x(i), x2: x(i), y1: T, y2: H - B, stroke: hr === 0 ? "rgba(150,172,222,.3)" : "rgba(150,172,222,.08)" }));
      g.append(svg("text", { class: "axis", x: x(i), y: H - B + 14, "text-anchor": "middle" }, hr === 0 ? t.toLocaleDateString("en-US", { weekday: "short", timeZone: tz }) : t.toLocaleTimeString("en-US", { hour: "numeric", timeZone: tz })));
    }
  }
  const line = (arr, color, width) => {
    const pts = arr.slice(0, n).map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean);
    if (pts.length > 1) g.append(svg("polyline", { points: pts.join(" "), fill: "none", stroke: color, "stroke-width": width, "stroke-linejoin": "round", "stroke-linecap": "round" }));
  };
  line(s.dewpoint_F || [], "#3ddc97", 2);
  line(s.temp_F, "#ff8f3a", 2.6);
  card.append(g, el("div", { class: "legend", style: { gridTemplateColumns: "auto auto auto auto auto auto", justifyContent: "start", marginTop: "6px" } },
    el("i", { style: { background: "#ff8f3a" } }), "Temperature", el("i", { style: { background: "#3ddc97" } }), "Dewpoint", el("i", { style: { background: "rgba(92,200,255,.5)" } }), "Precip chance"));
  return card;
}

// ── 7-day: pair each daytime period (high) with the night after it (low) ───
function dailyCard(d) {
  const periods = d.daily || [];
  const rows = [];
  let i = 0;
  if (periods[0] && !periods[0].isDaytime) {
    rows.push({ name: periods[0].name, hi: null, lo: periods[0].temp_F, short: periods[0].short, pop: periods[0].pop });
    i = 1;
  }
  for (; i < periods.length; i += 2) {
    const day = periods[i];
    const night = periods[i + 1];
    if (!day) break;
    rows.push({ name: day.name, hi: day.temp_F, lo: night?.temp_F ?? null, short: day.short, pop: Math.max(day.pop || 0, night?.pop || 0) });
  }
  return el("div", { class: "panel o-daily", style: { padding: "14px 16px" } },
    el("div", { class: "kicker", style: { marginBottom: "6px" }, text: "7-day · NWS point forecast" }),
    el("table", { class: "daily-table" }, el("tbody", {}, rows.slice(0, 8).map((r) => el("tr", {},
      el("td", { class: "d", text: r.name }),
      el("td", { class: "s", text: r.short || "" }),
      el("td", { class: "p", text: r.pop ? `${r.pop}%` : "" }),
      el("td", { class: "t" }, r.hi != null ? `${r.hi}°` : "", el("span", { class: "muted", text: r.lo != null ? ` / ${r.lo}°` : "" })),
    )))),
  );
}

function compass(deg) {
  if (deg == null) return "";
  const P = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return P[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

export { setLocation };
