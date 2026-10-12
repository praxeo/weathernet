// Small DOM + data helpers shared by every section. Build DOM with el() and
// textContent — upstream text (NWS products, camera names, model output) never
// goes through innerHTML except via markdown.js, which escapes it first.

export const $ = (id) => document.getElementById(id);

export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
      else if (k === "on") for (const [evt, fn] of Object.entries(v)) node.addEventListener(evt, fn);
      else if (k === "dataset") Object.assign(node.dataset, v);
      else if (k in node && typeof v !== "string") node[k] = v;
      else node.setAttribute(k, v === true ? "" : String(v));
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function svg(tag, attrs, ...children) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) node.setAttribute(k, String(v));
  for (const c of children.flat()) if (c != null) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

// Element.append() turns null into the text "null"; this skips empties.
export function put(parent, ...kids) {
  for (const k of kids.flat()) if (k != null && k !== false) parent.append(k);
  return parent;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export async function getJSON(url, { timeout = 25000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// localStorage can be unavailable (private mode, blocked storage); every
// read/write degrades to "nothing stored".
export const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore
    }
  },
};

export function ago(iso) {
  const ms = Date.now() - Date.parse(iso || "");
  if (!Number.isFinite(ms)) return "";
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function fmtTime(iso, tz) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz || undefined });
}

export function fmtDay(iso, tz) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", timeZone: tz || undefined });
}

export function utcStamp(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d)) return "";
  return d.toISOString().slice(11, 16) + " UTC";
}

export const tierClass = (t) => `tier-${Math.max(0, Math.min(3, t | 0))}`;
export const TONE = ["context", "notable", "major", "extreme"];

// Run fn once, the first time node scrolls near the viewport.
export function onVisible(node, fn, margin = "300px") {
  if (!node) return;
  if (!("IntersectionObserver" in window)) return fn();
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      io.disconnect();
      fn();
    }
  }, { rootMargin: margin });
  io.observe(node);
}

// ── Side sheet (story details, cam viewer, explainers, location) ───────────
let sheetCleanup = null;

export function openSheet(titleNode, bodyNodes, { onClose } = {}) {
  closeSheet();
  clear($("sheetTitle")).append(titleNode);
  clear($("sheetBody")).append(...[bodyNodes].flat().filter(Boolean));
  $("sheet").classList.add("open");
  $("sheet").setAttribute("aria-hidden", "false");
  $("overlay").classList.add("open");
  $("sheetBody").scrollTop = 0;
  sheetCleanup = onClose || null;
  $("sheetClose").focus({ preventScroll: true });
}

export function closeSheet() {
  if (sheetCleanup) {
    try {
      sheetCleanup();
    } catch {
      // ignore
    }
    sheetCleanup = null;
  }
  $("sheet").classList.remove("open");
  $("sheet").setAttribute("aria-hidden", "true");
  if (!$("ask").classList.contains("open")) $("overlay").classList.remove("open");
  clear($("sheetBody"));
}

export function sheetTitle(kicker, title, sub, tier) {
  return el("div", { class: tier != null ? tierClass(tier) : "" },
    kicker ? el("div", { class: "kicker tc", text: kicker, style: tier == null ? {} : { color: "var(--tier)" } }) : null,
    el("h2", { text: title }),
    sub ? el("div", { class: "muted", text: sub }) : null,
  );
}

export function plural(n, word, pl) {
  return `${n} ${n === 1 ? word : pl || word + "s"}`;
}
