// Selbstständigkeit: Einnahmen-Überschuss-Rechnung (Anlage EÜR) + Anlage S (freiberuflich) bzw. Anlage G (gewerblich)
// Stand: Veranlagungsjahre 2025/2026. Keine Steuerberatung – Ausfüllhilfe auf Basis der erfassten Daten.

export const BIZ_KINDS = {
  freiberuflich: { label: "Freiberuflich (Anlage S)", anlage: "S", examples: "z. B. Berater/Coach, IT-/Software-Entwicklung, Ingenieur, Architekt, Journalist, Übersetzer, Fotograf (künstlerisch), Dozent, Heilberufe" },
  gewerblich: { label: "Gewerbe (Anlage G)", anlage: "G", examples: "z. B. Handel/Online-Shop, Handwerk, Vermittlung/Makler, Reinigung, Hausmeisterservice, gewerbliche Ferienvermietung, Gastronomie, Fotograf (Werbung/Events oft gewerblich)" },
};

// Kategorien mit Zuordnung zu den Bereichen der Anlage EÜR (Feldbezeichnungen, nicht Zeilennummern – die ändern sich jährlich)
export const EUER_CATS = {
  umsatz:       { side: "ein", label: "Umsätze (Rechnungen an Kunden)", euer: "Betriebseinnahmen als umsatzsteuerpflichtiger Unternehmer" },
  umsatz_frei:  { side: "ein", label: "Umsätze ohne Umsatzsteuer (steuerfrei / Kleinunternehmer)", euer: "Umsatzsteuerfreie, nicht umsatzsteuerbare Betriebseinnahmen bzw. Betriebseinnahmen als Kleinunternehmer" },
  ust_erstattet:{ side: "ein", label: "Vom Finanzamt erstattete Umsatzsteuer", euer: "Vom Finanzamt erstattete und ggf. verrechnete Umsatzsteuer", noVat: true },
  sonst_ein:    { side: "ein", label: "Sonstige Betriebseinnahmen (z. B. Zuschüsse, Verkauf von Anlagegütern)", euer: "Sonstige Betriebseinnahmen" },
  waren:        { side: "aus", label: "Waren, Material, Rohstoffe", euer: "Waren, Rohstoffe und Hilfsstoffe einschließlich der Nebenkosten" },
  fremd:        { side: "aus", label: "Fremdleistungen / Subunternehmer", euer: "Bezogene Fremdleistungen" },
  personal:     { side: "aus", label: "Personal (Löhne, Minijob, Sozialabgaben)", euer: "Ausgaben für eigenes Personal" },
  gwg:          { side: "aus", label: "Geringwertige Wirtschaftsgüter bis 800 € netto (Laptop, Möbel …)", euer: "Aufwendungen für geringwertige Wirtschaftsgüter" },
  afa:          { side: "aus", label: "Abschreibung größerer Anschaffungen (AfA)", euer: "Absetzung für Abnutzung (AfA) auf bewegliche Wirtschaftsgüter", noVat: true },
  raum:         { side: "aus", label: "Miete Büro/Werkstatt, Raumkosten", euer: "Miete/Pacht für Geschäftsräume und betrieblich genutzte Grundstücke" },
  telefon:      { side: "aus", label: "Telefon, Internet", euer: "Aufwendungen für Telekommunikation" },
  kfz:          { side: "aus", label: "Fahrzeugkosten (Leasing, Sprit, Versicherung, Reparatur)", euer: "Kraftfahrzeugkosten und andere Fahrtkosten" },
  reise:        { side: "aus", label: "Reisekosten, Übernachtung", euer: "Übernachtungs- und Reisenebenkosten bei Geschäftsreisen" },
  werbung:      { side: "aus", label: "Werbung, Website, Marketing", euer: "Werbeaufwendungen" },
  fortbildung:  { side: "aus", label: "Fortbildung, Fachliteratur", euer: "Fortbildungskosten" },
  beratung:     { side: "aus", label: "Steuerberatung, Buchhaltung, Rechtsberatung", euer: "Rechts- und Steuerberatung, Buchführung" },
  versicherung: { side: "aus", label: "Betriebliche Versicherungen, Beiträge (IHK, Kammer)", euer: "Beiträge, Gebühren, Abgaben und Versicherungen" },
  buero:        { side: "aus", label: "Bürobedarf, Porto, Software, Abos", euer: "Übrige unbeschränkt abziehbare Betriebsausgaben" },
  bewirtung:    { side: "aus", label: "Bewirtung von Geschäftspartnern (70 % abziehbar)", euer: "Bewirtungsaufwendungen (abziehbar 70 %)", quota: 0.7 },
  geschenke:    { side: "aus", label: "Geschenke an Geschäftspartner (bis 50 € je Person/Jahr)", euer: "Geschenke" },
  zinsen:       { side: "aus", label: "Zinsen für betriebliche Kredite", euer: "Schuldzinsen", noVat: true },
  ust_gezahlt:  { side: "aus", label: "An das Finanzamt gezahlte Umsatzsteuer", euer: "An das Finanzamt gezahlte und ggf. verrechnete Umsatzsteuer", noVat: true },
  sonst_aus:    { side: "aus", label: "Sonstige Betriebsausgaben", euer: "Übrige unbeschränkt abziehbare Betriebsausgaben" },
  privat:       { side: "aus", label: "Privat (zählt nicht)", euer: null, noVat: true },
};

export const HOMEOFFICE_PER_DAY = 600, HOMEOFFICE_MAX = 126000, KM_RATE = 30; // Cent
export const KU_LIMIT_PREV = 2500000, KU_LIMIT_CUR = 10000000; // Kleinunternehmer ab 2025: Vorjahr ≤ 25.000 €, laufendes Jahr ≤ 100.000 €
export const GEWST_FREIBETRAG = 2450000;

const netOf = (gross, rate) => (rate ? Math.round(gross / (1 + rate / 100)) : gross);

// Zusammenfassung je Tätigkeit und Jahr (Zuflussprinzip: Datum der Zahlung)
export function euer(state, businessId, year) {
  const b = (state.businesses || []).find((x) => x.id === businessId) || {};
  const ku = !!b.kleinunternehmer;
  const lines = {}; let vatIn = 0, vatOut = 0;
  const add = (k, v) => { lines[k] = (lines[k] || 0) + v; };
  for (const e of state.bizEntries || []) {
    if (e.businessId !== businessId || !String(e.date).startsWith(String(year))) continue;
    const cat = EUER_CATS[e.category]; if (!cat || !cat.euer) continue;
    const rate = ku || cat.noVat ? 0 : Number(e.vat) || 0;
    const net = netOf(e.amount, rate), vat = e.amount - net;
    if (cat.side === "ein") { add(ku && e.category === "umsatz" ? "umsatz_frei" : e.category, net); vatIn += vat; }
    else { add(e.category, Math.round(net * (cat.quota || 1))); vatOut += vat; }
  }
  const p = (b.yearData || {})[year] || {};
  const homeoffice = Math.min(HOMEOFFICE_MAX, (Number(p.homeofficeDays) || 0) * HOMEOFFICE_PER_DAY);
  const km = Math.round((Number(p.km) || 0) * KM_RATE);
  if (homeoffice) add("homeoffice", homeoffice);
  if (km) add("km", km);
  if (!ku && vatIn) add("ust_vereinnahmt", vatIn);
  if (!ku && vatOut) add("vorsteuer", vatOut);
  const IN = ["umsatz", "umsatz_frei", "sonst_ein", "ust_vereinnahmt", "ust_erstattet"];
  const income = IN.reduce((s, k) => s + (lines[k] || 0), 0);
  const costs = Object.entries(lines).filter(([k]) => !IN.includes(k)).reduce((s, [, v]) => s + v, 0);
  return { business: b, ku, lines, income, costs, profit: income - costs, vatIn, vatOut, homeoffice, km, umsatzBrutto: (lines.umsatz || 0) + (lines.umsatz_frei || 0) + vatIn };
}

export const EXTRA_LINES = {
  homeoffice: { label: "Homeoffice-Pauschale (6 € je Tag, max. 1.260 €)", euer: "Tagespauschale für die Tätigkeit in der häuslichen Wohnung" },
  km: { label: "Fahrten mit dem Privat-Pkw (0,30 €/km)", euer: "Kraftfahrzeugkosten und andere Fahrtkosten" },
  ust_vereinnahmt: { label: "Vereinnahmte Umsatzsteuer", euer: "Vereinnahmte Umsatzsteuer sowie Umsatzsteuer auf unentgeltliche Wertabgaben" },
  vorsteuer: { label: "Gezahlte Vorsteuer", euer: "Gezahlte Vorsteuerbeträge" },
};
export const lineInfo = (k) => EUER_CATS[k] || EXTRA_LINES[k] || { label: k, euer: k };

// Prüfhinweise wie beim Steuerberater
export function bizChecks(state, businessId, year) {
  const r = euer(state, businessId, year), b = r.business, out = [];
  const add = (level, text) => out.push({ level, text });
  if (!b.kind) add("bad", "Art der Tätigkeit fehlt: freiberuflich (Anlage S) oder Gewerbe (Anlage G)? Im Assistenten beantworten.");
  if (b.kind === "gewerblich" && !b.gewerbeAngemeldet) add("warn", "Gewerbe muss beim Gewerbeamt angemeldet sein. Gewerbesteuer fällt erst ab 24.500 € Gewinn an (Freibetrag) und wird größtenteils auf die Einkommensteuer angerechnet.");
  if (b.kind === "gewerblich" && r.profit > GEWST_FREIBETRAG) add("warn", `Gewinn über 24.500 €: Gewerbesteuererklärung erforderlich (die Gewerbesteuer wird über § 35 EStG weitgehend angerechnet).`);
  if (b.kleinunternehmer && r.umsatzBrutto > KU_LIMIT_CUR) add("bad", "Umsatz über 100.000 €: Kleinunternehmerregelung entfällt sofort ab dem Umsatz, der die Grenze überschreitet.");
  else if (b.kleinunternehmer && r.umsatzBrutto > KU_LIMIT_PREV) add("warn", "Umsatz über 25.000 €: Im nächsten Jahr ist die Kleinunternehmerregelung nicht mehr möglich – ab 1.1. mit Umsatzsteuer abrechnen.");
  if (!b.kleinunternehmer && r.vatIn) add("info", "Umsatzsteuer: zusätzlich Umsatzsteuer-Jahreserklärung abgeben (Voranmeldungen während des Jahres, je nach Höhe monatlich/vierteljährlich).");
  if (r.income >= 0 && !(state.bizEntries || []).some((e) => e.businessId === businessId && String(e.date).startsWith(String(year)))) add("bad", `Für ${year} sind noch keine Einnahmen/Ausgaben erfasst.`);
  if ((r.lines.bewirtung || 0)) add("info", "Bewirtung: Nur 70 % sind abziehbar (bereits berücksichtigt). Bewirtungsbeleg mit Anlass und Teilnehmern aufbewahren.");
  if (r.profit < 0) add("info", "Verlust: wird mit anderen Einkünften (z. B. Vermietung, Gehalt) verrechnet. Bei dauerhaften Verlusten fragt das Finanzamt nach der Gewinnerzielungsabsicht.");
  return out;
}
