/**
 * Does a remote job in another EU country (or Norway, Switzerland) say the
 * hire must live, or work remotely from, a place that leaves out the user's
 * country? Plain script (no import/export) so it can be injected via
 * chrome.scripting.executeScript({ files }) after title-match.js, whose
 * folding it uses (lowercase, no accents, "ß" = "ss", Greek final sigma).
 *
 * Only the employer's words count: the title and the description, read one
 * at a time. Indeed's own location field ("Remote", "Homeoffice", "Remote in
 * Deutschland", "Télétravail", a city) is Indeed's, so it is never read.
 *
 * Each place a posting names (a country in the job country's languages or
 * English, in its inflected forms: "innerhalb Deutschlands", "in der
 * Schweiz", "z terenu Polski", "Suomesta käsin", "Magyarországon"; a region:
 * DACH, Benelux, Nordics, CEE; the EU, Europe, the EEA, EMEA or the world; a
 * word for the job's own country: "bundesweit", "territorio nacional",
 * "landelijke functie", "din țară") is read with the words around it:
 *   - required: where the hire lives or works from ("Wohnsitz in
 *     Deutschland", "woonachtig in Nederland", "tu dois résider en France",
 *     "must be based in Ireland", "100% Homeoffice innerhalb Deutschlands",
 *     "remote vanuit Spanje", "deutschlandweit remote", "praca zdalna z
 *     terenu Polski", "von überall in der Schweiz", "Remote (Deutschland)" or
 *     "| Ireland | Remote" in the title, "Location: Sweden, Denmark, Norway",
 *     "candidates residing in the following countries: …", "we cannot hire
 *     outside of Sweden", "dass du in Deutschland wohnst"), near an office
 *     ("Wohnort im Raum München", "within commuting distance of our Dublin
 *     hub", "domicilio entro 50 km da Torino", "een uur reizen van ons
 *     kantoor"), or only on a Swiss or Luxembourg posting that turns away
 *     cross-border commuters ("Grenzgänger leider ausgeschlossen");
 *   - open: the same words with the EU, Europe, the EEA, EMEA, the world,
 *     or a list that names the user's country ("EU-weit remote", "remote aus
 *     ganz Europa", "Remote in Deutschland oder Schweden" for Sweden, "auch
 *     aus dem Ausland"), and cross-border commuters welcome.
 * Not signals: places tied to the company, its clients, products, offices,
 * travel or superlatives ("Sitz in Berlin", "Kunden nur in Deutschland",
 * "nicht nur in Deutschland", "Go-Live in Deutschland", "wir arbeiten remote
 * aus ganz Deutschland", "Sveriges största"), languages ("fließend Deutsch"),
 * a right to work ("Arbeitserlaubnis für Deutschland", "right to work in
 * Ireland"), time zones, perks ("bis zu 30 Tage aus dem EU-Ausland"), a
 * preference ("ideally based in Ireland", "von Vorteil") and anything a
 * negation cancels ("Wohnsitz in Wien nicht zwingend erforderlich", "kein
 * Muss").
 *
 * Text is read a sentence at a time; a line break ends one, as in a list.
 * Any open signal keeps the job; otherwise any required one leaves it out.
 */
(function () {
  const fold = (text) =>
    globalThis.jbFold ? globalThis.jbFold(text) : String(text || "").toLowerCase();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Not a letter or digit on that side (\b only knows ASCII)
  const NB = "(?<![\\p{L}\\p{N}])";
  const NA = "(?![\\p{L}\\p{N}])";
  // Patterns are written folded; Greek final sigma folds to σ. Each runs once on "" when built: V8
  // runs a pattern's first match in its slow interpreter (seconds on a long German sentence for
  // the biggest ones here) and compiles it to native code after that
  const pattern = (source, flags = "") => {
    const re = new RegExp(source.replace(/ς/g, "σ"), `u${flags}`);
    re.test("");
    return re;
  };
  const words = (alts, flags) => pattern(`${NB}(?:${alts})${NA}`, flags);

  // ---- Places ----

  // Country names by language, "|" between forms. "@" marks a form that holds
  // its own preposition (Finnish and Hungarian cases: "Suomessa" = in Finland,
  // "Magyarországról" = from Hungary). Genitives that are mostly company
  // superlatives ("Suomen suurin", "Sveriges största", "Nederlands" = Dutch)
  // and adjectives that are languages ("Czech", "Deutsch") are left out
  const NAMES = {
    AT: { en: "Austria", de: "Österreich|Österreichs|~österreichweit", fr: "Autriche", nl: "Oostenrijk", it: "Austria", es: "Austria", pt: "Áustria", pl: "Austria|Austrii", cs: "Rakousko|Rakouska|Rakousku", hu: "Ausztria|@Ausztriában|@Ausztriából", ro: "Austria|Austriei", el: "Αυστρία|Αυστρίας", sv: "Österrike", da: "Østrig", no: "Østerrike", fi: "Itävalta|@Itävallassa|@Itävallasta|@Itävaltaa" },
    BE: { en: "Belgium", de: "Belgien|Belgiens", fr: "Belgique", nl: "België", it: "Belgio", es: "Bélgica", pt: "Bélgica", pl: "Belgia|Belgii", cs: "Belgie|Belgii", hu: "Belgium|@Belgiumban|@Belgiumból", ro: "Belgia|Belgiei", el: "Βέλγιο|Βελγίου", sv: "Belgien", da: "Belgien", no: "Belgia", fi: "Belgia|@Belgiassa|@Belgiasta" },
    BG: { en: "Bulgaria|България", de: "Bulgarien|Bulgariens", fr: "Bulgarie", nl: "Bulgarije", it: "Bulgaria", es: "Bulgaria", pt: "Bulgária", pl: "Bułgaria|Bułgarii", cs: "Bulharsko|Bulharska|Bulharsku", hu: "Bulgária|@Bulgáriában|@Bulgáriából", ro: "Bulgaria|Bulgariei", el: "Βουλγαρία|Βουλγαρίας", sv: "Bulgarien", da: "Bulgarien", no: "Bulgaria", fi: "Bulgaria|@Bulgariassa|@Bulgariasta" },
    HR: { en: "Croatia|Hrvatska|Hrvatskoj", de: "Kroatien|Kroatiens", fr: "Croatie", nl: "Kroatië", it: "Croazia", es: "Croacia", pt: "Croácia", pl: "Chorwacja|Chorwacji", cs: "Chorvatsko|Chorvatska|Chorvatsku", hu: "Horvátország|@Horvátországban|@Horvátországból", ro: "Croația|Croației", el: "Κροατία|Κροατίας", sv: "Kroatien", da: "Kroatien", no: "Kroatia", fi: "Kroatia|@Kroatiassa|@Kroatiasta" },
    CY: { en: "Cyprus", de: "Zypern|Zyperns", fr: "Chypre", nl: "Cyprus", it: "Cipro", es: "Chipre", pt: "Chipre", pl: "Cypr|Cypru|Cyprze", cs: "Kypr|Kypru", hu: "Ciprus|@Cipruson|@Ciprusról", ro: "Cipru|Ciprului", el: "Κύπρος|Κύπρο|Κύπρου", sv: "Cypern", da: "Cypern", no: "Kypros", fi: "Kypros|@Kyproksella|@Kyprokselta" },
    CZ: { en: "Czechia|Czech Republic", de: "Tschechien|Tschechiens|Tschechische Republik|Tschechischen Republik", fr: "Tchéquie|République tchèque", nl: "Tsjechië", it: "Cechia|Repubblica Ceca", es: "Chequia|República Checa", pt: "Chéquia|Tchéquia|República Checa", pl: "Czechy|Czechach", cs: "Česko|Česka|Česku|Česká republika|České republiky|České republice|ČR", hu: "Csehország|@Csehországban|@Csehországból", ro: "Cehia|Cehiei", el: "Τσεχία|Τσεχίας", sv: "Tjeckien", da: "Tjekkiet", no: "Tsjekkia", fi: "Tšekki|@Tšekissä|@Tšekistä" },
    DK: { en: "Denmark", de: "Dänemark|Dänemarks", fr: "Danemark", nl: "Denemarken", it: "Danimarca", es: "Dinamarca", pt: "Dinamarca", pl: "Dania|Danii", cs: "Dánsko|Dánska|Dánsku", hu: "Dánia|@Dániában|@Dániából", ro: "Danemarca|Danemarcei", el: "Δανία|Δανίας", sv: "Danmark", da: "Danmark", no: "Danmark", fi: "Tanska|@Tanskassa|@Tanskasta|@Tanskaa" },
    EE: { en: "Estonia|Eesti", de: "Estland", fr: "Estonie", nl: "Estland", it: "Estonia", es: "Estonia", pt: "Estónia|Estônia", pl: "Estonia|Estonii", cs: "Estonsko|Estonska|Estonsku", hu: "Észtország|@Észtországban", ro: "Estonia|Estoniei", el: "Εσθονία|Εσθονίας", sv: "Estland", da: "Estland", no: "Estland", fi: "Viro|@Virossa|@Virosta" },
    FI: { en: "Finland", de: "Finnland|Finnlands", fr: "Finlande", nl: "Finland", it: "Finlandia", es: "Finlandia", pt: "Finlândia", pl: "Finlandia|Finlandii", cs: "Finsko|Finska|Finsku", hu: "Finnország|@Finnországban|@Finnországból", ro: "Finlanda|Finlandei", el: "Φινλανδία|Φινλανδίας", sv: "Finland", da: "Finland", no: "Finland", fi: "Suomi|@Suomessa|@Suomesta|@Suomea|@Suomeen|@Suomen alueella|@Suomen alueelta|@Suomen sisällä" },
    FR: { en: "France", de: "Frankreich|Frankreichs", fr: "France|France métropolitaine", nl: "Frankrijk", it: "Francia", es: "Francia", pt: "França", pl: "Francja|Francji", cs: "Francie|Francii", hu: "Franciaország|@Franciaországban|@Franciaországból", ro: "Franța|Franței", el: "Γαλλία|Γαλλίας", sv: "Frankrike", da: "Frankrig", no: "Frankrike", fi: "Ranska|@Ranskassa|@Ranskasta" },
    DE: { en: "Germany", de: "Deutschland|Deutschlands|Bundesrepublik Deutschland|~deutschlandweit", fr: "Allemagne", nl: "Duitsland", it: "Germania", es: "Alemania", pt: "Alemanha", pl: "Niemcy|Niemiec|Niemczech", cs: "Německo|Německa|Německu", hu: "Németország|@Németországban|@Németországból", ro: "Germania|Germaniei", el: "Γερμανία|Γερμανίας", sv: "Tyskland", da: "Tyskland", no: "Tyskland", fi: "Saksa|@Saksassa|@Saksasta|@Saksaa" },
    GR: { en: "Greece|Hellas", de: "Griechenland|Griechenlands", fr: "Grèce", nl: "Griekenland", it: "Grecia", es: "Grecia", pt: "Grécia", pl: "Grecja|Grecji", cs: "Řecko|Řecka|Řecku", hu: "Görögország|@Görögországban", ro: "Grecia|Greciei", el: "Ελλάδα|Ελλάδας|Ελλάδος|Ελλάς|ελληνική επικράτεια|ελληνικής επικράτειας|~πανελλαδικά", sv: "Grekland", da: "Grækenland", no: "Hellas", fi: "Kreikka|@Kreikassa|@Kreikasta" },
    HU: { en: "Hungary", de: "Ungarn|Ungarns", fr: "Hongrie", nl: "Hongarije", it: "Ungheria", es: "Hungría", pt: "Hungria", pl: "Węgry|Węgier|Węgrzech", cs: "Maďarsko|Maďarska|Maďarsku", hu: "Magyarország|@Magyarországon|@Magyarországról|@Magyarországra|@magyarországi|@Magyarország területéről|@Magyarország területén", ro: "Ungaria|Ungariei", el: "Ουγγαρία|Ουγγαρίας", sv: "Ungern", da: "Ungarn", no: "Ungarn", fi: "Unkari|@Unkarissa|@Unkarista" },
    IE: { en: "Ireland|Republic of Ireland|Éire", de: "Irland|Irlands", fr: "Irlande", nl: "Ierland", it: "Irlanda", es: "Irlanda", pt: "Irlanda", pl: "Irlandia|Irlandii", cs: "Irsko|Irska|Irsku", hu: "Írország|@Írországban", ro: "Irlanda|Irlandei", el: "Ιρλανδία|Ιρλανδίας", sv: "Irland", da: "Irland", no: "Irland", fi: "Irlanti|@Irlannissa|@Irlannista" },
    IT: { en: "Italy", de: "Italien|Italiens", fr: "Italie", nl: "Italië", it: "Italia|Penisola", es: "Italia", pt: "Itália", pl: "Włochy|Włoch|Włoszech", cs: "Itálie|Itálii", hu: "Olaszország|@Olaszországban", ro: "Italia|Italiei", el: "Ιταλία|Ιταλίας", sv: "Italien", da: "Italien", no: "Italia", fi: "Italia|@Italiassa|@Italiasta" },
    LV: { en: "Latvia|Latvija", de: "Lettland", fr: "Lettonie", nl: "Letland", it: "Lettonia", es: "Letonia", pt: "Letónia|Letônia", pl: "Łotwa|Łotwie|Łotwy", cs: "Lotyšsko|Lotyšska|Lotyšsku", hu: "Lettország|@Lettországban", ro: "Letonia", el: "Λετονία|Λετονίας", sv: "Lettland", da: "Letland", no: "Latvia", fi: "Latvia|@Latviassa" },
    LT: { en: "Lithuania|Lietuva", de: "Litauen", fr: "Lituanie", nl: "Litouwen", it: "Lituania", es: "Lituania", pt: "Lituânia", pl: "Litwa|Litwie|Litwy", cs: "Litva|Litvy|Litvě", hu: "Litvánia|@Litvániában", ro: "Lituania", el: "Λιθουανία|Λιθουανίας", sv: "Litauen", da: "Litauen", no: "Litauen", fi: "Liettua|@Liettuassa" },
    LU: { en: "Luxembourg|Lëtzebuerg", de: "Luxemburg|Luxemburgs", fr: "Luxembourg", nl: "Luxemburg", it: "Lussemburgo", es: "Luxemburgo", pt: "Luxemburgo", pl: "Luksemburg|Luksemburga|Luksemburgu", cs: "Lucembursko|Lucemburska|Lucembursku", hu: "Luxemburg|@Luxemburgban", ro: "Luxemburg|Luxemburgului", el: "Λουξεμβούργο|Λουξεμβούργου", sv: "Luxemburg", da: "Luxembourg", no: "Luxembourg", fi: "Luxemburg|@Luxemburgissa" },
    MT: { en: "Malta", de: "Malta", fr: "Malte", nl: "Malta", it: "Malta", es: "Malta", pt: "Malta", pl: "Malta|Malcie|Malty", cs: "Malta|Maltě", hu: "Málta|@Máltán", ro: "Malta", el: "Μάλτα|Μάλτας", sv: "Malta", da: "Malta", no: "Malta", fi: "Malta|@Maltalla" },
    NL: { en: "Netherlands|Holland", de: "Niederlande|Niederlanden|Holland", fr: "Pays-Bas|Hollande", nl: "Nederland", it: "Paesi Bassi|Olanda", es: "Países Bajos|Holanda", pt: "Países Baixos|Holanda", pl: "Holandia|Holandii|Niderlandy|Niderlandach", cs: "Nizozemsko|Nizozemska|Nizozemsku", hu: "Hollandia|@Hollandiában", ro: "Țările de Jos|Olanda|Olandei", el: "Ολλανδία|Ολλανδίας|Κάτω Χώρες", sv: "Nederländerna", da: "Holland|Nederlandene", no: "Nederland", fi: "Alankomaat|@Alankomaissa|@Alankomaista|Hollanti|@Hollannissa" },
    PL: { en: "Poland", de: "Polen|Polens", fr: "Pologne", nl: "Polen", it: "Polonia", es: "Polonia", pt: "Polónia|Polônia", pl: "Polska|Polski|Polsce|Polskę", cs: "Polsko|Polska|Polsku", hu: "Lengyelország|@Lengyelországban", ro: "Polonia|Poloniei", el: "Πολωνία|Πολωνίας", sv: "Polen", da: "Polen", no: "Polen", fi: "Puola|@Puolassa|@Puolasta" },
    PT: { en: "Portugal|Portugal Continental", de: "Portugal", fr: "Portugal", nl: "Portugal", it: "Portogallo", es: "Portugal", pt: "Portugal|Portugal Continental", pl: "Portugalia|Portugalii", cs: "Portugalsko|Portugalska|Portugalsku", hu: "Portugália|@Portugáliában", ro: "Portugalia|Portugaliei", el: "Πορτογαλία|Πορτογαλίας", sv: "Portugal", da: "Portugal", no: "Portugal", fi: "Portugali|@Portugalissa|@Portugalista" },
    RO: { en: "Romania", de: "Rumänien|Rumäniens", fr: "Roumanie", nl: "Roemenië", it: "Romania", es: "Rumanía|Rumania", pt: "Roménia|Romênia", pl: "Rumunia|Rumunii", cs: "Rumunsko|Rumunska|Rumunsku", hu: "Románia|@Romániában", ro: "România|României", el: "Ρουμανία|Ρουμανίας", sv: "Rumänien", da: "Rumænien", no: "Romania", fi: "Romania|@Romaniassa" },
    SK: { en: "Slovakia|Slovensko", de: "Slowakei", fr: "Slovaquie", nl: "Slowakije", it: "Slovacchia", es: "Eslovaquia", pt: "Eslováquia", pl: "Słowacja|Słowacji", cs: "Slovensko|Slovenska|Slovensku", hu: "Szlovákia|@Szlovákiában", ro: "Slovacia", el: "Σλοβακία|Σλοβακίας", sv: "Slovakien", da: "Slovakiet", no: "Slovakia", fi: "Slovakia|@Slovakiassa" },
    SI: { en: "Slovenia|Slovenija", de: "Slowenien", fr: "Slovénie", nl: "Slovenië", it: "Slovenia", es: "Eslovenia", pt: "Eslovénia|Eslovênia", pl: "Słowenia|Słowenii", cs: "Slovinsko|Slovinska|Slovinsku", hu: "Szlovénia|@Szlovéniában", ro: "Slovenia", el: "Σλοβενία|Σλοβενίας", sv: "Slovenien", da: "Slovenien", no: "Slovenia", fi: "Slovenia|@Sloveniassa" },
    ES: { en: "Spain", de: "Spanien|Spaniens", fr: "Espagne", nl: "Spanje", it: "Spagna", es: "España|Península", pt: "Espanha", pl: "Hiszpania|Hiszpanii", cs: "Španělsko|Španělska|Španělsku", hu: "Spanyolország|@Spanyolországban", ro: "Spania|Spaniei", el: "Ισπανία|Ισπανίας", sv: "Spanien", da: "Spanien", no: "Spania", fi: "Espanja|@Espanjassa|@Espanjasta" },
    SE: { en: "Sweden", de: "Schweden|Schwedens", fr: "Suède", nl: "Zweden", it: "Svezia", es: "Suecia", pt: "Suécia", pl: "Szwecja|Szwecji", cs: "Švédsko|Švédska|Švédsku", hu: "Svédország|@Svédországban", ro: "Suedia|Suediei", el: "Σουηδία|Σουηδίας", sv: "Sverige", da: "Sverige", no: "Sverige", fi: "Ruotsi|@Ruotsissa|@Ruotsista" },
    NO: { en: "Norway", de: "Norwegen|Norwegens", fr: "Norvège", nl: "Noorwegen", it: "Norvegia", es: "Noruega", pt: "Noruega", pl: "Norwegia|Norwegii", cs: "Norsko|Norska|Norsku", hu: "Norvégia|@Norvégiában", ro: "Norvegia", el: "Νορβηγία|Νορβηγίας", sv: "Norge", da: "Norge", no: "Norge", fi: "Norja|@Norjassa|@Norjasta" },
    CH: { en: "Switzerland", de: "Schweiz|Deutschschweiz|~schweizweit|~gesamtschweizerisch", fr: "Suisse|Suisse romande|Romandie", it: "Svizzera|Ticino", nl: "Zwitserland", es: "Suiza", pt: "Suíça", pl: "Szwajcaria|Szwajcarii", cs: "Švýcarsko|Švýcarska|Švýcarsku", hu: "Svájc|@Svájcban", ro: "Elveția|Elveției", el: "Ελβετία|Ελβετίας", sv: "Schweiz", da: "Schweiz", no: "Sveits", fi: "Sveitsi|@Sveitsissä" },
    // Not where the user can live, but they keep a list going ("Germany, Canada, Spain, France, and the UK")
    GB: { en: "United Kingdom|UK|Great Britain|Britain|England|Scotland|Wales|Northern Ireland", de: "Vereinigtes Königreich|Vereinigten Königreich|Großbritannien|England|Nordirland", fr: "Royaume-Uni|Angleterre|Irlande du Nord", nl: "Verenigd Koninkrijk|Groot-Brittannië|Engeland|Noord-Ierland", it: "Regno Unito|Inghilterra|Irlanda del Nord", es: "Reino Unido|Inglaterra|Irlanda del Norte", pt: "Reino Unido|Inglaterra|Irlanda do Norte", pl: "Wielka Brytania|Wielkiej Brytanii|Anglia|Anglii", cs: "Velká Británie|Velké Británii|Spojené království", hu: "Egyesült Királyság|@Egyesült Királyságban|Nagy-Britannia", ro: "Regatul Unit|Marea Britanie", el: "Ηνωμένο Βασίλειο|Ηνωμένου Βασιλείου", sv: "Storbritannien|England", da: "Storbritannien|England", no: "Storbritannia|England", fi: "Iso-Britannia|Englanti" },
    US: { en: "United States|USA", de: "Vereinigte Staaten|Vereinigten Staaten", fr: "États-Unis", nl: "Verenigde Staten", it: "Stati Uniti", es: "Estados Unidos", pt: "Estados Unidos|EUA", pl: "Stany Zjednoczone|Stanach Zjednoczonych", cs: "Spojené státy", hu: "Egyesült Államok|@Egyesült Államokban", ro: "Statele Unite", el: "ΗΠΑ", sv: "", da: "", no: "", fi: "Yhdysvallat|@Yhdysvalloissa" },
    CA: { en: "Canada", de: "Kanada", nl: "Canada", fr: "Canada", it: "Canada", es: "Canadá", pt: "Canadá", pl: "Kanada|Kanadzie", cs: "Kanada|Kanadě", hu: "Kanada|@Kanadában", ro: "Canada", el: "Καναδάς|Καναδά", sv: "Kanada", da: "Canada", no: "Canada", fi: "Kanada|@Kanadassa" },
    UA: { en: "Ukraine", de: "Ukraine", fr: "Ukraine", nl: "Oekraïne", it: "Ucraina", es: "Ucrania", pt: "Ucrânia", pl: "Ukraina|Ukrainie|Ukrainy", cs: "Ukrajina|Ukrajiny|Ukrajině", hu: "Ukrajna|@Ukrajnában", ro: "Ucraina", el: "Ουκρανία", sv: "Ukraina", da: "Ukraine", no: "Ukraina", fi: "Ukraina|@Ukrainassa" },
    IS: { en: "Iceland", de: "Island", fr: "Islande", nl: "IJsland", it: "Islanda", es: "Islandia", pt: "Islândia", pl: "Islandia|Islandii", cs: "Island", hu: "Izland", ro: "Islanda", el: "Ισλανδία", sv: "Island", da: "Island", no: "Island", fi: "Islanti" },
    LI: { en: "Liechtenstein" },
    XX: { en: "Americas|North America|South America|Latin America|LATAM|Asia|APAC|Middle East|Africa|Australia|India|Japan|Israel|Turkey|Serbia", de: "Amerika|Nordamerika|Lateinamerika|Asien|Afrika|Naher Osten|Türkei|Serbien", fr: "Amérique|Amérique du Nord|Amérique latine|Asie|Afrique|Moyen-Orient|Turquie", es: "América|América Latina|Latinoamérica|Asia|África|Oriente Medio", it: "America|America Latina|Asia|Africa|Medio Oriente", pt: "América|América Latina|Ásia|África|Médio Oriente" },
  };

  // Places that hold every country: the EU, Europe, the EEA, EMEA, the world
  const WIDE = {
    en: "Europe|EU|European Union|EEA|European Economic Area|EFTA|Schengen|EMEA|European countries|European country|Western Europe|world|globe|~worldwide|~globally|~Europe-wide|~pan-European",
    de: "Europa|Europas|Europäische Union|Europäischen Union|EWR|Europäischer Wirtschaftsraum|Europäischen Wirtschaftsraum|EFTA|Welt|~weltweit|~europaweit|~EU-weit",
    fr: "Europe|UE|Union européenne|EEE|Espace économique européen|AELE|monde|pays européen|pays européens",
    nl: "Europa|EU|Europese Unie|EER|Europese Economische Ruimte|wereld|~wereldwijd",
    it: "Europa|UE|Unione Europea|SEE|Spazio economico europeo|AELS|mondo|paese europeo|paesi europei",
    es: "Europa|UE|Unión Europea|EEE|Espacio Económico Europeo|AELC|mundo|país europeo|países europeos",
    pt: "Europa|UE|União Europeia|EEE|Espaço Económico Europeu|Espaço Econômico Europeu|mundo|país europeu|países europeus",
    pl: "Europa|Europy|Europie|UE|Unia Europejska|Unii Europejskiej|Unię Europejską|EOG|świat|świata|świecie",
    cs: "Evropa|Evropy|Evropě|EU|Evropská unie|Evropské unie|Evropské unii|EHP|svět|světa|světě",
    hu: "Európa|@Európában|@Európából|EU|@EU-ban|@EU-ból|Európai Unió|@Európai Unióban|@Európai Unióból|EGT|világ|@világon|@világból",
    ro: "Europa|Europei|UE|Uniunea Europeană|Uniunii Europene|SEE|lume|lumea|lumii",
    el: "Ευρώπη|Ευρώπης|ΕΕ|Ευρωπαϊκή Ένωση|Ευρωπαϊκής Ένωσης|ΕΟΧ|κόσμο|κόσμου|~παγκοσμίως",
    sv: "Europa|EU|EES|Europeiska unionen|världen|hela världen",
    da: "Europa|EU|EØS|Den Europæiske Union|Europæiske Union|verden",
    no: "Europa|EU|EØS|verden",
    fi: "Eurooppa|@Euroopassa|@Euroopasta|@Eurooppaa|EU|@EU-maassa|@EU-maasta|@EU-alueella|@EU-alueelta|ETA|Euroopan unioni|@Euroopan unionissa|@Euroopan unionin alueella|maailma|@maailmalla|@maailmasta|~maailmanlaajuisesti",
  };

  // Parts of Europe: open only to their countries. A bare part in the title
  // is a sales territory ("Solutions Engineer DACH", "Sales Engineer - Nordics")
  const PARTS = [
    ["DACH", "DE AT CH", { en: "DACH|D-A-CH", de: "deutschsprachigen Raum|deutschsprachiger Raum" }],
    ["Benelux", "BE NL LU", { en: "Benelux" }],
    [
      "Nordics",
      "DK FI SE NO IS",
      {
        en: "Nordics|Nordic countries|Nordic region",
        de: "nordischen Ländern|nordische Länder",
        sv: "Norden|nordiska länderna|nordiska länder",
        da: "Norden|nordiske lande",
        no: "Norden|nordiske land|nordiske landene",
        fi: "Pohjoismaat|@Pohjoismaissa|@Pohjoismaista",
        fr: "pays nordiques",
        es: "países nórdicos",
        it: "paesi nordici",
        pt: "países nórdicos",
        nl: "Noordse landen",
      },
    ],
    [
      "Scandinavia",
      "DK SE NO",
      { en: "Scandinavia", de: "Skandinavien", fr: "Scandinavie", es: "Escandinavia", it: "Scandinavia", pt: "Escandinávia", nl: "Scandinavië", pl: "Skandynawia|Skandynawii", sv: "Skandinavien", da: "Skandinavien", no: "Skandinavia", fi: "Skandinavia" },
    ],
    ["Baltics", "EE LV LT", { en: "Baltics|Baltic states|Baltic countries", de: "Baltikum", pl: "kraje bałtyckie" }],
    ["Iberia", "ES PT", { en: "Iberia|Iberian Peninsula", es: "Península Ibérica", pt: "Península Ibérica" }],
    [
      "CEE",
      "PL CZ SK HU RO BG HR SI EE LV LT",
      { en: "CEE|Central and Eastern Europe|Central & Eastern Europe|Eastern Europe", de: "Osteuropa|Mittel- und Osteuropa", pl: "Europa Środkowo-Wschodnia|Europie Środkowo-Wschodniej|Europy Środkowo-Wschodniej" },
    ],
    // Luxembourg and the border regions around it
    ["Greater Region", "LU DE FR BE", { de: "Großregion", fr: "Grande Région" }],
  ];

  // Words for the job's own country ("bundesweit", "territorio nacional", "din țară"); "~" marks
  // an adverb or adjective, which needs no preposition
  const OWN = {
    en: "the country|~nationwide",
    de: "Bundesgebiet|~bundesweit|~landesweit",
    fr: "territoire national|territoire français",
    es: "territorio nacional|territorio español",
    it: "territorio nazionale|territorio italiano",
    pt: "território nacional|território português",
    nl: "~landelijke|~landelijk",
    pl: "kraju|całego kraju|cały kraj|całym kraju",
    cs: "celé republiky|celé republice|~celorepublikově",
    hu: "@az ország bármely pontjáról|@országon belül|@az ország területén",
    ro: "țară|țara|țării",
    sv: "~rikstäckande",
    da: "~landsdækkende",
    no: "~landsdekkende|~landsomfattende",
    fi: "@koko maassa|~valtakunnallinen|~valtakunnallisesti",
  };

  // The languages postings on a country's sites are written in (English everywhere)
  const NORDIC = ["sv", "da", "no"];
  const LANGS = {
    AT: ["de"],
    BE: ["fr", "nl", "de"],
    BG: [],
    CH: ["de", "fr", "it"],
    CY: ["el"],
    CZ: ["cs"],
    DE: ["de"],
    DK: NORDIC,
    EE: [],
    ES: ["es"],
    FI: ["fi", "sv"],
    FR: ["fr"],
    GR: ["el"],
    HR: [],
    HU: ["hu"],
    IE: [],
    IT: ["it"],
    LT: [],
    LU: ["fr", "de"],
    LV: [],
    MT: [],
    NL: ["nl"],
    NO: NORDIC,
    PL: ["pl"],
    PT: ["pt"],
    RO: ["ro"],
    SE: NORDIC,
    SI: [],
    SK: ["cs"],
  };
  const ALL_LANGS = ["de", "fr", "nl", "it", "es", "pt", "pl", "cs", "hu", "ro", "el", "sv", "da", "no", "fi"];
  // Cross-border commuters on a Swiss or Luxembourg posting live here
  const BORDER = { CH: "CH DE FR IT AT LI", LU: "LU DE FR BE" };

  // ---- Words around a place (written folded: lowercase, no accents) ----

  // Remote work: "remote", "Homeoffice", "mobiles Arbeiten", "télétravail", "praca zdalna", "távmunka"…
  const REMOTE =
    "remote|remotely|home[\\s-]?office|home\\s+working|homeworking|work(?:ing)?\\s+from\\s+home|wfh|telework\\p{L}*|telecommut\\p{L}*|mobile[sn]?\\s+arbeit\\p{L}*|mobil\\s+arbeiten|mobile\\s+work\\p{L}*|teletravail\\p{L}*|teletrabaj\\p{L}*|a\\s+distancia|remot[oa]s?|remotamente|smart\\s+working|lavoro\\s+agile|telelavoro|teletrabalho|thuiswerk\\p{L}*|thuis\\s+werken|telewerk\\p{L}*|op\\s+afstand|distans\\p{L}*|fjernarbe\\p{L}*|hjemmefra|etana|etatyo\\p{L}*|etatoi\\p{L}*|zdaln\\p{L}*|na\\s+dalku|tavmunk\\p{L}*|la\\s+distanta|telemunca|τηλεργασι\\p{L}*|απομακρυσμεν\\p{L}*";
  // Where the hire lives: "Wohnsitz", "woonachtig", "bosatt", "résider", "residencia", "zamieszkania"…
  const RESIDE =
    "based|located|living|live|lives|reside|resides|residing|resident|residents|residence|residency|domiciled|wohnhaft|wohnst|wohnen|wohnt|wohnsitz|hauptwohnsitz|wohnort|lebst|lebt|ansassig|woonachtig|woont|woon|wonen|woonplaats|bosatt|bosatta|bor|bo|boende|bopael|bosat|asuinpaikka\\p{L}*|asut|asua|asuva\\p{L}*|asumista|asuminen|resider|residez|residant\\p{L}*|domicilie\\p{L}*|habiter|habitez|habites|vivre|vivez|basee?s?(?=\\s+(?:en|au|aux|dans)\\s)|residir|resida|residencia|residentes?|domicilio|domiciliad\\p{L}*|vivir|vives|residenza|residenti|risiedere|risiedi|domiciliat\\p{L}*|vivere|abitare|residencia|morar|(?:standig|dauerhaft|gewohnlich)\\p{L}*\\s+aufenthalt\\p{L}*|zamieszka\\p{L}*|mieszkajac\\p{L}*|mieszkasz|mieszkac|bydlist\\p{L}*|bydlite|bydlis|bydlet|zijici|trvaly\\s+pobyt|elo|elok|elsz|lakcim\\p{L}*|lakhel\\p{L}*|lakohel\\p{L}*|domiciliul|domiciliu|rezident\\p{L}*|locuiesti|locuiti|διαμεν\\p{L}*|διαμονη|κατοικια|κατοικει\\p{L}*|κατοικοι|κατοικος|μενεις";
  // Residence words strong enough to name a city or region the vocabulary doesn't know
  // ("residencia en la Comunidad de Madrid", "domiciliati in Lombardia", "κατοικία στην Αττική"),
  // with the verbs that speak to the reader ("Du wohnst in Bayern", "Vous habitez en Île-de-France")
  const RESIDE_STRONG =
    "reside|resides|residing|resident|residents|residency|wohnsitz|hauptwohnsitz|wohnort|wohnhaft|(?:standig|dauerhaft|gewohnlich)\\p{L}*\\s+aufenthalt\\p{L}*|wohnst|lebst|woonachtig|woont|bosatt|bopael|bosat|bor|bo|asuinpaikka\\p{L}*|asumista|resider|residez|residant\\p{L}*|domicilie\\p{L}*|habiter|habitez|habites|vivez|residir|residencia|residentes?|domicilio|domiciliad\\p{L}*|vives|residenza|residenti|domiciliat\\p{L}*|abiti|vivi|risiedi|morar|moras|zamieszka\\p{L}*|mieszkajac\\p{L}*|mieszkasz|bydlist\\p{L}*|bydlis|trvaly\\s+pobyt|domiciliul|rezident\\p{L}*|locuiesti|locuiti|διαμεν\\p{L}*|κατοικια|μενεις";
  // Who is hired: "candidates", "Bewerbungen", "we hire", "assumiamo", "zatrudniamy"…
  const HIRE =
    "hire|hires|hiring|recruit\\p{L}*|employ|employing|candidat\\p{L}*|kandidat\\p{L}*|kandydat\\p{L}*|applicants?|applications?|bewerb\\p{L}*|einstell\\p{L}*|anstellung|embauch\\p{L}*|recrut\\p{L}*|contratamos|assumiamo|werven|sollicit\\p{L}*|anstaller|anstalla|ansaetter|ansaette|ansetter|ansette|rekrytoi\\p{L}*|hakij\\p{L}*|zatrudni\\p{L}*|zamestnav\\p{L}*|jelolt\\p{L}*|felvesz\\p{L}*|angaj\\p{L}*|υποψηφι\\p{L}*|προσλαμβαν\\p{L}*|προσληψ\\p{L}*|open\\s+to|available\\s+to|accepting";
  // Work verbs and nouns: where the hire works only with "from" ("must work from Germany", "lavoro dall'Italia")
  const WORK =
    "work|works|worked|working|arbeit\\p{L}*|werk|werkt|werken|arbeta\\p{L}*|jobba\\p{L}*|arbejd\\p{L}*|jobbe\\p{L}*|tyoskennel\\p{L}*|tyo|travaill\\p{L}*|trabaj\\p{L}*|lavor\\p{L}*|trabalh\\p{L}*|prac\\p{L}*|dolgoz\\p{L}*|munkavegzes|lucr\\p{L}*|munca|εργασι\\p{L}*|εργαστ\\p{L}*|δουλει\\p{L}*";
  // The job itself, next to a word for the whole country ("Stillingen er landsdækkende", "landelijke functie")
  const JOB =
    "stelle|position|job|role|rolle|tatigkeit|einsatz|einsatzort|arbeitsort|poste|emploi|puesto|empleo|posizione|ruolo|vaga|cargo|funcao|functie|rol|baan|vacature|tjanst|tjansten|roll|rollen|jobb|jobbet|stilling|stillingen|tehtava|stanowisko|pozice|allas|munkakor|postul|θεση";
  // Anywhere, only, from all of: these need no other word ("von überall in der Schweiz",
  // "desde cualquier punto de España", "nur aus Deutschland", "vanuit heel Nederland")
  const ANYWHERE =
    "anywhere|any\\s+location|any\\s+part\\s+of|everywhere|uberall|ortsunabhangig|partout|n\\s+importe\\s+ou|cualquier\\s+(?:punto|lugar|parte|sitio)|ovunque|qualsiasi\\s+(?:punto|parte|luogo)|qualquer\\s+(?:ponto|lugar|parte|local)|(?:von|an)\\s+(?:jedem|einem)\\s+(?:beliebigen\\s+)?ort|overal|var\\s+som\\s+helst|var\\s+du\\s+vill|hvor\\s+som\\s+helst|hvor\\s+du\\s+vil|uansett\\s+hvor(?:\\s+du\\s+bor)?|mista\\s+tahansa|mista\\s+pain|barhonnan|barhol|odkudkoliv?|kdekoliv?|z\\s+dowolnego\\s+miejsca|z\\s+kazdego\\s+miejsca|skadkolwiek|(?:de\\s+)?oriunde|(?:απο\\s+)?(?:οπουδηποτε|οποιοδηποτε|οποιαδηποτε)";
  const FROM_ALL =
    "(?:aus|von)\\s+ganz|(?:vanuit|uit)\\s+heel|fran\\s+hela|fra\\s+hele|de\\s+toute?|de(?:sde)?\\s+tod[ao]|da\\s+tutt[ao]|z\\s+calej|z\\s+cele(?:ho)?|din\\s+toata|from\\s+all\\s+over|from\\s+all\\s+of|from\\s+across|from\\s+throughout";
  const ONLY =
    "only|nur|uniquement|exclusivement|seulement|solo|solamente|unicamente|exclusivamente|apenas|somente|soltanto|esclusivamente|alleen|uitsluitend|enkel|endast|enbart|kun|ainoastaan|vain|tylko|wylacznie|pouze|jen|vyhradne|csak|kizarolag|doar|numai|exclusiv|μονο|αποκλειστικα";
  // In, within, from (and the ones with "from": a work word counts only with these)
  const FROM_PREPS =
    "from|aus|von|vom|vanuit|uit|fran|fra|depuis|desde|dall|dalla|dal|dai|a\\s+partir\\s+d[aoe]|z\\s+terenu|z|ze|din|απο";
  const PREPS = `${FROM_PREPS}|out\\s+of|of|in|im|innerhalb|within|across|throughout|inside|en|dans|de|des|du|au|aux|sur|dentro\\s+de|da|del|dell|della|dello|dei|nel|nella|nei|entro|su|em|no|na|nos|nas|do|dos|binnen|i|inom|innenfor|inden\\s+for|indenfor|na\\s+terenie|na\\s+obszarze|w\\s+obrebie|w|we|v\\s+ramci|v|ve|po|na\\s+uzemi|pe\\s+teritoriul|de\\s+pe\\s+teritoriul|pe|(?:σημειο|μερος|περιοχη|ακρη)\\s+(?:της|του)|στην|στη|στο|στον|στις|σε|εντος`;
  // Between the preposition and the place: articles, "ganz", "toda", "any", "country"…
  const DETS =
    "the|der|die|das|den|dem|des|la|le|l|les|el|il|lo|los|las|het|de|o|a|os|as|ganz|ganzen|gesamten|gesamte|heel|hela|hele|toda|todo|toute|tout|tous|tutta|tutto|tutti|cala|cale|caly|calej|calym|cele|cela|celeho|toata|tot|ολη|ολο|την|τη|της|του|az|all|whole|entire|an|any|another|other|one\\s+of\\s+the|einem|einen|einer|anderen|autre|otro|altro|outro|qualsiasi|cualquier|qualquer|quel|quelque|n\\s+importe|jedem|jedes|elk|ieder|vilket|hvilket|nagot|annat|dowolnego|dowolnym|jakekoli|barmely|orice|οποιαδηποτε|country|countries|land|lande|landes|landet|pays|pais|paises|paese|paesi|kraju|kraj|zeme|zemi|orszag|tara|tari|χωρα|χωρες|member|state|states";
  // The company, its clients, offices, travel, a market, a superlative, experience, a language or a
  // right to work: a place after these is not where the hire lives
  const CLIENTS =
    "client\\p{L}*|customer\\p{L}*|kunde\\p{L}*|kundin\\p{L}*|klant\\p{L}*|kund|kunder\\p{L}*|kundene|asiak\\p{L}*|clientes|clienti|klient\\p{L}*|ugyfel\\p{L}*|πελατ\\p{L}*";
  const COMPANY =
    `${CLIENTS}|` +
    "office|offices|buro\\p{L}*|kantoor|kontor\\p{L}*|bureau\\p{L}*|oficina\\p{L}*|uffic\\p{L}*|escritorio\\p{L}*|biur\\p{L}*|kancelar\\p{L}*|irod\\p{L}*|birou\\p{L}*|γραφει\\p{L}*|hq|headquarter\\p{L}*|hubs?|campus|entit(?:y|ies)|niederlassung\\p{L}*|filiale?n?|vestiging\\p{L}*|filial\\p{L}*|sucursal\\p{L}*|succursal\\p{L}*|oddzia\\p{L}*|pobock\\p{L}*|fiok\\p{L}*|υποκαταστημ\\p{L}*|hauptsitz|firmensitz|sitz|standort\\p{L}*|siege|sede|sedi|siedzib\\p{L}*|sidl\\p{L}*|szekhely\\p{L}*|sediu\\p{L}*|εδρα|hoofdkantoor|huvudkontor\\p{L}*|hovedkontor\\p{L}*|paakonttori|company|companies|unternehmen\\p{L}*|firma|firmen|firm|bedrijf\\p{L}*|organi[sz]ati\\p{L}*|foretag\\p{L}*|virksomhed\\p{L}*|selskap\\p{L}*|yrity\\p{L}*|entreprise\\p{L}*|societe\\p{L}*|empresa\\p{L}*|azienda\\p{L}*|societa|spolk\\p{L}*|spolecnost\\p{L}*|ceg\\p{L}*|vallalat\\p{L}*|compani\\p{L}*|εταιρει\\p{L}*|start-?ups?|scale-?ups?|agency|agentur|team|teams|teammates|teamet|members|employees|staff|mitarbeiter\\p{L}*|mitarbeitend\\p{L}*|kolleg\\p{L}*|colleague\\p{L}*|collega\\p{L}*|collegue\\p{L}*|companer\\p{L}*|colleghi|colegas|kolega\\p{L}*|kollegak|colegi|συναδελφ\\p{L}*|travel\\p{L}*|trips?|reise\\p{L}*|reisebereitschaft|dienstreise\\p{L}*|reizen|resor|resa|rejse\\p{L}*|reiser|matka\\p{L}*|matkustus\\p{L}*|deplacement\\p{L}*|viaje\\p{L}*|trasfert\\p{L}*|viage\\p{L}*|desloca\\p{L}*|wyjazd\\p{L}*|podroz\\p{L}*|sluzebn\\p{L}*|utaz\\p{L}*|deplasar\\p{L}*|ταξιδ\\p{L}*|visit\\p{L}*|besuch\\p{L}*|events?|meetups?|meetings?|offsites?|onsites?|on-site|retreats?|workshops?|conferences?|treffen|teamtreffen|rencontre\\p{L}*|markets?|markt\\p{L}*|marche|mercado\\p{L}*|mercat\\p{L}*|partners?|universit\\p{L}*|business|footprint|presence|operations|leading|largest|biggest|grosste\\p{L}*|fuhrende\\p{L}*|grootste|storsta|storste|suurin|najwieksz\\p{L}*|nejvetsi|legnagyobb|μεγαλυτερ\\p{L}*|experience|erfahrung|experiencia|esperienza|ervaring|erfarenhet|erfaring|kokemus\\p{L}*|doswiadcz\\p{L}*|zkusenost\\p{L}*|tapasztalat\\p{L}*|experienta|εμπειρι\\p{L}*";
  const RIGHT =
    "right|rights|eligible|eligibility|authori[sz]\\p{L}*|permit\\p{L}*|permission|visa\\p{L}*|legally|entitled|allowed|qualified|arbeitserlaubnis|arbeitsgenehmigung|aufenthalts\\p{L}+|werkvergunning|verblijfsvergunning|arbetstillstand|ratt|ret|rett|arbeidstillatelse|arbejdstilladelse|tyolupa|oikeus|autorise\\p{L}*|autorisation|permis|permiso\\p{L}*|autoriza\\p{L}*|permesso|autorizzat\\p{L}*|pozwoleni\\p{L}*|uprawnion\\p{L}*|povoleni|opravnen\\p{L}*|engedely\\p{L}*|jogosult\\p{L}*|autorizat\\p{L}*|drept\\p{L}*|αδεια|citizen\\p{L}*|staatsburger\\p{L}*|staatsangehorig\\p{L}*|nationalit\\p{L}*|ressortissant\\p{L}*|cittadin\\p{L}*|ciudadan\\p{L}*|cidada\\p{L}*|statsborger\\p{L}*|medborgar\\p{L}*|kansalai\\p{L}*|obywatel\\p{L}*|obcan\\p{L}*|allampolgar\\p{L}*|cetatean\\p{L}*|υπηκο\\p{L}*|passport\\p{L}*|reisepass|passeport|pasaporte|passaporto|stamp";
  const LANGUAGE =
    "deutsch\\p{L}*|english|englisch\\p{L}*|languages?|sprache\\p{L}*|langue\\p{L}*|idioma\\p{L}*|lingua|taal|sprak\\p{L}*|kieli\\p{L}*|jezyk\\p{L}*|jazyk\\p{L}*|nyelv\\p{L}*|limba|γλωσσ\\p{L}*|fluent\\p{L}*|fliessend|courant|fluido|fluente|vloeiend|flytande|flydende|flytende|sujuva\\p{L}*|plynn\\p{L}*|biegl\\p{L}*|folyekony\\p{L}*";
  // One free word between an anchor and a place: anything but the words above
  const GAP = `(?!(?:${COMPANY}|${RIGHT}|${LANGUAGE})(?![\\p{L}\\p{N}]))[^\\s.;!?]+`;
  // The employer or someone else as the subject ("we are based in Sweden", "our team is located in…");
  // for remote work only colleagues ("mit anderen Kollegen remote in Spanien"). "våra" (our) folds like
  // "vara" (be: "du måste vara bosatt i Sverige")
  const PRONOUNS =
    "we|wir|nous|nosotros|noi|wij|vi|me|my|mi|εμεις|our|unser\\p{L}*|notre|nos|nuestr\\p{L}*|nostr\\p{L}*|noss\\p{L}*|onze|ons|var|vart|(?<!(?:maste|ska|skall|bor|behover|kan|vill)\\s)vara|vores|meidan|nasz\\p{L}*|nase|μας|it|which";
  const TEAM =
    "team|teams|teamet|members|employees|staff|mitarbeiter\\p{L}*|mitarbeitend\\p{L}*|kolleg\\p{L}*|colleague\\p{L}*|collega\\p{L}*|kollegor|kolleger|kollegaer|collegue\\p{L}*|companer\\p{L}*|colleghi|colegas|kolega\\p{L}*|kollegak|colegi|συναδελφ\\p{L}*";

  // A residence word glued to a hyphen is part of a compound ("Go-Live", "cloud-based")
  const NBH = "(?<![\\p{L}\\p{N}-])";
  const anchorRe = (alts, nb = NB) => pattern(`${nb}(?:${alts})${NA}`, "g");
  const ANCHORS = {
    remote: anchorRe(REMOTE),
    reside: anchorRe(RESIDE, NBH),
    hire: anchorRe(HIRE),
    work: anchorRe(WORK),
    job: anchorRe(JOB),
    // "Wir stellen ausschließlich in Deutschland ein": hires only with "ein" after the place
    stellen: anchorRe("stell(?:en|e|st|t)"),
  };
  const EIN_AFTER = pattern(`^\\s+(?:[^\\s.;!?]+\\s+)?ein${NA}`);
  // After the anchor: the rest of its word ("Remote-Arbeit", "Kolleg:innen") and up to n free words
  const GAP_TO = new Map();
  const gapTo = (n) => {
    if (!GAP_TO.has(n)) GAP_TO.set(n, pattern(`^[^\\s.;!?]*(?:\\s+${GAP}){0,${n}}\\s*$`));
    return GAP_TO.get(n);
  };
  const SUBJECT_END = pattern(`${NB}(?:${PRONOUNS}|${COMPANY})${NA}(?:\\s+[^\\s.;!?]+){0,2}\\s*$`);
  const TEAM_END = pattern(`${NB}(?:${TEAM})${NA}(?:\\s+[^\\s.;!?]+){0,1}\\s*$`);
  const RIGHT_END = pattern(`${NB}(?:${RIGHT})${NA}(?:\\s+[^\\s.;!?]+){0,3}\\s*$`);
  // A right to live there takes an infinitive ("eligible to live", "right to work and reside",
  // "autorizado a residir"); "EU citizens residing in Spain" is still where they live
  const RIGHT_TO_END = pattern(
    `${NB}(?:${RIGHT})${NA}(?:(?:\\s+[^\\s.;!?]+){0,2}?\\s+(?:to|zu|um|om|at|til|aby|να)(?:\\s+[^\\s.;!?]+){0,2}|\\s+(?:a|de|d|para|per|pour))\\s*$`
  );
  // The employer, its people or clients at work: "wir arbeiten remote", "Kolleg:innen arbeiten 100%
  // remote", "Kunden" ("… aus ganz Deutschland"); not "Home office"
  const AUX = "sind|ist|are|is|zijn|sont|son|somos|sono|siamo|sommes|ar|er|jestesmy|sa|alle|all|fully|vollstandig|komplett|\\d+\\s*%";
  const SUBJECT_WORK_END = pattern(
    `${NB}(?:${PRONOUNS}|${TEAM}|${CLIENTS}|company|companies|unternehmen\\p{L}*|firm\\p{L}*|bedrijv\\p{L}*|entreprises|empresas|aziende|foretag|virksomheder)${NA}(?::\\p{L}+)?(?:\\s+(?:${WORK}|${REMOTE}|${AUX})${NA}){0,3}\\s*$`
  );

  // The preposition right before a place, with articles ("innerhalb der ", "z terenu ", "desde
  // cualquier punto de ") and a city between ("from Dublin, Ireland")
  const PREP_END = pattern(
    `${NB}(?:${PREPS})${NA}(?:\\s+(?:${DETS})${NA}){0,3}(?:(?:\\s+[\\p{L}-]+){1,2},)?\\s*$`
  );
  const FROM_START = pattern(`^(?:${FROM_PREPS})${NA}`);
  const SELF_END = pattern(
    `${NB}(?:(?:${ANYWHERE})${NA}(?:\\s+${GAP}){0,3}?\\s+(?:${PREPS})|${FROM_ALL})${NA}(?:\\s+(?:${DETS})${NA}){0,3}(?:(?:\\s+[\\p{L}-]+){1,2},)?\\s*$`
  );
  // "nur in Deutschland": a hire, remote or residence word must come first ("Remote – nur in
  // Deutschland", "Bewerbungen nur aus Deutschland"), not "Kunden nur in Deutschland"
  const ONLY_PREP_END = pattern(
    `${NB}(?:${ONLY})(?:\\s+(?:${PREPS}))?${NA}(?:\\s+(?:${DETS})${NA}){0,3}(?:(?:\\s+[\\p{L}-]+){1,2},)?\\s*$`
  );
  // Before a case form ("mistä päin Suomea tahansa", "kizárólag Magyarországon élő")
  const SELF_CASE_END = pattern(`${NB}(?:${ANYWHERE})${NA}(?:\\s+(?:${DETS})${NA}){0,2}\\s*$`);
  const ONLY_CASE_END = pattern(`${NB}(?:${ONLY})${NA}(?:\\s+(?:${DETS})${NA}){0,2}\\s*$`);
  // Hungarian and Finnish put the anchor after the place
  const AFTER_CASE = pattern(
    `^[^\\s.;!?]*(?:\\s+[^\\s.;!?]+){0,2}?\\s+(?:elo|elok|lakcim\\p{L}*|lakhel\\p{L}*|lakohel\\p{L}*|belul|barhonnan|barmely|teruleterol|teruleten|kasin|tahansa|asuva\\p{L}*|asuin\\p{L}*|asumista|asuminen|kotipaik\\p{L}*|etana|etatyo\\p{L}*)${NA}`
  );
  // "Remote (Deutschland)", "Remote, Ireland", "Remote – UK & Ireland only", "(Full Remote - Only ITALY)",
  // "Praca zdalna - cała Polska", "Remote, pe teritoriul României"
  const TAG_END = pattern(
    `${NB}(?:${REMOTE})${NA}(?:\\s+(?:work|working|arbeit|role|position|job))?\\s*[(\\[,:/|-]\\s*(?:(?:${ONLY})\\s+)?(?:(?:${PREPS})${NA}\\s*)?(?:(?:${DETS})${NA}\\s*){0,2}$`
  );
  // "Remote Nordics Europe", "Full remote France)" in the title
  const BARE_TAG_END = pattern(`${NB}(?:${REMOTE})\\s+$`);
  // "Spain (Remote)", "| Ireland | Remote"; in the title also "Portugal Remote"
  const REMOTE_AFTER = pattern(`^\\s*[(\\[|/]\\s*(?:(?:full|fully|100\\s*%?)\\s+)?(?:${REMOTE})${NA}`);
  const HEAD_REMOTE_AFTER = pattern(`^\\s*(?:[(\\[|/,-]\\s*)?(?:(?:full|fully|100\\s*%?)\\s+)?(?:${REMOTE})${NA}`);
  // "Any Romania based location", "Europe-based" (not "a Germany-based company")
  const BASED_AFTER = pattern(`^-?\\s*based${NA}(?!\\s+(?:\\p{L}+\\s+)?(?:${COMPANY})${NA})`);
  // "Location: Sweden, Denmark, Norway" (not "Office Location: …")
  const COLON_END = pattern(
    `(?<!(?:office|company|head|hq|buro|firmen|unternehmens|siege|bureau|sede|kantoor|kontor|biuro|irodai)\\s+)${NB}(?:locations?|standort|arbeitsort|einsatzort|dienstort|wohnort|lieu(?:\\s+de\\s+travail)?|localisation|ubicacion|localizacion|lugar\\s+de\\s+trabajo|sede\\s+di\\s+lavoro|luogo\\s+di\\s+lavoro|local\\s+de\\s+trabalho|localizacao|locatie|werklocatie|standplaats|placering|arbetsort|lokation|arbejdssted|arbeidssted|sijainti|lokalizacja|miejsce\\s+pracy|misto\\s+vykonu\\s+prace|lokalita|munkavegzes\\s+helye|helyszin|locul\\s+de\\s+munca|τοποθεσια|τοπος\\s+εργασιας)\\s*:\\s*(?:[^\\s.;!?:]+\\s+){0,3}?$`
  );
  // "candidates residing in the following European countries: Bulgaria, …"
  const ANCHOR_COLON_END = pattern(`(?:${NBH}(?:${RESIDE})|${NB}(?:${HIRE}))${NA}(?:\\s+${GAP}){0,8}?\\s*:\\s*$`);
  const FOLLOWING_END = pattern(
    `${NB}(?:following|these|listed|folgenden|nachfolgenden|genannten|suivants|suivantes|siguientes|seguintes|seguenti|volgende|foljande|folgende|seuraav\\p{L}*|nastepujacych|nasledujicich|alabbi|urmatoarele|ακολουθ\\p{L}*)(?:\\s+[^\\s.;!?]+){0,2}\\s*$`
  );
  const ONLY_AFTER = pattern(`^\\s*(?:[-)]\\s*)?(?:${ONLY})${NA}`);
  const WHO_ONLY_AFTER = pattern(
    `^\\s*(?:[-)]\\s*)?(?:based|resident|residents|candidates|applicants|remote|hires|citizens)\\s+(?:${ONLY})${NA}`
  );
  const ONLY_END = pattern(`${NB}(?:${ONLY})${NA}(?:\\s+(?:${DETS})${NA})?\\s*$`);
  const ALL_KINDS = ["remote", "reside", "hire", "job", "work"];
  const ANY_ANCHOR = pattern(`${NB}(?:${REMOTE}|${RESIDE}|${HIRE}|${WORK}|${JOB})${NA}`);
  // The verb after the place ("in Deutschland wohnst", "in Deutschland deinen Wohnsitz hast", "in
  // Nederland woont"), said to the reader or of the hire ("du", "je", "Bewerber", "musst", "Voraussetzung")
  const RESIDE_AFTER = pattern(
    `^\\s+(?:[^\\s.;!?]+\\s+)?(?:wohnen|wohnst|wohnt|leben|lebst|lebt|ansassig\\p{L}*|gemeldet|wohnhaft|wohnsitz|hauptwohnsitz|wonen|woon|woont|woonachtig|gevestigd|woonplaats)${NA}`
  );
  const READER = pattern(
    `${NB}(?:du|sie|ihr|you|je|jij|u|${HIRE}|muss\\p{L}*|soll\\p{L}*|moet\\p{L}*|dien\\p{L}*|voraussetzung|bedingung|erforderlich|wichtig|voorwaarde|vereist|belangrijk|verplicht)${NA}`
  );
  // "we cannot hire outside of these geographies", "it cannot be worked from outside of Sweden"
  const NOT = `${NB}(?:not|cannot|unable|never|t|nicht|kein\\p{L}*|nie|ne|pas|no|non|niet|geen|inte|ikke|ei|nem|nu|δεν)${NA}`;
  const OUTSIDE_END = pattern(
    `${NOT}(?:\\s+${GAP}){0,6}?\\s+(?:outside|ausserhalb|hors|en\\s+dehors|fuera|fuori|buiten|utanfor|uden\\s+for|udenfor|utenfor|poza|mimo|in\\s+afara)(?:\\s+(?:of|de|du|des|d|von|dal|dall|dalla|del|van|av|af|the|der|la|le|l|el|il|granicami))*\\s*$`
  );
  // "in Österreich und darüber hinaus", "auch aus dem Ausland", "oder im europäischen Ausland": not
  // limited after all
  const ALSO = "auch|also|aussi|tambien|anche|ook|ocksa|ogsa|myos|rowniez|take|επισης";
  const BEYOND_AFTER = pattern(
    `^\\s*[,-]?\\s*(?:(?:und|and|or|oder|et|ou|y|e|en|of|och|eller|og|ja|tai|i|lub|oraz|a|nebo|es|vagy|si|sau|και|η)(?:\\s+(?:${ALSO}))?|${ALSO})\\s+(?:(?:aus\\s+dem|vom|im)\\s+(?:europaischen\\s+|eu-)?ausland|from\\s+abroad|de\\s+l\\s+etranger|desde\\s+el\\s+extranjero|dall\\s+estero|vanuit\\s+het\\s+buitenland|fran\\s+utlandet|fra\\s+udlandet|ulkomailta|z\\s+zagranicy|ze\\s+zahranici|kulfoldrol|din\\s+strainatate|απο\\s+το\\s+εξωτερικο|daruber\\s+hinaus|beyond|elsewhere|abroad|au-dela|au\\s+dela|ailleurs|a\\s+l\\s+etranger|mas\\s+alla|en\\s+el\\s+extranjero|oltre|all\\s+estero|alem|no\\s+estrangeiro|daarbuiten|in\\s+het\\s+buitenland|utomlands|i\\s+utlandet|i\\s+udlandet|ulkomailla|za\\s+granica|v\\s+zahranici|kulfoldon|in\\s+strainatate|στο\\s+εξωτερικο|international\\p{L}*)${NA}`
  );
  const NOT_SOON = pattern(`^[^,.;!?]{0,30}?${NOT}`);
  // Time zones are not places ("EU time zones", "European Time")
  const TZ_AFTER = pattern(
    `^\\s+(?:(?:business|working|work|office)\\s+)?(?:time\\s*zones?|timezones?|time|hours|zeitzone\\p{L}*|fuseaux?\\s+horaires?|zonas?\\s+horarias?|fus[oi]\\s+orari[oa]?|tijdzone\\p{L}*|tidszon\\p{L}*|aikavyohyk\\p{L}*|strefa\\p{L}*\\s+czasow\\p{L}*|casov\\p{L}*\\s+pasm\\p{L}*|idozona\\p{L}*|fus\\p{L}*\\s+orar\\p{L}*)${NA}`
  );
  // A word for the whole country next to a company ("bundesweit an 12 Standorten tätig",
  // "rikstäckande företag", "landelijk opererende organisatie", "valtakunnallinen toimija")
  const OWN_COMPANY_AFTER = pattern(
    `^[\\s)]*(?:${COMPANY}|tatig|aktiv|operating|operat\\p{L}*|opererende|toimija\\p{L}*|an\\s+\\d+)${NA}`
  );
  const ANY_END = pattern(
    `${NB}(?:any|another|other|orice|cualquier|qualsiasi|qualquer|dowolnego|jakekoli|barmely|οποιαδηποτε|quel|jedem|jedes|elk|ieder|vilket|hvilket|annat|annet|andet)\\s*$`
  );
  // A negation next to the place cancels it ("Wohnsitz in Wien nicht zwingend erforderlich", "kein Muss",
  // "nicht nur in Deutschland"), as does a preference ("ideally based in Ireland", "von Vorteil")
  const PREFERENCE =
    "ideally|idealerweise|idealement|idealmente|ideaalis\\p{L}*|prefer\\p{L}*|praferi\\p{L}*|bevorzugt\\p{L}*|vorzugsweise|wunschenswert|nice\\s+to\\s+have|(?:a|ein|un|een)\\s+(?:plus|pluspunkt|atout)|pluspunt|von\\s+vorteil|een\\s+pre|bij\\s+voorkeur|se\\s+valorar\\p{L}*|valorable|titolo\\s+preferenziale|gradit\\p{L}*|(?<!som\\s)helst|meriterande|en\\s+fordel|eduksi|mile\\s+widzian\\p{L}*|vyhodou|elony|κατα\\s+προτιμηση|πλεονεκτημα";
  const NEGATION =
    `(?:nicht|not|non|pas|no|nao|niet|nie|inte|ikke|ei|nem|nu|οχι)(?:\\s+[^\\s,.;!?]+){0,2}?\\s+(?:${ONLY}|just|bara|bare)|nejen|${PREFERENCE}|` +
    "nicht\\s+(?:zwingend\\s+|unbedingt\\s+)?(?:erforderlich|notwendig|notig|vorausgesetzt|voraussetzung|pflicht|bedingung)|kein(?:e|en)?\\s+(?:muss|voraussetzung|pflicht|bedingung)|not\\s+(?:a\\s+)?(?:required|requirement|necessary|mandatory|needed|essential|must)|no\\s+(?:need|requirement)|(?:do|does|don|doesn)\\s+(?:not\\s+|t\\s+)?(?:have|need)\\s+to|n\\s+est\\s+pas\\s+(?:obligatoire|necessaire|requis|exige|indispensable)|pas\\s+(?:obligatoire|necessaire|requis)|no\\s+es\\s+(?:necesario|imprescindible|obligatorio|requisito)|non\\s+(?:e\\s+)?(?:necessari\\p{L}*|richiest\\p{L}*|obbligatori\\p{L}*|indispensabile|vincolante)|nao\\s+e\\s+(?:necessario|obrigatorio)|niet\\s+(?:vereist|noodzakelijk|nodig|verplicht)|geen\\s+(?:vereiste|eis|must|voorwaarde)|inte\\s+(?:ett\\s+)?(?:krav|nodvandig\\p{L}*)|inget\\s+krav|ikke\\s+(?:et\\s+)?(?:krav|nodvendig\\p{L}*|pakraevet)|intet\\s+krav|ei\\s+(?:ole\\s+)?(?:edellytys|vaatimus|valttamaton|pakollinen)|ei\\s+edellyteta|nie\\s+(?:jest\\s+)?(?:wymagan\\p{L}*|konieczn\\p{L}*|obowiazkow\\p{L}*)|nie\\s+wymagamy|neni\\s+(?:podminkou|nutn\\p{L}*|vyzadovan\\p{L}*|nutnosti)|nem\\s+(?:feltetel|szukseges|kotelezo|elvaras)|nu\\s+(?:este\\s+)?(?:obligatori\\p{L}*|necesar\\p{L}*)|δεν\\s+(?:ειναι\\s+)?(?:απαραιτητ\\p{L}*|υποχρεωτικ\\p{L}*)|δεν\\s+απαιτειται";
  // Up to a clause stop, a spaced dash included ("Remote innerhalb Deutschlands – Deutschkenntnisse
  // nicht erforderlich"), unless the negation comes right after it ("Wohnsitz in Deutschland – kein Muss")
  const NEG_AFTER = pattern(`^(?:(?:(?!\\s-\\s)[^,:;.!?]){0,60}?${NB}|\\s*[-:]\\s*)(?:${NEGATION})${NA}`);
  const NEG_BEFORE = pattern(`${NB}(?:${NEGATION})${NA}(?:\\s+[^\\s.;!?]+){0,6}\\s*$`);
  // A title segment: "(Greece)", "| Ireland |", "- Polska"
  const SEG_START = /(?:^|[(\[|,/:-])\s*$/u;
  const SEG_END = /^\s*(?:$|[)\]|,/-])/u;
  // "deutschlandweit remote", "deutschlandweit bis zu 100% Remote", "landelijke functie"
  const WORD_AFTER = pattern(`^[^\\s.;!?]*(?:\\s+${GAP}){0,3}?\\s*[(/:,-]?\\s*(?:${REMOTE}|${JOB}|${RESIDE})${NA}`);
  // "EU-Bürger", "Deutschland-Ticket": a compound, not a place (not "Europe-based")
  const COMPOUND_AFTER = /^-(?!based)\p{L}/u;

  // ---- Near an office, or a city or region the vocabulary doesn't know ----

  const NEAR =
    "(?:within\\s+)?commut\\p{L}*\\s+distance|commutable|pendel\\p{L}*|pendling\\p{L}*|pendle\\p{L}*|reisafstand|dojazd\\p{L}*|dojezd\\p{L}*|ingazhato|umkreis|im\\s+raum|grossraum|in\\s+der\\s+nahe|in\\s+der\\s+umgebung|a\\s+moins\\s+de\\s+\\d+|a\\s+proximite|cerca\\s+de|a\\s+menos\\s+de\\s+\\d+|entro\\s+\\d+|nelle\\s+vicinanze|in\\s+prossimita|perto\\s+de|in\\s+de\\s+buurt|i\\s+naerheten|i\\s+narheten|i\\s+naerheden|w\\s+poblizu|w\\s+odleglosci|v\\s+okoli|lahella|tyomatkan|within\\s+\\d+\\s*(?:km|miles|kilomet\\p{L}*|minutes|mins|hours?)|(?:\\d+|an|one|een|anderhalf|half|eine[rn]?|une|una|uma|un)\\s+(?:hours?|uur|stunden?|heures?|horas?|ore|ora)\\s+(?:reizen|rijden|reistijd|fahrzeit|entfernt|away|from|of|von|van|de|da|di)|near|close\\s+to";
  // "Wohnort im Raum München", "habiter à moins de 2 h de Lyon", "live within commuting distance of our Dublin hub"
  const NEAR_RE = pattern(`${NBH}(?:${RESIDE})${NA}(?:\\s+${GAP}){0,4}?\\s+(?:${NEAR})${NA}`, "g");
  // "residencia en la Comunidad de Madrid", "domiciliati in Lombardia" (not "in an EU country": a known place)
  const RESIDE_IN_RE = pattern(
    `${NB}(?:${RESIDE_STRONG})${NA}(?:\\s+${GAP}){0,2}?\\s+(?:${PREPS})${NA}\\s+(?!(?:an?|any|other|another|ein\\p{L}*|un|une|uno|una|um|uma|een|ett|et|egy|jeden|jedna|jakiekolwiek|cualquier|qualsiasi|qualquer|n|beliebig\\p{L}*|elk|orice|οποιαδηποτε|${PRONOUNS}|dein\\p{L}*|your|votre|vos|ton|ta|tes|tu|tus|tuo|tua|jouw|je|din|ditt|dina|twoj\\p{L}*)${NA})`,
    "g"
  );
  // "budapesti vagy Pest megyei lakhellyel": a Hungarian place adjective before the address (not
  // "jelenlegi lakhelyedtől függetlenül", "külföldi lakhellyel")
  const HU_RESIDE_RE = pattern(`${NB}(?!(?:jelenlegi|mostani|korabbi|kulfoldi|europai|nemzetkozi|egyeni|tenyleges|valodi)${NA})\\p{L}{3,}i\\s+(?:vagy\\s+\\p{L}+(?:\\s+\\p{L}+)?\\s+)?(?:lakhel|lakcim|lakohel)\\p{L}*`, "g");
  // A Swiss or Luxembourg cross-border commuter lives in the country or next to it
  const BORDER_RE = words(
    "grenzganger\\p{L}*|frontali\\p{L}*|permis\\s+g|g-bewilligung|grenzgangerbewilligung|ausweis\\s+g|permesso\\s+g|cross-border\\s+commut\\p{L}*"
  );
  // "Grenzgänger leider ausgeschlossen", "pas de frontaliers", "frontalieri esclusi": the country only
  const EXCLUDED = words(
    "ausgeschlossen|nicht|kein\\p{L}*|leider|exclu\\p{L}*|pas|non|esclus\\p{L}*|purtroppo|malheureusement|unfortunately|not|no|cannot|niet|geen|uitgesloten"
  );

  // ---- Perks: time away from home, not where home is ----

  const UNITS =
    "days?|weeks?|months?|tage?n?|woche|wochen|monate?n?|jours?|semaines?|mois|dias|semanas|meses|giorni|settimane|mesi|dagen|weken|maanden|dagar|veckor|manader|dage|uger|maneder|dager|uker|paivaa|viikkoa|kuukautta|dni|tygodni|miesiecy|dnu|tydnu|mesicu|nap|napot|het|honap|zile|saptamani|luni|ημερες|εβδομαδες|μηνες";
  const COUNT = "\\d+|one|two|three|four|five|six|eight|ten|a\\s+few|several|ein\\p{L}*|zwei|drei|vier|funf|sechs|acht|zehn";
  // "work from anywhere in the EU for up to 10 consecutive days"
  const PERK_AFTER = pattern(
    `^\\s+(?:for\\s+|fur\\s+|pour\\s+|por\\s+|per\\s+|voor\\s+)?(?:up\\s+to\\s+|bis\\s+zu\\s+|jusqu\\s+a\\s+|hasta\\s+|fino\\s+a\\s+|ate\\s+|tot\\s+|upp\\s+till\\s+|op\\s+til\\s+|inntil\\s+|enintaan\\s+|max(?:imum)?\\s+)?(?:${COUNT})\\s*(?:consecutive\\s+|aufeinanderfolgende\\s+)?(?:${UNITS})${NA}`
  );
  // "four weeks a year to work from anywhere in Europe"
  const PERK_BEFORE = pattern(
    `${NB}(?:${COUNT})\\s*(?:${UNITS})\\s+(?:a|per|pro|each|every|im|par|al|all|por|ao|om|w|za|το)\\s+(?:year|jahr|an|annee|ano|anno|jaar|aret|ar|vuodessa|roku|rok|ev|χρονο)${NA}(?:\\s+${GAP}){0,5}?\\s*$`
  );

  // ---- Text and vocabulary ----

  // Uppercase only: "EU" is not Portuguese "eu" (I), "DACH" not "Dach" (roof), "SEE" not "see"; "ETÄ"
  // (Finnish: remote) is never ETA (the EEA)
  const UPPER_RE = /(?<![\p{L}\p{N}])(?:eu|ue|dach|see|et[aä]|ees|eee|eer|ewr|cee|eog|ehp|egt|eøs|čr)(?![\p{L}\p{N}])/giu;
  // A letter glued before such a word keeps it from matching
  const MARK = "ʼ";

  /** Folded text: lowercase, no accents, apostrophes and quotes as spaces, "-" for dashes, one space. */
  function prep(text) {
    return fold(String(text || "").replace(UPPER_RE, (w) => (w === w.toUpperCase() && !/ä/iu.test(w) ? w : MARK + w)))
      .replace(/\[\s*(?:\.\.\.|…)\s*\]|…/g, ". ")
      .replace(/['’‘‛`´"“”„«»]/g, " ")
      .replace(/[‐‑‒–—―−]/g, "-")
      .replace(/[^\S\n]+/g, " ")
      // A line ends a sentence (a list item, a heading), unless it ends with a colon or comma
      .replace(/([:,]?) ?\n\s*/g, (m, stop) => (stop ? `${stop} ` : "; "))
      .trim();
  }
  const nameKey = (name) => name.replace(/[\s-]+/g, " ");

  // "EU countries", "EU-Ländern", "EU-maasta": the place with a word for country after it
  const SUFFIX =
    "[\\s-]+(?:countries|country|member\\s+states?|nations|region|area|lander|landern|land|staaten|staat|mitgliedstaaten|mitgliedstaat|pays|paises|pais|paesi|paese|landen|lande|landene|landerna|maat|maissa|maasta|maa|kraje|krajach|krajow|kraju|zeme|zemi|orszag\\p{L}*|tari|tarile|tarii|χωρες|χωρα|χωρων)";
  const CONJ =
    "and\\/or|and|or|plus|as\\s+well\\s+as|und|oder|sowie|bzw|et|ou|y|o|e|en|of|och|eller|og|ja|tai|seka|i|lub|oraz|albo|a|nebo|es|vagy|si|sau|και|η";
  // Between two places of one list: ", ", " oder der ", " or anywhere else in the ", " eller något annat land inom "
  const LIST_GAP = pattern(
    `^[\\s,/|&+()-]*(?:(?:${CONJ})${NA}[\\s(]*)?(?:(?:elsewhere|anywhere(?:\\s+else)?)\\s+)?(?:(?:${PREPS}|${DETS})${NA}\\s*){0,5}$`
  );

  // Built on first use per set of languages: the names are folded like the text (title-match.js may load
  // after this file)
  const vocabs = new Map();
  function vocab(country) {
    const langs = ["en", ...(LANGS[country] || ALL_LANGS)];
    const id = langs.join(" ");
    if (vocabs.has(id)) return vocabs.get(id);
    const byName = new Map();
    const add = (forms, place) => {
      for (const raw of String(forms || "").split("|")) {
        const flag = /^[@~]/.test(raw) ? raw[0] : "";
        const name = nameKey(prep(raw.slice(flag.length)));
        if (name && !byName.has(name)) byName.set(name, { ...place, flag });
      }
    };
    for (const lang of langs) {
      for (const [code, names] of Object.entries(NAMES)) add(names[lang], { kind: "country", codes: [code] });
      for (const [label, codes, names] of PARTS) add(names[lang], { kind: "part", label, codes: codes.split(" ") });
      add(WIDE[lang], { kind: "wide" });
      add(OWN[lang], { kind: "own" });
    }
    const alts = [...byName.keys()]
      .sort((a, b) => b.length - a.length)
      .map((name) => esc(name).replace(/ /g, "[\\s-]+"))
      .join("|");
    // Not glued to a hyphen before: "Île-de-France" is a region, "non-EU" not the EU
    const v = { byName, re: pattern(`${NBH}(${alts})(?:${SUFFIX})?${NA}`, "g"), hu: langs.includes("hu") };
    vocabs.set(id, v);
    return v;
  }

  // A posting names a few dozen places; more add nothing (and cost time on long text)
  const MAX_PLACES = 300;
  const MAX_SIGNALS = 20;

  /** Places in one field, grouped into lists ("Germany, France, the UK or Spain"). */
  function placeLists(text, v) {
    const found = [];
    for (const m of text.matchAll(v.re)) {
      if (found.length >= MAX_PLACES) break;
      found.push({ start: m.index, end: m.index + m[0].length, ...v.byName.get(nameKey(m[1])) });
    }
    const lists = [];
    for (let i = 0; i < found.length; ) {
      let j = i + 1;
      while (
        j < found.length &&
        found[j].start - found[j - 1].end <= 80 &&
        LIST_GAP.test(text.slice(found[j - 1].end, found[j].start))
      ) {
        j++;
      }
      lists.push({ start: found[i].start, end: found[j - 1].end, items: found.slice(i, j) });
      i = j;
    }
    return lists;
  }

  /** The text of the sentence before `at` (a list is read with its own sentence). */
  function sentenceBefore(text, at) {
    const before = text.slice(Math.max(0, at - 200), at);
    const end = Math.max(...[". ", "! ", "? ", "; ", "• "].map((stop) => before.lastIndexOf(stop)));
    return end < 0 ? before : before.slice(end + 2);
  }

  function sentenceAfter(text, at) {
    const after = text.slice(at, at + 120);
    const stop = after.search(/[.!?;•](?:\s|$)/u);
    return stop < 0 ? after : after.slice(0, stop);
  }

  /**
   * The nearest word of one of `kinds` that ends `text`, with at most `max` free words after it,
   * that isn't a right to work ("eligible to live and work in") or the employer's own ("we are
   * based in", "our team is located in"; for remote work, "colleagues remote in").
   */
  function anchorBefore(text, kinds, max) {
    const gap = gapTo(max);
    let best = null;
    for (const kind of kinds) {
      for (const m of text.matchAll(ANCHORS[kind])) {
        if (best && m.index < best.at) continue;
        if (!gap.test(text.slice(m.index + m[0].length))) continue;
        const lead = text.slice(0, m.index);
        if (kind === "reside" ? RIGHT_TO_END.test(lead) : RIGHT_END.test(lead)) continue;
        if ((kind === "reside" || kind === "work") && SUBJECT_END.test(lead)) continue;
        if ((kind === "remote" || kind === "work") && TEAM_END.test(lead)) continue;
        if (kind === "remote" && SUBJECT_WORK_END.test(lead)) continue;
        best = { kind, at: m.index };
      }
    }
    return best;
  }

  // A spaced dash ends a clause: "Remote innerhalb Deutschlands – Deutschkenntnisse nicht erforderlich"
  // (but "Wohnsitz in Deutschland – kein Muss")
  const negated = (before, after) => {
    const dash = before.lastIndexOf(" - ");
    return NEG_AFTER.test(after) || NEG_BEFORE.test(dash < 0 ? before : before.slice(dash + 3));
  };

  /** How a list of places is tied to where the hire lives or works, or null. */
  function tie(list, before, after, head) {
    const first = list.items[0];
    const wide = list.items.some((p) => p.kind === "wide");
    // "we cannot hire outside of Sweden", not "wir sind nu ook buiten Nederland actief"
    if (OUTSIDE_END.test(before) && ANY_ANCHOR.test(before)) return "outside";
    if (first.flag === "~") {
      if (OWN_COMPANY_AFTER.test(after)) return null;
      return anchorBefore(before, ALL_KINDS, 3) || WORD_AFTER.test(after) ? "word" : null;
    }
    const prepAt = first.flag === "@" ? null : before.match(PREP_END);
    if (prepAt || first.flag === "@") {
      const self = before.match(SELF_END) || (first.flag === "@" && before.match(SELF_CASE_END));
      // Not the employer's own people or clients ("wir arbeiten remote aus ganz Deutschland")
      if (self) return SUBJECT_WORK_END.test(before.slice(0, self.index)) ? null : "anywhere";
      const hires = (text) => anchorBefore(text, ALL_KINDS, 8) || (EIN_AFTER.test(after) && anchorBefore(text, ["stellen"], 5));
      const only = before.match(ONLY_PREP_END) || (first.flag === "@" && before.match(ONLY_CASE_END));
      if (only && (head || hires(before.slice(0, only.index)))) return "only";
      const lead = prepAt ? before.slice(0, prepAt.index) : before;
      // A work word counts with "from" only: "must work from Germany", not "right to work in Germany"
      const from = prepAt && FROM_START.test(before.slice(prepAt.index));
      const kinds = from ? ["remote", "reside", "hire", "work"] : ["remote", "reside", "hire"];
      if (anchorBefore(lead, kinds, wide ? 8 : 5)) return "anchor";
      if (EIN_AFTER.test(after) && anchorBefore(lead, ["stellen"], 5)) return "anchor";
      // German and Dutch put the verb last: "dass du in Deutschland wohnst", "je moet in Nederland
      // wonen" (not "Menschen, die in Deutschland leben", "wij zijn in Nederland gevestigd")
      if (prepAt && RESIDE_AFTER.test(after)) {
        const clause = lead.slice(lead.lastIndexOf(",") + 1);
        if (READER.test(clause) && !SUBJECT_END.test(lead)) return "anchor";
      }
    }
    if (TAG_END.test(before) || (head ? HEAD_REMOTE_AFTER : REMOTE_AFTER).test(after)) return "tag";
    if (head && BARE_TAG_END.test(before) && SEG_END.test(after)) return "tag";
    if (BASED_AFTER.test(after)) return "based";
    if (COLON_END.test(before) || ANCHOR_COLON_END.test(before)) return "list";
    if (WHO_ONLY_AFTER.test(after)) return "only";
    // "Germany only" in a description needs a hire, remote or residence word before it
    if ((ONLY_END.test(before) || ONLY_AFTER.test(after)) && (head || anchorBefore(before, ALL_KINDS, 8))) return "only";
    if (AFTER_CASE.test(after)) return "case";
    // A bare country in a title segment ("Technical Pre-Sales Engineer (Greece)"); a bare part
    // of Europe is a sales territory ("Senior Sales Engineer - Nordics")
    if (head && SEG_START.test(before) && SEG_END.test(after) && list.items.some((p) => p.kind !== "part")) return "title";
    return null;
  }

  function readList(list, text, field, ctx) {
    const { start, end, items } = list;
    const before = sentenceBefore(text, start);
    const after = sentenceAfter(text, end);
    if (TZ_AFTER.test(after) || COMPOUND_AFTER.test(after)) return;
    // "residing in the following European countries:" heads the list after it
    if (/^\s*:/u.test(after) && FOLLOWING_END.test(before)) return;
    // A perk says nothing about where the hire lives: "work from anywhere in the EU for up to 10
    // consecutive days" opens nothing, "bis zu 20 Tage aus dem EU-Ausland" requires nothing
    if (PERK_AFTER.test(after) || PERK_BEFORE.test(before)) return;
    // "din orice țară", "z dowolnego kraju": any country, not this one
    if (items.length === 1 && items[0].kind === "own" && ANY_END.test(before)) return;
    const how = tie(list, before, after, field === "title");
    if (!how || (how !== "outside" && negated(before, after))) return;
    const codes = new Set(items.flatMap((p) => (p.kind === "own" ? [ctx.country] : p.codes || [])));
    // "auch aus dem Ausland möglich", not "ook vanuit het buitenland is niet mogelijk"
    const beyond = after.match(BEYOND_AFTER);
    const open = items.some((p) => p.kind === "wide") || (beyond && !NOT_SOON.test(after.slice(beyond[0].length)));
    const lead = before.split(" ").slice(-5).join(" ");
    ctx.hits.push({ field, how, text: `${lead}${text.slice(start, end)}`.trim(), scope: open ? null : codes });
  }

  /** Signals that aren't a named place: near an office, an unknown city or region, a cross-border commuter. */
  function otherSignals(text, field, ctx, starts) {
    const own = (m, how) => {
      const before = sentenceBefore(text, m.index);
      const after = sentenceAfter(text, m.index + m[0].length);
      if (negated(before, after) || SUBJECT_END.test(before) || RIGHT_TO_END.test(before)) return;
      ctx.hits.push({ field, how, text: m[0], scope: new Set([ctx.country]) });
    };
    let n = 0;
    for (const m of text.matchAll(NEAR_RE)) {
      if (++n > MAX_SIGNALS) break;
      own(m, "near");
    }
    n = 0;
    for (const m of text.matchAll(RESIDE_IN_RE)) {
      if (++n > MAX_SIGNALS) break;
      // A known place right after is read with its list
      const at = m.index + m[0].length;
      if (!starts.some((s) => s >= m.index && s <= at + 40)) own(m, "reside");
    }
    if (ctx.vocab.hu) {
      n = 0;
      for (const m of text.matchAll(HU_RESIDE_RE)) {
        if (++n > MAX_SIGNALS) break;
        own(m, "reside");
      }
    }
    const border = BORDER[ctx.country] && text.match(BORDER_RE);
    if (border) {
      const before = sentenceBefore(text, border.index);
      const after = sentenceAfter(text, border.index + border[0].length);
      // In its clause: "Wohnsitz in der Schweiz (Grenzgänger leider ausgeschlossen)", "pas de frontaliers"
      const clause = `${before.slice(Math.max(before.lastIndexOf(","), before.lastIndexOf("(")) + 1).slice(-40)} ${after.split(/[,)]/u)[0].slice(0, 40)}`;
      const excluded = EXCLUDED.test(clause);
      if (excluded || !negated(before, after)) {
        const scope = excluded ? [ctx.country] : BORDER[ctx.country].split(" ");
        ctx.hits.push({ field, how: "border", text: border[0], scope: new Set(scope) });
      }
    }
  }

  function readField(text, field, ctx) {
    if (!text) return;
    const lists = placeLists(text, ctx.vocab);
    for (const list of lists) readList(list, text, field, ctx);
    otherSignals(
      text,
      field,
      ctx,
      lists.map((l) => l.start)
    );
  }

  // "Full Remote (nur DE)", "Java Developer (Remote - DE/AT/CH)": country codes, upper case, that hold
  // the job's own, next to "only" or a remote tag in the title, are names ("Remote IT Consultant" is IT)
  const CODE_LIST = pattern("(?<![\\p{L}\\p{N}])[A-Z]{2}(?:\\s*[/,&+|]\\s*[A-Z]{2}){0,9}(?![\\p{L}\\p{N}])", "g");
  function titleCodes(title, code) {
    if (!title.includes(code)) return title;
    return title.replace(CODE_LIST, (list, at) => {
      const codes = list.split(/\s*[/,&+|]\s*/u);
      if (!codes.includes(code) || !codes.every((c) => NAMES[c]?.en)) return list;
      const before = `${prep(title.slice(0, at))} `;
      const after = prep(title.slice(at + list.length));
      const tagged = ONLY_END.test(before) || TAG_END.test(before) || BARE_TAG_END.test(before);
      if (!(tagged && SEG_END.test(after)) && !(SEG_START.test(before) && ONLY_AFTER.test(after))) return list;
      return codes.map((c) => NAMES[c].en.split("|")[0]).join(", ");
    });
  }

  /**
   * @param {{ title?: string, location?: string, company?: string, description?: string }} job
   * @param {{ country?: string, home?: string }} opts  country: ISO code the job is listed in;
   *   home: where the user lives
   * @returns {{ required: boolean, reason: string }}  required: the posting limits where the hire
   *   lives or works from to a place that doesn't include home
   */
  function jbResidenceRequired(job, { country, home } = {}) {
    const code = String(country || job?.country || "").toUpperCase();
    const mine = String(home || "").toUpperCase();
    const ctx = { country: code, vocab: vocab(code), hits: [] };
    let description = prep(job?.description);
    // "Software Partner Italia", "AlmavivA de Belgique": the company's name is not where it hires
    const company = prep(job?.company).replace(/[,.]?\s+(?:inc|ltd|llc|gmbh|plc|limited|corp|sa|bv|nv|ag|ab|as|oy|spa|srl|sas|sarl|kft|zrt|sro|e\s?v)\.?$/u, "");
    if (company && description.includes(company)) {
      if ([...company.matchAll(ctx.vocab.re)].some((m) => m[0].length < company.length)) {
        description = description.split(company).join(" ").replace(/\s+/g, " ");
      }
    }
    readField(prep(titleCodes(String(job?.title || ""), code)), "title", ctx);
    readField(description, "description", ctx);
    const open = ctx.hits.find((h) => h.scope === null || h.scope.has(mine));
    if (open) return { required: false, reason: `open: ${open.text}` };
    if (ctx.hits.length) return { required: true, reason: ctx.hits[0].text };
    return { required: false, reason: "" };
  }

  globalThis.jbResidenceRequired = jbResidenceRequired;
})();
