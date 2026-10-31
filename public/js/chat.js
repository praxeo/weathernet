// Ask WeatherNet: the weatherchat agent (/api/chat, streamed) in a side
// panel. One persistent conversation; tool progress shows as chips; when the
// model looks up cameras, the cameras it found appear under its answer.
import { $, el, clear, getJSON, store } from "./util.js";
import { state } from "./state.js";
import { renderMarkdown } from "./markdown.js";
import { camTile, openCam } from "./cams.js";

const KEY = "wn.chat.v1";
const MAX_MSGS = 40;
const CHAT_STALL_MS = 75000;
// Your own weather first, as in weatherchat, then the national questions.
const SUGGEST = [
  "What's my forecast for tonight?",
  "Any severe weather risk here in the next 3 days?",
  "How does today compare with the records here?",
  "What's the biggest weather story right now?",
  "Show me cameras near the top story",
  "What are the GOES mesoscale sectors watching?",
];
const TOOL_WORDS = { spc: "SPC", afd: "AFD", wpc: "WPC", qpf: "QPF", cpc: "CPC", nhc: "NHC", metar: "METAR", taf: "TAF", day48: "day 4-8", cams: "cameras" };

let messages = store.get(KEY, []);
let busy = false;

export function initAsk() {
  $("askFab").onclick = openAsk;
  $("askClose").onclick = closeAsk;
  $("askClear").onclick = () => {
    messages = [];
    save();
    paint();
  };
  $("overlay").addEventListener("click", () => {
    if ($("ask").classList.contains("open")) closeAsk();
  });
  const input = $("askInput");
  $("askForm").onsubmit = (e) => {
    e.preventDefault();
    send(input.value);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $("askForm").requestSubmit();
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  });
  paint();
}

export function openAsk() {
  $("ask").classList.add("open");
  $("ask").setAttribute("aria-hidden", "false");
  $("overlay").classList.add("open");
  setTimeout(() => $("askInput").focus(), 200);
  paint();
}

function closeAsk() {
  $("ask").classList.remove("open");
  $("ask").setAttribute("aria-hidden", "true");
  if (!$("sheet").classList.contains("open")) $("overlay").classList.remove("open");
}

export function askAbout(story) {
  openAsk();
  const where = Number.isFinite(story.lat) ? ` (${story.place || ""}, lat ${story.lat.toFixed(2)}, lon ${story.lon.toFixed(2)})` : "";
  send(`Tell me about this: ${story.kicker ? story.kicker + " — " : ""}${story.title}${where}. What's happening, why, and what should I watch for?`);
}

function save() {
  store.set(KEY, messages.slice(-MAX_MSGS).map(({ role, content, trace, cams }) => ({ role, content, trace: (trace || []).map((t) => ({ name: t.name, ok: t.ok })), cams })));
}

function toolLabel(name) {
  return String(name || "tool").split("_").filter((w) => w && w !== "get").map((w) => TOOL_WORDS[w] || w).join(" ");
}

function paint() {
  const log = clear($("askLog"));
  const sug = clear($("askSuggest"));
  if (state.config && state.config.features && state.config.features.llm === false) {
    log.append(el("div", { class: "item" }, el("b", { text: "The AI meteorologist isn't configured on this deployment." }), "Set the provider key (FIREWORKS_API_KEY) as a Worker secret to enable chat and forecast discussions."));
  }
  if (!messages.length) {
    log.append(el("div", { class: "muted", style: { fontSize: "13.5px" } },
      "Ask about anything happening in US weather. Answers come from live NWS, SPC, WPC, NHC and storm-report data, and the model pulls cameras, satellite and records when they help."));
    for (const s of SUGGEST) sug.append(el("button", { class: "chip", text: s, on: { click: () => send(s) } }));
  }
  for (const m of messages) log.append(renderMsg(m));
  log.scrollTop = log.scrollHeight;
}

function renderMsg(m) {
  if (m.role === "user") return el("div", { class: "msg user", text: m.content });
  const box = el("div", { class: "msg bot" });
  const trace = m.trace || [];
  if (trace.length || m.pendingTools?.length) {
    box.append(el("div", { class: "tools" },
      trace.map((t) => el("span", { class: t.ok === false ? "" : "done", text: toolLabel(t.name) })),
      (m.pendingTools || []).map((n) => el("span", { text: `${toolLabel(n)}…` }))));
  }
  if (m.thinking && !m.content) {
    box.append(el("div", { class: "muted", style: { fontSize: "13px" } }, el("span", { class: "typing" }, el("i"), el("i"), el("i")), " ", m.status || "Thinking"));
  }
  if (m.content) {
    const md = el("div", { class: "md" });
    md.innerHTML = renderMarkdown(m.content);
    box.append(md);
  }
  if (m.cams?.length) {
    box.append(el("div", { class: "attach" }, el("div", { class: "muted", style: { fontSize: "12px", marginBottom: "6px" }, text: "Cameras it found:" }),
      el("div", { class: "cam-grid", style: { gridTemplateColumns: "repeat(2, 1fr)" } }, m.cams.slice(0, 6).map((c) => camTile(c, () => openCam(c))))));
  }
  return box;
}

let paintQueued = false;
function schedulePaint() {
  if (paintQueued) return;
  paintQueued = true;
  requestAnimationFrame(() => {
    paintQueued = false;
    const log = $("askLog");
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
    const last = log.lastElementChild;
    const m = messages[messages.length - 1];
    if (last && m) log.replaceChild(renderMsg(m), last);
    if (stick) log.scrollTop = log.scrollHeight;
  });
}

async function attachCams(m, input) {
  const loc = state.loc || {};
  const lat = Number.isFinite(input?.lat) ? input.lat : loc.lat;
  const lon = Number.isFinite(input?.lon) ? input.lon : loc.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  try {
    const d = await getJSON(`/api/cams?lat=${lat}&lon=${lon}&radius=${input?.radius_mi || 60}&limit=${Math.min(8, input?.limit || 6)}&prefer=sky`);
    if (d.cams?.length) {
      m.cams = d.cams;
      schedulePaint();
    }
  } catch {
    // cameras are a bonus
  }
}

async function readStream(resp, m, ac) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let final = null;
  let stall = 0;
  const arm = () => {
    clearTimeout(stall);
    stall = setTimeout(() => ac.abort(), CHAT_STALL_MS);
  };
  const handle = (ev) => {
    if (ev.type === "delta") {
      if (m.thinking) {
        m.thinking = false;
        m.content = "";
      }
      m.content += ev.text || "";
    } else if (ev.type === "reset") {
      m.content = "";
      m.thinking = true;
    } else if (ev.type === "tools") {
      m.pendingTools = (ev.calls || []).map((c) => c.name);
      m.thinking = true;
      m.status = "Pulling " + m.pendingTools.map(toolLabel).join(", ");
    } else if (ev.type === "tool") {
      m.trace.push({ name: ev.name, ok: ev.ok, input: ev.input });
      const i = (m.pendingTools || []).indexOf(ev.name);
      if (i >= 0) m.pendingTools.splice(i, 1);
      if (!m.pendingTools?.length) m.status = "Analyzing";
      if (ev.name === "get_cams_near" && ev.ok) attachCams(m, ev.input);
    } else if (ev.type === "done" || ev.type === "error") {
      final = ev;
      return;
    }
    schedulePaint();
  };
  try {
    for (;;) {
      arm();
      const r = await reader.read();
      if (r.value) buf += decoder.decode(r.value, { stream: true });
      let cut;
      while ((cut = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        for (const line of block.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          let ev = null;
          try {
            ev = JSON.parse(line.slice(6));
          } catch {
            ev = null;
          }
          if (ev && ev.type) handle(ev);
        }
      }
      if (r.done) break;
    }
  } finally {
    clearTimeout(stall);
  }
  return final || { type: "error", error: "The reply stream ended before it finished." };
}

async function send(text) {
  text = String(text || "").trim();
  if (!text || busy) return;
  busy = true;
  $("askSend").disabled = true;
  $("askInput").value = "";
  $("askInput").style.height = "auto";
  messages.push({ role: "user", content: text });
  const pending = { role: "assistant", content: "", thinking: true, trace: [], pendingTools: [] };
  messages.push(pending);
  paint();
  const ac = new AbortController();
  const headerTimer = setTimeout(() => ac.abort(), CHAT_STALL_MS);
  try {
    const outbound = messages.slice(0, -1).slice(-20).map(({ role, content }) => ({ role, content }));
    const loc = state.loc || {};
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: outbound, location: { lat: loc.lat, lon: loc.lon, name: loc.name, office: loc.office }, stream: true }),
      signal: ac.signal,
    });
    clearTimeout(headerTimer);
    const ct = resp.headers.get("content-type") || "";
    let ok;
    let data;
    if (resp.body && ct.includes("text/event-stream")) {
      data = await readStream(resp, pending, ac);
      ok = data.type === "done";
    } else {
      data = await resp.json();
      ok = resp.ok;
    }
    pending.thinking = false;
    pending.pendingTools = [];
    if (!ok) pending.content = `**Error:** ${data.error || "unknown"}${data.details ? "\n\n" + String(data.details).slice(0, 300) : ""}`;
    else pending.content = data.response || pending.content || "(no response)";
  } catch (e) {
    clearTimeout(headerTimer);
    pending.thinking = false;
    pending.content = ac.signal.aborted
      ? `**No response:** the server went quiet for ${Math.round(CHAT_STALL_MS / 1000)} s, so this reply was abandoned. Try again.`
      : `**Network error:** ${e.message}`;
  } finally {
    busy = false;
    $("askSend").disabled = false;
    save();
    paint();
  }
}
