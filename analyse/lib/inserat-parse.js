// Liest Eckdaten aus einem Anzeigentext (Kleinanzeigen-Seite, kopierter Text, Exposé-Text).
// Läuft im Browser und auf dem Server. Ergebnis: nur gefundene Felder, nichts wird erfunden.
// Grundsatz: feste Datenfelder der Seite vor Beschreibungstext; Beträge immer mit ihrem Zusammenhang lesen.

export const zahlDe = (s) => {
  if (s == null) return null;
  const t = String(s).trim().replace(/\s/g, "");
  // 1.234.567,89 | 1234,5 | 380 | 47.80 (englische Dezimalstelle bei 1–2 Nachkommastellen)
  let n;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) n = parseFloat(t.replace(/\./g, "").replace(",", "."));
  else if (/^\d+\.\d{1,2}$/.test(t)) n = parseFloat(t);
  else n = parseFloat(t.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const ZAHL = "(\\d{1,3}(?:[.\\s]\\d{3})+(?:,\\d+)?|\\d+(?:[.,]\\d+)?)";
const EURO = "\\s*(?:€|EUR\\b|Euro\\b)";

function erste(text, muster) {
  for (const m of muster) {
    const r = new RegExp(m, "i").exec(text);
    if (r) return r;
  }
  return null;
}

// Alle Euro-Beträge mit Text davor/danach (für die Einordnung: Kaufpreis, Miete, Garage …)
function betraege(flach) {
  return [...flach.matchAll(new RegExp(`${ZAHL}${EURO}`, "gi"))].map((m) => ({
    wert: zahlDe(m[1]),
    vor: flach.slice(Math.max(0, m.index - 70), m.index).toLowerCase(),
    // Nur der unmittelbar folgende Text (z. B. "p. a.", "/Monat") gehört zum Betrag
    nach: flach.slice(m.index + m[0].length, m.index + m[0].length + 14).toLowerCase(),
  })).filter((b) => b.wert != null);
}

const NEBENPOSTEN = /stellplatz|garage|carport|küche|kueche|inventar|möbel|moebel|ablöse|abloese|kaution|nebenkosten|hausgeld|rücklage|ruecklage|instandhaltung|provision|courtage|sanierung|modernisierung|investiert|renoviert|kosten|darlehen|rate|bodenrichtwert|grundsteuer|versicherung|heiz|strom|miete|pacht|erbbauzins|ersparnis|förder|foerder|zuschuss/;
const JAEHRLICH = /jährl|jaehrl|jahres|p\.\s*a\.|pro jahr|im jahr|\/\s*jahr|per anno/;
const MONATLICH = /monatl|mtl\.|pro monat|\/\s*monat|im monat|monatlich/;

export function leseInserat(roh, vorgaben = {}) {
  const text = String(roh || "").replace(/ /g, " ").replace(/[ \t]+/g, " ");
  const flach = text.replace(/\s*\n\s*/g, " | ");
  const klein = flach.toLowerCase();
  const f = {};
  const alle = betraege(flach);

  // ---- Objektart zuerst (beeinflusst Einheiten und Grundstück)
  const art = erste(flach, [`(Mehrfamilienhaus|Zweifamilienhaus|Dreifamilienhaus|Einfamilienhaus|Doppelhaushälfte|Reihenhaus|Bungalow|Eigentumswohnung|Wohn- und Geschäftshaus|Gewerbeimmobilie|Baugrundstück|Grundstück|Bürogebäude|Garage)`]);
  f.objektart = vorgaben.objektart || (art ? art[1] : undefined);
  // "Grundstück" im Text heißt nicht, dass ein Grundstück verkauft wird – nur ohne Wohnfläche
  if (/grundst/i.test(f.objektart || "") && (vorgaben.wohnflaeche_m2 || /wohnfl(?:ä|ae)che/i.test(flach))) f.objektart = undefined;
  if (!f.objektart && /\bETW\b|Etagenwohnung|Dachgeschosswohnung|Erdgeschosswohnung|Maisonette|Penthouse|Wohnungstyp/i.test(flach)) f.objektart = "Eigentumswohnung";
  const istEtw = /wohnung/i.test(f.objektart || "");

  // ---- Kaufpreis: Vorgabe (festes Preisfeld) > "Kaufpreis:" ohne Nebenposten > alleinstehender Preis > größter passender Betrag
  if (vorgaben.kaufpreis) f.kaufpreis = vorgaben.kaufpreis;
  if (!f.kaufpreis) {
    const kp = [...flach.matchAll(new RegExp(`(?<![A-Za-zÄÖÜäöüß])(?:Kaufpreis|Verkaufspreis|Angebotspreis|Preis)(?:\\s+(?:der|des|für|fuer|die|das)?\\s*[A-Za-zÄÖÜäöüß-]{3,20}){0,2}\\s*(?:beträgt|von|:|\\|)?\\s*(?:\\|\\s*)?(?:nur\\s*)?${ZAHL}${EURO}`, "gi"))]
      // Nebenposten nur direkt am Wort prüfen ("Garagen-Kaufpreis", "Kaufpreis Stellplatz: …"), nicht im ganzen Satz davor
      .filter((m) => !NEBENPOSTEN.test((flach.slice(Math.max(0, m.index - 12), m.index) + m[0]).toLowerCase().replace(/kaufpreis|verkaufspreis|angebotspreis|preis/g, " ")) && zahlDe(m[1]) >= 5000);
    if (kp.length) f.kaufpreis = zahlDe(kp[0][1]);
  }
  if (!f.kaufpreis) {
    const allein = new RegExp(`(?:^|\\|)\\s*${ZAHL}${EURO}\\s*(?:VB\\s*)?(?:\\||$)`, "i").exec(flach);
    if (allein && zahlDe(allein[1]) >= 20000 && !NEBENPOSTEN.test(flach.slice(Math.max(0, allein.index - 40), allein.index).toLowerCase())) f.kaufpreis = zahlDe(allein[1]);
  }
  if (!f.kaufpreis) {
    const kandidaten = alle.filter((b) => b.wert >= 20000 && !NEBENPOSTEN.test(b.vor.slice(-25)) && !JAEHRLICH.test(b.nach) && !MONATLICH.test(b.nach));
    if (kandidaten.length) f.kaufpreis = Math.max(...kandidaten.map((b) => b.wert));
  }
  if (f.kaufpreis && f.kaufpreis < 5000) delete f.kaufpreis;

  // ---- Flächen
  const wfl = erste(flach, [`Wohnfl(?:ä|ae)che\\s*(?:ca\\.?)?\\s*[:|]?\\s*(?:\\|\\s*)?(?:ca\\.?\\s*)?${ZAHL}\\s*(?:m²|m2|qm)`, `${ZAHL}\\s*(?:m²|m2|qm)\\s*Wohnfl`, `Wfl\\.?\\s*(?:ca\\.?)?\\s*${ZAHL}`]);
  f.wohnflaeche_m2 = vorgaben.wohnflaeche_m2 || (wfl ? zahlDe(wfl[1]) : undefined);
  if (!f.wohnflaeche_m2) {
    const nfl = erste(flach, [`Nutzfl(?:ä|ae)che\\s*[:|]?\\s*(?:\\|\\s*)?(?:ca\\.?\\s*)?${ZAHL}\\s*(?:m²|m2|qm)`]);
    if (nfl) f.wohnflaeche_m2 = zahlDe(nfl[1]);
  }
  if (!f.wohnflaeche_m2 && !/grundst/i.test(f.objektart || "")) {
    const m2 = new RegExp(`${ZAHL}\\s*(?:m²|m2|qm)`, "i").exec(flach);
    if (m2 && !/grundst|garten|terrass|balkon|keller|halle|lager/i.test(flach.slice(Math.max(0, m2.index - 30), m2.index))) f.wohnflaeche_m2 = zahlDe(m2[1]);
  }
  const grund = erste(flach, [`Grundst(?:ü|ue)cks?(?:fl(?:ä|ae)che|gr(?:ö|oe)(?:ß|ss)e)?\\s*(?:von\\s*)?(?:ca\\.?)?\\s*[:|]?\\s*(?:\\|\\s*)?(?:ca\\.?\\s*)?${ZAHL}\\s*(?:m²|m2|qm)`, `${ZAHL}\\s*(?:m²|m2|qm)\\s*(?:gro(?:ß|ss)es\\s*)?Grundst`]);
  f.grundstueck_m2 = vorgaben.grundstueck_m2 || (grund ? zahlDe(grund[1]) : undefined);
  // Bei Eigentumswohnungen ist das Grundstück Gemeinschaftseigentum – kein eigenes Bauland
  if (istEtw && f.grundstueck_m2) f.grundstueck_gemeinschaft = true;

  const zimmer = erste(flach, [`Zimmer\\s*[:|]?\\s*(?:\\|\\s*)?${ZAHL}`, `${ZAHL}\\s*Zi(?:mmer|\\.)`]);
  f.zimmer = vorgaben.zimmer || (zimmer ? zahlDe(zimmer[1]) : undefined);

  // ---- Baujahr: bei sanierten Altbauten zählt das ursprüngliche Baujahr, das Sanierungsjahr wird extra vermerkt
  const jahre = [];
  const feldJahr = vorgaben.baujahr || (erste(flach, [`Baujahr(?:\\s*der Immobilie)?\\s*[:|]?\\s*(?:\\|\\s*)?(?:ca\\.?\\s*)?(1[6-9]\\d\\d|20[0-3]\\d)`]) || [])[1];
  if (feldJahr) jahre.push(parseInt(feldJahr, 10));
  for (const m of flach.matchAll(/(?:aus dem jahr|aus dem jahre|baujahr(?:\s*ca\.?)?|erbaut(?:\s*im jahr|\s*ca\.?)?|errichtet(?:\s*im jahr)?|altbau(?:\s*von|\s*aus)?|gründerzeit\w*\s*von|bj\.?)\s*(1[6-9]\d\d|20[0-3]\d)/gi)) jahre.push(parseInt(m[1], 10));
  // Nur Komplettsanierungen des ganzen Gebäudes zählen (eine renovierte Einzelwohnung macht das Haus nicht neu)
  const SAN = "(?:kernsaniert|vollsaniert|grundsaniert|komplett saniert|umfassend saniert|vollständig saniert|kernsanierung|komplettsanierung)";
  const sanierungen = [...flach.matchAll(new RegExp(`${SAN}[^|.]{0,40}?\\b(19[5-9]\\d|20[0-3]\\d)\\b|\\b(19[5-9]\\d|20[0-3]\\d)\\b[^|.]{0,25}?${SAN}`, "gi"))].map((m) => parseInt(m[1] || m[2], 10));
  if (sanierungen.length) f.sanierungsjahr = Math.max(...sanierungen);
  const plausibel = jahre.filter((j) => j >= 1600 && j <= new Date().getFullYear() + 3);
  if (plausibel.length) {
    const aelteste = Math.min(...plausibel);
    // Feldwert = Sanierungsjahr, älteres Baujahr im Text → das ältere nehmen
    f.baujahr = f.sanierungsjahr && aelteste < f.sanierungsjahr ? aelteste : plausibel[0];
    if (f.sanierungsjahr && f.sanierungsjahr <= f.baujahr) delete f.sanierungsjahr;
  }

  // ---- Einheiten: bei Wohnungen die Einheiten im Haus nicht als gekaufte Einheiten zählen
  const we = erste(flach, [`${ZAHL}\\s*(?:exklusive\\s*|separate\\s*|abgeschlossene\\s*)?(?:Wohneinheiten|WE\\b|Wohnungen|Parteien|Einheiten)`, `Wohneinheiten\\s*[:|]?\\s*(?:\\|\\s*)?${ZAHL}`, `(Ein|Zwei|Drei|Vier|Fünf|Sechs|Sieben|Acht)familienhaus`, `(?:nur|insgesamt)\\s+(zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn)\\s+(?:exklusive\\s+)?(?:Wohneinheiten|Wohnungen|Einheiten)`]);
  if (we) {
    const wort = { ein: 1, zwei: 2, drei: 3, vier: 4, "fünf": 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10 }[String(we[1]).toLowerCase()];
    const n = wort || zahlDe(we[1]);
    if (istEtw) { f.einheiten_im_haus = n; f.einheiten = 1; } else if (n > 0 && n < 200) f.einheiten = n;
  }
  if (istEtw && !f.einheiten) f.einheiten = 1;
  if (/grundst/i.test(f.objektart || "") && !f.wohnflaeche_m2) { f.moegliche_einheiten = f.einheiten; delete f.einheiten; }

  // ---- Mieten: jeden Betrag einzeln als Jahres- oder Monatsmiete einordnen
  const mieten = alle.filter((b) => /(kalt)?miete|mieteinnahm|mietertrag|ist-miete|nettokalt/.test(b.vor.slice(-45)) && !/warmmiete|kaution|nebenkosten|garage|stellplatz|carport|soll-?miete|marktmiete|mietspiegel|vergleichsmiete|potenzial|möglich|moeglich|erzielbar/.test(b.vor.slice(-45)));
  const jahresWerte = mieten.filter((b) => JAEHRLICH.test(b.vor.slice(-45)) || JAEHRLICH.test(b.nach)).map((b) => b.wert);
  const monatsWerte = mieten.filter((b) => !(JAEHRLICH.test(b.vor.slice(-45)) || JAEHRLICH.test(b.nach))).map((b) => b.wert).filter((v) => v >= 100 && v <= 50000);
  if (jahresWerte.length) f.ist_miete_jahr = Math.max(...jahresWerte);
  else if (monatsWerte.length) {
    const verschieden = [...new Set(monatsWerte)];
    // Mehrere Einzelmieten nur addieren, wenn es mehrere Einheiten gibt
    f.ist_miete_monat = (f.einheiten || 1) > 1 && verschieden.length > 1 ? verschieden.reduce((a, b) => a + b, 0) : Math.max(...verschieden);
  }
  const fa = /(?:x-fach(?:e)?\s*(?:jahres)?(?:netto)?(?:kalt)?miete|kaufpreisfaktor|faktor|vervielfältiger)\s*[:|]?\s*(?:\|\s*)?(?:ca\.?\s*)?(\d{1,2}(?:[.,]\d{1,2})?)\b/i.exec(flach);
  if (fa) f.faktor_angabe = zahlDe(fa[1]);
  const ra = /(\d{1,2}(?:[.,]\d{1,2})?)\s*%\s*(?:brutto|netto|miet)?-?rendite/i.exec(flach);
  if (ra) f.rendite_angabe = zahlDe(ra[1]);

  const hausgeld = erste(flach, [`Hausgeld\\s*(?:monatlich|mtl\\.?)?\\s*(?:von|:|\\|)?\\s*(?:ca\\.?\\s*)?${ZAHL}${EURO}`]);
  f.hausgeld_monat = vorgaben.hausgeld_monat || (hausgeld ? zahlDe(hausgeld[1]) : undefined);

  const prov = erste(flach, [`${ZAHL}\\s*%\\s*(?:inkl\\.?[^|]{0,20})?(?:Makler|K(?:ä|ae)uferprovision|Provision|Courtage|Maklercourtage)`, `(?:Makler(?:provision|courtage)?|K(?:ä|ae)uferprovision|Provision|Courtage)[^|%]{0,40}?${ZAHL}\\s*%`]);
  if (vorgaben.makler_prozent != null) f.makler_prozent = vorgaben.makler_prozent;
  else if (prov && zahlDe(prov[1]) <= 8) f.makler_prozent = zahlDe(prov[1]);
  else if (/provisionsfrei|ohne (?:makler|provision)|keine (?:makler|provision)|von privat|privatverkauf/i.test(flach)) f.makler_prozent = 0;
  else if (/mit provision/i.test(flach)) f.makler_hinweis = "Provision laut Anzeige, Höhe unbekannt";

  const ek = erste(flach, [`Energieeffizienzklasse\\s*[:|]?\\s*(?:\\|\\s*)?(A\\+|[A-H])\\b`, `Effizienzklasse\\s*[:|]?\\s*(A\\+|[A-H])\\b`]);
  if (ek) f.energieklasse = ek[1].toUpperCase();
  const ev = erste(flach, [`${ZAHL}\\s*kWh\\s*/\\s*\\(?m(?:²|2)\\s*(?:·|\\*|x)?\\s*a`]);
  if (ev) f.energie_kwh = zahlDe(ev[1]);

  if (vorgaben.ort) f.ort = vorgaben.ort;
  else {
    const plz = /\b(\d{5})\s+([A-ZÄÖÜ][\wäöüß.\- ]{2,40}?)(?=\s*[|,(]|$)/.exec(flach);
    if (plz) f.ort = `${plz[1]} ${plz[2].trim()}`;
  }
  if (f.ort) f.ort = f.ort.replace(/\s*(Nordrhein-Westfalen|Niedersachsen|Hessen|Bayern|Baden-Württemberg|Rheinland-Pfalz|Sachsen|Berlin|Hamburg|Bremen|Brandenburg|Thüringen|Schleswig-Holstein|Saarland|Mecklenburg-Vorpommern|Sachsen-Anhalt)\s*-\s*/, " ");

  if (f.einheiten >= 3 && !istEtw && !/Mehrfamilienhaus|Dreifamilienhaus|Wohn- und Geschäftshaus/.test(f.objektart || "")) f.objektart = "Mehrfamilienhaus";

  // ---- Merkmale (mit Verneinungen)
  const m = (re) => re.test(klein);
  const leer = m(/leerstehend|bezugsfrei|frei ab|wird frei|werden[^|]{0,40}frei|unvermietet|nicht vermietet/);
  f.merkmale = {
    // Sanierung = Kernsanierung (Haustechnik, Substanz); Renovierung = Oberflächen, Bad, Böden
    sanierungsbeduerftig: m(/sanierungsbed(?:ü|ue)rftig|kernsanierung (?:nötig|notwendig|erforderlich)|handwerkerobjekt|bastler|abrissreif|entkernt|rohbau/) && !m(/kernsaniert|vollsaniert|neuwertig/),
    renovierungsbeduerftig: m(/renovierungsbed(?:ü|ue)rftig|modernisierungsbed(?:ü|ue)rftig|für handwerker|unrenoviert|renovierungsstau|in die jahre gekommen/) && !m(/kernsaniert|vollsaniert|neuwertig/),
    vermietet: vorgaben.vermietet ?? (m(/(?<!un)(?<!nicht )vermietet|mieteinnahm|mietvertr|mieter vorhanden/) && !leer),
    leer,
    denkmal: m(/denkmalgeschützt|denkmalschutz|baudenkmal|einzeldenkmal/),
    erbpacht: m(/erbpacht|erbbaurecht|erbbauzins|erbbaugrundst/),
    baurecht: !istEtw && m(/baugenehmigung|bauvorbescheid|§\s*34|nach bebauungsplan|bebaubar mit|bebaubar nach|baureif/),
    zweites_grundstueck: !istEtw && m(/zweites flurst(?:ü|ue)ck|separate[sn]? flurst(?:ü|ue)ck|zus(?:ä|ae)tzliche[sn]? baugrundst(?:ü|ue)ck|grundstück (?:ist )?teilbar/),
    oelheizung: m(/(?:ö|oe)lheizung|heiz(?:ö|oe)l/),
    nachtspeicher: m(/nachtspeicher/),
    versteigerung: m(/zwangsversteiger|versteigerungstermin|amtsgericht.{0,40}versteiger/),
    altbau: m(/altbau|gründerzeit|jugendstil/) || (f.baujahr && f.baujahr < 1950),
  };
  return f;
}

// Zieht die Eckdaten aus einer heruntergeladenen Kleinanzeigen-Detailseite (HTML).
// Feste Felder der Seite (Preis, Wohnfläche, Zimmer, Baujahr, Haustyp, Häkchen) haben Vorrang vor dem Beschreibungstext.
export function leseKleinanzeigenHtml(html) {
  const s = String(html);
  const ent = (x) => x.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const textVon = (x) => ent(String(x).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

  const titelM = /<h1[^>]*id="viewad-title"[^>]*>([\s\S]*?)<\/h1>/.exec(s) || /<meta property="og:title" content="([^"]+)"/.exec(s);
  const titel = titelM ? textVon(titelM[1]).replace(/ \| kleinanzeigen\.de$/, "") : "";

  const vorgaben = {};
  const preisMeta = /itemprop="price"[^>]*content="([\d.]+)"/.exec(s);
  const preisFeld = /id="viewad-price"[^>]*>([\s\S]*?)<\//.exec(s);
  if (preisMeta && parseFloat(preisMeta[1]) >= 1000) vorgaben.kaufpreis = parseFloat(preisMeta[1]);
  else if (preisFeld) { const p = zahlDe((/([\d.]+(?:,\d+)?)/.exec(textVon(preisFeld[1])) || [])[1]); if (p >= 1000) vorgaben.kaufpreis = p; }
  const ortFeld = /id="viewad-locality"[^>]*>([\s\S]*?)<\//.exec(s);
  if (ortFeld) vorgaben.ort = textVon(ortFeld[1]);

  const details = {};
  for (const m of s.matchAll(/class="addetailslist--detail">([\s\S]*?)<\/li>/g)) {
    const roh = m[1];
    const wert = /addetailslist--detail--value[^>]*>([\s\S]*?)<\//.exec(roh);
    const t = textVon(roh);
    if (wert) { const w = textVon(wert[1]); details[t.slice(0, t.lastIndexOf(w)).trim()] = w; }
    else { const i = t.indexOf(" "); details[t.slice(0, i)] = t.slice(i + 1); }
  }
  const dz = (k) => (details[k] != null ? zahlDe((/([\d.]+(?:,\d+)?)/.exec(details[k]) || [])[1]) : undefined);
  if (dz("Wohnfläche")) vorgaben.wohnflaeche_m2 = dz("Wohnfläche");
  if (dz("Grundstücksfläche")) vorgaben.grundstueck_m2 = dz("Grundstücksfläche");
  if (dz("Zimmer")) vorgaben.zimmer = dz("Zimmer");
  if (dz("Baujahr")) vorgaben.baujahr = dz("Baujahr");
  if (dz("Hausgeld")) vorgaben.hausgeld_monat = dz("Hausgeld");
  // Gewerbe: Fläche und Objektart aus den Datenfeldern
  if (!vorgaben.wohnflaeche_m2 && dz("Fläche")) vorgaben.wohnflaeche_m2 = dz("Fläche");
  if (details.Objektart && /büro|praxis/i.test(details.Objektart)) vorgaben.objektart = "Bürogebäude";
  else if (details.Objektart && /hotel|gastronomie/i.test(details.Objektart)) vorgaben.objektart = "Hotel/Pension";
  else if (details.Objektart && /halle|lager|produktion|gewerbe|einzelhandel/i.test(details.Objektart)) vorgaben.objektart = "Gewerbeimmobilie";
  if (details.Provision && /keine|ohne|provisionsfrei/i.test(details.Provision)) vorgaben.makler_prozent = 0;
  // Kategorie aus dem Anzeigen-Link: -196- Eigentumswohnung, -208- Haus, -207- Grundstück, -277- Gewerbe
  // Eigener Link der Anzeige (canonical), nicht der erste beliebige Link auf der Seite
  const eigenerLink = (/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/.exec(s) || /<meta[^>]+property="og:url"[^>]+content="([^"]+)"/.exec(s) || [])[1] || "";
  const kat = (/\/\d+-(\d{3})-\d+\/?$/.exec(eigenerLink) || [])[1];
  if (kat === "196") vorgaben.objektart = "Eigentumswohnung";
  if (kat === "207" && !vorgaben.wohnflaeche_m2) vorgaben.objektart = "Grundstück";
  if (kat === "277" && !vorgaben.objektart) vorgaben.objektart = "Gewerbeimmobilie";
  if (details.Haustyp) vorgaben.objektart = /mehrfamilien/i.test(details.Haustyp) ? "Mehrfamilienhaus" : /zweifamilien/i.test(details.Haustyp) ? "Zweifamilienhaus" : /doppel/i.test(details.Haustyp) ? "Doppelhaushälfte" : /reihen/i.test(details.Haustyp) ? "Reihenhaus" : /bungalow/i.test(details.Haustyp) ? "Bungalow" : "Einfamilienhaus";
  if (details.Wohnungstyp) vorgaben.objektart = "Eigentumswohnung";
  if (details["Grundstücksart"] && !vorgaben.wohnflaeche_m2) vorgaben.objektart = "Grundstück";
  if (kat === "208" && !vorgaben.objektart) vorgaben.objektart = "Einfamilienhaus";
  const haekchen = [...s.matchAll(/class="checktag">([\s\S]*?)</g)].map((m) => textVon(m[1]).toLowerCase());
  if (haekchen.includes("aktuell vermietet")) vorgaben.vermietet = true;

  const ohne = ent(s
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "\n"))
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n");
  const marke = /\n\s*Beschreibung\s*\n/.exec(ohne);
  const beschrStart = marke ? marke.index + marke[0].length : -1;
  const ende = ohne.slice(Math.max(beschrStart, 0)).search(/Nachricht schreiben|Anzeigennr|Ähnliche Anzeigen/);
  const beschreibung = beschrStart >= 0 ? ohne.slice(beschrStart, ende > 0 ? beschrStart + ende : beschrStart + 8000) : "";
  // Kopf dieser Anzeige (Titel bis "Beschreibung": Preis, Ort, Datenfelder) – ohne Navigation und fremde Anzeigen
  const titelPos = titel ? ohne.lastIndexOf(titel.slice(0, 40), marke ? marke.index : ohne.length) : -1;
  const kopf = titelPos >= 0 && marke ? ohne.slice(titelPos, marke.index) : titel;
  const f = leseInserat(`${kopf}\n${beschreibung}`, vorgaben);
  f.titel = titel.replace(/\s+in\s+[^|]+?\s+-\s+.*$/, "").trim() || undefined;
  f.beschreibung = beschreibung.trim().slice(0, 4000) || undefined;
  f.details = details;
  return f;
}
