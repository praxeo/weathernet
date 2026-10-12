// The Learn library: explainer cards and the explainer sheet. Content lives
// in explainers.js; stories, map popups and the hero link here by key.
import { $, el, clear, openSheet, sheetTitle } from "./util.js";
import { EXPLAINERS, LEARN_GROUPS } from "./explainers.js";

export function learnTitle(key) {
  return EXPLAINERS[key]?.title || String(key).replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function renderLearn() {
  const board = clear($("learnBoard"));
  const groups = el("div", { class: "learn-groups" });
  for (const g of LEARN_GROUPS) {
    const items = Object.entries(EXPLAINERS).filter(([, x]) => x.group === g.id);
    if (!items.length) continue;
    groups.append(el("div", { class: "learn-group" },
      el("h3", { text: g.title }),
      el("div", { class: "learn-grid" }, items.map(([key, x]) => el("button", { class: "learn-card", on: { click: () => openLearn(key) } },
        el("span", { class: "ico", text: x.icon || "◆" }),
        el("b", { text: x.title }),
        el("span", { text: x.summary }),
      ))),
    ));
  }
  board.append(groups);
}

export function openLearn(key) {
  const x = EXPLAINERS[key];
  if (!x) return;
  const group = LEARN_GROUPS.find((g) => g.id === x.group);
  const body = [
    el("p", { style: { margin: 0, fontSize: "16px", color: "var(--text)" }, text: x.summary }),
    el("div", { class: "explainer" }, x.body.map((p) => el("p", { text: p }))),
  ];
  if (x.lookFor?.length) {
    body.push(el("div", { class: "explainer" }, el("h4", { text: "What to look for" }), el("ul", {}, x.lookFor.map((t) => el("li", { text: t })))));
  }
  if (x.related?.length) {
    body.push(el("div", {}, el("h4", { text: "Related" }),
      el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
        x.related.filter((k) => EXPLAINERS[k]).map((k) => el("button", { class: "chip learn", text: EXPLAINERS[k].title, on: { click: () => openLearn(k) } })))));
  }
  if (x.sources?.length) {
    body.push(el("div", {}, el("h4", { text: "Sources" }),
      el("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } },
        x.sources.map((s) => el("a", { href: s.url, target: "_blank", rel: "noopener", text: `${s.label} ↗` })))));
  }
  openSheet(sheetTitle(`${x.icon || ""} Learn · ${group?.title || ""}`.trim(), x.title), body);
}
