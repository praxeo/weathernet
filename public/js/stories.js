// Story board cards and the story detail sheet.
import { $, el, clear, getJSON, store, ago, fmtTime, openSheet, closeSheet, sheetTitle, tierClass, plural } from "./util.js";
import { state, storyById } from "./state.js";
import { openLearn, learnTitle } from "./learn.js";
import { askAbout } from "./chat.js";
import { camTile, openCam } from "./cams.js";
import { focusMap } from "./map.js";

export function renderStories(data) {
  const board = clear($("storyBoard"));
  const stories = data?.stories || [];
  $("storiesUpdated").textContent = data?.generated ? `Updated ${ago(data.generated)}` : "";
  const us = stories.filter((s) => s.lane !== "world");
  const world = stories.filter((s) => s.lane === "world");
  if (!stories.length) {
    board.append(el("div", { class: "panel empty", text: "Nothing significant is happening nationally right now. That's rare: enjoy it, and check the satellite loops below." }));
  } else {
    board.append(el("div", { class: "stories-grid" }, us.map((s, i) => storyCard(s, i < 3, i === 0 && !!s.radar))));
  }
  if (world.length) {
    board.append(el("div", { class: "lane-label", text: "Elsewhere in the world · GDACS red alerts only" }),
      el("div", { class: "stories-grid" }, world.map((s) => storyCard(s, false, false))));
  }
  if (data?.unavailable?.length) {
    board.append(el("p", { class: "muted", style: { fontSize: "12px", marginTop: "10px" }, text: `Temporarily unavailable: ${data.unavailable.join(", ")}.` }));
  }
}

function storyCard(s, withMedia, lead) {
  const card = el("article", {
    class: `story ${tierClass(s.tier)}${s.lane === "world" ? " world" : ""}${lead ? " lead" : ""}`,
    tabindex: 0,
    on: { click: () => openStory(s.id), keydown: (e) => { if (e.key === "Enter") openStory(s.id); } },
  },
  el("div", { class: "k" }, s.kicker || ""),
  el("h3", { text: s.title }),
  el("div", { class: "place", text: [s.place, s.time ? ago(s.time) : null].filter(Boolean).join(" · ") }),
  s.facts?.length ? el("div", { class: "badges" }, s.facts.map((f) => el("span", { class: "badge", text: f }))) : null,
  withMedia && s.radar ? el("div", { class: "media" }, el("img", { src: s.radar.still, alt: `Radar ${s.radar.id}`, loading: "lazy" })) : null,
  s.summary ? el("p", { class: "summary", text: s.summary }) : null,
  s.badges?.length ? el("div", { class: "badges" }, s.badges.slice(0, 4).map((b) => el("span", { class: `badge ${b.tone}`, text: b.label }))) : null,
  el("div", { class: "actions" },
    (s.learn || []).slice(0, 2).map((k) => el("button", { class: "chip learn", text: learnTitle(k), on: { click: (e) => { e.stopPropagation(); openLearn(k); } } })),
  ));
  return card;
}

export async function openStory(id) {
  const s = typeof id === "object" ? id : storyById(id);
  if (!s) return;
  const body = [];

  const actions = el("div", { class: "hero-actions" },
    Number.isFinite(s.lat) ? el("button", { class: "btn", text: "Show on map", on: { click: () => { focusMap(s); } } }) : null,
    el("button", { class: "btn primary", text: "Ask WeatherNet about this", on: { click: () => askAbout(s) } }),
  );
  body.push(actions);

  if (s.facts?.length || s.badges?.length) {
    body.push(el("div", { class: "badges", style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
      (s.facts || []).map((f) => el("span", { class: "badge", text: f })),
      (s.badges || []).map((b) => el("span", { class: `badge ${b.tone}`, text: b.label }))));
  }
  if (s.summary) body.push(el("p", { style: { margin: 0, color: "var(--text-2)" }, text: s.summary }));

  if (s.radar) {
    body.push(el("div", {},
      el("h4", { text: `Radar · ${s.radar.id} ${s.radar.name} (${s.radar.distMi} mi away)` }),
      el("div", { class: "radar-big" }, el("img", { src: s.radar.loop, alt: `Base reflectivity loop from ${s.radar.id}`, loading: "lazy" })),
      el("div", { class: "muted", style: { fontSize: "12px", marginTop: "6px" } },
        "NWS RIDGE base reflectivity loop. ", el("a", { href: s.radar.page, target: "_blank", rel: "noopener", text: "Open interactive radar ↗" })),
    ));
  }

  // NOAA's 1-minute mesoscale sector over this story, if any.
  for (const m of (s.meso || []).filter((x) => x.imagery !== false).slice(0, 1)) {
    const sector = (state.satellite?.meso || []).find((x) => x.sat === m.sat && x.id === m.id);
    const band = sector?.bands?.find((b) => b.id === "GEOCOLOR") || sector?.bands?.[0];
    const src = band?.latest || band?.frames?.[band.frames.length - 1]?.url;
    if (!src) continue;
    body.push(el("div", {},
      el("h4", { text: `Satellite · ${m.sat === "west" ? "GOES-West" : "GOES-East"} ${m.id.replace("M", "Meso ")} (1-minute imagery)` }),
      el("div", { class: "radar-big" }, el("img", { src, alt: `GOES mesoscale sector ${m.id}`, loading: "lazy" })),
      el("div", { class: "muted", style: { fontSize: "12px", marginTop: "6px" } },
        "NOAA aimed this sector here, which says forecasters are watching this weather closely. ",
        el("a", { href: "#satellite", text: "Loop it in the satellite gallery →", on: { click: () => { store.set("wn.satView", `meso-${m.sat}-${m.id}`); window.dispatchEvent(new CustomEvent("wn:satview")); closeSheet(); } } })),
    ));
  }

  if (s.items?.length) {
    body.push(el("div", {}, el("h4", { text: "What's in effect & what's been reported" }),
      el("div", { class: "item-list" }, s.items.map((it) => el("div", { class: "item" },
        el("b", { text: `${it.label}${it.area ? " — " + it.area : ""}` }),
        it.text ? el("div", { text: it.text }) : null,
        el("div", { class: "muted", text: [it.expires ? `until ${fmtTime(it.expires)}` : null, it.time ? ago(it.time) : null, it.source || null].filter(Boolean).join(" · ") }),
      )))));
  }

  const camBox = el("div", {}, el("h4", { text: "Cameras near this story" }), el("div", { class: "cam-grid" }, el("div", { class: "skeleton", style: { aspectRatio: "16/9" } })));
  if (Number.isFinite(s.lat) && s.lane !== "world") body.push(camBox);

  if (s.learn?.length) {
    body.push(el("div", {}, el("h4", { text: "Understand it" }),
      el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
        s.learn.map((k) => el("button", { class: "chip learn", text: learnTitle(k), on: { click: () => openLearn(k) } })))));
  }
  if (s.links?.length) {
    body.push(el("div", {}, el("h4", { text: "Official sources" }),
      el("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap" } },
        s.links.map((l) => el("a", { href: l.url, target: "_blank", rel: "noopener", text: `${l.label} ↗` })))));
  }

  openSheet(sheetTitle(s.kicker, s.title, [s.place, s.time ? `updated ${ago(s.time)}` : null].filter(Boolean).join(" · "), s.tier), body);

  if (Number.isFinite(s.lat) && s.lane !== "world") {
    try {
      const d = await getJSON(`/api/cams?lat=${s.lat}&lon=${s.lon}&radius=80&limit=8&prefer=sky`);
      const grid = camBox.querySelector(".cam-grid");
      clear(grid);
      if (!d.cams?.length) grid.append(el("div", { class: "muted", text: "No public cameras within 80 miles yet. WeatherNet's camera network grows state by state." }));
      for (const c of d.cams || []) grid.append(camTile(c, () => openCam(c)));
    } catch {
      camBox.remove();
    }
  }
}

export function storyCountText(data) {
  const n = data?.stories?.length || 0;
  return plural(n, "story", "stories");
}

export { state };
