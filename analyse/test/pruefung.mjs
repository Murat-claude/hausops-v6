// Prüfkatalog für Einlesen und Auswertung: node analyse/test/pruefung.mjs
// Jeder Fall stammt aus einem echten Fehler oder einer typischen Anzeigen-Formulierung.
import { leseInserat } from "../lib/inserat-parse.js";
import { auswerten } from "../lib/auswertung.js";

const faelle = [
  ["Jahresmiete aus Fließtext (Soest-Fehler)", "Altbauwohnung, Kaufpreis 789.000 €, Wohnfläche 135,63 m². Die Wohnung erzielt eine jährliche Kaltmiete in Höhe von 16.507,32 €. Ein Stellplatz kann für 9.900 € erworben werden. Garagen/Stellplatzkaufpreis: 9.900,00 €. x-fach Miete: 47.80", { kaufpreis: 789000, miete: 1376, ampel: "rot" }],
  ["Saniertes Baujahr vs. Altbau", "Eigentumswohnung 100 m², Kaufpreis 300.000 €. Baujahr 2014. Im Jahr 2014 kernsanierter Altbau aus dem Jahr 1867.", { kaufpreis: 300000, baujahr: 1867 }],
  ["MFH mit Jahresnettokaltmiete", "Voll vermietetes MFH in 59597 Erwitte, Baujahr 1952, 6 Wohneinheiten, ca. 400 m² Wohnfläche, Kaufpreis: 320.000 €, Jahresnettokaltmiete 31.200 €, provisionsfrei", { kaufpreis: 320000, miete: 2600 }],
  ["Wohnung mit Hausgeld", "3-Zimmer-Eigentumswohnung in 59199 Bönen, 86 m², 89.000 €, Kaltmiete 520 €, Hausgeld 280 €, Baujahr 1972, 3,57 % Käuferprovision, vermietet", { kaufpreis: 89000, miete: 520 }],
  ["Einzelmieten mehrerer Wohnungen", "Dreifamilienhaus, Kaufpreis 349.000 €. EG: Kaltmiete 520 €, OG: Kaltmiete 540 €, DG Kaltmiete 410 €. Wohnfläche 210 m². Stellplatz kann für 15.000 € erworben werden.", { kaufpreis: 349000, miete: 1470 }],
  ["'jährliche' direkt nach dem Preis", "ETW 70 m², Preis 150.000 €, die jährliche Kaltmiete beträgt 6.600 €. Ein Stellplatz kostet zusätzlich 9.900 €.", { kaufpreis: 150000, miete: 550 }],
  ["Garagenpreis vor dem Kaufpreis", "Garage für 12.000 € optional. Kaufpreis: 210.000 €. Wohnfläche 95 m². Mieteinnahmen 8.400 € p.a.", { kaufpreis: 210000, miete: 700 }],
  ["Getrennte Kaufpreise Stellplatz/Wohnung", "Wohnung 80 m². Kaufpreis Stellplatz: 9.900 €. Kaufpreis Wohnung: 199.000 €", { kaufpreis: 199000 }],
  ["Monatsmiete mit 'monatlich'", "Haus 120 m², 260.000 €, Kaltmiete 900 € monatlich, Baujahr 1975", { kaufpreis: 260000, miete: 900 }],
];

let fehler = 0;
for (const [name, text, soll] of faelle) {
  const e = leseInserat(text);
  const { daten } = auswerten(e);
  const miete = daten.szenarien?.realistisch?.kaltmiete_monat;
  const probleme = [];
  if (soll.kaufpreis && daten.kaufpreis !== soll.kaufpreis) probleme.push(`Kaufpreis ${daten.kaufpreis} statt ${soll.kaufpreis}`);
  if (soll.miete && Math.abs(miete - soll.miete) > 1) probleme.push(`Miete ${miete} statt ${soll.miete}`);
  if (soll.baujahr && e.baujahr !== soll.baujahr) probleme.push(`Baujahr ${e.baujahr} statt ${soll.baujahr}`);
  if (soll.ampel && daten.ampel !== soll.ampel) probleme.push(`Ampel ${daten.ampel} statt ${soll.ampel}`);
  console.log(probleme.length ? "FEHLER" : "ok    ", name, probleme.join("; "));
  fehler += probleme.length ? 1 : 0;
}
// Sicherung: offensichtlich falsche Daten dürfen nie grün werden
const falsch = auswerten({ objektart: "Eigentumswohnung", kaufpreis: 9900, wohnflaeche_m2: 135.63, ist_miete_monat: 16507, merkmale: {} }).daten;
const sicher = falsch.ampel !== "gruen" && falsch.warnungen.length > 0;
console.log(sicher ? "ok    " : "FEHLER", "Unplausible Daten werden nicht grün", sicher ? "" : JSON.stringify(falsch.warnungen));
fehler += sicher ? 0 : 1;
// Gewerbe: Umbau-Strategien statt Wohn-Rechnung, Service-Apartments nie "gut"
const buero = auswerten({ objektart: "Bürogebäude", kaufpreis: 600000, wohnflaeche_m2: 1200, ort: "44135 Dortmund", merkmale: { leer: true } }).daten;
const namen = buero.strategien.map((s) => s.name);
const gewerbeOk = namen.includes("Umbau zu Wohnungen & vermieten") && !namen.includes("Halten & vermieten") && !namen.includes("Fix & Flip")
  && buero.strategien.find((s) => s.name === "Service-Apartments").eignung !== "gut" && buero.ampel !== "rot";
console.log(gewerbeOk ? "ok    " : "FEHLER", "Leeres Büro (1.200 m², 500 €/m²) → Umbau-Rechnung", gewerbeOk ? "" : JSON.stringify(buero.strategien.map((s) => [s.name, s.eignung])));
fehler += gewerbeOk ? 0 : 1;
const teuer = auswerten({ objektart: "Bürogebäude", kaufpreis: 3000000, wohnflaeche_m2: 1000, ort: "59065 Hamm", merkmale: {} }).daten;
const teuerOk = teuer.ampel === "rot";
console.log(teuerOk ? "ok    " : "FEHLER", "Teures Büro (3.000 €/m²) lohnt keinen Umbau", teuerOk ? "" : teuer.empfehlung);
fehler += teuerOk ? 0 : 1;
// Scout: Gewerbe mit Preis je m² und Mindestfläche
const { bewerte } = await import("../lib/scout-kern.mjs");
const g = bewerte({ kategorie: "Büro zum Umbau", titel: "Bürogebäude leerstehend", beschreibung: "", preis_text: "", groesse_text: "5.466 m² · 824 €/m²", km: 48 }, { maxKm: 52, minFlaeche: 250, preisProM2: true });
const klein = bewerte({ kategorie: "Büro zum Umbau", titel: "Praxis", beschreibung: "", preis_text: "120.000 €", groesse_text: "90 m²", km: 10 }, { maxKm: 52, minFlaeche: 250, preisProM2: true });
const scoutOk = g.preis === 4503984 && !g.ausschluss && g.punkte >= 3 && klein.ausschluss;
console.log(scoutOk ? "ok    " : "FEHLER", "Scout: Preis je m² und Mindestfläche bei Büros", scoutOk ? "" : JSON.stringify([g.preis, g.ausschluss, g.punkte, klein.ausschluss]));
fehler += scoutOk ? 0 : 1;
console.log(fehler ? `\n${fehler} Fehler` : "\nAlle Prüfungen bestanden");
process.exit(fehler ? 1 : 0);
