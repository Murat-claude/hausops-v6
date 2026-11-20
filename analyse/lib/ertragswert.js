// Wertermittlung nach Immobilienwertermittlungsverordnung (ImmoWertV 2021, §§ 27–34):
// Ertragswert für Renditeobjekte (Mehrfamilien-, Wohn- und Geschäftshaus), Vergleichswert für Wohnungen und Häuser.
// Werte der Gutachterausschüsse (Grundstücksmarktbericht 2026, Daten 2025) – die amtliche Grundlage, auf der auch Banken
// und Sachverständige rechnen. Ergebnis ist eine Plausibilitätsprüfung, kein Verkehrswertgutachten.

// Bewirtschaftungskosten nach Anlage 3 ImmoWertV, fortgeschrieben ab 1.1.2026
export const BEWIRTSCHAFTUNG_2026 = { verwaltung_we: 367, verwaltung_etw: 439, instandhaltung_m2: 14.4, mietausfall: 0.02 };

// Kennzahlen je Gutachterausschuss: Liegenschaftszins (lz, %), marktübliche Miete (€/m²), Restnutzungsdauer (rnd), Kaufpreis (€/m² Wohnfläche)
export const GUTACHTER = {
  Hamm: {
    quelle: "Grundstücksmarktbericht 2026 Hamm (Daten 2025)",
    mfh: { lz: 3.5, miete: 6.4, rnd: 40, kauf: 1345 },
    wgh: { lz: 4.3, miete: 6.6, rnd: 29, kauf: 1084 },
    dreifam: { lz: 2.4, miete: 6.1, rnd: 28, kauf: 1233 },
    zweifam: { lz: 1.3, miete: 6.4, rnd: 42, kauf: 2538 },
    efh: { lz: 1.0, miete: 6.5, rnd: 45, kauf: 3037 },
    reihen: { lz: 1.1, miete: 6.7, rnd: 47, kauf: 2704 },
    etw: { lz: 1.8, miete: 6.2, rnd: 42, kauf: 1826 },
  },
  Dortmund: {
    quelle: "Grundstücksmarktbericht 2026 Dortmund (Daten 2025)",
    mfh: { lz: 2.6, miete: 7.11, rnd: 22, kauf: 1432 },
    efh: { lz: 1.4, miete: 7.91, rnd: 32, kauf: 3471 },
    etw: { lz: 1.1, miete: 7.5, rnd: 33, kauf: 2131 },
  },
};

// Objektart → Schlüssel in der Gutachter-Tabelle
export function gutachterArt(objektart = "", einheiten = 1) {
  const o = String(objektart).toLowerCase();
  if (/wohn- und geschäft/.test(o)) return "wgh";
  if (/wohnung/.test(o)) return "etw";
  if (/dreifamilien/.test(o) || (/mehrfamilien/.test(o) && einheiten === 3)) return "dreifam";
  if (/mehrfamilien/.test(o) || einheiten >= 3) return "mfh";
  if (/zweifamilien/.test(o) || einheiten === 2) return "zweifam";
  if (/reihen|doppel/.test(o)) return "reihen";
  if (/einfamilien|haus/.test(o)) return "efh";
  return null;
}

// Kennzahlen für Ort und Objektart; ohne eigene Werte gilt Hamm (als Annahme gekennzeichnet)
export function gutachterWerte(ortName, art) {
  if (!art) return null;
  const eigene = GUTACHTER[ortName]?.[art];
  const wert = eigene || GUTACHTER.Hamm[art] || GUTACHTER.Hamm.mfh;
  return { ...wert, quelle: eigene ? GUTACHTER[ortName].quelle : `${GUTACHTER.Hamm.quelle} – für ${ortName || "diesen Ort"} als Annahme übernommen`, eigene: Boolean(eigene) };
}

const barwertfaktor = (p, n) => (p > 0 ? (1 - Math.pow(1 + p, -n)) / p : n);

// Restnutzungsdauer: Gesamtnutzungsdauer 80 Jahre (Anlage 1 ImmoWertV), Modernisierung verlängert
function restnutzung(baujahr, sanierungsjahr, standardRnd) {
  if (!baujahr) return standardRnd;
  const jahr = new Date().getFullYear();
  let rnd = 80 - (jahr - baujahr);
  if (sanierungsjahr >= 2005) rnd = Math.max(rnd, 40);
  return Math.max(25, Math.min(80, rnd)); // erhaltene Altbauten: mindestens 25 Jahre (übliche Modernisierungen)
}

/**
 * @param e Eingabe (objektart, wohnflaeche_m2, grundstueck_m2, einheiten, baujahr, sanierungsjahr)
 * @param o { ortName, bodenrichtwert, jahresmiete (Ist oder realistisch) }
 */
export function wertermittlung(e, o = {}) {
  const fl = Number(e.wohnflaeche_m2) || 0;
  const einheiten = Math.max(1, Number(e.einheiten) || 1);
  const art = gutachterArt(e.objektart, einheiten);
  if (!fl || !art || /grundst|gewerbe|büro|hotel/i.test(e.objektart || "")) return null;
  const g = gutachterWerte(o.ortName, art);
  const ertrag = ["mfh", "wgh", "dreifam"].includes(art);
  const alt = e.baujahr && e.baujahr < 1980 && !(e.sanierungsjahr >= 2005) ? 0.85 : 1;

  if (!ertrag) {
    // Vergleichswert: Ø-Kaufpreis des Gutachterausschusses, unsanierte Altbauten mit Abschlag
    const wert = fl * g.kauf * alt;
    return { methode: "Vergleichswert", wert: Math.round(wert / 1000) * 1000, text: `${Math.round(fl)} m² × ${g.kauf.toLocaleString("de-DE")} €/m² (Ø Kaufpreis ${art === "etw" ? "Eigentumswohnung" : "Haus"})${alt < 1 ? " × 0,85 (unsaniert vor 1980)" : ""}`, quelle: g.quelle, g };
  }

  // Ertragswert: Rohertrag aus marktüblicher Miete (Ist-Miete höchstens 30 % darüber)
  const marktJahr = fl * g.miete * 12;
  const roh = o.jahresmiete > 0 ? Math.min(o.jahresmiete, marktJahr * 1.3) : marktJahr;
  const b = BEWIRTSCHAFTUNG_2026;
  const bewirt = einheiten * b.verwaltung_we + fl * b.instandhaltung_m2 + roh * b.mietausfall;
  const rein = roh - bewirt;
  const p = g.lz / 100;
  const rnd = restnutzung(e.baujahr, e.sanierungsjahr, g.rnd);
  const gfl = Number(e.grundstueck_m2) || 0;
  const boden = gfl && o.bodenrichtwert ? gfl * o.bodenrichtwert : 0;
  // Mit Bodenwert: allgemeines Ertragswertverfahren; ohne: vereinfachtes Verfahren (Reinertrag × Barwertfaktor)
  const wert = boden ? Math.max(rein - boden * p, 0) * barwertfaktor(p, rnd) + boden : Math.max(rein, 0) * barwertfaktor(p, rnd);
  return {
    methode: "Ertragswert",
    wert: Math.round(wert / 1000) * 1000,
    text: `Rohertrag ${Math.round(roh).toLocaleString("de-DE")} €/Jahr − Bewirtschaftung ${Math.round(bewirt).toLocaleString("de-DE")} € (ImmoWertV 2026) = Reinertrag ${Math.round(rein).toLocaleString("de-DE")} €; Liegenschaftszins ${g.lz.toLocaleString("de-DE")} %, Restnutzungsdauer ${rnd} Jahre${boden ? `, Bodenwert ${Math.round(boden).toLocaleString("de-DE")} €` : ", Bodenwert unbekannt (Grundstücksgröße fehlt)"}`,
    quelle: g.quelle, g, rnd, rein,
  };
}
