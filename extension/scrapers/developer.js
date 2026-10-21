/**
 * "Is this job title a software-development role?" in EU languages, for runs
 * with no Title. Plain script (no import/export) so it can be injected via
 * chrome.scripting.executeScript({ files }) after title-match.js, whose
 * normalizer it uses: lowercase, no accents, punctuation as spaces, and the
 * EU words for developer and engineer as the English ones ("Softwareentwickler"
 * = "software developer", "Ingénieur logiciel" = "engineer logiciel").
 *
 * A title is a developer role when it names one and nothing makes it another
 * kind of job:
 *   1. never: business developers, property/project developers, HR
 *      "Personalentwickler", sales/solutions/field engineers, other engineering
 *      disciplines (mechanical, civil, electrical…), designers, teaching;
 *   2. developer, programmer, DevOps, SRE, frontend/backend/fullstack, mobile,
 *      QA automation, CTO, tech lead… always count;
 *   3. engineers and architects count next to a software word ("Data
 *      Engineer", "Cloud Architect", "Ingénieur Études et Développement").
 */
(function () {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const inside = (list) => new RegExp(`(?:${list.map(esc).join("|")})`, "u");
  const words = (list) => new RegExp(`(?:^| )(?:${list.map(esc).join("|")})(?= |$)`, "u");
  const pattern = (source) => new RegExp(source, "u");
  const any = (...res) => ({ test: (s) => res.some((re) => re.test(s)) });

  const EXCLUDE = any(
    words([
      "business developer",
      "business development",
      "property developer",
      "real estate developer",
      "personal developer",
      "organisations developer",
      "organisation developer",
      "organizational developer",
      "personnel developer",
      "sales engineer",
      "presales engineer",
      "pre sales engineer",
      "solutions engineer",
      "solution engineer",
      "field engineer",
      "service engineer",
      "field service engineer",
      "sales developer",
      "sales development",
      "developer marketing",
      "developer content",
      "localization engineer",
      "localisation engineer",
      "software support",
      "softwaresupport",
      "software sales",
      "softwarevertrieb",
    ]),
    // Marketing jobs at software companies: "Growth Marketing Manager (AI Software)"
    pattern("(?:^| )(?:marketing|growth|content|brand|communications?) (?:manager|specialist|lead|director|executive)(?= |$)"),
    // German compounds: Projektentwickler (real estate), Produktentwickler (goods)
    pattern("(?:^| )(?:projekt|immobilien|produkt|geschafts|unternehmens|stadt|regional|kompetenz|team)\\p{L}* developer"),
    // Other engineering disciplines
    inside([
      "mechanical",
      "mechatron",
      "civil engineer",
      "structural",
      "electrical",
      "electronics engineer",
      "process engineer",
      "chemical",
      "manufacturing",
      "maintenance",
      "hvac",
      "construction",
      "maschinenbau",
      "elektrotechn",
      "verfahrenstechn",
      "bau engineer",
      "genie civil",
      "biomedical",
      "aerospace",
      "automotive",
      "hardware engineer",
      "pcb",
      "rf engineer",
      "moulding",
      "molding",
    ]),
    // Not building software
    pattern(
      "designer|(?:^| )(?:recruit\\p{L}*|teacher|lecturer|dozent\\p{L}*|trainer|tutor)(?= |$)|(?:^| )(?:sales|account executive|account manager)(?= |$)"
    )
  );

  const STRONG = any(
    inside([
      "developer",
      "programmer",
      "programmierer",
      "programmeur",
      "programador",
      "programmatore",
      "programator",
      "programozo",
      "devops",
      "devsecops",
      "mlops",
      "frontend",
      "backend",
      "fullstack",
      "softwar",
      "logiciel",
      "λογισμικ",
      "oprogramowani",
      "ohjelmisto",
      "anwendungsentwickl",
      "softwareentwickl",
    ]),
    words([
      "full stack",
      "sre",
      "site reliability",
      "sdet",
      "qa automation",
      "test automation",
      "automation tester",
      "ios",
      "android",
      "flutter",
      "react native",
      "unity",
      "unreal",
      "solidity",
      "smart contract",
      "cto",
      "tech lead",
      "technical lead",
      "head of engineering",
      "vp engineering",
      "director of engineering",
      "engineering manager",
      "engineering lead",
      "founding engineer",
      "forward deployed",
      "internal tools",
      "staff engineer",
      "principal engineer",
      "fachinformatiker anwendungsentwicklung",
    ])
  );

  // Engineers and architects count next to a software word ("Data Engineer",
  // "Ingénieur Études et Développement", "Cloud Architect")
  const ROLE = words(["engineer", "engineers", "engineering", "architect", "architekt"]);
  const SOFTWARE = words([
    "developpement",
    "desarrollo",
    "sviluppo",
    "web",
    "mobile",
    "app",
    "apps",
    "api",
    "data",
    "ml",
    "ai",
    "llm",
    "machine",
    "cloud",
    "platform",
    "infrastructure",
    "infra",
    "qa",
    "test",
    "testing",
    "integration",
    "security",
    "application",
    "embedded",
    "firmware",
    "systems",
    "python",
    "java",
    "javascript",
    "typescript",
    "go",
    "rust",
    "ruby",
    "php",
    "scala",
    "kotlin",
    "swift",
    "c#",
    "c++",
    "dotnet",
    "react",
    "angular",
    "vue",
    "node",
    "salesforce",
    "sap",
    "abap",
    "kubernetes",
    "aws",
    "azure",
    "gcp",
    "blockchain",
    "game",
    "games",
    "computer vision",
    "robotics",
    "growth",
    "martech",
    "tools",
    "devtools",
    "backend",
  ]);

  function jbIsDeveloperTitle(title) {
    const s = globalThis.jbNormalizeWords(title).join(" ");
    if (!s || EXCLUDE.test(s)) return false;
    if (STRONG.test(s)) return true;
    return ROLE.test(s) && SOFTWARE.test(s);
  }

  globalThis.jbIsDeveloperTitle = jbIsDeveloperTitle;
})();
