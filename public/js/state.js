// App-wide state and a tiny event bus. Sections subscribe to what they draw:
//   "location" — the visitor's point changed (local weather, history, cams)
//   "stories"  — a fresh national story board arrived
//   "satellite" — a fresh GOES catalog arrived
import { store } from "./util.js";

const listeners = {};

export const state = {
  config: null,
  loc: store.get("wn.loc", null),
  stories: null,
  satellite: null,
};

export function on(evt, fn) {
  (listeners[evt] = listeners[evt] || []).push(fn);
}

export function emit(evt, data) {
  for (const fn of listeners[evt] || []) {
    try {
      fn(data);
    } catch (e) {
      console.error(`[${evt}]`, e);
    }
  }
}

export function setLocation(loc) {
  state.loc = { lat: +loc.lat, lon: +loc.lon, name: loc.name || null, office: loc.office || null };
  store.set("wn.loc", state.loc);
  emit("location", state.loc);
}

// The story list across sections can reference a story by id.
export function storyById(id) {
  return (state.stories?.stories || []).find((s) => s.id === id) || null;
}
