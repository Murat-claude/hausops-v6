// Ferienvermietung (Winterberg und Umgebung) – Rechnung nach dem Skill "ferienwohnung-profi":
// Umsatz = Nächte × Übernachtungspreis (ADR); Netto = Umsatz − Plattform − Betreuung vor Ort − Reinigung − Nebenkosten − Instandhaltung.
// Drei Szenarien über die Auslastung. Alle Werte sind Annahmen und im Formular änderbar.
//
// Quellen (Stand Nov. 2026):
// - Statistik NRW, Reisegebiet Sauerland 2025: Bettenauslastung 41,3 %, Ø Aufenthalt 3,1 Nächte
// - Winterberg 2025: 1,24 Mio. Übernachtungen (+7,7 %) (Radio Sauerland / Sauerland-Tourismus)
// - Kayak: Ferienwohnungen in Winterberg ab ca. 76 € pro Nacht
// - Stadt Winterberg: Wohnraumschutzsatzungen vom 05.11.2026 (Genehmigung für neue Ferienwohnungen, Wohnraum-ID)
import { num } from "../rechner.js";

export const FERIEN_ANNAHMEN = {
  fewo_auslastung: 45,      // % der Nächte belegt (realistisch); vorsichtig −10, gut +10 Punkte
  fewo_adr_klein: 80,       // € pro Nacht bis 45 m² (2 Personen)
  fewo_adr_mittel: 100,     // € pro Nacht 45–75 m² (4 Personen)
  fewo_adr_gross: 130,      // € pro Nacht 75–110 m² (6 Personen)
  fewo_adr_haus: 170,       // € pro Nacht ab 110 m² als ganzes Ferienhaus
  fewo_betreuung: 20,       // % vom Umsatz für Betreuung vor Ort (Schlüssel, Kontrolle, Gäste) – ihr wohnt 150 km entfernt
  fewo_plattform: 15,       // % vom Umsatz für Airbnb/Booking/Zahlung
  fewo_moebel_m2: 250,      // €/m² Einrichtung, falls nicht möbliert verkauft
};

// Orte der Ferienregion (PLZ) und Ortsteile ohne Winterberger Wohnraumschutzsatzung
const FERIEN_PLZ = /^(59955|59964|59969|34508|59939|59929|57392)/;
const OHNE_SATZUNG = /grönebach|groenebach|langewiese|hoheleye|mollseifen|altenfeld|lenneplätze|lenneplaetze/i;

export const istFerienregion = (e) => e.rubrik === "ferien" || FERIEN_PLZ.test(String(e.ort || "").trim());

// Ist die Ferienvermietung schon genehmigt? Hinweise aus der Anzeige
export function genehmigungsLage(e) {
  const t = `${e.titel || ""} ${e.beschreibung || ""} ${e.ort || ""}`;
  const genehmigt = /(?:als )?ferienwohnung(?:en)? (?:ist |sind )?(?:baurechtlich )?genehmigt|genehmigte ferien|ferienvermietung (?:ist )?(?:erlaubt|genehmigt|zulässig)|sondergebiet ferien|ferienhausgebiet|ferienhaussiedlung|ferienpark|teilungserklärung erlaubt.{0,30}ferien|derzeit als ferien|aktuell als ferien|wird als ferienwohnung vermietet|laufende buchungen|belegungsplan|buchungskalender|übernahme der buchungen/i.test(t);
  if (genehmigt) return { stufe: "genehmigt", text: "Anzeige spricht von genehmigter bzw. laufender Ferienvermietung – Genehmigung (Bauakte) und Teilungserklärung vorlegen lassen." };
  // Die Satzung gilt nur in der Stadt Winterberg (PLZ 59955) – nicht in Willingen, Medebach, Hallenberg usw.
  const inWinterberg = /^\s*59955\b/.test(String(e.ort || "")) || (!/\d{5}/.test(String(e.ort || "")) && /winterberg/i.test(String(e.ort || "")));
  if (inWinterberg && OHNE_SATZUNG.test(t)) return { stufe: "frei", text: "Ortsteil ohne Winterberger Wohnraumschutzsatzung – keine Zweckentfremdungsgenehmigung nötig, Baurecht trotzdem prüfen." };
  if (inWinterberg) return { stufe: "genehmigung", text: "Winterberg (Kernstadt oder Ortsteil mit Wohnraumschutzsatzung seit 05.11.2026): Ferienvermietung über 90 Tage im Jahr braucht vorher eine Genehmigung der Stadt und eine Wohnraum-ID (ab 01.04.2027 Pflicht in Inseraten). Kein Rechtsanspruch – vor dem Kauf bei der Stadt anfragen." };
  return { stufe: "pruefen", text: "Zulässigkeit der Ferienvermietung (Bebauungsplan, Satzung der Gemeinde, bei Wohnungen die Teilungserklärung) vor dem Kauf prüfen." };
}

function adr(m2, a) {
  if (m2 <= 45) return num(a.fewo_adr_klein);
  if (m2 <= 75) return num(a.fewo_adr_mittel);
  if (m2 <= 110) return num(a.fewo_adr_gross);
  return num(a.fewo_adr_haus);
}

function grenzpreis(fn, obergrenze) {
  let lo = 0, hi = Math.max(obergrenze, 1000);
  if (fn(lo) < 0) return 0;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (fn(mid) >= 0) lo = mid; else hi = mid; }
  return lo;
}

const eur = (v) => Math.round(v).toLocaleString("de-DE") + " €";
const r5 = (v) => Math.round(v / 5000) * 5000;

/**
 * Ferienvermietung als Strategie. e: Eingabe, a: Annahmen (mit zins, tilgung, ek_betrag), nkProzent: Kaufnebenkosten, sanierung: €
 */
export function ferienStrategie(e, a, nkProzent, sanierung, annahmenListe = []) {
  const u = { ...FERIEN_ANNAHMEN, ...Object.fromEntries(Object.entries(a).filter(([k]) => k in FERIEN_ANNAHMEN)) };
  const kp = num(e.kaufpreis), fl = num(e.wohnflaeche_m2);
  if (!kp || !fl) return null;
  const art = String(e.objektart || "");
  const pension = /hotel|pension|gewerbe/i.test(art);
  const etw = /wohnung/i.test(art);
  // Einheiten: Wohnung = 1; Mehrfamilienhaus = Wohnungen; Pension = Zimmer zu Apartments (ca. 45 m² Nutzfläche); Haus = ganzes Ferienhaus
  let einheiten = etw ? 1 : pension ? Math.max(1, Math.round(fl * 0.8 / 45)) : num(e.einheiten) >= 2 ? num(e.einheiten) : fl > 160 ? Math.max(2, Math.round(fl / 70)) : 1;
  const m2je = (pension ? fl * 0.8 : fl) / einheiten;
  const preisNacht = adr(m2je, u);
  const t = `${e.titel || ""} ${e.beschreibung || ""}`;
  const moebliert = /möbliert|moebliert|eingerichtet|komplett ausgestattet|voll ausgestattet|inventar|mit einrichtung|inkl\.? (?:küche|möbel)/i.test(t);
  const moebel = moebliert ? 0 : fl * num(u.fewo_moebel_m2);
  const umbau = pension ? fl * 500 : 0; // Pensionszimmer zu Apartments (Küchenzeilen, Bäder anpassen)
  const hausgeld = num(e.hausgeld_monat) * 12;
  const zins = num(a.zins) / 100, tilg = num(a.tilgung) / 100;
  const ek = num(e.eigenkapital) || num(a.ek_betrag) || 10000;

  const rechne = (preis, ausl) => {
    const naechte = 365 * ausl / 100 * einheiten;
    const umsatz = naechte * preisNacht;
    const netto = umsatz / 1.07; // Übernachtung mit 7 % Umsatzsteuer
    const aufenthalte = naechte / 3.1;
    const kosten = netto * (num(u.fewo_plattform) + num(u.fewo_betreuung)) / 100
      + aufenthalte * 35                       // Reinigung/Wäsche, soweit nicht über die Endreinigungsgebühr gedeckt
      + (etw ? hausgeld * 0.6 + 900 : fl * 3.5 * 12) // Nebenkosten trägt der Vermieter (Strom, Heizung, Wasser, Internet, Versicherung)
      + fl * 15                                // Instandhaltung
      + netto * 0.03;                          // Ersatz Einrichtung
    const invest = preis * (1 + nkProzent / 100) + sanierung + moebel + umbau;
    const rate = Math.max(invest - ek, 0) * (zins + tilg);
    return { umsatz, netto, kosten, rein: netto - kosten, rate, cf: (netto - kosten - rate) / 12, naechte, invest };
  };
  const ausl = num(u.fewo_auslastung);
  const real = rechne(kp, ausl), vors = rechne(kp, ausl - 10), gut = rechne(kp, ausl + 10);
  const maxKp = grenzpreis((p) => rechne(p, ausl).cf, kp * 3);
  const maxVors = grenzpreis((p) => rechne(p, ausl - 10).cf, kp * 3);
  const lage = genehmigungsLage(e);

  annahmenListe.push(`Ferienvermietung: ${einheiten} Einheit${einheiten > 1 ? "en" : ""} à ca. ${Math.round(m2je)} m², ${preisNacht} € pro Nacht, Auslastung ${ausl} % (vorsichtig ${ausl - 10} %, gut ${ausl + 10} %; Sauerland 2025: 41 % Bettenauslastung), Plattform ${u.fewo_plattform} %, Betreuung vor Ort ${u.fewo_betreuung} %${moebel ? `, Einrichtung ${eur(moebel)}` : ", laut Anzeige möbliert"}${umbau ? `, Umbau Zimmer → Apartments ${eur(umbau)}` : ""}`);

  // "Gut" nur, wenn es auch bei 10 Punkten weniger Auslastung trägt und die Vermietung rechtlich nicht offen ist
  let eignung = real.cf >= 150 && vors.cf >= -150 ? "gut" : real.cf >= -150 ? "bedingt" : "nein";
  if (eignung === "gut" && lage.stufe === "genehmigung") eignung = "bedingt";
  return {
    buchstabe: "E",
    name: "Ferienvermietung",
    ferien: true,
    eignung,
    cashflow_monat: Math.round(real.cf),
    max_kaufpreis: r5(maxKp),
    max_kaufpreis_vorsichtig: r5(maxVors),
    genehmigung: lage.stufe,
    begruendung: `${Math.round(real.naechte)} Nächte × ${preisNacht} € = ${eur(real.umsatz)} Umsatz im Jahr (realistisch). Nach Plattform, Betreuung, Reinigung, Nebenkosten und Instandhaltung bleiben ${eur(real.rein)}; Kreditrate ${eur(real.rate)}. Vorsichtig (${ausl - 10} %): ${eur(vors.cf)}/Monat, gut (${ausl + 10} %): ${eur(gut.cf)}/Monat. ${lage.text}`,
    nein_wenn: `die Auslastung unter ${ausl - 10} % fällt (${Math.round(365 * (ausl - 10) / 100)} Nächte im Jahr) oder die Stadt keine Genehmigung erteilt`,
    risiko: lage.text,
  };
}
