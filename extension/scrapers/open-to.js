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
 *      time-zone window (and, with home not set, by "you must be based in
 *      …"): none of T → restricted; with home set and the job saying you
 *      must live elsewhere → residentsOnly; else open to the region or the T
 *      countries it names;
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

  // Description phrases about this job, not the company's policy ("we offer a hybrid model");
  // "this role is hybrid or remote" can be done remotely
  const JOB = "(?:role|position|job|opportunity|vacancy)";
  const HYBRID_SAID = `(?:this|the)\\s+${JOB}\\s+(?:is|will\\s+be)\\s+(?:a\\s+)?hybrid(?!\\s*(?:or|/)\\s*(?:fully\\s+)?remote)|(?:this\\s+is\\s+)an?\\s+hybrid\\s+${JOB}`;
  const OFFICE_DAYS = "(?:\\d|one|two|three|four)\\s+days?\\s+(?:a|per|each)\\s+week\\s+(?:in|at|from)\\s+(?:the|our)(?:\\s+[\\p{L}-]+)?\\s+office";
  const DESC_HYBRID_RE = words(`${HYBRID_SAID}|${OFFICE_DAYS}`);
  // Under a "Remote" location only a plain statement counts: "optional 2 days a week in our office" is still remote
  const DESC_HYBRID_SAID_RE = words(HYBRID_SAID);
  const ONSITE_SAID = `(?:this|the)\\s+${JOB}\\s+is\\s+(?:fully\\s+|100%\\s+)?(?:on[\\s-]?site|office[\\s-]based|in[\\s-]office|in[\\s-]person)|this\\s+is\\s+(?:an?\\s+)?(?:on[\\s-]?site|office[\\s-]based|in[\\s-]office|in[\\s-]person)\\s+${JOB}|(?:this\\s+is\\s+)?not\\s+a\\s+remote\\s+${JOB}`;
  // "No remote work" may only limit where from ("…from outside Germany"): not under a "Remote" location
  const DESC_ONSITE_RE = words(
    `${ONSITE_SAID}|(?:remote\\s+work|working\\s+remotely)\\s+is\\s+not\\s+(?:possible|available|an\\s+option)|no\\s+remote\\s+(?:work|option)s?`
  );
  const DESC_ONSITE_SAID_RE = words(ONSITE_SAID);

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
   * position"). A plain "Remote (Germany)" location is often the board's own
   * label, so the description may still say the job is hybrid or on-site;
   * office days or "no remote work" alone don't overrule it. `cheap` reads
   * the title and location only.
   * @returns {"hybrid" | "onsite" | "remote" | null}
   */
  function jbWorkplaceFromText(job, { cheap = false } = {}) {
    const fromTitle = fieldWorkplace(job?.title, true);
    if (fromTitle) return fromTitle;
    const fromLocation = fieldWorkplace(job?.location, false);
    // Hybrid, on-site, or "Remote or Hybrid" in the location settles it
    if (fromLocation && (fromLocation !== "remote" || EITHER_RE.test(fold(job?.location)))) return fromLocation;
    if (cheap) return fromLocation;
    const d = fold(job?.description).slice(0, 20000);
    if ((fromLocation ? DESC_ONSITE_SAID_RE : DESC_ONSITE_RE).test(d)) return "onsite";
    if ((fromLocation ? DESC_HYBRID_SAID_RE : DESC_HYBRID_RE).test(d)) return "hybrid";
    return fromLocation;
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
      let label = list.label;
      let why = list.why;
      const utc = Array.isArray(w.utc) && w.utc.length === 2 ? w.utc : null;
      const window = utc ? `${utcText(Math.min(...utc))} to ${utcText(Math.max(...utc))}` : "";
      if (utc) {
        const inWindow = new Set(globalThis.jbCountriesInUtc(utc[0], utc[1]));
        codes = new Set([...codes].filter((c) => inWindow.has(c)));
        // A region the window cuts is that region in those hours, whoever T is
        if (label && codes.size < list.codes.length) label = `${label === "Worldwide" ? "Europe" : label} (${window})`;
        why = `${why}, ${window}`;
      }
      // With home unset, "you must be based in Germany" narrows the list the way
      // rule 7 reads the same words (with home set, the residence check below
      // decides); "based in the EU" leaves every European country in
      if (!home && !cheap) {
        const must = residentsOnly(job, listed, "");
        const read = must ? globalThis.jbReadPlaces(must.reason) : null;
        if (read?.codes.length && !read.wide) {
          codes = new Set([...codes].filter((c) => read.codes.includes(c)));
          label = null;
          why = must.reason;
        }
      }
      const covered = T.filter((c) => codes.has(c));
      if (!covered.length) return closed("restricted", why);
      if (home) {
        if (cheap) return { open: true, to: "", pending: true };
        const must = residentsOnly(job, listed, home);
        if (must) return closed("residentsOnly", must.reason);
      }
      return { open: true, to: label || namesText(covered) };
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
