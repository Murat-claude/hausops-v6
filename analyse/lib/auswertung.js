// Regelbasierte Immobilien-Auswertung – ohne KI, ohne laufende Kosten.
// Alle Annahmen sind sichtbar und änderbar; jede Zahl im Bericht ist entweder aus der Anzeige oder als Annahme gekennzeichnet.
import { rechneSzenario, maxKaufpreisCashflowNull, num } from "../rechner.js";

export const STANDARD_ANNAHMEN = {
  miete_m2: 7.5,          // €/m² kalt bei Neuvermietung, Raum Hamm/Unna/Soest (Angebotsmieten ca. 7–9 €)
  etw_saniert_m2: 2200,   // €/m² Verkaufspreis saniert (Fix & Flip)
  etw_bestand_m2: 2000,   // €/m² Verkaufspreis Eigentumswohnung im Bestand (Aufteilung)
  verkaufsfaktor_mfh: 18, // Verkaufspreis eines Mehrfamilienhauses = Jahreskaltmiete × Faktor
  bodenrichtwert_m2: 200, // €/m² Bauland
  zins: 4.0,              // % Sollzins 10 Jahre
  tilgung: 2.0,           // % anfängliche Tilgung
  ek_prozent: 25,         // Eigenkapital in % vom Kaufpreis, wenn kein Betrag angegeben
  grest: 6.5,             // Grunderwerbsteuer NRW
  notar: 2.0,             // Notar + Grundbuch
  makler: 3.57,           // falls in der Anzeige nichts steht
  monteur_preis: 13,      // € pro Bett und Nacht
};

const r5 = (v) => Math.round(v / 5000) * 5000;
const dz = (v, n = 2) => Number(v).toLocaleString("de-DE", { maximumFractionDigits: n });
const eur = (v) => (v == null || !Number.isFinite(v) ? "–" : Math.round(v).toLocaleString("de-DE") + " €");

function instandhaltung(baujahr) {
  if (!baujahr) return 14;
  if (baujahr < 1950) return 18;
  if (baujahr < 1980) return 15;
  if (baujahr < 2000) return 12;
  return 9;
}

function sanierungSchaetzung(e) {
  if (num(e.sanierung) > 0) return { wert: num(e.sanierung), quelle: "eigene Angabe" };
  const fl = num(e.wohnflaeche_m2);
  const m = e.merkmale || {};
  let proM2 = 50, grund = "Annahme: kleine Renovierung";
  if (m.sanierungsbeduerftig) { proM2 = 600; grund = "Annahme: laut Anzeige sanierungsbedürftig (ca. 600 €/m²)"; }
  else if (e.baujahr && e.baujahr < 1980) { proM2 = 150; grund = "Annahme: älteres Baujahr, Auffrischung (ca. 150 €/m²)"; }
  if (["E", "F", "G", "H"].includes(e.energieklasse)) { proM2 += 100; grund += ", plus Energie (Klasse " + e.energieklasse + ")"; }
  return { wert: Math.round(fl * proM2 / 1000) * 1000, quelle: grund };
}

export function auswerten(eingabe, annahmenTeil = {}) {
  const a = { ...STANDARD_ANNAHMEN, ...Object.fromEntries(Object.entries(annahmenTeil).filter(([, v]) => v !== "" && v != null)) };
  const e = { ...eingabe, merkmale: eingabe.merkmale || {} };
  const kp = num(e.kaufpreis);
  const fl = num(e.wohnflaeche_m2);
  const einheiten = Math.max(1, num(e.einheiten) || 1);
  const istEtw = /wohnung/i.test(e.objektart || "");
  const istGrundstueck = /grundst/i.test(e.objektart || "") && !fl;
  const makler = e.makler_prozent != null && e.makler_prozent !== "" ? num(e.makler_prozent) : a.makler;
  const nkProzent = num(a.grest) + num(a.notar) + makler;
  const annahmenListe = [];

  // ---- Miete
  let istMiete = num(e.ist_miete_jahr) / 12 || num(e.ist_miete_monat) || 0;
  const marktMiete = fl * num(a.miete_m2);
  let mieteHinweis = "";
  // Plausibilität: Bruttorendite aus der Ist-Miete muss zwischen ca. 1,5 % und 15 % liegen
  if (istMiete > 0 && kp > 0) {
    const rendite = (istMiete * 12) / kp;
    if (rendite > 0.15 && (istMiete / kp) >= 0.015 && (istMiete / kp) <= 0.15) {
      istMiete = istMiete / 12; mieteHinweis = " – Betrag aus der Anzeige als Jahresmiete gewertet";
    } else if (rendite > 0.15 || (fl && istMiete > marktMiete * 2.5)) {
      istMiete = 0; mieteHinweis = " – Mietangabe der Anzeige unplausibel, daher Marktmiete";
    } else if (einheiten > 1 && fl && istMiete < marktMiete * 0.35 && !e.merkmale.leer) {
      istMiete = 0; mieteHinweis = " – Mietangabe wirkt unvollständig (nur eine Wohnung?), daher Marktmiete";
    }
  }
  let realMiete, mieteQuelle;
  if (istMiete > 0 && e.merkmale.leer && marktMiete > istMiete) {
    realMiete = marktMiete; mieteQuelle = `Marktmiete ${dz(a.miete_m2)} €/m² (Anzeige: ${eur(istMiete)} Ist-Miete, Wohnungen werden frei)`;
  } else if (istMiete > 0) {
    realMiete = istMiete; mieteQuelle = "Ist-Miete laut Anzeige";
  } else {
    realMiete = marktMiete; mieteQuelle = `ANNAHME ${dz(a.miete_m2)} €/m² Marktmiete`;
  }
  annahmenListe.push(`Kaltmiete: ${eur(realMiete)}/Monat (${mieteQuelle}${mieteHinweis})`);

  const san = sanierungSchaetzung(e);
  annahmenListe.push(`Renovierung: ${eur(san.wert)} (${san.quelle})`);
  const ih = instandhaltung(e.baujahr);
  const nichtUml = istEtw ? Math.round(num(e.hausgeld_monat) * 0.4) || Math.round(fl * 1.0) : Math.round(fl * 0.3);
  annahmenListe.push(`Nicht umlagefähige Kosten: ${eur(nichtUml)}/Monat${istEtw && e.hausgeld_monat ? " (ca. 40 % vom Hausgeld)" : " (Annahme)"}; Instandhaltung ${ih} €/m² im Jahr (nach Baujahr)`);

  const szen = (fM, fS, lee, ihPlus) => ({
    kaltmiete_monat: Math.round(realMiete * fM),
    sanierung: Math.round(san.wert * fS),
    leerstand_prozent: lee,
    nicht_umlagefaehig_monat: nichtUml,
    instandhaltung_m2_jahr: ih + ihPlus,
    verwaltung_monat: einheiten > 1 ? 30 * einheiten : istEtw ? 0 : 25,
  });
  const szenarien = {
    vorsichtig: szen(istMiete > 0 && !e.merkmale.leer ? 1 : 0.9, 1.5, 5, 3),
    realistisch: szen(1, 1, 3, 0),
    gut: szen(istMiete > 0 && !e.merkmale.leer ? 1.05 : 1.08, 0.7, 2, -2),
  };

  const basis = { kaufpreis: kp, wohnflaeche_m2: fl, grunderwerbsteuer_prozent: a.grest, notar_grundbuch_prozent: a.notar, makler_prozent: makler };
  const ek = num(e.eigenkapital) || Math.round(kp * num(a.ek_prozent) / 100);
  const fin = { eigenkapital: ek, zins_prozent: num(a.zins), tilgung_prozent: num(a.tilgung) };
  annahmenListe.push(`Eigenkapital: ${eur(ek)}${num(e.eigenkapital) ? "" : ` (Annahme ${a.ek_prozent} % vom Kaufpreis)`}`);
  const real = fl && kp ? rechneSzenario(basis, szenarien.realistisch, fin) : null;
  const vors = fl && kp ? rechneSzenario(basis, szenarien.vorsichtig, fin) : null;

  // ---- Strategien
  const strategien = [];
  const nk = (preis) => preis * nkProzent / 100;

  if (real && !istGrundstueck) {
    const maxKp = maxKaufpreisCashflowNull(basis, szenarien.realistisch, fin);
    const cf = real.cashflowMonat;
    strategien.push({
      name: "Halten & vermieten",
      eignung: cf >= 100 && vors.cashflowMonat >= -100 ? "gut" : cf >= -150 ? "bedingt" : "nein",
      cashflow_monat: Math.round(cf),
      max_kaufpreis: r5(maxKp),
      begruendung: `Faktor ${real.faktor ? dz(real.faktor, 1) : "–"}, Bruttorendite ${real.bruttorendite ? dz(real.bruttorendite, 1) : "–"} %. Mit ${eur(ek)} Eigenkapital, ${dz(a.zins)} % Zins und ${dz(a.tilgung)} % Tilgung.`,
    });
  }

  if (fl && kp && !istGrundstueck) {
    // Fix & Flip: kaufen, sanieren, als saniert verkaufen (9 Monate Haltezeit)
    // Mehrfamilienhäuser werden nach Ertrag verkauft, kleinere Objekte nach Preis pro m²
    const mfh = einheiten >= 3;
    const erloes = mfh ? szenarien.realistisch.kaltmiete_monat * 1.05 * 12 * num(a.verkaufsfaktor_mfh) : fl * num(a.etw_saniert_m2);
    const sanFlip = Math.max(san.wert, fl * 400);
    const halte = (kp + nk(kp) + sanFlip) * num(a.zins) / 100 * 0.75;
    const kosten = kp + nk(kp) + sanFlip + halte + erloes * 0.04;
    const gewinn = erloes - kosten;
    const marge = gewinn / kosten * 100;
    const maxKp = ((erloes * 0.96) / 1.15 - sanFlip * (1 + num(a.zins) / 100 * 0.75)) / ((1 + nkProzent / 100) * (1 + num(a.zins) / 100 * 0.75));
    strategien.push({
      name: "Fix & Flip",
      eignung: marge >= 15 ? "gut" : marge >= 5 ? "bedingt" : "nein",
      gewinn: Math.round(gewinn),
      max_kaufpreis: r5(Math.max(maxKp, 0)),
      begruendung: `Verkauf saniert ca. ${eur(erloes)} (${mfh ? `Jahresmiete × ${a.verkaufsfaktor_mfh}` : `${dz(a.etw_saniert_m2, 0)} €/m²`}), Sanierung ${eur(sanFlip)}, 9 Monate Haltezeit, 4 % Verkaufskosten. Marge ${marge.toFixed(0)} % (Ziel ≥ 15 %).`,
    });
  }

  if (einheiten >= 2 && fl && kp) {
    // Vermietete Wohnungen erzielen weniger als freie (Abschlag 15 %)
    const vermietetAbschlag = e.merkmale.vermietet && !e.merkmale.leer ? 0.85 : 1;
    const erloes = fl * num(a.etw_bestand_m2) * vermietetAbschlag;
    const kostenAuf = 5000 * einheiten + 3000;
    const halte = (kp + nk(kp)) * num(a.zins) / 100;
    const kosten = kp + nk(kp) + san.wert + kostenAuf + halte + erloes * 0.04;
    const gewinn = erloes - kosten;
    const marge = gewinn / kosten * 100;
    const maxKp = ((erloes * 0.96) / 1.15 - san.wert - kostenAuf) / ((1 + nkProzent / 100) * (1 + num(a.zins) / 100));
    strategien.push({
      name: "Aufteilung in Eigentumswohnungen",
      eignung: marge >= 15 ? "gut" : marge >= 5 ? "bedingt" : "nein",
      gewinn: Math.round(gewinn),
      max_kaufpreis: r5(Math.max(maxKp, 0)),
      begruendung: `${einheiten} Wohnungen à ${dz(a.etw_bestand_m2, 0)} €/m²${vermietetAbschlag < 1 ? " (−15 %, weil vermietet)" : ""} = ${eur(erloes)}. Aufteilungskosten ca. ${eur(kostenAuf)}, 12 Monate. Marge ${marge.toFixed(0)} %. Achtung: ab 4 Verkäufen in 5 Jahren gewerblicher Grundstückshandel.`,
    });
  }

  const gfl = num(e.grundstueck_m2);
  if (istGrundstueck || e.merkmale.zweites_grundstueck || e.merkmale.baurecht || (gfl && fl && gfl > fl * 3)) {
    const preisM2 = istGrundstueck && gfl ? kp / gfl : null;
    const brw = num(a.bodenrichtwert_m2);
    let eignung = "bedingt", text, gewinn = null, maxKp = null;
    if (preisM2) {
      eignung = preisM2 <= brw * 0.9 ? "gut" : preisM2 <= brw * 1.1 ? "bedingt" : "nein";
      maxKp = r5(gfl * brw * 0.9);
      text = `${Math.round(preisM2)} €/m² gegenüber Bodenrichtwert-Annahme ${brw} €/m².${e.merkmale.baurecht ? " Baurecht laut Anzeige erwähnt." : " Baurecht beim Bauamt prüfen."}`;
    } else {
      const ueberschuss = Math.max(gfl - fl * 1.5, 0);
      gewinn = Math.round(ueberschuss * brw * 0.8);
      text = `Grundstück ${gfl ? gfl + " m²" : "groß"}${e.merkmale.zweites_grundstueck ? ", laut Anzeige mit separatem Flurstück" : ""}. Möglicher Wert einer Teilfläche grob ${eur(gewinn)} (Annahme ${brw} €/m², 80 %). Nur mit Bauvorbescheid einplanen.`;
    }
    strategien.push({ name: "Grundstück / Bebauung", eignung, gewinn, max_kaufpreis: maxKp, begruendung: text, zusatz: !istGrundstueck });
  }

  if (fl && kp && !istGrundstueck) {
    const betten = Math.max(2, Math.round((num(e.zimmer) || fl / 25) * 1.3));
    const brutto = betten * num(a.monteur_preis) * 365 * 0.6;
    const netto = brutto * 0.6;
    const lang = szenarien.realistisch.kaltmiete_monat * 12;
    strategien.push({
      name: "Monteur- / Ferienwohnung",
      eignung: netto > lang * 1.25 ? "bedingt" : "nein",
      cashflow_monat: Math.round((netto - lang) / 12),
      max_kaufpreis: null,
      begruendung: `Ca. ${betten} Betten × ${a.monteur_preis} €/Nacht × 60 % Auslastung, nach Kosten ca. ${eur(netto)}/Jahr gegenüber ${eur(lang)} Kaltmiete. Zahl zeigt den Unterschied pro Monat. Nur mit Genehmigung (Nutzungsänderung) und viel Aufwand.`,
    });
  }

  // ---- Ampel, Punktzahl, Verhandlungsziel
  const rang = { gut: 3, bedingt: 2, nein: 1 };
  // Zusatzpotenziale (Teilfläche, Monteurzimmer) bestimmen die Ampel nicht
  const kern = strategien.filter((s) => s.name !== "Monteur- / Ferienwohnung" && !s.zusatz);
  const beste = [...kern].sort((x, y) => rang[y.eignung] - rang[x.eignung] || (y.max_kaufpreis || 0) - (x.max_kaufpreis || 0))[0];
  const ampel = !beste ? "gelb" : beste.eignung === "gut" ? "gruen" : beste.eignung === "bedingt" ? "gelb" : "rot";
  let score = { gruen: 75, gelb: 50, rot: 25 }[ampel];
  if (real?.faktor) score += Math.max(-15, Math.min(15, Math.round((18 - real.faktor) * 2)));
  score = Math.max(5, Math.min(95, score));
  const maxPreise = kern.map((s) => s.max_kaufpreis).filter((v) => v > 0);
  const besterMax = maxPreise.length ? Math.max(...maxPreise) : null;
  const verhandlungsziel = besterMax ? r5(Math.min(kp * 0.97, besterMax)) : r5(kp * 0.92);
  const empfehlung = ampel === "gruen" ? `Interessant – ${beste.name} funktioniert zum Angebotspreis`
    : ampel === "gelb" ? `Nur mit Verhandlung: ${beste?.max_kaufpreis ? beste.name + " lohnt sich bis ca. " + eur(beste.max_kaufpreis) : "Zahlen prüfen"}`
    : `Zum Angebotspreis nicht wirtschaftlich${besterMax ? " – interessant erst ab ca. " + eur(besterMax) : ""}`;

  const daten = {
    titel: e.titel || [e.objektart, e.ort].filter(Boolean).join(" in ") || "Objekt",
    ort: e.ort || null, objektart: e.objektart || null, baujahr: e.baujahr || null,
    wohnflaeche_m2: fl, grundstueck_m2: gfl || null, einheiten, energieklasse: e.energieklasse || null,
    kaufpreis: kp, grunderwerbsteuer_prozent: a.grest, notar_grundbuch_prozent: a.notar, makler_prozent: makler,
    bauzins_prozent: a.zins, szenarien, strategien, ampel, score, empfehlung, verhandlungsziel,
    max_kaufpreis_cashflow_positiv: strategien.find((s) => s.name === "Halten & vermieten")?.max_kaufpreis || null,
  };
  return { daten, finanz: { eigenkapital: ek, zins_prozent: a.zins, tilgung_prozent: a.tilgung }, bericht: bericht(e, daten, real, annahmenListe, a, makler) };
}

function risiken(e, d) {
  const r = [];
  const m = e.merkmale || {};
  if (e.baujahr && e.baujahr < 1978) r.push("Baujahr vor 1978: Elektrik, Leitungen, Dämmung und mögliche Schadstoffe (Asbest) prüfen lassen.");
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

function bericht(e, d, real, annahmen, a, makler) {
  const z = (v) => (v == null || v === "" ? "fehlt – anfragen" : v);
  const st = d.strategien.map((s) => `| ${s.name} | ${{ gut: "✅ gut", bedingt: "⚠️ bedingt", nein: "❌ nein" }[s.eignung]} | ${s.cashflow_monat != null ? eur(s.cashflow_monat) + "/Monat" : s.gewinn != null ? eur(s.gewinn) : "–"} | ${s.max_kaufpreis ? "bis " + eur(s.max_kaufpreis) : "–"} |`).join("\n");
  return `# ${d.titel}

## Kurzfazit
**${d.empfehlung}.** Verhandlungsziel: **${eur(d.verhandlungsziel)}** (Angebot ${eur(d.kaufpreis)}).
${real ? `Im realistischen Szenario: Faktor ${real.faktor?.toFixed(1).replace(".", ",") ?? "–"}, Cashflow ${eur(real.cashflowMonat)} pro Monat vor Steuern.` : ""}

## Eckdaten aus der Anzeige
| | |
|---|---|
| Objektart | ${z(e.objektart)} |
| Ort | ${z(e.ort)} |
| Kaufpreis | ${e.kaufpreis ? eur(e.kaufpreis) : "fehlt – anfragen"} |
| Wohnfläche | ${e.wohnflaeche_m2 ? e.wohnflaeche_m2 + " m²" : "fehlt – anfragen"} |
| Preis pro m² | ${e.kaufpreis && e.wohnflaeche_m2 ? eur(e.kaufpreis / e.wohnflaeche_m2) : "–"} |
| Grundstück | ${e.grundstueck_m2 ? e.grundstueck_m2 + " m²" : "fehlt – anfragen"} |
| Einheiten / Zimmer | ${z(e.einheiten)} / ${z(e.zimmer)} |
| Baujahr | ${z(e.baujahr)} |
| Energieklasse | ${z(e.energieklasse)} |
| Ist-Miete | ${e.ist_miete_jahr ? eur(e.ist_miete_jahr) + " im Jahr" : e.ist_miete_monat ? eur(e.ist_miete_monat) + " im Monat" : "fehlt – anfragen"} |
| Makler | ${dz(makler)} %${e.makler_prozent == null || e.makler_prozent === "" ? " (Annahme)" : ""} |

## Strategien
| Strategie | Bewertung | Ergebnis | Lohnt sich |
|---|---|---|---|
${st}

## Annahmen (im Rechner änderbar)
${annahmen.map((x) => "- " + x).join("\n")}
- Finanzierung: ${dz(a.zins)} % Zins, ${dz(a.tilgung)} % Tilgung, Kaufnebenkosten ${dz(num(a.grest) + num(a.notar) + makler)} % (Grunderwerbsteuer NRW ${dz(a.grest)} %, Notar ${dz(a.notar)} %, Makler ${dz(makler)} %)
- Marktwerte: Verkauf saniert ${dz(a.etw_saniert_m2, 0)} €/m², Eigentumswohnung im Bestand ${dz(a.etw_bestand_m2, 0)} €/m², Mehrfamilienhaus Faktor ${dz(a.verkaufsfaktor_mfh, 1)}, Bauland ${dz(a.bodenrichtwert_m2, 0)} €/m² (alles Annahmen für den Raum Hamm)

## Risiken
${risiken(e, d).map((x) => "- " + x).join("\n")}

## Unterlagen und Fragen an Verkäufer / Makler
- Exposé mit Grundrissen und Wohnflächenberechnung je Einheit
- Mieterliste mit Ist-Mieten, Mietverträge, Nebenkostenabrechnung der letzten 2 Jahre
- Energieausweis, Alter von Heizung, Dach, Fenstern, Elektrik und Leitungen
- Grundbuchauszug und Baulastenverzeichnis${/wohnung/i.test(e.objektart || "") ? "\n- Teilungserklärung, Protokolle der letzten 3 Eigentümerversammlungen, Wirtschaftsplan, Stand der Rücklage" : ""}
- Grund für den Verkauf und Verhandlungsspielraum

_Regelbasierte Ersteinschätzung ohne KI. Marktwerte sind Annahmen – vor dem Kauf mit Mietspiegel, Bank und Besichtigung prüfen._`;
}
