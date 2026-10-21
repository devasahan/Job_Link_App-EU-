/**
 * Word-aware job title matcher shared by extension pages and site tabs.
 * Plain script (no import/export) so it can be injected via
 * chrome.scripting.executeScript({ files }) and also imported for side effects.
 *
 * Text is compared without case or accents in any EU language
 * ("Développeur" = "developpeur", "Straße" = "strasse", "Łódź" = "lodz"), and
 * the EU words for developer and engineer read as the English ones
 * ("Backend-Entwickler", "Développeur Backend", "Programista Backend" all
 * match "Backend Developer").
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

  // Developer and engineer in EU languages, also at the end of compounds
  // ("Softwareentwickler", "Backend-Entwicklerin", "systemutvecklare")
  const ROLE_WORDS = [
    [
      /(?:entwickler(?:innen|in)?|developpeu(?:r|se)s?|desarrollador(?:a|es|as)?|desenvolvedor(?:a|es|as)?|sviluppat(?:ore|rice|ori)|ontwikkelaars?|programist(?:a|ka|ki|y)|vyvojar(?:ka|i)?|utvecklare|udvikler(?:e)?|utvikler(?:e)?|kehittaja(?:t)?|fejleszto(?:k)?|dezvoltator(?:i)?|προγραμματιστ\p{L}*)(?![\p{L}\p{N}])/gu,
      " developer",
    ],
    [
      /(?<![\p{L}\p{N}])(?:ingenieur(?:in|e|s)?|ingeniero|ingegnere|inzynier|ingenjor|ingenior|insinoori|inzenyr|inginer|μηχανικ\p{L}*)(?![\p{L}\p{N}])/gu,
      "engineer",
    ],
  ];

  const PHRASES = [
    [/\bfront end\b/g, "frontend"],
    [/\bback end\b/g, "backend"],
    [/\bfull stack\b/g, "fullstack"],
    [/\bdev ops\b/g, "devops"],
    [/\bartificial intelligence\b/g, "ai"],
    [/\bmachine learning\b/g, "ml"],
    [/\b(react|node|vue|angular)(?: ?js)\b/g, "$1"],
    // Next/Nest/Express are everyday words: keep the .js form distinct
    [/\b(next|nest|express)(?: ?js)\b/g, "$1js"],
    [/\bobjective c\b/g, "objectivec"],
    // ".NET" and "dotnet" become "dotnet" in normalize(); staffing ads say "Dot Net"
    [/\bdot net\b/g, "dotnet"],
    [/\bgolang\b/g, "go"],
  ];

  const WORDS = {
    sr: "senior",
    snr: "senior",
    jr: "junior",
    eng: "engineer",
    engr: "engineer",
    dev: "developer",
    swe: "software engineer",
    postgresql: "postgres",
    k8s: "kubernetes",
    springboot: "spring boot",
  };

  function normalize(text) {
    let s = fold(text)
      // ".NET" / "ASP.NET" before punctuation goes ("net" alone is a word)
      .replace(/\.net\b/g, " dotnet")
      // "React+Redux" is two words; "C++" stays one
      .replace(/(\p{L})\+(?=\p{L})/gu, "$1 ");
    for (const [re, rep] of ROLE_WORDS) s = s.replace(re, rep);
    s = s.replace(/[^\p{L}\p{N}+#]+/gu, " ").trim();
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

  /** "Backend Developer, Platform Engineer": either title. Empty parts are dropped. */
  function queryPhrases(query) {
    return String(query || "")
      .split(/[,;]/)
      .map(queryTokens)
      .filter((tokens) => tokens.length);
  }

  function tokenInWords(token, words) {
    for (const w of words) {
      if (w === token) return true;
      // engineer → engineering, develop → developer
      if (token.length >= 4 && w.startsWith(token)) return true;
      // German compounds: kubernetes → kubernetesplattform, typescript → typescriptkenntnisse
      if (token.length >= 7 && w.includes(token)) return true;
    }
    return false;
  }

  /** Every word of one comma-separated title is in the job title. */
  function jbTitleMatches(title, query) {
    const phrases = queryPhrases(query);
    if (!phrases.length) return true;
    const words = normalize(title).split(" ");
    return phrases.some((tokens) => tokens.every((t) => tokenInWords(t, words)));
  }

  /**
   * Every stack word must appear as a whole word in the title or description
   * (Go ≠ Google, Java ≠ JavaScript, Node.js = NodeJS = Node).
   */
  function jbStackMatches(job, stack) {
    const tokens = queryTokens(stack);
    if (!tokens.length) return true;
    const words = new Set(
      normalize(`${job?.title || ""} ${job?.description || ""}`).split(" ")
    );
    // "Python3", "C++17": the word plus a version number
    const versioned = (t) =>
      [...words].some((w) => w.startsWith(t) && /^\d+$/.test(w.slice(t.length)));
    // A bare "Express" asks for the framework too ("Express.js" → expressjs);
    // a "Next.js" query still needs the .js form
    const jsForm = (t) => /^(?:next|nest|express)$/.test(t) && words.has(`${t}js`);
    return tokens.every((t) => words.has(t) || versioned(t) || jsForm(t));
  }

  globalThis.jbFold = fold;
  globalThis.jbTitleMatches = jbTitleMatches;
  globalThis.jbTitleQueryTokens = queryTokens;
  globalThis.jbTitleQueryPhrases = queryPhrases;
  /** All normalized words, 1-letter ones included ("C Developer" → c, developer). */
  globalThis.jbNormalizeWords = (text) => normalize(text).split(" ").filter(Boolean);
  globalThis.jbStackMatches = jbStackMatches;
})();
