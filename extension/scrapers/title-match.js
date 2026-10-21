/**
 * Word-aware job title matcher shared by extension pages and site tabs.
 * Plain script (no import/export) so it can be injected via
 * chrome.scripting.executeScript({ files }) and also imported for side effects.
 *
 * Text is compared without case or accents in any EU language
 * ("Référent" = "referent", "Straße" = "strasse", "Łódź" = "lodz").
 */
(function () {
  // Letters NFD doesn't split into a base letter + accent
  const FOLD = {
    ß: "ss",
    ł: "l",
    ø: "o",
    æ: "ae",
    œ: "oe",
    đ: "d",
    ı: "i",
    þ: "th",
    ð: "d",
    ħ: "h",
    ŧ: "t",
    // Greek final sigma
    ς: "σ",
  };
  const FOLD_RE = /[ßłøæœđıþðħŧς]/g;

  /** Lowercase without accents: the form every comparison uses. */
  function fold(text) {
    return String(text || "")
      .toLowerCase()
      .replace(FOLD_RE, (c) => FOLD[c])
      .normalize("NFD")
      .replace(/\p{M}+/gu, "");
  }

  const PHRASES = [
    [/\bsearch engine optimi[sz]ation\b/g, "seo"],
    [/\bsearch engine advertising\b/g, "sea"],
    [/\bsearch engine marketing\b/g, "sem"],
    [/\bpay per click\b/g, "ppc"],
    [/\bgoogle adwords\b/g, "google ads"],
    [/\bpublic relations\b/g, "pr"],
    [/\bcustomer relationship management\b/g, "crm"],
    [/\baccount based marketing\b/g, "abm"],
    [/\bgo to market\b/g, "gtm"],
    // "E-Mail-Marketing", "e mail" and "email" are one word
    [/\be mail\b/g, "email"],
  ];

  const WORDS = {
    sr: "senior",
    snr: "senior",
    jr: "junior",
    jnr: "junior",
    mgr: "manager",
    mktg: "marketing",
    comms: "communications",
    adwords: "google ads",
  };

  function normalize(text) {
    let s = fold(text)
      // "SEO+SEA" is two words; "C++" stays one
      .replace(/(\p{L})\+(?=\p{L})/gu, "$1 ")
      .replace(/[^\p{L}\p{N}+#]+/gu, " ")
      .trim();
    s = s
      .split(" ")
      .map((w) => WORDS[w] || w)
      .join(" ");
    for (const [re, rep] of PHRASES) s = s.replace(re, rep);
    return s.replace(/\s+/g, " ").trim();
  }

  function queryTokens(query) {
    const s = normalize(query);
    if (!s) return [];
    return s
      .split(" ")
      .filter((t) => t.length > 1 || /[+#]/.test(t));
  }

  /** "SEO Manager, Content Marketing": either phrase. Empty parts are dropped. */
  function queryPhrases(query) {
    return String(query || "")
      .split(/[,;]/)
      .map(queryTokens)
      .filter((tokens) => tokens.length);
  }

  function tokenInWords(token, words) {
    for (const w of words) {
      if (w === token) return true;
      // market → marketing, kommunikation → kommunikationsmanagerin
      if (token.length >= 4 && w.startsWith(token)) return true;
      // German compounds: marketing → onlinemarketing, produktmarketingmanager
      if (token.length >= 7 && w.includes(token)) return true;
    }
    return false;
  }

  /** Every word of one comma-separated phrase is in the title. */
  function jbTitleMatches(title, query) {
    const phrases = queryPhrases(query);
    if (!phrases.length) return true;
    const words = normalize(title).split(" ");
    return phrases.some((tokens) => tokens.every((t) => tokenInWords(t, words)));
  }

  /**
   * Every skill word must appear as a whole word in the title or description
   * (SEO = search engine optimisation, Google Ads = AdWords, E-Mail = email).
   */
  function jbSkillsMatch(job, skills) {
    const tokens = queryTokens(skills);
    if (!tokens.length) return true;
    const words = new Set(
      normalize(`${job?.title || ""} ${job?.description || ""}`).split(" ")
    );
    // "GA4", "Web3": the word plus a version number
    const versioned = (t) =>
      [...words].some((w) => w.startsWith(t) && /^\d+$/.test(w.slice(t.length)));
    return tokens.every((t) => words.has(t) || versioned(t));
  }

  globalThis.jbFold = fold;
  globalThis.jbTitleMatches = jbTitleMatches;
  globalThis.jbTitleQueryTokens = queryTokens;
  globalThis.jbTitleQueryPhrases = queryPhrases;
  /** All normalized words, 1-letter ones included ("C Developer" → c, developer). */
  globalThis.jbNormalizeWords = (text) => normalize(text).split(" ").filter(Boolean);
  globalThis.jbSkillsMatch = jbSkillsMatch;
})();
