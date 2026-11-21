// Unser Suchprofil (festgelegt im Frage-Antwort-Gespräch am 21.11.2026).
// Scout, Bewertung und die Anfrage an Claude richten sich danach.
export const SUCHPROFIL = {
  strategien: ["Ferienvermietung (Winterberg)", "Halten & vermieten", "Aufteilung in Eigentumswohnungen", "Fix & Flip", "Umbau Gewerbe → Wohnen", "Ferien-/Monteurwohnung", "Grundstück bebauen"],
  region: { mitte: "Hamm", km: 50, text: "50 km um Hamm inkl. Dortmund, Bochum, Hagen, Münster, Kreise Unna, Soest, Warendorf – plus Rubrik Winterberg & Ferien (20 km um Winterberg)" },
  budget: { min: 30000, max: 1500000 },
  objektarten: ["Mehrfamilienhaus", "Wohn- und Geschäftshaus", "Zwei-/Dreifamilienhaus", "Eigentumswohnung", "Einfamilienhaus", "Gewerbe/Büro zum Umbau", "Grundstück"],
  zustand: "alles, wenn der Preis passt (Sanierung wird eingerechnet)",
  sonderfaelle: { zwangsversteigerung: true, erbpacht: true, denkmal: true, wohnrecht: false },
  top: "trägt sich zum Angebotspreis auch im vorsichtigen Fall, mit 10.000 € Eigenkapital",
  eigenkapital: 10000,
};

// Anzeigen mit Wohnrecht, Nießbrauch oder Verrentung passen nicht ins Profil
export const PROFIL_AUSSCHLUSS = /wohnrecht|nie(?:ß|ss)brauch|leibrente|verrentung|immobilienrente|lebenslang(?:es|em)? (?:wohn|nutzungs)/i;

export function profilText(p = SUCHPROFIL) {
  return [
    `Strategien: ${p.strategien.join(", ")}`,
    `Region: ${p.region.text}`,
    `Kaufpreis: ${p.budget.min.toLocaleString("de-DE")} – ${p.budget.max.toLocaleString("de-DE")} €`,
    `Objektarten: ${p.objektarten.join(", ")}`,
    `Zustand: ${p.zustand}`,
    `Sonderfälle: Zwangsversteigerung, Erbpacht und Denkmal ja – Wohnrecht/Nießbrauch nein`,
    `Top: ${p.top}`,
  ];
}
