/**
 * A source id → its adapter's run(ctx). Each module is imported on first use,
 * from the `module` path in its sources.js entry, so the popup (which reads
 * the registry) never loads an adapter, and adding a source touches only its
 * registry object.
 */

import { sourceById } from "./sources.js";
import { SourceError } from "./http.js";

const loaded = new Map();

/** @param {string | object} source  an id or a registry entry */
export async function loadAdapter(source) {
  const meta = typeof source === "string" ? sourceById(source) : source;
  if (!meta || meta.pending || !meta.module) {
    throw new SourceError("skipped", "not available in this version");
  }
  const href = new URL(meta.module, import.meta.url).href;
  if (!loaded.has(href)) loaded.set(href, import(href));
  let mod;
  try {
    mod = await loaded.get(href);
  } catch (err) {
    loaded.delete(href);
    throw new Error(`adapter ${meta.module} failed to load: ${err?.message || err}`);
  }
  if (typeof mod.run !== "function") throw new Error(`adapter ${meta.module} has no run(ctx)`);
  return mod.run;
}
