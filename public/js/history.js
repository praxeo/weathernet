// "This day in weather": records and normals at the nearest long-record
// station, every year's high and low on this date as a dot plot, and the
// tornadoes on this date nearby and nationally.
import { $, el, svg, clear, put, getJSON } from "./util.js";
import { state } from "./state.js";
import { openLearn } from "./learn.js";

let token = 0;
const EF_COLOR = ["#9be7ff", "#6dd38b", "#ffe066", "#ffa64d", "#ff5c5c", "#d63cff"];

export async function renderHistory() {
  const loc = state.loc;
  if (!loc) return;
  const my = ++token;
  const board = clear($("historyBoard"));
  board.append(el("div", { class: "skeleton", style: { height: "260px" } }));
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  let d;
  try {
    d = await getJSON(`/api/history?lat=${loc.lat}&lon=${loc.lon}&date=${date}`, { timeout: 30000 });
  } catch {
    d = null;
  }
  if (my !== token) return;
  clear(board);
  if (!d || (!d.records && !d.tornadoes)) {
    board.append(el("div", { class: "panel empty", text: "Climate records are unavailable for this point right now." }));
    return;
  }
  const dayLabel = new Date(`${d.date}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric" });
  board.append(el("div", { class: "history-grid" }, recordsCard(d, dayLabel), tornadoCard(d, dayLabel)));
}

function recordsCard(d, dayLabel) {
  const r = d.records || {};
  const st = d.station || {};
  const yrs = (v) => (v?.years?.length ? v.years.slice(0, 3).join(", ") + (v.years.length > 3 ? "…" : "") : "");
  const card = el("div", { class: "panel records" },
    el("div", { class: "kicker", text: `${dayLabel} at ${st.name || "the nearest station"}` }),
    el("div", { class: "muted", style: { fontSize: "12.5px", marginTop: "6px" }, text: `${st.sid || ""}${st.distMi != null ? ` · ${Math.round(st.distMi)} mi away` : ""}${st.por?.start ? ` · records since ${st.por.start.slice(0, 4)}` : ""}` }),
    el("div", { class: "record-row" },
      rec("Record high", r.maxt?.high, "°", yrs(r.maxt?.high), "#ff8f3a"),
      rec("Record low", r.mint?.low, "°", yrs(r.mint?.low), "#5cc8ff"),
      rec("Normal high / low", d.normals ? { value: `${fmt(d.normals.maxt)}° / ${fmt(d.normals.mint)}°` } : null, "", "1991–2020"),
      rec("Wettest", r.pcpn?.max, '"', yrs(r.pcpn?.max), "#3ddc97"),
    ),
  );
  if (d.series?.years?.length) card.append(dotPlot(d));
  card.append(el("div", { style: { marginTop: "8px", display: "flex", gap: "6px", flexWrap: "wrap" } },
    el("button", { class: "chip learn", text: "How records are kept", on: { click: () => openLearn("record-event-report") } })));
  return card;
}

function fmt(v) {
  return v == null ? "—" : Math.round(Number(v));
}

function rec(label, v, unit, sub, color) {
  return el("div", { class: "record" },
    el("span", { text: label }),
    el("b", { style: color ? { color } : {}, text: v?.value != null ? `${v.display ?? v.value}${v.display === "T" ? "" : unit}` : "—" }),
    el("i", { text: sub || "" }));
}

function dotPlot(d) {
  const { years, maxt, mint } = d.series;
  const vals = [...maxt, ...mint].filter((v) => v != null && Number.isFinite(+v)).map(Number);
  if (!vals.length) return el("div");
  const W = 760, H = 250, L = 36, R = 12, T = 16, B = 28;
  const y0 = years[0], y1 = years[years.length - 1];
  const lo = Math.floor((Math.min(...vals) - 4) / 10) * 10;
  const hi = Math.ceil((Math.max(...vals) + 4) / 10) * 10;
  const x = (yr) => L + ((yr - y0) / Math.max(1, y1 - y0)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `High and low temperature on this date every year since ${y0}` });
  for (let v = lo; v <= hi; v += 10) {
    g.append(svg("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: "rgba(150,172,222,.1)" }));
    g.append(svg("text", { class: "axis", x: L - 6, y: y(v) + 3, "text-anchor": "end" }, `${v}°`));
  }
  for (let yr = Math.ceil(y0 / 20) * 20; yr <= y1; yr += 20) {
    g.append(svg("text", { class: "axis", x: x(yr), y: H - 8, "text-anchor": "middle" }, String(yr)));
  }
  if (d.normals?.maxt != null) g.append(svg("line", { x1: L, x2: W - R, y1: y(d.normals.maxt), y2: y(d.normals.maxt), stroke: "#ff8f3a", "stroke-dasharray": "5 5", "stroke-opacity": 0.6 }));
  if (d.normals?.mint != null) g.append(svg("line", { x1: L, x2: W - R, y1: y(d.normals.mint), y2: y(d.normals.mint), stroke: "#5cc8ff", "stroke-dasharray": "5 5", "stroke-opacity": 0.6 }));
  years.forEach((yr, i) => {
    if (maxt[i] != null) g.append(svg("circle", { cx: x(yr), cy: y(+maxt[i]), r: 2.6, fill: "#ff8f3a", "fill-opacity": 0.85 }, svg("title", {}, `${yr}: high ${maxt[i]}°`)));
    if (mint[i] != null) g.append(svg("circle", { cx: x(yr), cy: y(+mint[i]), r: 2.6, fill: "#5cc8ff", "fill-opacity": 0.85 }, svg("title", {}, `${yr}: low ${mint[i]}°`)));
  });
  const mark = (v, color, below) => {
    if (!v || v.value == null || !v.years?.length) return;
    const yr = v.years[0];
    g.append(svg("circle", { cx: x(yr), cy: y(+v.value), r: 5.5, fill: "none", stroke: color, "stroke-width": 2 }));
    g.append(svg("text", { class: "axis", x: x(yr), y: y(+v.value) + (below ? 18 : -10), "text-anchor": x(yr) > W - 90 ? "end" : "middle", fill: color, style: `fill:${color}` }, `${v.value}° (${yr})`));
  };
  mark(d.records?.maxt?.high, "#ffb347", false);
  mark(d.records?.mint?.low, "#8fd8ff", true);
  return el("div", { class: "dotplot" },
    el("div", { class: "muted", style: { fontSize: "12.5px", margin: "12px 0 4px" }, text: `Every ${new Date(`${d.date}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric" })} since ${y0}: highs (orange) and lows (blue); dashed lines are the 1991–2020 normals.` }),
    g);
}

function tornadoCard(d, dayLabel) {
  const t = d.tornadoes || {};
  const card = el("div", { class: "panel tornado-list" },
    el("div", { class: "kicker", text: `Tornadoes on ${dayLabel}` }));
  const list = (arr, empty) => arr?.length
    ? el("ol", {}, arr.map((x) => el("li", {},
      el("span", { class: "ef", style: { background: EF_COLOR[Math.max(0, Math.min(5, x.mag ?? 0))] }, text: x.scale || (x.mag != null ? `F${x.mag}` : "F?") }),
      el("div", {},
        el("b", { text: `${x.year} · ${x.county ? x.county + ", " : ""}${x.state}` }),
        el("div", { class: "muted", text: [x.distMi != null ? `${Math.round(x.distMi)} mi away` : null, x.lenMi ? `${x.lenMi} mi path` : null, x.widthYd ? `${x.widthYd} yd wide` : null, x.fatalities ? `${x.fatalities} killed` : null, x.injuries ? `${x.injuries} injured` : null].filter(Boolean).join(" · ") }),
      ))))
    : el("div", { class: "muted", style: { fontSize: "13px", padding: "8px 0" }, text: empty });
  put(card,
    el("h4", { style: { margin: "14px 0 6px" }, text: `Within ${t.localRadiusMi || 150} miles` }),
    list((t.local || []).slice(0, 6), "No tornadoes on record within range on this date."),
    el("h4", { style: { margin: "16px 0 6px" }, text: "Nationally: violent or deadly" }),
    list((t.notable || []).slice(0, 6), "No violent or deadly tornadoes on record on this date."),
    el("div", { style: { marginTop: "10px" } }, el("button", { class: "chip learn", text: "The EF scale", on: { click: () => openLearn("ef-scale") } })),
  );
  return card;
}
