// Marktdaten je Ort (Raum Hamm, Umkreis ca. 50 km) – Grundlage für Schnellcheck und Rechnung.
// Werte sind Durchschnitte von Immobilienportalen (Angebotsdaten), keine amtlichen Mietspiegel.
// Stand: Recherche November 2026. Vor einem Kauf immer mit dem Mietspiegel der Stadt,
// dem Grundstücksmarktbericht (gars.nrw) und BORIS NRW (boris.nrw.de) abgleichen.
//   miete: €/m² Kaltmiete Wohnung (Angebote), kauf: €/m² Eigentumswohnung Bestand, boden: Bodenrichtwert Wohnen Ø €/m²
export const MARKT_STAND = "Nov. 2026";
export const MARKT_QUELLE = "Portal-Durchschnitte (ImmoScout24, Immowelt, immobilienpreise-2026.de, Borisportal), Stand Nov. 2026";

const ORTE = [
  // [Name, PLZ-Bereiche, miete, kauf, boden]
  ["Hamm", [[59063, 59077]], 7.9, 2090, 250],
  ["Dortmund", [[44135, 44388]], 8.8, 2650, null],
  ["Bochum", [[44787, 44894]], 8.7, 2620, null],
  ["Hagen", [[58089, 58135]], 7.5, 2090, 185],
  ["Münster", [[48143, 48167]], 11.5, 4030, 750],
  ["Lünen", [[44532, 44536]], 7.95, 2300, 280],
  ["Kamen", [[59174, 59174]], 7.95, 2320, 225],
  ["Lippstadt", [[59555, 59558]], 8.1, 2410, 162],
  ["Soest", [[59494, 59494]], 7.95, 2590, 180],
  // Ferienregion: Werte als Annahme aus aktuellen Inseraten (Wohnungen ca. 1.900–2.450 €/m²) bzw. Hochsauerlandkreis
  ["Winterberg", [[59955, 59955]], 6.5, 2200, null, "Annahme aus aktuellen Kleinanzeigen-Inseraten (Nov. 2026), Miete Hochsauerlandkreis – mit Gutachterausschuss HSK prüfen"],
];
// Kreise als Rückfall, wenn die Stadt selbst nicht in der Liste ist
const KREISE = [
  ["Kreis Unna", [[58239, 58239], [58730, 58730], [59174, 59199], [59368, 59379], [59423, 59439]], 7.97, 2290, null],
  ["Kreis Soest", [[59457, 59597], [59581, 59609]], 7.97, 2210, null],
];

function plzVon(ort) {
  const m = /\b(\d{5})\b/.exec(String(ort || ""));
  return m ? Number(m[1]) : null;
}

// Liefert die Marktwerte für einen Ort (Text mit PLZ oder Ortsname) – oder null, wenn unbekannt
export function marktFuer(ort) {
  const text = String(ort || "");
  const plz = plzVon(text);
  const passt = ([, bereiche]) => plz && bereiche.some(([von, bis]) => plz >= von && plz <= bis);
  const treffer = ORTE.find(passt)
    || ORTE.find(([name]) => new RegExp(`\\b${name}\\b`, "i").test(text))
    || KREISE.find(passt);
  if (!treffer) return null;
  const [name, , miete, kauf, boden, quelle] = treffer;
  return { name, miete, kauf, boden, quelle: quelle || MARKT_QUELLE };
}
