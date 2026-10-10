// Prints the live national story board: NODE_USE_ENV_PROXY=1 node scripts/check-stories.mjs
import { nationalStories } from "../src/sources/stories.js";

const t0 = Date.now();
const d = await nationalStories({ NWS_USER_AGENT: "WeatherNet/0.1 (check script)" });
const out = [];
out.push(`built in ${Date.now() - t0} ms · level ${d.level} · unavailable: ${d.unavailable.join(", ") || "none"}`);
out.push(`counts ${JSON.stringify(d.counts)}`);
out.push(`spc ${JSON.stringify(d.outlook && { max: d.outlook.max, text: (d.outlook.text || "").slice(0, 160) })}`);
for (const s of d.stories) {
  out.push(`\n[T${s.tier} ${s.lane} ${s.kind}] ${s.kicker} | ${s.title}`);
  out.push(`   place: ${s.place} · radar: ${s.radar?.id} · learn: ${(s.learn || []).join(",")}`);
  if (s.facts) out.push(`   facts: ${s.facts.join(" · ")}`);
  out.push(`   ${String(s.summary).slice(0, 300)}`);
  out.push(`   badges: ${(s.badges || []).map((b) => `${b.label}(${b.tone})`).join(" | ")}`);
  for (const i of (s.items || []).slice(0, 4)) out.push(`   - ${i.type}: ${i.label} · ${i.area || ""} ${i.text ? "· " + String(i.text).slice(0, 90) : ""}`);
}
const m = d.map;
out.push(`\nmap: warnings ${m.warnings.length}, hazards ${m.hazards.length}, watches ${m.watches.length}, outlook ${m.outlook.length}, reports ${m.reports.length}, storms ${m.storms.length}`);
out.push(`json size ${JSON.stringify(d).length} bytes`);
process.stdout.write(out.join("\n") + "\n");
