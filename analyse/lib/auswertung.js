// Regelbasierte Immobilien-Auswertung – ohne KI, ohne laufende Kosten.
// Alle Annahmen sind sichtbar und änderbar; jede Zahl im Bericht ist entweder aus der Anzeige oder als Annahme gekennzeichnet.
import { rechneSzenario, maxKaufpreisCashflowNull, maxKaufpreisDscr, num } from "../rechner.js";
import { umbauStrategien, umbauRisiken, UMBAU_ANNAHMEN } from "./umbau.js";
import { marktFuer, MARKT_QUELLE } from "./markt.js";
import { wertermittlung } from "./ertragswert.js";
import { ferienStrategie, istFerienregion, FERIEN_ANNAHMEN } from "./ferien.js";
import { SUCHPROFIL, PROFIL_AUSSCHLUSS } from "./suchprofil.js";

export const STANDARD_ANNAHMEN = {
  // Miete, Wohnungspreise und Bauland werden automatisch aus den Ortsdaten (lib/markt.js) genommen,
  // solange hier der Standardwert steht. Ein eigener Wert im Formular hat immer Vorrang.
  miete_m2: 7.9,          // €/m² kalt, Hamm Ø Angebotsmiete Nov. 2026
  etw_saniert_m2: 2090,   // €/m² Angebotspreis Wohnung (Ortsschnitt) als Basis für den Verkauf nach Sanierung, Hamm
  etw_bestand_m2: 2090,   // €/m² Verkaufspreis Eigentumswohnung im Bestand (Aufteilung), Hamm
  verkaufsfaktor_mfh: 15, // Verkaufspreis eines Mehrfamilienhauses = Jahreskaltmiete × Faktor (Bestand Ruhrgebiet/Hamm meist 12–16)
  bodenrichtwert_m2: 250, // €/m² Bauland, Hamm Ø Bodenrichtwert 2026
  zins: 4.4,              // % Zins 10 Jahre bei über 90 % Beleihung (Interhyp 12.11.2026: 4,35 % eff.) – 100-%-Finanzierung
  tilgung: 2.0,           // % anfängliche Tilgung
  ek_betrag: 10000,       // € Eigenkapital (höchstens), Nebenkosten werden mitfinanziert
  grest: 6.5,             // Grunderwerbsteuer NRW
  notar: 2.0,             // Notar + Grundbuch
  makler: 3.57,           // falls in der Anzeige nichts steht
  monteur_preis: 13,      // € pro Bett und Nacht
  ...UMBAU_ANNAHMEN,      // Umbau Büro/Hotel → Wohnen (siehe lib/umbau.js)
  ...FERIEN_ANNAHMEN,     // Ferienvermietung Winterberg/Sauerland (siehe lib/ferien.js)
};

const r5 = (v) => Math.round(v / 5000) * 5000;
const dz = (v, n = 2) => Number(v).toLocaleString("de-DE", { maximumFractionDigits: n });
const eur = (v) => (v == null || !Number.isFinite(v) ? "–" : Math.round(v).toLocaleString("de-DE") + " €");

// Angebotspreise liegen über den echten Kaufpreisen; ältere Häuser erzielen weniger als der Ortsschnitt
const ANGEBOT_ABSCHLAG = 0.92;
function altersFaktor(baujahr, sanierungsjahr) {
  if (sanierungsjahr >= 2005) return 1.0;
  if (!baujahr) return 0.85;
  if (baujahr < 1950) return 0.8;
  if (baujahr < 1980) return 0.82;
  if (baujahr < 2000) return 0.95;
  return 1.1;
}

function instandhaltung(baujahr, sanierungsjahr) {
  if (sanierungsjahr && sanierungsjahr >= 2000) return 10; // komplett saniert: wie jüngeres Gebäude
  if (!baujahr) return 14;
  if (baujahr < 1950) return 18;
  if (baujahr < 1980) return 15;
  if (baujahr < 2000) return 12;
  return 9;
}

// Sanierungskosten je m² Wohnfläche, Spannen aus Ratgebern Stand 2026 (Teilsanierung ca. 200–700 €/m²,
// Kernsanierung ca. 1.000–1.800 €/m², Altbau mit Überraschungen auch über 2.000 €/m²).
export const SANIERUNG_STUFEN = {
  kleinigkeiten: { m2: 30, spanne: "0–80", text: "nur Kleinigkeiten" },
  auffrischen: { m2: 150, spanne: "100–250", text: "Auffrischung (Malern, Böden teilweise)" },
  altbau: { m2: 350, spanne: "250–700", text: "Altbau ohne bekannte Komplettsanierung (Teilsanierung 1–2 Gewerke)" },
  renovieren: { m2: 400, spanne: "200–700", text: "renovierungsbedürftig – Böden, Bad, Malern, Elektrik teilweise" },
  sanieren: { m2: 1100, spanne: "800–1.800", text: "sanierungsbedürftig – Teil- bis Kernsanierung" },
  standard: { m2: 60, spanne: "30–150", text: "kleine Renovierung" },
};
export const SANIERUNG_QUELLE = "Ratgeber-Spannen 2026 (z. B. reduco.ai, handwerk.cloud, justhome.com) – vor dem Kauf Angebot vom Fachbetrieb einholen";

function sanierungSchaetzung(e) {
  if (num(e.sanierung) > 0) return { wert: num(e.sanierung), quelle: "eigene Angabe" };
  const fl = num(e.wohnflaeche_m2);
  const m = e.merkmale || {};
  let st = SANIERUNG_STUFEN.standard;
  if (m.sanierungsbeduerftig) st = SANIERUNG_STUFEN.sanieren;
  else if (m.renovierungsbeduerftig) st = SANIERUNG_STUFEN.renovieren;
  else if (e.sanierungsjahr && e.sanierungsjahr >= 2005) st = SANIERUNG_STUFEN.kleinigkeiten;
  else if (e.baujahr && e.baujahr < 1950) st = SANIERUNG_STUFEN.altbau;
  else if (e.baujahr && e.baujahr < 1980) st = SANIERUNG_STUFEN.auffrischen;
  let proM2 = st.m2;
  let grund = `Annahme: ${st.text}, ca. ${proM2} €/m² (Spanne ${st.spanne} €/m²)`;
  // Schlechte Energieklasse: Dämmung, Fenster oder Heizung anteilig
  if (["E", "F", "G", "H"].includes(e.energieklasse) && st !== SANIERUNG_STUFEN.sanieren) { proM2 += 150; grund += `, plus ca. 150 €/m² Energie (Klasse ${e.energieklasse})`; }
  return { wert: Math.round(fl * proM2 / 1000) * 1000, quelle: grund };
}

export function auswerten(eingabe, annahmenTeil = {}) {
  const a = { ...STANDARD_ANNAHMEN, ...Object.fromEntries(Object.entries(annahmenTeil).filter(([, v]) => v !== "" && v != null)) };
  const e = { ...eingabe, merkmale: eingabe.merkmale || {} };
  // Marktwerte des Ortes einsetzen, solange im Formular der Standardwert steht
  const markt = marktFuer(e.ort);
  const ortsWerte = [];
  if (markt) {
    const setze = (k, v, text) => { if (v && num(a[k]) === STANDARD_ANNAHMEN[k]) { a[k] = v; ortsWerte.push(text); } };
    setze("miete_m2", markt.miete, `Miete ${dz(markt.miete)} €/m²`);
    setze("etw_bestand_m2", markt.kauf, `Wohnungen ${dz(markt.kauf, 0)} €/m²`);
    setze("etw_saniert_m2", markt.kauf, "");
    setze("bodenrichtwert_m2", markt.boden, `Bauland ${dz(markt.boden, 0)} €/m²`);
  }
  const kp = num(e.kaufpreis);
  const fl = num(e.wohnflaeche_m2);
  // Mehrfamilienhaus ohne Angabe der Einheiten: grob eine Wohnung je 70 m² annehmen
  const einheitenGeschaetzt = !num(e.einheiten) && /mehrfamilien|wohn- und geschäft/i.test(e.objektart || "") && num(e.wohnflaeche_m2) > 0;
  const einheiten = einheitenGeschaetzt ? Math.max(3, Math.round(num(e.wohnflaeche_m2) / 70)) : Math.max(1, num(e.einheiten) || 1);
  const istEtw = /wohnung/i.test(e.objektart || "");
  const istGrundstueck = /grundst/i.test(e.objektart || "") && !fl;
  // Büro, Gewerbe, Hotel/Pension: Umbau-Strategien statt Wohn-Strategien
  const istGewerbe = /gewerbe|büro|buero|hotel|pension|praxis|boarding/i.test(e.objektart || "") && !/wohn- und geschäft/i.test(e.objektart || "");
  const makler = e.makler_prozent != null && e.makler_prozent !== "" ? num(e.makler_prozent) : a.makler;
  const nkProzent = num(a.grest) + num(a.notar) + makler;
  const annahmenListe = [];
  const warnungen = [];
  const jetzt = new Date().getFullYear();

  // ---- Plausibilität der Eckdaten
  if (kp && fl && !istGrundstueck) {
    const pm2 = kp / fl;
    if (pm2 < (istGewerbe ? 150 : 400)) warnungen.push(`Preis pro m² nur ${eur(pm2)} – Kaufpreis oder Wohnfläche wahrscheinlich falsch erkannt. Bitte mit der Anzeige vergleichen.`);
    if (pm2 > 7000) warnungen.push(`Preis pro m² ${eur(pm2)} ungewöhnlich hoch – Kaufpreis und Wohnfläche prüfen.`);
  }
  if (e.baujahr && (e.baujahr > jetzt + 2 || e.baujahr < 1500)) warnungen.push(`Baujahr ${e.baujahr} unplausibel – bitte prüfen.`);
  // Typische Lesefehler der Anzeigen: Grundstück als Wohnfläche, Preise weit unter dem Ort
  if (/einfamilien|doppelhaus|reihenhaus/i.test(e.objektart || "") && fl > 350) warnungen.push(`${Math.round(fl)} m² Wohnfläche sind für ein ${e.objektart} ungewöhnlich – vermutlich die Grundstücksfläche. Bitte prüfen.`);
  const ortKauf = marktFuer(e.ort)?.kauf;
  if (ortKauf && kp && fl && !istGrundstueck && !istGewerbe && kp / fl < ortKauf * (/mehrfamilien|wohn- und geschäft/i.test(e.objektart || "") ? 0.25 : 0.35)) warnungen.push(`Preis pro m² (${eur(kp / fl)}) liegt bei nur ${Math.round(kp / fl / ortKauf * 100)} % des Ortsschnitts – Fläche, Zustand oder Haken (Erbpacht, Wohnrecht, Abriss) prüfen.`);
  // Suchprofil: Wohnrecht/Nießbrauch/Verrentung wollen wir nicht
  if (PROFIL_AUSSCHLUSS.test(`${e.titel || ""} ${e.beschreibung || ""}`)) warnungen.push("Wohnrecht, Nießbrauch oder Verrentung erwähnt – passt nicht in euer Suchprofil.");
  if (kp > SUCHPROFIL.budget.max) warnungen.push(`Kaufpreis über eurem Rahmen von ${eur(SUCHPROFIL.budget.max)}.`);
  // Fehlende Kernangaben: ohne sie gibt es kein "Top", sondern "erst prüfen"
  const datenluecken = [];
  if (!e.baujahr && !istGrundstueck) datenluecken.push("Baujahr");
  if (e.beschreibung != null && String(e.beschreibung).trim().length < 150) datenluecken.push("Beschreibung fast leer");
  if (einheitenGeschaetzt) datenluecken.push("Zahl der Wohnungen");

  // ---- Miete
  let istMiete = num(e.ist_miete_jahr) / 12 || num(e.ist_miete_monat) || 0;
  // Unsanierte ältere Wohnungen erzielen weniger als die Ø-Angebotsmiete
  const mieteAlter = e.baujahr && e.baujahr < 1980 && !(e.sanierungsjahr >= 2005) ? 0.92 : 1;
  const marktMiete = fl * num(a.miete_m2) * mieteAlter;
  let mieteHinweis = "";
  if (!istMiete && num(e.faktor_angabe) >= 5 && kp) {
    istMiete = kp / num(e.faktor_angabe) / 12;
    mieteHinweis = ` – aus Faktor ${dz(e.faktor_angabe, 1)} laut Anzeige berechnet`;
  }
  // Plausibilität: Bruttorendite aus der Ist-Miete muss zwischen ca. 1,5 % und 15 % liegen
  if (istMiete > 0 && kp > 0) {
    const rendite = (istMiete * 12) / kp;
    if (rendite > 0.15 && (istMiete / kp) >= 0.015 && (istMiete / kp) <= 0.15) {
      istMiete = istMiete / 12; mieteHinweis = " – Betrag aus der Anzeige als Jahresmiete gewertet";
    } else if (rendite > 0.15 || (fl && istMiete > marktMiete * 2.5)) {
      warnungen.push(`Mietangabe der Anzeige (${eur(istMiete)}/Monat) passt nicht zu Preis und Fläche – Monats- oder Jahresmiete? Bitte prüfen.`);
      istMiete = 0; mieteHinweis = " – Mietangabe der Anzeige unplausibel, daher Marktmiete";
    } else if (einheiten > 1 && fl && istMiete < marktMiete * 0.35 && !e.merkmale.leer) {
      istMiete = 0; mieteHinweis = " – Mietangabe wirkt unvollständig (nur eine Wohnung?), daher Marktmiete";
    }
  }
  // Gegenprobe mit dem Faktor, den die Anzeige selbst nennt
  if (istMiete > 0 && kp && num(e.faktor_angabe) >= 5) {
    const faktorRechnung = kp / (istMiete * 12);
    if (Math.abs(faktorRechnung / num(e.faktor_angabe) - 1) > 0.15) warnungen.push(`Anzeige nennt Faktor ${dz(e.faktor_angabe, 1)}, aus Preis und Miete ergibt sich ${dz(faktorRechnung, 1)} – eine der Angaben stimmt nicht.`);
  }
  let realMiete, mieteQuelle;
  if (istMiete > 0 && e.merkmale.leer && marktMiete > istMiete) {
    realMiete = marktMiete; mieteQuelle = `Marktmiete ${dz(a.miete_m2)} €/m² (Anzeige: ${eur(istMiete)} Ist-Miete, Wohnungen werden frei)`;
  } else if (istMiete > 0) {
    realMiete = istMiete; mieteQuelle = "Ist-Miete laut Anzeige";
  } else {
    realMiete = marktMiete; mieteQuelle = `ANNAHME ${dz(a.miete_m2 * mieteAlter)} €/m² Marktmiete${mieteAlter < 1 ? " (Ø-Miete −8 % für unsanierten Altbau)" : ""}`;
  }
  annahmenListe.push(`Kaltmiete: ${eur(realMiete)}/Monat (${mieteQuelle}${mieteHinweis})`);
  if (istMiete > 0 && realMiete === istMiete && marktMiete > 0 && istMiete > marktMiete * 1.2) annahmenListe.push(`Ist-Miete liegt ${Math.round((istMiete / marktMiete - 1) * 100)} % über der Marktmiete (${eur(marktMiete)}) – Mietverträge prüfen; im vorsichtigen Fall wird mit Marktmiete + 10 % gerechnet`);

  if (einheitenGeschaetzt) annahmenListe.push(`Wohneinheiten: ${einheiten} (ANNAHME, ca. 70 m² je Wohnung – Anzahl in der Anzeige nicht genannt)`);
  const san = sanierungSchaetzung(e);
  annahmenListe.push(`Renovierung: ${eur(san.wert)} (${san.quelle})`);
  // Wohnungen: Rücklage und Verwaltung stecken im Hausgeld – Instandhaltung nur fürs Sondereigentum
  const ih = istEtw ? 4 : instandhaltung(e.baujahr, e.sanierungsjahr);
  const nichtUml = istEtw ? Math.round(num(e.hausgeld_monat) * 0.4) || Math.round(fl * 1.2) : Math.round(fl * 0.3);
  annahmenListe.push(`Nicht umlagefähige Kosten: ${eur(nichtUml)}/Monat${istEtw ? (e.hausgeld_monat ? " (ca. 40 % vom Hausgeld: Verwaltung, Rücklage)" : " (Annahme: Verwaltung und Rücklage, Hausgeld unbekannt)") : " (Annahme)"}; Instandhaltung ${ih} €/m² im Jahr${istEtw ? " (nur Sondereigentum)" : e.sanierungsjahr >= 2000 ? ` (saniert ${e.sanierungsjahr})` : " (nach Baujahr)"}`);

  const szen = (fM, fS, lee, ihPlus) => ({
    kaltmiete_monat: Math.round(realMiete * fM),
    sanierung: Math.round(san.wert * fS),
    leerstand_prozent: lee,
    nicht_umlagefaehig_monat: nichtUml,
    instandhaltung_m2_jahr: ih + ihPlus,
    verwaltung_monat: einheiten > 1 ? 30 * einheiten : istEtw ? 0 : 25,
  });
  const szenarien = {
    // Liegt die Ist-Miete deutlich über dem Markt, droht bei Mieterwechsel weniger Miete
    vorsichtig: szen(istMiete > 0 && !e.merkmale.leer ? Math.min(1, (marktMiete * 1.1) / realMiete) : 0.9, 1.5, 5, 3),
    realistisch: szen(1, 1, 3, 0),
    gut: szen(istMiete > 0 && !e.merkmale.leer ? 1.05 : 1.08, 0.7, 2, -2),
  };

  const basis = { kaufpreis: kp, wohnflaeche_m2: fl, grunderwerbsteuer_prozent: a.grest, notar_grundbuch_prozent: a.notar, makler_prozent: makler };
  const ek = num(e.eigenkapital) || num(a.ek_betrag);
  const fin = { eigenkapital: ek, zins_prozent: num(a.zins), tilgung_prozent: num(a.tilgung) };
  annahmenListe.push(`Eigenkapital: ${eur(ek)}${num(e.eigenkapital) ? "" : " (Standard: höchstens 10.000 €, Kaufnebenkosten werden mitfinanziert – Banken verlangen dafür oft Zinsaufschläge)"}`);
  const real = fl && kp ? rechneSzenario(basis, szenarien.realistisch, fin) : null;
  const vors = fl && kp ? rechneSzenario(basis, szenarien.vorsichtig, fin) : null;
  // Stresstest immer: Zins +1 %-Punkt im realistischen Szenario
  const stress = fl && kp ? rechneSzenario(basis, szenarien.realistisch, { ...fin, zins_aufschlag: 1 }) : null;
  // Amtliche Plausibilitätsprüfung: Ertrags- bzw. Vergleichswert nach ImmoWertV mit Gutachterausschuss-Daten
  const wert = kp && fl ? wertermittlung({ ...e, einheiten }, { ortName: markt?.name || "Hamm", bodenrichtwert: num(a.bodenrichtwert_m2), jahresmiete: istMiete > 0 ? istMiete * 12 : 0 }) : null;
  const ueberWert = wert && kp > wert.wert * 1.15;

  // ---- Strategien
  const strategien = [];
  const nk = (preis) => preis * nkProzent / 100;

  if (real && !istGrundstueck && (!istGewerbe || istMiete > 0)) {
    // Höchstpreis wie bei der Bank: der niedrigere Wert aus Cashflow 0 (realistisch) und Kapitaldienstdeckung 1,1 (vorsichtig)
    const maxKp = Math.min(maxKaufpreisCashflowNull(basis, szenarien.realistisch, fin), maxKaufpreisDscr(basis, szenarien.vorsichtig, fin, 1.1));
    const cf = real.cashflowMonat;
    // Bei nur geschätzter Miete braucht "gut" einen deutlichen Puffer
    const mieteBelegt = istMiete > 0 && !e.merkmale.leer;
    const gutGrenze = mieteBelegt ? 100 : 300;
    strategien.push({
      buchstabe: "A",
      name: "Halten & vermieten",
      max_kaufpreis_vorsichtig: r5(Math.min(maxKaufpreisCashflowNull(basis, szenarien.vorsichtig, fin), maxKaufpreisDscr(basis, szenarien.vorsichtig, fin, 1.1))),
      eignung: cf >= gutGrenze && vors.cashflowMonat >= -100 && maxKp >= kp ? "gut" : cf >= -150 ? "bedingt" : "nein",
      cashflow_monat: Math.round(cf),
      max_kaufpreis: r5(maxKp),
      begruendung: `Faktor ${real.faktor ? dz(real.faktor, 1) : "–"}, Bruttorendite ${real.bruttorendite ? dz(real.bruttorendite, 1) : "–"} %, vorsichtig ${eur(vors.cashflowMonat)}/Monat. Mit ${eur(ek)} Eigenkapital, ${dz(a.zins)} % Zins und ${dz(a.tilgung)} % Tilgung. Höchstpreis = niedrigerer Wert aus Cashflow 0 (realistisch) und Kapitaldienstdeckung 1,1 (vorsichtig).`,
      nein_wenn: `die Miete unter ${eur(realMiete - Math.max(cf, 0))}/Monat fällt oder der Zins bei der Anschlussfinanzierung deutlich steigt`,
    });
  }

  if (fl && kp && !istGrundstueck && !istGewerbe) {
    // Fix & Flip: kaufen, sanieren, verkaufen – 12 Monate, echte Abschlusspreise (Angebotspreis −8 %)
    // Mehrfamilienhäuser werden nach Ertrag verkauft (gedeckelt durch den Wohnungswert), kleinere Objekte nach Preis pro m²
    const mfh = einheiten >= 3;
    const proM2 = num(a.etw_saniert_m2) * ANGEBOT_ABSCHLAG;
    const erloesM2 = fl * proM2 * (e.baujahr && e.baujahr < 1950 ? 0.95 : 1);
    const erloes = mfh ? Math.min(szenarien.realistisch.kaltmiete_monat * 1.05 * 12 * num(a.verkaufsfaktor_mfh), erloesM2 * 0.85) : erloesM2;
    const sanFlip = Math.max(san.wert, fl * (e.sanierungsjahr >= 2005 ? 100 : !e.baujahr || e.baujahr < 1980 ? 700 : 500));
    const z = num(a.zins) / 100;
    const flip = (preis, erl, sanK) => {
      const kosten = preis * (1 + nkProzent / 100) + sanK;
      const gesamt = kosten + kosten * z + erl * 0.05; // 12 Monate Zinsen, 5 % Vertrieb
      return { gewinn: erl - gesamt, marge: (erl - gesamt) / gesamt * 100 };
    };
    const maxFlip = (erl, sanK) => Math.max(((erl * 0.95) / 1.2 / (1 + z) - sanK) / (1 + nkProzent / 100), 0); // Ziel 20 % Marge
    const f = flip(kp, erloes, sanFlip);
    const maxKp = maxFlip(erloes, sanFlip);
    const maxKpVors = maxFlip(erloes * 0.9, sanFlip * 1.3);
    const vermietet = e.merkmale.vermietet && !e.merkmale.leer;
    strategien.push({
      buchstabe: "C",
      name: "Fix & Flip",
      max_kaufpreis_vorsichtig: r5(maxKpVors),
      // Vermietet: erst nach Auszug sanier- und verkaufbar – als Flip nicht geeignet
      eignung: vermietet ? "nein" : f.marge >= 20 && maxKpVors >= kp * 0.95 ? "gut" : f.marge >= 10 ? "bedingt" : "nein",
      gewinn: Math.round(f.gewinn),
      max_kaufpreis: r5(maxKp),
      begruendung: `Verkauf saniert ca. ${eur(erloes)} (${mfh ? `Jahresmiete × ${a.verkaufsfaktor_mfh}, höchstens 85 % des Wohnungswerts` : `${dz(proM2, 0)} €/m² = Ortsschnitt −8 % Abschlag vom Angebots- zum Kaufpreis`}), Sanierung ${eur(sanFlip)}, 12 Monate Zinsen, 5 % Vertrieb. Marge ${f.marge.toFixed(0)} % (Ziel ≥ 20 %). Vorsichtig (Erlös −10 %, Sanierung +30 %) bis ${eur(r5(maxKpVors))}. Hinweis: Banken finanzieren Flips selten zu 100 %; Spekulationsfrist 10 Jahre.${vermietet ? " Achtung: vermietet – erst nach Auszug sanier- und verkaufbar." : ""}`,
      nein_wenn: `der Verkaufspreis unter ca. ${eur((maxKp * (1 + nkProzent / 100) + sanFlip) * (1 + z) / 0.95 / fl)} pro m² liegt oder die Sanierung mehr als ${eur(sanFlip * 1.3)} kostet`,
    });
  }

  if (einheiten >= 2 && fl && kp && !istEtw && !istGewerbe) {
    // Aufteilung: Wohnungen einzeln verkaufen. Echte Kaufpreise (−8 %), Altersabschlag, vermietete Wohnungen
    // gehen an Kapitalanleger (höchstens Jahresmiete × 22). 24 Monate, Gemeinschaftseigentum herrichten, 6 % Vertrieb.
    const vermietet = e.merkmale.vermietet && !e.merkmale.leer;
    const proM2 = num(a.etw_bestand_m2) * ANGEBOT_ABSCHLAG * altersFaktor(e.baujahr, e.sanierungsjahr);
    const frei = fl * proM2;
    const erloes = vermietet ? Math.min(frei * 0.9, szenarien.realistisch.kaltmiete_monat * 12 * 22) : frei;
    const gemeinschaft = fl * (e.sanierungsjahr >= 2005 ? 30 : !e.baujahr || e.baujahr < 1980 ? 150 : 80);
    const kostenAuf = 2500 * einheiten + 5000 + gemeinschaft;
    const z = num(a.zins) / 100;
    const aufteilen = (preis, erl, sanK) => {
      const kosten = preis * (1 + nkProzent / 100) + sanK + kostenAuf;
      const gesamt = kosten + kosten * z * 2 + erl * 0.06;
      return { gewinn: erl - gesamt, marge: (erl - gesamt) / gesamt * 100 };
    };
    const maxAuf = (erl, sanK) => Math.max(((erl * 0.94) / 1.2 / (1 + 2 * z) - sanK - kostenAuf) / (1 + nkProzent / 100), 0);
    const g = aufteilen(kp, erloes, san.wert);
    const maxKp = maxAuf(erloes, san.wert);
    const maxKpVors = maxAuf(erloes * 0.9, san.wert * 1.5);
    strategien.push({
      buchstabe: "C",
      name: "Aufteilung in Eigentumswohnungen",
      max_kaufpreis_vorsichtig: r5(maxKpVors),
      // Ohne bekannte Zahl der Wohnungen höchstens "bedingt"
      eignung: g.marge >= 20 && maxKpVors >= kp * 0.95 && !einheitenGeschaetzt ? "gut" : g.marge >= 10 ? "bedingt" : "nein",
      gewinn: Math.round(g.gewinn),
      max_kaufpreis: r5(maxKp),
      begruendung: `${einheiten} Wohnungen à ${dz(proM2, 0)} €/m² (Ortsschnitt −8 %, Altersabschlag)${vermietet ? ", vermietet höchstens Jahresmiete × 22" : ""} = ${eur(erloes)}. Teilung, Vermessung und Gemeinschaftseigentum ca. ${eur(kostenAuf)}, 24 Monate, 6 % Vertrieb. Marge ${g.marge.toFixed(0)} % (Ziel ≥ 20 %). Achtung: Abgeschlossenheitsbescheinigung nötig, in Gebieten mit Umwandlungsverbot (§ 250 BauGB) genehmigungspflichtig, ab 4 Verkäufen in 5 Jahren gewerblicher Grundstückshandel.`,
      nein_wenn: `die Wohnungen weniger als ca. ${eur(proM2 * 0.9)} pro m² erzielen oder die Bank die Aufteilung nicht mitfinanziert`,
    });
  }

  const gfl = num(e.grundstueck_m2);
  if (!istEtw && !e.grundstueck_gemeinschaft && (istGrundstueck || e.merkmale.zweites_grundstueck || e.merkmale.baurecht || (gfl && fl && gfl > fl * 3))) {
    const preisM2 = istGrundstueck && gfl ? kp / gfl : null;
    const brw = num(a.bodenrichtwert_m2);
    let eignung = "bedingt", text, gewinn = null, maxKp = null;
    if (preisM2) {
      eignung = preisM2 <= brw * 0.9 ? "gut" : preisM2 <= brw * 1.1 ? "bedingt" : "nein";
      maxKp = r5(gfl * brw * 0.9);
      text = `${Math.round(preisM2)} €/m² gegenüber Bodenrichtwert-Annahme ${brw} €/m² (Raum Hamm – den echten Wert für diesen Ort unter boris.nrw.de prüfen).${e.merkmale.baurecht ? " Baurecht laut Anzeige erwähnt." : " Baurecht beim Bauamt prüfen."}${e.moegliche_einheiten ? ` Laut Anzeige bebaubar mit bis zu ${e.moegliche_einheiten} Wohneinheiten.` : ""}`;
    } else {
      const ueberschuss = Math.max(gfl - fl * 1.5, 0);
      gewinn = Math.round(ueberschuss * brw * 0.8);
      text = `Grundstück ${gfl ? gfl + " m²" : "groß"}${e.merkmale.zweites_grundstueck ? ", laut Anzeige mit separatem Flurstück" : ""}. Möglicher Wert einer Teilfläche grob ${eur(gewinn)} (Annahme ${brw} €/m², 80 %). Nur mit Bauvorbescheid einplanen.`;
    }
    strategien.push({ buchstabe: "D", name: "Grundstück / Bebauung", eignung, gewinn, max_kaufpreis: maxKp, begruendung: text, zusatz: !istGrundstueck });
  }

  // Ferienregion (Winterberg und Umgebung): echte Ferienrechnung statt Monteurzimmer-Schätzung
  const ferienLage = istFerienregion(e);
  if (ferienLage && fl && kp && !istGrundstueck) {
    const fs = ferienStrategie({ ...e, einheiten: num(e.einheiten) || (einheitenGeschaetzt ? einheiten : 0) }, a, nkProzent, san.wert, annahmenListe);
    if (fs) strategien.push(fs);
  }
  if (fl && kp && !istGrundstueck && !istGewerbe && !ferienLage) {
    const betten = Math.max(2, Math.round((num(e.zimmer) || fl / 25) * 1.3));
    const brutto = betten * num(a.monteur_preis) * 365 * 0.6;
    const netto = brutto * 0.6;
    const lang = szenarien.realistisch.kaltmiete_monat * 12;
    strategien.push({
      buchstabe: "E",
      name: "Monteur- / Ferienwohnung",
      eignung: netto > lang * 1.25 ? "bedingt" : "nein",
      cashflow_monat: Math.round((netto - lang) / 12),
      max_kaufpreis: null,
      begruendung: `Ca. ${betten} Betten × ${a.monteur_preis} €/Nacht × 60 % Auslastung, nach Kosten ca. ${eur(netto)}/Jahr gegenüber ${eur(lang)} Kaltmiete. Zahl zeigt den Unterschied pro Monat. Nur mit Genehmigung (Nutzungsänderung) und viel Aufwand.`,
    });
  }

  if (istGewerbe) {
    // Wohnungs-Annahmen (Marktmiete, Renovierung …) gelten für leere Büros nicht
    if (!(istMiete > 0)) for (let i = annahmenListe.length - 1; i >= 0; i--) if (/^(Kaltmiete|Renovierung|Nicht umlagefähige)/.test(annahmenListe[i])) annahmenListe.splice(i, 1);
    strategien.push(...umbauStrategien(e, a, nkProzent, annahmenListe));
  }

  // ---- Ampel, Punktzahl, Verhandlungsziel
  const rang = { gut: 3, bedingt: 2, nein: 1 };
  // Zusatzpotenziale (Teilfläche, Monteurzimmer) bestimmen die Ampel nicht
  const kern = strategien.filter((s) => s.name !== "Monteur- / Ferienwohnung" && !s.zusatz);
  // Service-Apartments sind ein Betreibergeschäft – bei Gleichstand zählt die solidere Strategie
  const r = (s) => rang[s.eignung] - (s.name === "Service-Apartments" ? 0.5 : 0);
  const beste = [...kern].sort((x, y) => r(y) - r(x) || (y.max_kaufpreis || 0) - (x.max_kaufpreis || 0))[0];
  let ampel = !beste ? "gelb" : beste.eignung === "gut" ? "gruen" : beste.eignung === "bedingt" ? "gelb" : "rot";
  // Grün nur, wenn es sich auch im vorsichtigen Fall trägt (sonst entpuppt es sich im zweiten Schritt als schwach)
  if (ampel === "gruen" && beste.max_kaufpreis_vorsichtig != null && beste.max_kaufpreis_vorsichtig < kp * 0.95) ampel = "gelb";
  if (ampel === "gruen" && (beste.max_kaufpreis || 0) < kp) ampel = "gelb";
  // Bei fraglichen Daten nie Grün – erst prüfen
  if (warnungen.length && ampel === "gruen") ampel = "gelb";
  let score = { gruen: 75, gelb: 50, rot: 25 }[ampel];
  if (real?.faktor) score += Math.max(-15, Math.min(15, Math.round((18 - real.faktor) * 2)));
  score = Math.max(5, Math.min(95, score));
  const solide = kern.filter((s) => s.name !== "Service-Apartments");
  const maxPreise = (solide.length ? solide : kern).map((s) => s.max_kaufpreis).filter((v) => v > 0);
  const besterMax = maxPreise.length ? Math.max(...maxPreise) : null;
  // Liegt der tragbare Preis weit unter dem Angebot, ist ein "Verhandlungsziel" nicht realistisch
  const verhandlungsziel = !besterMax ? r5(kp * 0.92) : besterMax < kp * 0.7 ? null : r5(Math.min(kp * 0.97, besterMax));
  const empfehlung = warnungen.length ? `Daten prüfen: ${warnungen[0].split(" – ")[0]}`
    : ampel === "gruen" ? `Interessant – ${beste.name} funktioniert zum Angebotspreis`
    : ampel === "gelb" ? (beste?.max_kaufpreis >= kp
      ? `Prüfenswert: ${beste.name} trägt sich bis ca. ${eur(beste.max_kaufpreis)} – Annahmen vor Ort prüfen`
      : `Nur mit Verhandlung: ${beste?.max_kaufpreis ? beste.name + " lohnt sich bis ca. " + eur(beste.max_kaufpreis) : "Zahlen prüfen"}`)
    : `Zum Angebotspreis nicht wirtschaftlich${besterMax ? " – interessant erst ab ca. " + eur(besterMax) : ""}`;

  // ---- Urteil (erste Zeile laut Analyse-Skill): maßgeblich ist das realistische Szenario
  // Liegt das Angebot mehr als 15 % über dem amtlichen Wert, ist es kein Top-Objekt – egal was die Strategie verspricht
  if (ampel === "gruen" && ueberWert) ampel = "gelb";
  const lohnt = !warnungen.length && ampel === "gruen";
  // Stufe für die Funde: Top (trägt sich zum Angebotspreis, auch vorsichtig) – Verhandeln (bis −15 %) – Nein
  const stufe = lohnt ? (datenluecken.length ? "pruefen" : "top") : !warnungen.length && besterMax && besterMax >= kp * 0.85 ? "verhandeln" : "nein";
  const weg = beste && (solide.length ? [...solide] : kern).sort((x, y) => (y.max_kaufpreis || 0) - (x.max_kaufpreis || 0))[0];
  // ---- Verhandlung: Einstieg / Ziel / Schmerzgrenze aus realistischem und vorsichtigem Höchstpreis
  let verhandlung = null;
  if (besterMax && besterMax >= kp * 0.7) {
    const schmerz = r5(Math.min(kp, besterMax, wert ? wert.wert * 1.1 : Infinity));
    const vorsMax = Math.max(0, ...kern.filter((s) => s.name === weg?.name).map((s) => s.max_kaufpreis_vorsichtig || 0));
    const einstieg = r5(Math.min(schmerz * 0.88, vorsMax || schmerz * 0.88, kp * 0.9));
    verhandlung = { einstieg, ziel: r5(Math.max(einstieg, Math.min(schmerz * 0.93, kp * 0.97))), schmerzgrenze: schmerz };
  }

  const urteil = warnungen.length ? `Daten prüfen, bevor gerechnet wird: ${warnungen[0].split(" – ")[0]}`
    : lohnt && datenluecken.length ? `Rechnet sich, aber erst prüfen – es fehlt: ${datenluecken.join(", ")}. ${beste.name} trägt sich bis ca. ${eur(beste.max_kaufpreis)}`
    : lohnt ? `Lohnt sich zum Angebotspreis – ${beste.name} trägt sich bis ca. ${eur(beste.max_kaufpreis)}, vorsichtig bis ${eur(beste.max_kaufpreis_vorsichtig ?? beste.max_kaufpreis)}`
    : stufe === "verhandeln" && besterMax >= kp ? `Nur mit Verhandlung: ${weg?.name || "beste Strategie"} trägt sich realistisch bis ca. ${eur(besterMax)}, im vorsichtigen Fall nur bis ${eur(weg?.max_kaufpreis_vorsichtig ?? besterMax)} – Preis Richtung ${eur(verhandlung?.ziel ?? besterMax)} handeln`
    : stufe === "verhandeln" ? `Nur mit Verhandlung: lohnt sich bis ca. ${eur(besterMax)} (${weg?.name || "beste Strategie"}) – ${Math.round((1 - besterMax / kp) * 100)} % unter dem Angebot`
    : besterMax ? `Lohnt sich nicht zum Angebotspreis von ${eur(kp)} – lohnt sich ab ca. ${eur(besterMax)} (${weg?.name || "beste Strategie"})`
    : `Lohnt sich nicht zum Angebotspreis – kein Weg trägt sich mit den Annahmen`;

  // ---- Schnellcheck: Preis/m² gegen Ortsschnitt und Kaufpreisfaktor
  const pm2 = kp && fl ? kp / fl : null;
  const vergleich = markt?.kauf || null;
  const schnell = {
    preis_m2: pm2 ? Math.round(pm2) : null,
    vergleich_m2: wert?.g?.kauf || vergleich,
    vergleich_quelle: wert?.g ? (wert.g.eigene ? "Gutachterausschuss" : "Gutachterausschuss Hamm, Annahme") : "Portale",
    vergleich_ort: markt?.name || null,
    preis_ok: pm2 && (wert?.g?.kauf || vergleich) ? pm2 <= (wert?.g?.kauf || vergleich) : null,
    faktor: real?.faktor ? Math.round(real.faktor * 10) / 10 : null,
    faktor_ok: real?.faktor ? real.faktor <= 20 : null,
    cashflow: real ? Math.round(real.cashflowMonat) : null,
    cashflow_stress: stress ? Math.round(stress.cashflowMonat) : null,
    dscr: real?.rateMonat ? Math.round(real.reinertrag / (real.rateMonat * 12) * 100) / 100 : null,
    // Wie viel Leerstand verträgt das Objekt, bevor der Cashflow negativ wird?
    break_even_leerstand: real?.jahresKaltmiete ? Math.round((1 - (real.rateMonat * 12 + real.bewirtschaftung) / real.jahresKaltmiete) * 100) : null,
    ek_rendite_tilgung: real && ek > 0 ? Math.round(((real.cashflowMonat + real.tilgungMonat) * 12) / ek * 100) : null,
    wert: wert ? { methode: wert.methode, wert: wert.wert, text: wert.text, quelle: wert.quelle, abweichung: Math.round((kp / wert.wert - 1) * 100) } : null,
    gutachter_kauf: wert?.g?.kauf || null,
  };
  if (ortsWerte.length) annahmenListe.push(`Marktwerte ${markt.name}: ${ortsWerte.join(", ")} (${markt.quelle})`);

  const daten = {
    urteil, stufe, datenluecken, verhandlung, schnell, markt_ort: markt?.name || null,
    nein_wenn: (lohnt ? beste : weg)?.nein_wenn || null,
    titel: e.titel || [e.objektart, e.ort].filter(Boolean).join(" in ") || "Objekt",
    ort: e.ort || null, objektart: e.objektart || null, baujahr: e.baujahr || null,
    wohnflaeche_m2: fl, grundstueck_m2: gfl || null, einheiten, energieklasse: e.energieklasse || null,
    kaufpreis: kp, grunderwerbsteuer_prozent: a.grest, notar_grundbuch_prozent: a.notar, makler_prozent: makler,
    bauzins_prozent: a.zins, szenarien, strategien, ampel, score, empfehlung, verhandlungsziel: verhandlung?.ziel ?? verhandlungsziel, warnungen,
    sanierungsjahr: e.sanierungsjahr || null, faktor_angabe: e.faktor_angabe || null,
    miete_quelle: mieteQuelle + mieteHinweis,
    max_kaufpreis_cashflow_positiv: strategien.find((s) => s.name === "Halten & vermieten")?.max_kaufpreis || null,
  };
  // Umbau-Strategien nutzen dieselbe Eigenkapital-Regel
  return { daten, finanz: { eigenkapital: ek, zins_prozent: a.zins, tilgung_prozent: a.tilgung }, bericht: bericht(e, daten, real, annahmenListe, a, makler) };
}

function risiken(e, d) {
  const r = [];
  const fe = d.strategien.find((s) => s.ferien);
  if (fe?.risiko) r.push(fe.risiko);
  if (/gewerbe|büro|buero|hotel|pension|praxis|boarding/i.test(e.objektart || "") && !/wohn- und geschäft/i.test(e.objektart || "")) r.push(...umbauRisiken(e));
  const m = e.merkmale || {};
  if (e.sanierungsjahr >= 2000) r.push(`Komplett saniert ${e.sanierungsjahr}: Umfang der Sanierung (Dach, Leitungen, Elektrik, Heizung, Dämmung) und Rechnungen vorlegen lassen.`);
  else if (e.baujahr && e.baujahr < 1978) r.push("Baujahr vor 1978: Elektrik, Leitungen, Dämmung und mögliche Schadstoffe (Asbest) prüfen lassen.");
  if (["F", "G", "H"].includes(e.energieklasse)) r.push(`Energieklasse ${e.energieklasse}: hohe Nebenkosten, CO₂-Kostenanteil für Vermieter, Sanierungsdruck.`);
  if (m.oelheizung || m.nachtspeicher) r.push("Öl- oder Nachtspeicherheizung: Tausch nach Gebäudeenergiegesetz einplanen.");
  if (m.erbpacht) r.push("Erbpacht: Erbbauzins, Restlaufzeit und Heimfall prüfen; Banken finanzieren oft schlechter.");
  if (m.denkmal) r.push("Denkmalschutz: Auflagen bei Sanierung, dafür steuerliche Sonderabschreibung möglich.");
  if (m.versteigerung) r.push("Zwangsversteigerung: kein Gewährleistungsanspruch, Besichtigung oft nicht möglich, Gutachten genau lesen.");
  if (m.vermietet) r.push("Vermietet: Mietverträge, Mietrückstände und Kündigungsschutz prüfen; Mieterhöhung nur nach Mietspiegel und Kappungsgrenze.");
  if (m.zweites_grundstueck || m.baurecht) r.push("Baurecht für zusätzliche Bebauung erst mit Bauvorbescheid sicher – vorher nicht einpreisen.");
  if (/wohnung/i.test(e.objektart || "")) r.push("Eigentumswohnung: Protokolle der Eigentümerversammlung, Rücklage und geplante Sonderumlagen prüfen.");
  if (d.strategien.every((s) => s.eignung !== "gut")) r.push("Keine Strategie trägt sich zum Angebotspreis – nur mit deutlichem Preisnachlass kaufen.");
  return r.length ? r : ["Keine besonderen Risiken aus der Anzeige erkennbar – Besichtigung und Unterlagen entscheiden."];
}

// Offene Fragen je Ansprechpartner (Skill: Makler/Verkäufer, Bauamt, Bank, Energieberater, Steuerberater)
export function offeneFragen(e, d) {
  const m = e.merkmale || {};
  const etw = /wohnung/i.test(e.objektart || "");
  const gewerbe = /gewerbe|büro|buero|hotel|pension|praxis/i.test(e.objektart || "") && !/wohn- und geschäft/i.test(e.objektart || "");
  const f = { "Makler / Verkäufer": [], Bauamt: [], "Bank (Markus)": [], Energieberater: [], Steuerberater: [] };
  const mk = f["Makler / Verkäufer"];
  if (!e.kaufpreis) mk.push("Kaufpreis und Provision?");
  if (!e.wohnflaeche_m2) mk.push("Wohn-/Nutzfläche je Einheit (Wohnflächenberechnung)?");
  if (!(e.ist_miete_monat || e.ist_miete_jahr) && !gewerbe) mk.push("Aktuelle Mieten je Einheit – Mieterliste und Kontoauszüge der letzten 12 Monate?");
  if (m.vermietet || e.ist_miete_monat || e.ist_miete_jahr) mk.push("Mietverträge, Mietrückstände, letzte Mieterhöhung?");
  if (!e.baujahr) mk.push("Baujahr und letzte Modernisierungen (Dach, Fenster, Heizung, Leitungen)?");
  if (!e.energieklasse) mk.push("Energieausweis und Alter der Heizung?");
  if (etw) mk.push("Teilungserklärung, Hausgeld, Rücklage, Protokolle der letzten 3 Versammlungen, geplante Sonderumlagen?");
  mk.push("Seit wann wird verkauft, gab es Preissenkungen, warum wird verkauft?");
  if (gewerbe || m.zweites_grundstueck || m.baurecht || /grundst/i.test(e.objektart || "")) f.Bauamt.push("Bebauungsplan oder § 34 BauGB, Gebietsart (WA, MI, GE)?");
  if (gewerbe) f.Bauamt.push("Ist die Nutzungsänderung zu Wohnen genehmigungsfähig? Stellplätze, Brandschutz – Bauvoranfrage möglich?");
  if (m.denkmal) f.Bauamt.push("Denkmalauflagen für Fenster, Fassade, Dach?");
  if (m.zweites_grundstueck || m.baurecht) f.Bauamt.push("Bauvorbescheid für zusätzliche Bebauung?");
  f.Bauamt.push("Baulasten und genehmigte Nutzung laut Bauakte?");
  f["Bank (Markus)"].push(`Finanzierung mit ${d.schnell?.cashflow != null ? "ca. 10.000 € Eigenkapital (Nebenkosten mitfinanziert)" : "wenig Eigenkapital"} möglich, zu welchem Zins?`);
  f["Bank (Markus)"].push("Finanzierungsbestätigung vorab bereitlegen, damit sie am Tag der Besichtigung rausgehen kann.");
  if (["E", "F", "G", "H"].includes(e.energieklasse) || m.oelheizung || m.nachtspeicher || (e.baujahr && e.baujahr < 1980)) f.Energieberater.push("Welche Maßnahmen sind nach Gebäudeenergiegesetz nötig, was kosten sie, welche Förderung (BEG/KfW) passt?");
  if (gewerbe) f.Energieberater.push("Förderfähigkeit KfW 266 „Gewerbe zu Wohnen“ prüfen (Antrag vor Baubeginn).");
  f.Steuerberater.push("Kaufpreisaufteilung Gebäude/Boden für die Abschreibung; privat oder über GmbH kaufen?");
  if (d.strategien?.some((s) => /Aufteilung|Flip|verkaufen/.test(s.name) && s.eignung !== "nein")) f.Steuerberater.push("Spekulationsfrist und gewerblicher Grundstückshandel (3-Objekt-Grenze) bei Weiterverkauf?");
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v.length));
}

function bericht(e, d, real, annahmen, a, makler) {
  const z = (v) => (v == null || v === "" ? "fehlt – anfragen" : v);
  const sc = d.schnell || {};
  const ok = (v) => (v == null ? "" : v ? " ✅" : " ❌");
  const eign = { gut: "✅ gut", bedingt: "⚠️ bedingt", nein: "❌ nein" };
  const st = [...d.strategien].sort((x, y) => (x.buchstabe || "Z").localeCompare(y.buchstabe || "Z"))
    .map((s) => `| ${s.buchstabe ? s.buchstabe + " · " : ""}${s.name} | ${eign[s.eignung]} | ${s.cashflow_monat != null ? eur(s.cashflow_monat) + "/Monat" : s.gewinn != null ? eur(s.gewinn) + " Gewinn" : "–"} | ${s.max_kaufpreis ? eur(s.max_kaufpreis) : "–"} | ${s.max_kaufpreis_vorsichtig ? eur(s.max_kaufpreis_vorsichtig) : "–"} |`).join("\n");
  const alleRisiken = risiken(e, d);
  const v = d.verhandlung;
  const fragen = offeneFragen(e, d);
  return `# ${d.titel}

## ${d.urteil}
${d.nein_wenn ? `\n**Die Antwort wäre NEIN, wenn** ${d.nein_wenn}.\n` : ""}${d.warnungen?.length ? `\n> **⚠️ Bitte zuerst prüfen:** ${d.warnungen.join(" ")}\n` : ""}
## Steckbrief
| | |
|---|---|
| Objektart | ${z(e.objektart)}${e.ort ? " · " + e.ort : ""} |
| Kaufpreis | ${e.kaufpreis ? eur(e.kaufpreis) : "fehlt – anfragen"} |
| Fläche | ${e.wohnflaeche_m2 ? dz(e.wohnflaeche_m2, 0) + " m²" : "fehlt – anfragen"}${e.grundstueck_m2 ? ` · Grundstück ${dz(e.grundstueck_m2, 0)} m²` : ""} |
| Preis pro m² | ${sc.preis_m2 ? eur(sc.preis_m2) : "–"}${sc.vergleich_m2 ? ` (Ø Kaufpreis ${sc.vergleich_ort || "Hamm"}: ${eur(sc.vergleich_m2)}, ${sc.vergleich_quelle})${ok(sc.preis_ok)}` : ""} |
| Wert (ImmoWertV) | ${sc.wert ? `${eur(sc.wert.wert)} ${sc.wert.methode} – Angebot ${sc.wert.abweichung >= 0 ? sc.wert.abweichung + " % darüber" : -sc.wert.abweichung + " % darunter"}${sc.wert.abweichung > 15 ? " ❌" : sc.wert.abweichung <= 0 ? " ✅" : ""}` : "–"} |
| Kaufpreisfaktor | ${sc.faktor ? dz(sc.faktor, 1) + " (Ziel ≤ 20)" + ok(sc.faktor_ok) : "–"} |
| Cashflow realistisch | ${sc.cashflow != null ? eur(sc.cashflow) + "/Monat · bei Zins +1 %: " + eur(sc.cashflow_stress) : "–"} |
| Kapitaldienstdeckung | ${sc.dscr ? dz(sc.dscr) + (sc.dscr >= 1.2 ? " ✅" : " (Banken wollen meist ≥ 1,2)") : "–"} |
| Leerstand verkraftbar | ${sc.break_even_leerstand != null ? (sc.break_even_leerstand > 0 ? `bis ${sc.break_even_leerstand} % der Miete` : "keiner – schon voll vermietet negativ") : "–"} |
| Eigenkapitalrendite inkl. Tilgung | ${sc.ek_rendite_tilgung != null ? sc.ek_rendite_tilgung + " % im Jahr auf das Eigenkapital" : "–"} |
| Baujahr / Energie | ${z(e.baujahr)}${e.sanierungsjahr ? ` (saniert ${e.sanierungsjahr})` : ""} / ${z(e.energieklasse)} |
| Ist-Miete | ${e.ist_miete_jahr ? eur(e.ist_miete_jahr / 12) + " im Monat" : e.ist_miete_monat ? eur(e.ist_miete_monat) + " im Monat" : "fehlt – anfragen"}${e.hausgeld_monat ? ` · Hausgeld ${eur(e.hausgeld_monat)}` : ""} |
| Ampel | ${{ gruen: "🟢 Grün", gelb: "🟡 Gelb", rot: "🔴 Rot" }[d.ampel]} |

## Strategien
| Strategie | Urteil | Ergebnis (realistisch) | lohnt bis (realistisch) | lohnt bis (vorsichtig) |
|---|---|---|---|---|
${st}

## Top 3 Risiken
${alleRisiken.slice(0, 3).map((x, i) => `${i + 1}. ${x}`).join("\n")}

## Verhandlungsziel
${v ? `| Einstieg | Ziel | Schmerzgrenze |\n|---|---|---|\n| ${eur(v.einstieg)} | ${eur(v.ziel)} | ${eur(v.schmerzgrenze)} |\n\nArgumente: ${verhandlungsArgumente(e, d).join(" · ")}. Die Schmerzgrenze nie nennen.` : `Kein realistisches Verhandlungsziel – der tragbare Preis liegt mehr als 30 % unter dem Angebot (${eur(d.kaufpreis)}).`}

## Offene Fragen
${Object.entries(fragen).map(([wer, l]) => `**${wer}**\n${l.map((x) => "- " + x).join("\n")}`).join("\n\n")}

<details><summary>Detailrechnung und Annahmen</summary>

${d.strategien.map((s) => `**${s.buchstabe ? s.buchstabe + " · " : ""}${s.name}** – ${s.begruendung}`).join("\n\n")}

${sc.wert ? `**Wertermittlung nach ImmoWertV (${sc.wert.methode})** – ${sc.wert.text}. Quelle: ${sc.wert.quelle}.\n\n` : ""}**Annahmen (im Rechner und unter „Annahmen anpassen“ änderbar)**
${annahmen.map((x) => "- " + x).join("\n")}
- Finanzierung: ${dz(a.zins)} % Zins, ${dz(a.tilgung)} % Tilgung, Kaufnebenkosten ${dz(num(a.grest) + num(a.notar) + makler)} % (Grunderwerbsteuer NRW ${dz(a.grest)} %, Notar ${dz(a.notar)} %, Makler ${dz(makler)} %${e.makler_prozent == null || e.makler_prozent === "" ? " – Annahme" : ""})

${alleRisiken.length > 3 ? `**Weitere Risiken**\n${alleRisiken.slice(3).map((x) => "- " + x).join("\n")}` : ""}

</details>

**Quellen:** Wertermittlung: Gutachterausschüsse Hamm und Dortmund, Grundstücksmarktbericht 2026; Bewirtschaftungskosten Anlage 3 ImmoWertV (Stand 2026). Marktwerte: ${MARKT_QUELLE}. Sanierung: ${SANIERUNG_QUELLE}. Förderung: kfw.de. Alles regelbasiert ohne KI – vor dem Kauf mit Mietspiegel, Grundstücksmarktbericht (gars.nrw), BORIS NRW und Besichtigung prüfen.`;
}

function verhandlungsArgumente(e, d) {
  const a = [];
  if (["E", "F", "G", "H"].includes(e.energieklasse)) a.push(`Energieklasse ${e.energieklasse} – Sanierungskosten`);
  if (!(e.ist_miete_monat || e.ist_miete_jahr)) a.push("keine Mietbelege");
  if (d.schnell?.preis_ok === false) a.push(`Preis pro m² über dem Ortsschnitt (${eur(d.schnell.vergleich_m2)})`);
  if (e.merkmale?.sanierungsbeduerftig || e.merkmale?.renovierungsbeduerftig) a.push("Renovierungsstau");
  if (e.baujahr && e.baujahr < 1978 && !e.sanierungsjahr) a.push("Baujahr vor 1978 – Leitungen, Elektrik, Dämmung");
  if (e.merkmale?.oelheizung || e.merkmale?.nachtspeicher) a.push("Heizungstausch nach Gebäudeenergiegesetz");
  a.push("schnelle, sichere Abwicklung mit Finanzierungsbestätigung");
  return a.slice(0, 4);
}
