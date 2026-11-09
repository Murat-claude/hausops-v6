// Liest Eckdaten aus einem Anzeigentext (Kleinanzeigen-Seite, kopierter Text, Exposé-Text).
// Läuft im Browser und auf dem Server. Ergebnis: nur gefundene Felder, nichts wird erfunden.

const zahlDe = (s) => {
  if (s == null) return null;
  const t = String(s).trim().replace(/\s/g, "");
  // 1.234.567,89 | 1234,5 | 380
  const n = parseFloat(t.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const ZAHL = "(\\d{1,3}(?:[.\\s]\\d{3})+(?:,\\d+)?|\\d+(?:,\\d+)?)";

function erste(text, muster) {
  for (const m of muster) {
    const r = new RegExp(m, "i").exec(text);
    if (r) return r;
  }
  return null;
}

export function leseInserat(roh) {
  const text = String(roh || "").replace(/ /g, " ").replace(/[ \t]+/g, " ");
  const flach = text.replace(/\s*\n\s*/g, " | ");
  const f = {};

  const preis = erste(flach, [
    `Kaufpreis\\s*[:|]?\\s*(?:\\|\\s*)?${ZAHL}\\s*(?:€|EUR|Euro)`,
    `(?:^|\\|)\\s*${ZAHL}\\s*€\\s*(?:VB\\s*)?(?:\\||$)`,
    `Preis\\s*[:|]?\\s*(?:\\|\\s*)?${ZAHL}\\s*(?:€|EUR|Euro)`,
    `${ZAHL}\\s*(?:€|EUR|Euro)\\s*(?:VB|Verhandlungsbasis|Kaufpreis)`,
  ]);
  if (preis) { const p = zahlDe(preis[1]); if (p >= 5000) f.kaufpreis = p; }
  if (!f.kaufpreis) {
    // Rückfall: größter Euro-Betrag ab 20.000 €, der nicht Miete, Hausgeld o. Ä. ist
    const kandidaten = [...flach.matchAll(new RegExp(`(Miete|Hausgeld|Rücklage|Provision|Jahres\\w*)?[^|]{0,25}?${ZAHL}\\s*(?:€|EUR|Euro)`, "gi"))]
      .filter((m) => !m[1]).map((m) => zahlDe(m[2])).filter((v) => v >= 20000);
    if (kandidaten.length) f.kaufpreis = Math.max(...kandidaten);
  }

  const wfl = erste(flach, [`Wohnfl(?:ä|ae)che\\s*(?:ca\\.?)?\\s*[:|]?\\s*(?:\\|\\s*)?(?:ca\\.?\\s*)?${ZAHL}\\s*(?:m²|m2|qm)`, `${ZAHL}\\s*(?:m²|m2|qm)\\s*Wohnfl`, `Wfl\\.?\\s*(?:ca\\.?)?\\s*${ZAHL}`]);
  if (wfl) f.wohnflaeche_m2 = zahlDe(wfl[1]);
  if (!f.wohnflaeche_m2) {
    const m2 = new RegExp(`(Grundst\\w*[^|]{0,20})?${ZAHL}\\s*(?:m²|m2|qm)`, "i").exec(flach);
    if (m2 && !m2[1] && !/grundst/i.test(flach.slice(Math.max(0, m2.index - 25), m2.index))) f.wohnflaeche_m2 = zahlDe(m2[2]);
  }
  const nfl = erste(flach, [`Nutzfl(?:ä|ae)che\\s*[:|]?\\s*(?:\\|\\s*)?(?:ca\\.?\\s*)?${ZAHL}\\s*(?:m²|m2|qm)`]);
  if (!f.wohnflaeche_m2 && nfl) f.wohnflaeche_m2 = zahlDe(nfl[1]);

  const grund = erste(flach, [`Grundst(?:ü|ue)cks?(?:fl(?:ä|ae)che|gr(?:ö|oe)(?:ß|ss)e)?\\s*(?:von\\s*)?(?:ca\\.?)?\\s*[:|]?\\s*(?:\\|\\s*)?(?:ca\\.?\\s*)?${ZAHL}\\s*(?:m²|m2|qm)`, `${ZAHL}\\s*(?:m²|m2|qm)\\s*(?:gro(?:ß|ss)es\\s*)?Grundst`]);
  if (grund) f.grundstueck_m2 = zahlDe(grund[1]);

  const zimmer = erste(flach, [`Zimmer\\s*[:|]?\\s*(?:\\|\\s*)?${ZAHL}`, `${ZAHL}\\s*Zi(?:mmer|\\.)`]);
  if (zimmer) f.zimmer = zahlDe(zimmer[1]);

  const bj = erste(flach, [`Baujahr(?:\\s*der Immobilie)?\\s*[:|]?\\s*(?:\\|\\s*)?(?:ca\\.?\\s*)?(1[89]\\d\\d|20[0-3]\\d)`, `(?:erbaut|errichtet|Bj\\.?)\\s*(?:im Jahr|ca\\.?)?\\s*(1[89]\\d\\d|20[0-3]\\d)`]);
  if (bj) f.baujahr = parseInt(bj[1], 10);

  const we = erste(flach, [`${ZAHL}\\s*(?:Wohneinheiten|WE\\b|Wohnungen|Parteien|Einheiten)`, `Wohneinheiten\\s*[:|]?\\s*(?:\\|\\s*)?${ZAHL}`, `(Ein|Zwei|Drei|Vier|Fünf|Sechs|Sieben|Acht)familienhaus`]);
  if (we) {
    const wort = { ein: 1, zwei: 2, drei: 3, vier: 4, "fünf": 5, sechs: 6, sieben: 7, acht: 8 }[String(we[1]).toLowerCase()];
    f.einheiten = wort || zahlDe(we[1]);
  }

  // Mieten: Jahresmiete hat Vorrang, sonst Monatsmieten aufsummieren
  const jahr = erste(flach, [`(?:Jahres(?:netto)?kaltmiete|Jahresmiete|Mieteinnahmen\\s*(?:p\\.\\s*a\\.|pro Jahr|jährlich)|Ist-Miete\\s*p\\.\\s*a\\.)\\s*(?:von|ca\\.?|:|\\|)?\\s*(?:ca\\.?\\s*)?${ZAHL}\\s*(?:€|EUR|Euro)`, `${ZAHL}\\s*(?:€|EUR|Euro)\\s*(?:Jahres(?:netto)?kaltmiete|p\\.\\s*a\\.|pro Jahr|im Jahr|jährlich)`]);
  if (jahr) f.ist_miete_jahr = zahlDe(jahr[1]);
  if (!f.ist_miete_jahr) {
    const monate = [...flach.matchAll(new RegExp(`(?:Kaltmiete|Nettokaltmiete|Miete)\\s*(?:von|i\\.\\s*H\\.\\s*v\\.|in H(?:ö|oe)he von|:|\\|)?\\s*(?:ca\\.?\\s*)?${ZAHL}\\s*(?:€|EUR|Euro)`, "gi"))].map((m) => zahlDe(m[1])).filter((v) => v >= 100 && v <= 20000);
    const monatlich = erste(flach, [`Mieteinnahmen\\s*(?:monatlich|pro Monat|mtl\\.?)?\\s*(?:von|:|\\|)?\\s*(?:ca\\.?\\s*)?${ZAHL}\\s*(?:€|EUR|Euro)\\s*(?:monatlich|pro Monat|mtl)`]);
    if (monatlich) f.ist_miete_monat = zahlDe(monatlich[1]);
    else if (monate.length) f.ist_miete_monat = monate.reduce((a, b) => a + b, 0);
  }
  const hausgeld = erste(flach, [`Hausgeld\\s*(?:von|:|\\|)?\\s*(?:ca\\.?\\s*)?${ZAHL}\\s*(?:€|EUR|Euro)`]);
  if (hausgeld) f.hausgeld_monat = zahlDe(hausgeld[1]);

  const prov = erste(flach, [`${ZAHL}\\s*%\\s*(?:Makler|K(?:ä|ae)uferprovision|Provision|Courtage|Maklercourtage)`, `(?:Makler|K(?:ä|ae)uferprovision|Provision|Courtage|Maklercourtage)[^|%]{0,40}?${ZAHL}\\s*%`]);
  if (prov) f.makler_prozent = zahlDe(prov[1]);
  else if (/provisionsfrei|ohne (?:makler|provision)|keine (?:makler|provision)|von privat/i.test(flach)) f.makler_prozent = 0;
  else if (/mit provision/i.test(flach)) f.makler_hinweis = "Provision laut Anzeige, Höhe unbekannt";

  const ek = erste(flach, [`Energieeffizienzklasse\\s*[:|]?\\s*(?:\\|\\s*)?(A\\+|[A-H])\\b`, `Effizienzklasse\\s*[:|]?\\s*(A\\+|[A-H])\\b`]);
  if (ek) f.energieklasse = ek[1].toUpperCase();
  const ev = erste(flach, [`${ZAHL}\\s*kWh\\s*/\\s*\\(?m(?:²|2)\\s*(?:·|\\*|x)?\\s*a`]);
  if (ev) f.energie_kwh = zahlDe(ev[1]);

  const plz = /\b(\d{5})\s+([A-ZÄÖÜ][\wäöüß.\- ]{2,30}?)(?=\s*[|,(]|$)/.exec(flach);
  if (plz) f.ort = `${plz[1]} ${plz[2].trim()}`.replace(/\s*(Nordrhein-Westfalen|Niedersachsen|Hessen|Bayern|Baden-Württemberg|Rheinland-Pfalz|Sachsen|Berlin|Hamburg|Bremen|Brandenburg|Thüringen|Schleswig-Holstein|Saarland|Mecklenburg-Vorpommern|Sachsen-Anhalt)\s*-\s*/, " ");

  const art = erste(flach, [`(Mehrfamilienhaus|Zweifamilienhaus|Dreifamilienhaus|Einfamilienhaus|Doppelhaushälfte|Reihenhaus|Bungalow|Eigentumswohnung|Wohn- und Geschäftshaus|Gewerbeimmobilie|Baugrundstück|Grundstück|Bürogebäude|Garage)`]);
  if (art) f.objektart = art[1];
  if (!f.objektart && /\bETW\b|Etagenwohnung|Dachgeschosswohnung|Erdgeschosswohnung|Wohnung/i.test(flach)) f.objektart = "Eigentumswohnung";
  if (f.einheiten >= 3 && !/Mehrfamilienhaus|Dreifamilienhaus|Wohn- und Geschäftshaus/.test(f.objektart || "")) f.objektart = "Mehrfamilienhaus";

  // Merkmale für Risiken und Strategien
  const m = (re) => re.test(flach);
  f.merkmale = {
    sanierungsbeduerftig: m(/sanierungsbed(?:ü|ue)rftig|renovierungsbed(?:ü|ue)rftig|modernisierungsbed(?:ü|ue)rftig|handwerker|kernsanierung|bastler/i),
    vermietet: m(/vermietet|mieteinnahmen|kaltmiete|mietvertr/i) && !m(/leerstehend|bezugsfrei|frei ab/i),
    leer: m(/leerstehend|bezugsfrei|frei ab|wird frei|werden[^|]{0,40}frei/i),
    denkmal: m(/denkmal/i),
    erbpacht: m(/erbpacht|erbbau/i),
    baurecht: m(/baugenehmigung|bauvorbescheid|§\s*34|bebauungsplan|bebaubar/i),
    zweites_grundstueck: m(/zweites flurst(?:ü|ue)ck|separate[sn]? flurst(?:ü|ue)ck|zus(?:ä|ae)tzliche[sn]? baugrundst(?:ü|ue)ck|teilbar/i),
    oelheizung: m(/(?:ö|oe)lheizung|heiz(?:ö|oe)l/i),
    nachtspeicher: m(/nachtspeicher/i),
    versteigerung: m(/versteigerung|zwangsversteiger/i),
    garage: m(/garage|stellpl(?:a|ä)tz/i),
  };
  return f;
}

// Zieht die Eckdaten aus einer heruntergeladenen Kleinanzeigen-Detailseite (HTML).
export function leseKleinanzeigenHtml(html) {
  const ohne = String(html)
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n");
  const titelM = /<h1[^>]*id="viewad-title"[^>]*>([\s\S]*?)<\/h1>/.exec(html) || /<meta property="og:title" content="([^"]+)"/.exec(html);
  const titel = titelM ? titelM[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().replace(/ \| kleinanzeigen\.de$/, "") : "";
  const start = ohne.indexOf(titel.slice(0, 30));
  const ende = ohne.search(/Nachricht schreiben|Anzeigennr|Ähnliche Anzeigen/);
  const ausschnitt = ohne.slice(Math.max(0, start), ende > start ? ende : start + 8000);
  const f = leseInserat(ausschnitt);
  f.titel = titel.replace(/\s+in\s+[^|]+?\s+-\s+.*$/, "").trim() || undefined;
  const beschr = /Beschreibung\n([\s\S]{0,6000})/.exec(ausschnitt);
  f.beschreibung = beschr ? beschr[1].trim().slice(0, 4000) : undefined;
  f.rohtext = ausschnitt.slice(0, 12000);
  return f;
}
