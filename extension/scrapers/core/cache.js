/**
 * A TTL cache in chrome.storage.local, for answers a source may fetch only so
 * often (Jobicy: at most one poll an hour) and for robots.txt (a day). Each
 * entry is its own storage key ("jbcache:<scope>:<key>" → { v, exp }), so a
 * scope can be cleared without reading the rest. Without chrome.storage (Node
 * tests, a page without the extension) it keeps entries in memory.
 */

const PREFIX = "jbcache:";

/** An in-memory stand-in for chrome.storage.local (tests, or no extension). */
export function memoryStorage() {
  const data = new Map();
  return {
    async get(keys) {
      if (keys == null) return Object.fromEntries(data);
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => data.has(k)).map((k) => [k, data.get(k)]));
    },
    async set(values) {
      for (const [k, v] of Object.entries(values)) data.set(k, structuredClone(v));
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
    },
  };
}

let fallback = null;
const defaultStorage = () => globalThis.chrome?.storage?.local || (fallback ||= memoryStorage());

/**
 * @param {{ storage?: object, scope?: string, now?: () => number }} [opts]
 * get(key) → the value, or undefined when missing or expired
 * set(key, value, ttlMs)
 * wrap(key, ttlMs, fn) → the cached value, or fn()'s result, cached
 * scope(name) → a cache whose keys live under that name
 * clear() → removes this scope's entries (all of them for the root cache)
 */
export function createCache({ storage, scope = "", now = Date.now } = {}) {
  const store = () => storage || defaultStorage();
  const base = `${PREFIX}${scope ? `${scope}:` : ""}`;
  const keyOf = (key) => `${base}${key}`;

  async function get(key) {
    try {
      const k = keyOf(key);
      const { [k]: entry } = await store().get(k);
      if (!entry || typeof entry !== "object") return undefined;
      if (!(entry.exp > now())) {
        await store().remove(k);
        return undefined;
      }
      return entry.v;
    } catch {
      // A broken or full storage only costs a fresh fetch
      return undefined;
    }
  }

  async function set(key, value, ttlMs) {
    try {
      await store().set({ [keyOf(key)]: { v: value, exp: now() + ttlMs } });
    } catch {
      // Over quota: the answer is still used, just not kept
    }
  }

  async function wrap(key, ttlMs, fn) {
    const hit = await get(key);
    if (hit !== undefined) return hit;
    const value = await fn();
    await set(key, value, ttlMs);
    return value;
  }

  async function clear() {
    const all = await store().get(null);
    const keys = Object.keys(all || {}).filter((k) => k.startsWith(base));
    if (keys.length) await store().remove(keys);
    return keys.length;
  }

  return {
    get,
    set,
    wrap,
    clear,
    scope: (name) => createCache({ storage, scope: scope ? `${scope}:${name}` : name, now }),
  };
}
