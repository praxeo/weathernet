// Local harness: serves public/ the way Workers Static Assets does and hands
// every other request to the worker's fetch(). Upstream calls are live.
//
//   NODE_USE_ENV_PROXY=1 node scripts/dev-server.mjs      (PORT, default 8787)
//
// Secrets come from the environment or a .dev.vars file (KEY=value lines);
// [vars] come from wrangler.toml. `wrangler dev` is the real thing — this
// exists for headless checks (Playwright) in environments without wrangler.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import proc from "node:process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");

// Cache API stand-in so edge caching behaves as it does in production.
const store = new Map();
const keyOf = (req) => (typeof req === "string" ? req : req.url);
globalThis.caches = {
  default: {
    async match(req) {
      const e = store.get(keyOf(req));
      if (!e || e.exp < Date.now()) return undefined;
      return new Response(e.body.slice(0), { status: e.status, headers: e.headers });
    },
    async put(req, res) {
      const m = /max-age=(\d+)/.exec(res.headers.get("cache-control") || "");
      store.set(keyOf(req), {
        status: res.status,
        body: await res.arrayBuffer(),
        headers: [...res.headers],
        exp: Date.now() + (m ? Number(m[1]) : 60) * 1000,
      });
    },
  },
};

function tomlVars(file) {
  const out = {};
  let inVars = false;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) { inVars = line === "[vars]"; continue; }
    if (!inVars || !line || line.startsWith("#")) continue;
    const m = /^([A-Z0-9_]+)\s*=\s*"(.*)"\s*$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function devVars(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const SECRET_NAMES = [
  "FIREWORKS_API_KEY", "MODEL_API_KEY", "AIRNOW_API_KEY", "ELEVENLABS_API_KEY",
  "X_BEARER_TOKEN", "YOUTUBE_API_KEY", "WINDY_API_KEY",
];
const env = { ...tomlVars(path.join(ROOT, "wrangler.toml")), ...devVars(path.join(ROOT, ".dev.vars")) };
for (const k of SECRET_NAMES) if (proc.env[k]) env[k] = proc.env[k];

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain",
};

async function staticFile(pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC) || !existsSync(file)) return null;
  try {
    return { body: await readFile(file), type: TYPES[path.extname(file)] || "application/octet-stream" };
  } catch {
    return null; // a directory, not a file
  }
}

// WORKER_ENTRY points the harness at another entry module (e.g. one with
// stubbed sources) without touching src/.
const entry = proc.env.WORKER_ENTRY ? path.resolve(proc.env.WORKER_ENTRY) : path.join(ROOT, "src/index.js");
const { default: worker } = await import(entry);
env.ASSETS = {
  async fetch(req) {
    const f = await staticFile(new URL(req.url).pathname);
    return f ? new Response(f.body, { headers: { "content-type": f.type } }) : new Response("Not found", { status: 404 });
  },
};
const ctx = { waitUntil: (p) => Promise.resolve(p).catch(() => {}), passThroughOnException() {} };

const port = Number(proc.env.PORT || 8787);
http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${port}`);
      if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
        const f = await staticFile(url.pathname);
        if (f) {
          res.writeHead(200, { "content-type": f.type, "cache-control": "no-cache" });
          res.end(f.body);
          return;
        }
      }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request(url, { method: req.method, headers: req.headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : body });
      const response = await worker.fetch(request, env, ctx);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) {
        for await (const chunk of response.body) res.write(chunk);
      }
      res.end();
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String((err && err.stack) || err));
    }
  })
  .listen(port, () => {
    // console may be unreliable inside harnesses; stdout write is enough here.
    proc.stdout.write(`WeatherNet dev server on http://localhost:${port}\n`);
  });
