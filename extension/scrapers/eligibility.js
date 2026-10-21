/**
 * Does a remote job at an employer abroad (UK, Canada, US) hire people living
 * in Europe? Plain script (no import/export) so it can be injected via
 * chrome.scripting.executeScript({ files }) after title-match.js.
 *
 * Read on the title, location and description, folded (lowercase, no accents):
 *   - a restriction to the employer's own country ("US only", "must reside in
 *     the United States", "authorized to work in the UK", security clearance)
 *     closes the job, whatever else it says;
 *   - otherwise it is open when it says where it hires: Europe, the EU, EMEA,
 *     worldwide / anywhere, European time zones, or one of the ticked countries
 *     ("Remote (Europe)", "candidates based in Germany", "work from anywhere");
 *   - a job that says neither is closed: most remote jobs there are local.
 */
(function () {
  const fold = (text) =>
    globalThis.jbFold ? globalThis.jbFold(text) : String(text || "").toLowerCase();
  const NB = "(?<![\\p{L}\\p{N}])";
  const NA = "(?![\\p{L}\\p{N}])";

  // Regions that include every EU country
  const REGION = "european union|europe|eu|eea|emea|european economic area";
  const ANYWHERE = "worldwide|world wide|anywhere|global(?:ly)?|international(?:ly)?";
  // The employer's own countries, spelled out ("us" is also the pronoun: the
  // abbreviations are matched case-sensitively on the original text below)
  const HOME = "united states|america|canada|uk|u k|united kingdom|great britain|britain|england|north america";
  const ONLY_TAIL = "(?:[\\s-]+(?:based|resident|residents|citizens?|candidates|applicants|locations?))?[\\s-]+only";
  // "US only", "U.S.-based only", "USA residents only", "authorized to work in the US"
  const US_RES = [
    new RegExp(`(?<![\\p{L}\\p{N}])(?:US|U\\.S\\.?|USA|U\\.S\\.A\\.?)${ONLY_TAIL.replace("only", "(?:[Oo]nly|ONLY)")}(?![\\p{L}\\p{N}])`, "u"),
    /(?:authori[sz]ed|eligible|legally (?:able|permitted|allowed)|right|permission|permitted) to work in (?:the )?(?:US|U\.S\.?|USA)(?![\p{L}\p{N}])/iu,
  ];

  const CLOSED_RES = [
    // "UK only", "Canada-based only", "United States residents only"
    new RegExp(`${NB}(?:${HOME})${ONLY_TAIL}${NA}`, "u"),
    // "must reside in the US", "must be located in one of the following states", "must live in Canada"
    new RegExp(
      `${NB}must\\s+(?:currently\\s+)?(?:be\\s+)?(?:live|living|reside|residing|located|based|a resident)\\s+(?:in|within|of)\\s+(?:the\\s+|one of the following\\s+)?(?:${HOME}|states|provinces|u s states)${NA}`,
      "u"
    ),
    // "authorized to work in the United States", "right to work in the UK"
    new RegExp(
      `${NB}(?:authori[sz]ed|authori[sz]ation|eligible|eligibility|legally (?:able|permitted|allowed)|right|permission|permitted)\\s+to\\s+work\\s+in\\s+(?:the\\s+)?(?:${HOME})${NA}`,
      "u"
    ),
    new RegExp(`${NB}(?:security clearance|us citizen(?:ship)?|u s citizen(?:ship)?|green card holder|ts sci|w 2 only|w2 only)${NA}`, "u"),
  ];

  const OPEN_RES = [
    // "Remote (Europe)", "Remote - EMEA", "remote within the EU", "Remote, worldwide"
    [new RegExp(`${NB}remote\\s*[(\\-–—:,/|]?\\s*(?:in|within|across|from)?\\s*(?:the\\s+)?(${REGION}|${ANYWHERE})${NA}`, "u"), null],
    // "Europe (Remote)", "EMEA - remote", "EU-remote"
    [new RegExp(`${NB}(${REGION})\\s*[(\\-–—:,/|]?\\s*remote${NA}`, "u"), null],
    // "anywhere in Europe", "based in the EU", "located in EMEA", "candidates from Europe"
    [
      new RegExp(
        `${NB}(?:anywhere|based|located|living|residing|reside|live|candidates?|applicants?|engineers?|developers?|people|talent|team members?|hire|hiring|hires|open)(?:\\s+\\p{L}+){0,2}?\\s+(?:in|from|within|across|throughout)\\s+(?:the\\s+)?(${REGION})${NA}`,
        "u"
      ),
      null,
    ],
    // "work from anywhere", "anywhere in the world", "location independent", "fully distributed"
    [new RegExp(`${NB}(work from anywhere|anywhere in the world|location[\\s-]independent|fully distributed|remote[\\s-]first,? worldwide)${NA}`, "u"), "Worldwide"],
    // "European time zones", "CET", "UTC+1", "GMT+2"
    [
      new RegExp(`${NB}(cet|cest|central european time|european time ?zones?|eu time ?zones?|(?:utc|gmt)\\s*\\+\\s*[0-3])${NA}`, "u"),
      "European time zones",
    ],
  ];

  const LABELS = {
    "european union": "EU",
    eu: "EU",
    eea: "EEA",
    "european economic area": "EEA",
    europe: "Europe",
    emea: "EMEA",
  };
  const label = (match) => LABELS[match] || (/anywhere|world|global|international/.test(match) ? "Worldwide" : match);

  /**
   * @param {{ title?: string, location?: string, description?: string }} job
   * @param {string[]} countryNames  ticked countries (English and local names)
   * @returns {{ open: boolean, to: string, reason: string }}
   */
  function jbOpenToEurope(job, countryNames = []) {
    const raw = `${job?.title || ""} \n ${job?.location || ""} \n ${job?.description || ""}`;
    for (const re of US_RES) {
      const m = raw.match(re);
      if (m) return { open: false, to: "", reason: m[0].trim() };
    }
    const text = fold(raw)
      .replace(/[.]/g, " ")
      .replace(/\s+/g, " ");
    for (const re of CLOSED_RES) {
      const m = text.match(re);
      if (m) return { open: false, to: "", reason: m[0].trim() };
    }
    for (const [re, fixed] of OPEN_RES) {
      const m = text.match(re);
      if (m) return { open: true, to: fixed || label(m[1]), reason: m[0].trim() };
    }
    const names = countryNames.map(fold).filter(Boolean).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (names.length) {
      const re = new RegExp(
        `${NB}(?:remote\\s*[(\\-–—:,/|]?\\s*(?:in\\s+)?(${names.join("|")})|(${names.join("|")})\\s*[(\\-–—:,/|]?\\s*remote|(?:based|located|living|residing|reside|live|candidates?|applicants?|hire|hiring|open)\\s+(?:to\\s+)?(?:candidates\\s+)?(?:in|from|within)\\s+(${names.join("|")}))${NA}`,
        "u"
      );
      const m = text.match(re);
      if (m) {
        const name = m[1] || m[2] || m[3];
        return { open: true, to: name.replace(/\b\p{L}/gu, (c) => c.toUpperCase()), reason: m[0].trim() };
      }
    }
    return { open: false, to: "", reason: "" };
  }

  globalThis.jbOpenToEurope = jbOpenToEurope;
})();
