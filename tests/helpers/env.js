/**
 * Browser APIs the extension code expects, for Node tests: a DOMParser that
 * returns text content, and an in-memory chrome.storage.local.
 */

if (typeof globalThis.DOMParser === "undefined") {
  const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  globalThis.DOMParser = class {
    parseFromString(html) {
      const text = String(html)
        .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]*>/g, "")
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
      return { body: { textContent: text } };
    }
  };
}

export function installChromeStorage(initial = {}) {
  const data = { ...initial };
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, data[k]]));
        },
        async set(values) {
          Object.assign(data, structuredClone(values));
        },
        async remove(keys) {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
        },
      },
    },
  };
  return data;
}

installChromeStorage();
