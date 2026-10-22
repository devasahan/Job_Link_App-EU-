/**
 * Who can take a job, from where the user is: one rule set for every source
 * but Indeed (which applies the same rules itself). Plain script (no
 * import/export) like eligibility.js, whose jbReadPlaces, jbCountriesInUtc
 * and jbOpenToEurope it uses, with residence.js's jbResidenceRequired.
 *
 * A source says what it knows about a job's place as a Where:
 *   workplace   "remote" | "hybrid" | "onsite", or null when it doesn't say
 *   listedIn    ISO code of the country the job is listed in, or null
 *   open        the board's "who may apply" list (codes or names), or null
 *   emptyOpen   what an empty list means on that board: "world", "europe" or null
 *   utc         [lo, hi], the UTC offsets the employer accepts, or null
 *   remoteOnly  the board lists remote jobs only
 *
 * The rules run in order; T is where the user lives, or with that not set the
 * ticked countries:
 *   1. hybrid or on-site → notRemote (with no workplace from the source: the
 *      title, the location and strong description phrases decide);
 *   2. listed in the user's country → inHome;
 *   3. listed in a European country that isn't ticked → elsewhere;
 *   4. listed in the UK, Canada or US not ticked under Employers abroad → abroadOff;
 *   5. a "who may apply" list (or what an empty one means), narrowed by the
 *      time-zone window: none of T → restricted; with home set and the job
 *      saying you must live elsewhere → residentsOnly; else open to the
 *      region or the T countries it names;
 *   6. listed in a ticked European country: with home set the residence
 *      check, else open (Indeed's rule);
 *   7. anything else (outside Europe, plain "Remote"): the posting must say
 *      it hires in Europe (jbOpenToEurope); no signal is closed.
 * `cheap: true` runs only what needs no description (list rows, before the
 * adapter fetches details): what still needs the text comes back open and
 * `pending`.
 */
(function () {
  const fold = (text) =>
    globalThis.jbFold ? globalThis.jbFold(text) : String(text || "").toLowerCase();
  // Not a letter or digit on that side (\b only knows ASCII)
  const NB = "(?<![\\p{L}\\p{N}])";
  const NA = "(?![\\p{L}\\p{N}])";
  const words = (alts, flags = "") => new RegExp(`${NB}(?:${alts})${NA}`, `u${flags}`);

  const ABROAD = ["GB", "CA", "US"];
  const NAMES = { GB: "United Kingdom", CA: "Canada", US: "United States" };
  // How many ticked countries an "Open to" cell names before it counts the rest
  const MAX_NAMES = 6;

  // Folded words. "Hybrid" is a workplace as a tag ("(Hybrid)", "- Hybrid", "Hybrid, Berlin"),
  // not before what it describes ("Hybrid Cloud Engineer", "Hybrid App Developer")
  const HYBRID = "hybrid|hybride|hibrido|ibrido|hybrydow\\p{L}*|hybridni|hibrid";
  const ONSITE =
    "on[\\s-]?site|in[\\s-]office|office[\\s-]based|in[\\s-]person|vor\\s+ort|presencial|presentiel|in\\s+sede|in\\s+presenza|stacjonarn\\p{L}*|op\\s+locatie|pa\\s+plats|paikan\\s+paalla";
  const REMOTE =
    "remote|fully\\s+remote|work\\s+from\\s+home|wfh|home\\s*office|homeoffice|teletravail|telework\\p{L}*|remoto|zdaln\\p{L}*|distanciel|thuiswerk\\p{L}*|etatyo|distansarbete|fjernarbejde";
  const OR = "\\s*(?:/|\\||\\+|,|&|or|oder|ou|o|of|eller|tai|lub|nebo|vagy|sau)\\s*";
  // "Remote or Hybrid", "Hybrid/Remote": the job can be done remotely
  const EITHER_RE = new RegExp(`${NB}(?:(?:${REMOTE})${OR}(?:${HYBRID}|${ONSITE})|(?:${HYBRID}|${ONSITE})${OR}(?:${REMOTE}))${NA}`, "u");
  const HYBRID_TAG_RE = new RegExp(
    `(?:^|[(\\[|,/:;–—-]\\s*|\\s-\\s)(?:${HYBRID})(?:\\s+remote)?(?=\\s*(?:$|[)\\]|,/:;–—-]|\\s+(?:in|from|at|working|role|position|job|days?|\\d)${NA}))`,
    "u"
  );
  const HYBRID_RE = words(HYBRID);
  const ONSITE_RE = words(ONSITE);
  const NOT_REMOTE_RE = words("(?:not|no|non)[\\s-]+remote|remote\\s*:\\s*no");
  const REMOTE_RE = words(REMOTE);

  // Description phrases about this job, not the company's policy ("we offer a hybrid model")
  const JOB = "(?:role|position|job|opportunity|vacancy)";
  const DESC_HYBRID_RE = words(
    `(?:this|the)\\s+${JOB}\\s+(?:is|will\\s+be)\\s+(?:a\\s+)?hybrid|(?:this\\s+is\\s+)an?\\s+hybrid\\s+${JOB}|(?:\\d|one|two|three|four)\\s+days?\\s+(?:a|per|each)\\s+week\\s+(?:in|at|from)\\s+(?:the|our)(?:\\s+[\\p{L}-]+)?\\s+office`
  );
  const DESC_ONSITE_RE = words(
    `(?:this|the)\\s+${JOB}\\s+is\\s+(?:fully\\s+|100%\\s+)?(?:on[\\s-]?site|office[\\s-]based|in[\\s-]office|in[\\s-]person)|this\\s+is\\s+(?:an?\\s+)?(?:on[\\s-]?site|office[\\s-]based|in[\\s-]office|in[\\s-]person)\\s+${JOB}|(?:this\\s+is\\s+)?not\\s+a\\s+remote\\s+${JOB}|(?:remote\\s+work|working\\s+remotely)\\s+is\\s+not\\s+(?:possible|available|an\\s+option)|no\\s+remote\\s+(?:work|option)s?`
  );

  /** "hybrid" | "onsite" | "remote" from one short field (title, location), or null. */
  function fieldWorkplace(text, isTitle) {
    const s = fold(text);
    if (!s) return null;
    if (NOT_REMOTE_RE.test(s)) return "onsite";
    if (EITHER_RE.test(s)) return "remote";
    if (isTitle ? HYBRID_TAG_RE.test(s) : HYBRID_RE.test(s)) return "hybrid";
    if (ONSITE_RE.test(s)) return "onsite";
    if (REMOTE_RE.test(s)) return "remote";
    return null;
  }

  /**
   * Where the job is done, read from the posting when the source doesn't say:
   * the title, then the location, then strong description phrases ("this role
   * is hybrid", "3 days a week in our Berlin office", "this is not a remote
   * position"). `cheap` reads the title and location only.
   * @returns {"hybrid" | "onsite" | "remote" | null}
   */
  function jbWorkplaceFromText(job, { cheap = false } = {}) {
    const fromTitle = fieldWorkplace(job?.title, true);
    if (fromTitle) return fromTitle;
    const fromLocation = fieldWorkplace(job?.location, false);
    if (fromLocation) return fromLocation;
    if (cheap) return null;
    const d = fold(job?.description).slice(0, 20000);
    if (DESC_ONSITE_RE.test(d)) return "onsite";
    if (DESC_HYBRID_RE.test(d)) return "hybrid";
    return null;
  }

  const europeanCodes = () => globalThis.jbCountriesInUtc(-24, 24);
  const nameOf = (code) => globalThis.jbCountryNames(code)[0] || NAMES[code] || code;
  const closed = (reason, why = "") => ({ open: false, reason, why, to: "" });

  /** "Germany, France", or "Germany, France, … +4" for a long list. */
  function namesText(codes) {
    const names = codes.map(nameOf);
    return names.length > MAX_NAMES ? `${names.slice(0, MAX_NAMES - 1).join(", ")} +${names.length - MAX_NAMES + 1}` : names.join(", ");
  }
  const utcText = (n) => `UTC${n < 0 ? "-" : "+"}${Math.abs(n)}`;

  /** The board's "who may apply" list as { codes, label, why }, or null when it has none. */
  function structured(where) {
    if (!Array.isArray(where.open)) return null;
    if (!where.open.length) {
      if (where.emptyOpen === "world") return { codes: europeanCodes(), label: "Worldwide", why: "open worldwide" };
      if (where.emptyOpen === "europe") return { codes: europeanCodes(), label: "Europe", why: "open to Europe" };
      return null;
    }
    const read = globalThis.jbReadPlaces(where.open);
    // Nothing in it that we know: the posting's text decides
    if (!read.codes.length && !read.outside.length) return null;
    const why = where.open.map((p) => (typeof p === "string" ? p : p?.name || p?.alpha2 || "")).filter(Boolean);
    return {
      codes: read.codes,
      label: read.wide,
      why: `open to ${why.slice(0, 4).join(", ")}${why.length > 4 ? ` +${why.length - 4}` : ""}`,
    };
  }

  /** Does the posting say the hire must live somewhere that leaves out home? */
  function residentsOnly(job, listed, home) {
    const check = globalThis.jbResidenceRequired?.(job, { country: listed || "", home });
    return check?.required ? check : null;
  }

  /**
   * @param {{ title?: string, location?: string, company?: string, description?: string }} job
   * @param {{ workplace?: string|null, listedIn?: string|null, open?: Array|null, emptyOpen?: string|null,
   *           utc?: number[]|null, remoteOnly?: boolean }} where
   * @param {{ home?: string, ticked?: string[], abroad?: string[], cheap?: boolean }} opts
   * @returns {{ open: boolean, to: string, reason?: string, why?: string, pending?: boolean }}
   */
  function jbOpenTo(job, where, { home = "", ticked = [], abroad = [], cheap = false } = {}) {
    const w = where || {};
    const T = home ? [home] : ticked;

    // 1. Workplace
    const workplace = w.workplace || jbWorkplaceFromText(job, { cheap });
    if (workplace === "hybrid" || workplace === "onsite") return closed("notRemote", workplace);

    const listed = String(w.listedIn || "").toUpperCase();
    const european = listed && europeanCodes().includes(listed);
    // 2.–4. Listed in a country the user doesn't want
    if (listed && home && listed === home) return closed("inHome", nameOf(listed));
    if (european && !ticked.includes(listed)) return closed("elsewhere", nameOf(listed));
    if (ABROAD.includes(listed) && !abroad.includes(listed)) return closed("abroadOff", nameOf(listed));

    // 5. The board's "who may apply" list, narrowed by the time-zone window
    const list = structured(w);
    if (list) {
      let codes = new Set(list.codes);
      const utc = Array.isArray(w.utc) && w.utc.length === 2 ? w.utc : null;
      if (utc) {
        const inWindow = new Set(globalThis.jbCountriesInUtc(utc[0], utc[1]));
        codes = new Set([...codes].filter((c) => inWindow.has(c)));
      }
      const window = utc ? `${utcText(Math.min(...utc))} to ${utcText(Math.max(...utc))}` : "";
      const covered = T.filter((c) => codes.has(c));
      if (!covered.length) return closed("restricted", window ? `${list.why}, ${window}` : list.why);
      if (home) {
        if (cheap) return { open: true, to: "", pending: true };
        const must = residentsOnly(job, listed, home);
        if (must) return closed("residentsOnly", must.reason);
      }
      // A region covers every T country unless the window cut some out
      const to =
        list.label && covered.length === T.length
          ? list.label
          : list.label
            ? `${list.label === "Worldwide" ? "Europe" : list.label} (${window})`
            : namesText(covered);
      return { open: true, to };
    }

    // 6. Listed in a ticked European country
    if (european) {
      if (home) {
        if (cheap) return { open: true, to: "", pending: true };
        const must = residentsOnly(job, listed, home);
        if (must) return closed("residentsOnly", must.reason);
      }
      return { open: true, to: nameOf(listed) };
    }

    // 7. The posting must say it hires in Europe or a T country
    if (cheap) return { open: true, to: "", pending: true };
    const names = T.flatMap((c) => globalThis.jbCountryNames(c));
    const open = globalThis.jbOpenToEurope(job, names);
    return open.open ? { open: true, to: open.to } : closed("notOpen", open.reason);
  }

  globalThis.jbOpenTo = jbOpenTo;
  globalThis.jbWorkplaceFromText = jbWorkplaceFromText;
})();
