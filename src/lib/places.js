// Human place labels and nearest-radar lookups from the static tables in
// src/data (regenerate with scripts/build-geodata.mjs).
import { PLACES } from "../data/places.js";
import { RADARS } from "../data/radars.js";
import { haversineMi, bearingDeg, compass } from "./net.js";

// Nearest populated place with at least `minPop` people. PLACES is sorted
// largest first, so the scan stops at the first place below the floor.
export function nearestPlace(lat, lon, minPop = 0) {
  let best = null;
  for (const p of PLACES) {
    if (p[4] < minPop) break;
    const d = haversineMi(lat, lon, p[2], p[3]);
    if (!best || d < best.distMi) best = { name: p[0], st: p[1], lat: p[2], lon: p[3], pop: p[4], distMi: d };
  }
  return best;
}

// "near Destin, FL" when a town is close; otherwise distance and direction
// from a city people know ("45 mi SSW of Panama City, FL").
export function describePlace(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const near = nearestPlace(lat, lon);
  if (!near) return null;
  if (near.distMi <= 12) return `near ${near.name}, ${near.st}`;
  const big = nearestPlace(lat, lon, 100000);
  const ref = big && big.distMi <= 150 ? big : near;
  const dir = compass(bearingDeg(ref.lat, ref.lon, lat, lon));
  return `${Math.round(ref.distMi / 5) * 5 || Math.round(ref.distMi)} mi ${dir} of ${ref.name}, ${ref.st}`;
}

export function nearestRadar(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best = null;
  for (const [id, name, rlat, rlon] of RADARS) {
    const d = haversineMi(lat, lon, rlat, rlon);
    if (!best || d < best.distMi) best = { id, name, distMi: Math.round(d) };
  }
  if (!best) return null;
  return {
    ...best,
    loop: `https://radar.weather.gov/ridge/standard/${best.id}_loop.gif`,
    still: `https://radar.weather.gov/ridge/standard/${best.id}_0.gif`,
    page: `https://radar.weather.gov/station/${best.id.toLowerCase()}/standard`,
  };
}

// Distance from a point to the nearest US populated place — a cheap "is this
// near the US?" test for tropical systems over open water.
export function milesToUS(lat, lon) {
  const p = nearestPlace(lat, lon);
  return p ? p.distMi : Infinity;
}
