/**
 * RSS 2.0, RDF and Atom feeds by string scanning (indexOf, no DOMParser), so
 * adapters run the same in the runner page and in Node tests, and a 2 MB feed
 * parses in a few milliseconds. Each item's direct children are read once:
 * CDATA is kept as written, entities (XML, common HTML, numeric) are decoded,
 * namespaced tags ("job_listing:location", "dc:creator", "content:encoded")
 * keep their prefix. Text that holds escaped HTML ("&lt;p&gt;") comes back as
 * HTML for stripHtml(); child elements inside a field (Atom's
 * <author><name>) are reduced to their text.
 */

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  euro: "€",
  pound: "£",
  copy: "©",
  reg: "®",
  trade: "™",
  times: "×",
  laquo: "«",
  raquo: "»",
};

const ENTITY_RE = /&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,8});/g;

/** "&amp;lt;p&amp;gt;" → "&lt;p&gt;"; unknown names stay as written. */
export function decodeEntities(text) {
  return String(text || "").replace(ENTITY_RE, (m, name) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? m;
  });
}

// "<" can't be inside a tag: stopping there keeps a stray "<" from rescanning the rest
const TAG_RE = /<[^<>]*>/g;

/** A field's text: CDATA as written, outside it tags dropped and entities decoded. */
function textOf(raw) {
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const start = raw.indexOf("<![CDATA[", i);
    if (start < 0) {
      out += decodeEntities(raw.slice(i).replace(TAG_RE, ""));
      break;
    }
    out += decodeEntities(raw.slice(i, start).replace(TAG_RE, ""));
    const end = raw.indexOf("]]>", start + 9);
    out += raw.slice(start + 9, end < 0 ? raw.length : end);
    i = end < 0 ? raw.length : end + 3;
  }
  return out.trim();
}

const isNameEnd = (c) =>
  c === undefined || c === ">" || c === "/" || c === " " || c === "\n" || c === "\t" || c === "\r" || c === "<";

/**
 * Index just past the start tag that begins at `at` (quotes may hold ">").
 * A "<" ends a broken tag: XML allows none inside one, and every scan stays
 * short, so malformed input can't make parsing quadratic.
 */
function startTagEnd(xml, at) {
  let quote = "";
  for (let i = at + 1; i < xml.length; i++) {
    const c = xml[i];
    if (c === "<") return i;
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ">") return i + 1;
  }
  return xml.length;
}

const ATTR_RE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function attrsOf(tag) {
  const attrs = {};
  for (const m of tag.matchAll(ATTR_RE)) attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? "");
  return attrs;
}

/** Where the element named `name` that opened before `from` closes: [innerEnd, after]. */
function closeOf(xml, from, name, limit) {
  let depth = 1;
  let i = from;
  while (i < limit) {
    const lt = xml.indexOf("<", i);
    if (lt < 0 || lt >= limit) break;
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      i = end < 0 ? limit : end + 3;
      continue;
    }
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      i = end < 0 ? limit : end + 3;
      continue;
    }
    if (xml[lt + 1] === "/" && xml.startsWith(name, lt + 2) && isNameEnd(xml[lt + 2 + name.length])) {
      if (--depth === 0) {
        const gt = xml.indexOf(">", lt);
        return [lt, gt < 0 ? limit : gt + 1];
      }
      i = lt + 2;
      continue;
    }
    if (xml.startsWith(name, lt + 1) && isNameEnd(xml[lt + 1 + name.length])) {
      const end = startTagEnd(xml, lt);
      if (xml[end - 2] !== "/") depth += 1;
      i = end;
      continue;
    }
    i = lt + 1;
  }
  return [limit, limit];
}

/** The direct children of one element's inner XML: [{ name, attrs, raw }]. */
function children(xml, from, to) {
  const out = [];
  let i = from;
  while (i < to) {
    const lt = xml.indexOf("<", i);
    if (lt < 0 || lt >= to) break;
    const next = xml[lt + 1];
    if (next === "!" || next === "?") {
      const close = xml.startsWith("<![CDATA[", lt) ? "]]>" : xml.startsWith("<!--", lt) ? "-->" : ">";
      const end = xml.indexOf(close, lt + 2);
      i = end < 0 ? to : end + close.length;
      continue;
    }
    if (next === "/") {
      i = lt + 2;
      continue;
    }
    let j = lt + 1;
    while (j < to && !isNameEnd(xml[j])) j++;
    const name = xml.slice(lt + 1, j);
    if (!name) {
      i = lt + 1;
      continue;
    }
    const tagEnd = startTagEnd(xml, lt);
    const attrs = attrsOf(xml.slice(j, tagEnd - 1));
    if (xml[tagEnd - 2] === "/") {
      out.push({ name, attrs, raw: "" });
      i = tagEnd;
      continue;
    }
    const [innerEnd, after] = closeOf(xml, tagEnd, name, to);
    out.push({ name, attrs, raw: xml.slice(tagEnd, innerEnd) });
    i = after;
  }
  return out;
}

/** Each `<tag …>…</tag>` block, as [innerStart, innerEnd] (not inside comments or CDATA). */
function blocks(xml, tag) {
  const out = [];
  let i = 0;
  while (i < xml.length) {
    const at = xml.indexOf("<", i);
    if (at < 0) break;
    if (xml.startsWith("<!--", at) || xml.startsWith("<![CDATA[", at)) {
      const close = xml[at + 2] === "-" ? "-->" : "]]>";
      const end = xml.indexOf(close, at + 4);
      i = end < 0 ? xml.length : end + close.length;
      continue;
    }
    if (!xml.startsWith(tag, at + 1) || !isNameEnd(xml[at + 1 + tag.length])) {
      i = at + 1;
      continue;
    }
    const start = startTagEnd(xml, at);
    const [innerEnd, after] = closeOf(xml, start, tag, xml.length);
    out.push([start, innerEnd]);
    i = after;
  }
  return out;
}

function itemOf(xml, [from, to]) {
  const fields = {};
  const values = {};
  const attrs = {};
  const links = [];
  const categories = [];
  for (const child of children(xml, from, to)) {
    const text = child.attrs.type === "xhtml" ? child.raw.trim() : textOf(child.raw);
    if (!(child.name in fields)) {
      fields[child.name] = text;
      attrs[child.name] = child.attrs;
    }
    (values[child.name] ||= []).push(text);
    if (child.name === "link" && child.attrs.href) links.push(child.attrs);
    if (child.name === "category") categories.push(text || child.attrs.term || child.attrs.label || "");
  }
  // Atom: the alternate link; RSS: the link's text
  const alternate = links.find((l) => !l.rel || l.rel === "alternate") || links[0];
  const pick = (...names) => names.map((n) => fields[n]).find((v) => v) || "";
  return {
    title: pick("title"),
    link: alternate?.href || pick("link") || (attrs.guid?.isPermaLink !== "false" ? pick("guid") : ""),
    guid: pick("guid", "id"),
    date: pick("pubDate", "published", "updated", "dc:date", "a10:updated"),
    description: pick("description", "summary"),
    content: pick("content:encoded", "content"),
    author: pick("dc:creator", "author"),
    categories: categories.filter(Boolean),
    fields,
    values,
    attrs,
  };
}

/**
 * @returns {{ kind: "rss" | "atom" | "rdf" | "", title: string, items: object[] }}
 * kind is "" when the text is no feed at all (an HTML page, an error).
 * Each item: { title, link, guid, date, description, content, author,
 * categories, fields: { tag: first text }, values: { tag: [texts] }, attrs: { tag: {…} } }.
 */
export function parseFeed(xml) {
  const text = String(xml || "");
  const head = text.slice(0, 2000);
  const kind = /<rss[\s>]/.test(head)
    ? "rss"
    : /<feed[\s>]/.test(head)
      ? "atom"
      : /<rdf:RDF[\s>]/.test(head)
        ? "rdf"
        : "";
  const tag = kind === "atom" ? "entry" : "item";
  const items = kind ? blocks(text, tag).map((b) => itemOf(text, b)) : [];
  const titleAt = text.indexOf("<title");
  let title = "";
  if (kind && titleAt >= 0) {
    const start = startTagEnd(text, titleAt);
    title = textOf(text.slice(start, closeOf(text, start, "title", text.length)[0]));
  }
  return { kind, title, items };
}

/** A feed date ("Wed, 21 Oct 2026 10:00:00 +0000", ISO) as ISO, or "". */
export function feedDate(value) {
  const t = Date.parse(String(value || "").trim());
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
}
