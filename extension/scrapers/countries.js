/**
 * Countries the popup offers: the 27 EU member states, plus Norway and
 * Switzerland as extras, where a remote job may be based; and the UK, Canada
 * and the US as employers abroad, whose remote jobs count when they say they
 * hire in Europe. Codes are ISO 3166-1 alpha-2 (Greece is GR, not the EU's
 * own "EL").
 */

export const EU_COUNTRIES = [
  { code: "AT", name: "Austria" },
  { code: "BE", name: "Belgium" },
  { code: "BG", name: "Bulgaria" },
  { code: "HR", name: "Croatia" },
  { code: "CY", name: "Cyprus" },
  { code: "CZ", name: "Czechia" },
  { code: "DK", name: "Denmark" },
  { code: "EE", name: "Estonia" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "DE", name: "Germany" },
  { code: "GR", name: "Greece" },
  { code: "HU", name: "Hungary" },
  { code: "IE", name: "Ireland" },
  { code: "IT", name: "Italy" },
  { code: "LV", name: "Latvia" },
  { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" },
  { code: "MT", name: "Malta" },
  { code: "NL", name: "Netherlands" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "RO", name: "Romania" },
  { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" },
  { code: "ES", name: "Spain" },
  { code: "SE", name: "Sweden" },
];

export const EXTRA_COUNTRIES = [
  { code: "NO", name: "Norway" },
  { code: "CH", name: "Switzerland" },
];

/** Employers abroad: their remote jobs count when open to Europe or a ticked country. */
export const ABROAD_COUNTRIES = [
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "US", name: "United States" },
];

export const ALL_COUNTRIES = [...EU_COUNTRIES, ...EXTRA_COUNTRIES];
export const EU_CODES = EU_COUNTRIES.map((c) => c.code);
export const ABROAD_CODES = ABROAD_COUNTRIES.map((c) => c.code);

const NAMES = Object.fromEntries([...ALL_COUNTRIES, ...ABROAD_COUNTRIES].map((c) => [c.code, c.name]));

export function countryName(code) {
  return NAMES[String(code || "").toUpperCase()] || String(code || "");
}

// The country's own name(s), as postings abroad may write it ("based in Deutschland")
const LOCAL_NAMES = {
  AT: ["Österreich"],
  BE: ["België", "Belgique", "Belgien"],
  BG: ["България"],
  HR: ["Hrvatska"],
  CY: ["Κύπρος"],
  CZ: ["Czech Republic", "Česko", "Česká republika"],
  DK: ["Danmark"],
  EE: ["Eesti"],
  FI: ["Suomi"],
  DE: ["Deutschland"],
  GR: ["Ελλάδα", "Hellas"],
  HU: ["Magyarország"],
  IE: ["Éire"],
  IT: ["Italia"],
  LV: ["Latvija"],
  LT: ["Lietuva"],
  LU: ["Lëtzebuerg", "Luxemburg"],
  NL: ["Nederland", "The Netherlands", "Holland"],
  PL: ["Polska"],
  RO: ["România"],
  SK: ["Slovensko"],
  SI: ["Slovenija"],
  ES: ["España"],
  SE: ["Sverige"],
  NO: ["Norge"],
  CH: ["Schweiz", "Suisse", "Svizzera"],
};

// Other names a board may write for a country it lists a job in
const ALIASES = {
  GB: ["UK", "Great Britain", "Britain", "England", "Scotland", "Wales", "Northern Ireland"],
  US: ["USA", "U.S.", "U.S.A.", "United States of America", "America"],
  CZ: ["Czech"],
  GR: ["EL"],
  IE: ["Republic of Ireland"],
  NL: ["Holland"],
};
const foldName = (text) =>
  String(text || "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
let byName = null;

/**
 * The ISO code of a country a board names: a code ("de", "UK", "EL") or a name
 * in English or its own language ("Germany", "Deutschland", "The Netherlands",
 * "USA"). Only the popup's countries and the employers abroad; "" otherwise.
 */
export function countryCode(text) {
  if (!byName) {
    byName = new Map();
    for (const [code, name] of Object.entries(NAMES)) {
      for (const n of [code, name, ...(LOCAL_NAMES[code] || []), ...(ALIASES[code] || [])]) {
        byName.set(foldName(n), code);
        byName.set(foldName(n).replace(/\./g, ""), code);
      }
    }
  }
  const key = foldName(text);
  return byName.get(key) || byName.get(key.replace(/\./g, "")) || "";
}

/** English and local names of a country. */
export function countryNames(code) {
  const key = String(code || "").toUpperCase();
  return [NAMES[key], ...(LOCAL_NAMES[key] || [])].filter(Boolean);
}

/** Known codes only, upper case, once each, in the popup's order. */
export function cleanCountryCodes(codes, list = ALL_COUNTRIES) {
  const wanted = new Set((Array.isArray(codes) ? codes : []).map((c) => String(c).toUpperCase()));
  return list.map((c) => c.code).filter((code) => wanted.has(code));
}

export const cleanAbroadCodes = (codes) => cleanCountryCodes(codes, ABROAD_COUNTRIES);

/** "All EU (27)", "All EU (27) + Norway", or "France, Germany". */
export function describeCountries(codes) {
  const list = cleanCountryCodes(codes);
  const allEu = EU_CODES.every((code) => list.includes(code));
  if (!allEu) return list.map(countryName).join(", ");
  const extras = list.filter((code) => !EU_CODES.includes(code)).map(countryName);
  return `All EU (${EU_CODES.length})${extras.length ? ` + ${extras.join(", ")}` : ""}`;
}
