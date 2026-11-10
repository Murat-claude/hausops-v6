// Umbau-Rechnung für Büro-, Gewerbe- und Hotelobjekte: Wohnungen (vermieten oder verkaufen) und Service-Apartments.
// Alle Werte sind Annahmen und im Formular änderbar. Förderung: KfW 266 "Gewerbe zu Wohnen" (Zuschuss, kein Rechtsanspruch).
import { num } from "../rechner.js";

export const UMBAU_ANNAHMEN = {
  umbau_m2: 1600,            // €/m² Nutzfläche für Umbau Büro → Wohnen (Bäder, Küchen, Haustechnik, Brandschutz); Spanne ca. 1.200–2.200
  flaecheneffizienz: 80,     // % der Nutzfläche, die als Wohnfläche übrig bleibt (Flure, Treppen, Technik)
  miete_neu_m2: 10,          // €/m² kalt nach Umbau (neuwertig), Raum Hamm
  etw_neu_m2: 3200,          // €/m² Verkaufspreis umgebaute Wohnung, Raum Hamm
  apartment_preis: 55,       // € pro Nacht und Service-Apartment
  apartment_auslastung: 65,  // % Auslastung
  apartment_groesse: 30,     // m² je Service-Apartment
};

const eur = (v) => (v == null || !Number.isFinite(v) ? "–" : Math.round(v).toLocaleString("de-DE") + " €");
const r5 = (v) => Math.round(v / 5000) * 5000;

// Großstadt-Zuschlag für Dortmund, Bochum und Umgebung (PLZ 44…) – als Annahme ausgewiesen
function ortsZuschlag(ort) {
  return /^44\d{3}/.test(String(ort || "").trim()) ? { miete: 1.0, verkauf: 400, text: "Großstadtlage (PLZ 44…): Miete +1 €/m², Verkauf +400 €/m²" } : { miete: 0, verkauf: 0, text: "" };
}

// Kaufpreis per Halbierung suchen, bei dem eine Kennzahl die Grenze erreicht
function grenzpreis(fn, ziel, obergrenze) {
  let lo = 0, hi = Math.max(obergrenze, 1000);
  if (fn(lo) < ziel) return 0;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (fn(mid) >= ziel) lo = mid; else hi = mid; }
  return lo;
}

export function umbauStrategien(e, a, nkProzent, annahmenListe) {
  const u = { ...UMBAU_ANNAHMEN, ...Object.fromEntries(Object.entries(a).filter(([k]) => k in UMBAU_ANNAHMEN)) };
  const kp = num(e.kaufpreis);
  const fl = num(e.wohnflaeche_m2);
  if (!kp || !fl) return [];
  const zus = ortsZuschlag(e.ort);
  const mieteNeu = num(u.miete_neu_m2) + zus.miete;
  const etwNeu = num(u.etw_neu_m2) + zus.verkauf;
  const wfl = fl * num(u.flaecheneffizienz) / 100;
  const wohnungen = Math.max(1, Math.round(wfl / 60));
  const apartments = Math.max(1, Math.floor(wfl / num(u.apartment_groesse)));
  const umbau = fl * num(u.umbau_m2) * 1.15; // + 15 % Planung, Gutachten, Genehmigung
  const zins = num(a.zins) / 100, tilg = num(a.tilgung) / 100;
  const foerderung = Math.min(wohnungen * 30000, umbau * 0.30);

  annahmenListe.push(`Umbau: ${eur(umbau)} (${u.umbau_m2} €/m² Nutzfläche + 15 % Planung/Genehmigung; Spanne ca. 1.200–2.200 €/m²)`);
  annahmenListe.push(`Aus ${Math.round(fl)} m² Nutzfläche werden ca. ${Math.round(wfl)} m² Wohnfläche (${u.flaecheneffizienz} %): ca. ${wohnungen} Wohnungen à 60 m² oder ${apartments} Service-Apartments à ${u.apartment_groesse} m²`);
  annahmenListe.push(`Nach Umbau: Miete ${mieteNeu.toLocaleString("de-DE")} €/m², Verkauf ${etwNeu.toLocaleString("de-DE")} €/m²${zus.text ? ` (${zus.text})` : ""}`);
  annahmenListe.push(`Förderung KfW 266 „Gewerbe zu Wohnen“: bis ${eur(foerderung)} Zuschuss (30 % der Umbaukosten, max. 30.000 € je Wohnung) – nur beheizte Nichtwohngebäude, Antrag vor Baubeginn, kein Rechtsanspruch; Service-Apartments (Beherbergung) sind voraussichtlich nicht förderfähig`);

  // a) Umbau zu Wohnungen und vermieten (mit Förderung)
  const vermieten = (preis) => {
    const invest = preis * (1 + nkProzent / 100) + umbau - foerderung;
    const ek = invest * num(a.ek_prozent) / 100;
    const kapitaldienst = (invest - ek) * (zins + tilg);
    const miete = wfl * mieteNeu * 12;
    const noi = miete * 0.97 - wfl * 8 - wohnungen * 30 * 12 - wfl * 0.3 * 12; // Leerstand 3 %, Instandhaltung 8 €/m², Verwaltung, nicht umlagefähig
    return { cf: (noi - kapitaldienst) / 12, invest, noi };
  };
  const v = vermieten(kp);
  const vMax = grenzpreis((p) => vermieten(p).cf, 0, kp * 3);

  // b) Umbau und einzeln verkaufen (Projektentwicklung, 18 Monate)
  const verkaufen = (preis, mitFoerderung = true) => {
    const erloes = wfl * etwNeu;
    const kosten = preis * (1 + nkProzent / 100) + umbau - (mitFoerderung ? foerderung : 0);
    const zinsen = kosten * 0.75 * zins * 1.5;
    const gesamt = kosten + zinsen + erloes * 0.05;
    return { gewinn: erloes - gesamt, marge: (erloes - gesamt) / gesamt * 100, erloes };
  };
  const vk = verkaufen(kp);
  const vkMax = grenzpreis((p) => verkaufen(p).marge, 20, kp * 3);

  // c) Service-Apartments betreiben (ohne KfW-Zuschuss, mit Möblierung)
  const service = (preis) => {
    const moebel = apartments * 6000;
    const invest = preis * (1 + nkProzent / 100) + umbau + moebel;
    const ek = invest * num(a.ek_prozent) / 100;
    const kapitaldienst = (invest - ek) * (zins + tilg);
    const umsatz = apartments * num(u.apartment_preis) * 365 * num(u.apartment_auslastung) / 100;
    // Übernachtungspreis enthält 7 % USt.; 55 % Betriebskosten (Reinigung, Wäsche, Plattformgebühren, Personal, Energie, Ersatz Möbel)
    const noi = (umsatz / 1.07) * 0.45 - wfl * 10;
    return { cf: (noi - kapitaldienst) / 12, umsatz };
  };
  const sa = service(kp);
  const saMax = grenzpreis((p) => service(p).cf, 0, kp * 3);

  return [
    {
      name: "Umbau zu Wohnungen & vermieten",
      eignung: v.cf >= 300 ? "gut" : v.cf >= -200 ? "bedingt" : "nein",
      cashflow_monat: Math.round(v.cf),
      max_kaufpreis: r5(vMax),
      begruendung: `${wohnungen} Wohnungen, Miete ${eur(wfl * mieteNeu)}/Monat. Gesamtinvestition ${eur(v.invest)} nach Abzug KfW-Zuschuss. Nutzungsänderung muss genehmigungsfähig sein (Bebauungsplan, Stellplätze, Brandschutz).`,
    },
    {
      name: "Umbau & Wohnungen verkaufen",
      eignung: vk.marge >= 20 ? "gut" : vk.marge >= 10 ? "bedingt" : "nein",
      gewinn: Math.round(vk.gewinn),
      max_kaufpreis: r5(vkMax),
      begruendung: `Verkaufserlös ca. ${eur(vk.erloes)} (${wohnungen} Wohnungen à ${etwNeu.toLocaleString("de-DE")} €/m²). Marge ${vk.marge.toFixed(0)} % (Ziel ≥ 20 % bei Projektentwicklung), 18 Monate Bauzeit, 5 % Vertrieb. Achtung: Verkauf vieler Einheiten ist gewerblicher Grundstückshandel.`,
    },
    {
      name: "Service-Apartments",
      // Betrieb ist ein eigenes Geschäft mit hohem Auslastungsrisiko – höchstens "bedingt"
      eignung: sa.cf >= -200 ? "bedingt" : "nein",
      cashflow_monat: Math.round(sa.cf),
      max_kaufpreis: r5(saMax),
      begruendung: `${apartments} Apartments × ${u.apartment_preis} €/Nacht × ${u.apartment_auslastung} % Auslastung = ${eur(sa.umsatz)} Umsatz im Jahr (inkl. 7 % USt.), 55 % Betriebskosten, 6.000 € Möblierung je Apartment. Ohne KfW-Zuschuss (Beherbergung). Höchstens „bedingt“: braucht ein Betreiberkonzept oder einen Pächter – Auslastung erst mit Vergleichsobjekten belegen.`,
    },
  ];
}

export function umbauRisiken(e) {
  return [
    "Nutzungsänderung Gewerbe → Wohnen braucht eine Baugenehmigung. In reinen Gewerbe- oder Industriegebieten ist Wohnen meist unzulässig – vor dem Kauf Bebauungsplan prüfen und Bauvoranfrage stellen.",
    "Brandschutz (zweiter Rettungsweg), Schallschutz, Stellplatzpflicht und Belichtung tiefer Bürogrundrisse entscheiden über Machbarkeit und Kosten – früh einen Architekten draufschauen lassen.",
    "KfW 266 nur für beheizte Nichtwohngebäude, Antrag vor Baubeginn, Mittel begrenzt, laut Richtlinie bis Ende 2026 – Förderung nicht als sicher einplanen.",
    "Bestehende Gewerbemietverträge, Altlasten und Schadstoffe (Asbest in Bürobauten der 60er–80er) prüfen.",
  ];
}
