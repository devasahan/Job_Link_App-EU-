/**
 * Countries the popup offers: the 27 EU member states, plus the UK,
 * Switzerland and Norway as extras. Codes are ISO 3166-1 alpha-2 (Greece is
 * GR, not the EU's own "EL").
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
  { code: "GB", name: "United Kingdom" },
];

export const ALL_COUNTRIES = [...EU_COUNTRIES, ...EXTRA_COUNTRIES];
export const EU_CODES = EU_COUNTRIES.map((c) => c.code);

const NAMES = Object.fromEntries(ALL_COUNTRIES.map((c) => [c.code, c.name]));

export function countryName(code) {
  return NAMES[String(code || "").toUpperCase()] || String(code || "");
}

/** Known codes only, upper case, once each, in the popup's order. */
export function cleanCountryCodes(codes) {
  const wanted = new Set((Array.isArray(codes) ? codes : []).map((c) => String(c).toUpperCase()));
  return ALL_COUNTRIES.map((c) => c.code).filter((code) => wanted.has(code));
}

/** "All EU (27)", "All EU (27) + United Kingdom", or "Germany, France". */
export function describeCountries(codes) {
  const list = cleanCountryCodes(codes);
  const allEu = EU_CODES.every((code) => list.includes(code));
  if (!allEu) return list.map(countryName).join(", ");
  const extras = list.filter((code) => !EU_CODES.includes(code)).map(countryName);
  return `All EU (${EU_CODES.length})${extras.length ? ` + ${extras.join(", ")}` : ""}`;
}
