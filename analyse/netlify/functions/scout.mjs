// Immo-Scout alle 15 Minuten (ca. 6–22 Uhr): sucht neue Anzeigen um Hamm (30 km),
// rechnet die vielversprechendsten sofort durch und meldet nur echte Kandidaten per Push.
import { getStore } from "@netlify/blobs";
import { SUCHEN, UA, parseListe, bewerte, istNeu, UMBAU_KATEGORIEN } from "../../lib/scout-kern.mjs";
import { leseKleinanzeigenHtml } from "../../lib/inserat-parse.js";
import { auswerten } from "../../lib/auswertung.js";
import { sendePush } from "../../lib/push.mjs";
import { einfuegen, aufraeumen, preisAenderung, naechstePruefung, meldenswert } from "../../lib/archiv.mjs";

const MAX_DETAILS = 6; // Detailseiten pro Lauf – alle aussichtsreichen werden voll durchgerechnet, bevor sie gemeldet werden
// Bei kurzzeitiger Drosselung (403/429/503) einmal nach 4 Sekunden erneut versuchen
async function holenStandard(pfad, versuch = 1) {
  const r = await fetch(`https://www.kleinanzeigen.de/${pfad}`, { headers: { "User-Agent": UA, "Accept-Language": "de-DE" } });
  if ([403, 429, 503].includes(r.status) && versuch === 1) { await new Promise((ok) => setTimeout(ok, 4000)); return holenStandard(pfad, 2); }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

const rang = (s) => ({ gut: 3, bedingt: 2, nein: 1 }[s.eignung] || 0) - (s.name === "Service-Apartments" ? 0.5 : 0);
const eur = (v) => Math.round(v).toLocaleString("de-DE") + " €";

// Volle Regel-Bewertung aus der Detailseite
export function bewerteDetail(fund, html) {
  const e = leseKleinanzeigenHtml(html);
  e.titel ||= fund.titel;
  e.kaufpreis ||= fund.preis;
  if (fund.kategorie !== "Grundstück") e.wohnflaeche_m2 ||= fund.flaeche;
  if (fund.kategorie === "Grundstück") { e.objektart = "Grundstück"; delete e.wohnflaeche_m2; e.grundstueck_m2 ||= fund.flaeche; }
  // Gemischte Objekte (Mehrfamilienhaus, Wohn- und Geschäftshaus) bleiben Wohnobjekte – nur leere Angaben werden ergänzt
  const unklar = !e.objektart || /einfamilien/i.test(e.objektart);
  if (fund.kategorie === "Büro zum Umbau" && unklar) e.objektart = "Bürogebäude";
  if (fund.kategorie === "Hotel/Pension" && unklar) e.objektart = "Hotel/Pension";
  if (!e.objektart) e.objektart = { Mehrfamilienhaus: "Mehrfamilienhaus", Eigentumswohnung: "Eigentumswohnung", Ferienwohnung: "Eigentumswohnung", "Wohn- und Geschäftshaus": "Wohn- und Geschäftshaus" }[fund.kategorie] || "Einfamilienhaus";
  if (!e.kaufpreis || (!e.wohnflaeche_m2 && !/grundst/i.test(e.objektart))) return null;
  const { daten } = auswerten(e);
  const halten = daten.strategien.find((s) => s.name === "Halten & vermieten");
  const beste = daten.strategien.filter((s) => !s.zusatz && s.name !== "Monteur- / Ferienwohnung").sort((a, b) => rang(b) - rang(a) || (b.max_kaufpreis || 0) - (a.max_kaufpreis || 0))[0];
  const real = daten.szenarien.realistisch;
  return {
    ampel: daten.ampel, score: daten.score, empfehlung: daten.urteil || daten.empfehlung, verhandlungsziel: daten.verhandlungsziel,
    stufe: daten.stufe, verhandlung: daten.verhandlung, nein_wenn: daten.nein_wenn,
    cashflow_vorsichtig_max: beste?.max_kaufpreis_vorsichtig ?? null,
    cashflow_monat: halten?.cashflow_monat ?? null,
    faktor: real?.kaltmiete_monat ? Math.round((daten.kaufpreis / (real.kaltmiete_monat * 12)) * 10) / 10 : null,
    beste: beste ? { name: beste.name, eignung: beste.eignung, max_kaufpreis: beste.max_kaufpreis } : null,
    ist_miete: Boolean(e.ist_miete_jahr || e.ist_miete_monat),
    warnungen: daten.warnungen || [],
    kaufpreis: daten.kaufpreis, wohnflaeche: daten.wohnflaeche_m2,
    baujahr: e.baujahr || null, einheiten: e.einheiten || null,
    anbieter: e.anbieter || null, objektart: e.objektart || null,
  };
}

export async function lauf(store, holen = holenStandard, jetzt = new Date()) {
  const gesehen = new Set((await store.get("scout/gesehen", { type: "json" })) || []);
  const funde = (await store.get("funde/liste", { type: "json" })) || [];
  let archiv = aufraeumen((await store.get("archiv/liste", { type: "json" })) || []);
  const imArchiv = new Map(archiv.map((x) => [x.id, x]));
  const senkungen = [];
  const geaendert = new Set(); // vom Scout geänderte Archiv-Einträge (für das Zusammenführen am Ende)
  const neu = [], fehler = [];
  // Ergebnisseiten parallel laden (eine Seite je Kategorie)
  // Umbau- und Ferien-Suchen (größerer Umkreis) nur im ersten Lauf jeder Stunde
  const stundenLauf = jetzt.getUTCMinutes() < 15;
  const suchen = SUCHEN.filter(([, , o = {}]) => !o.stuendlich || stundenLauf);
  const seiten = await Promise.allSettled(suchen.map(([, pfad]) => holen(pfad)));
  seiten.forEach((s, i) => {
    const [kategorie, , opts = {}] = suchen[i];
    if (s.status === "rejected") { fehler.push(`${kategorie}: ${s.reason?.message || s.reason}`); return; }
    for (const o of parseListe(s.value, kategorie).map((x) => bewerte(x, opts))) {
      // Objekte im Archiv: neuer Preis in der Ergebnisliste? Dann gleich festhalten
      const a = imArchiv.get(o.id);
      if (a && o.preis && a.preis && o.preis < a.preis) {
        const felder = preisAenderung(a, o.preis, jetzt);
        Object.assign(a, felder, { geprueft: jetzt.toISOString() });
        geaendert.add(a.id);
        if (felder.gesenkt) senkungen.push({ eintrag: a, senkung: felder.gesenkt, stufe: null });
      }
      if (gesehen.has(o.id)) continue;
      gesehen.add(o.id);
      if (istNeu(o) && !o.ausschluss) neu.push({ ...o, gefunden: new Date().toISOString(), gut: false });
    }
  });
  neu.sort((a, b) => b.punkte - a.punkte || (a.preis_m2 ?? 9e9) - (b.preis_m2 ?? 9e9));

  // Die vielversprechendsten sofort durchrechnen
  // Umbau-Objekte bekommen einen eigenen Platz, damit sie nicht hinter Wohnobjekten zurückfallen
  const umbau = neu.filter((o) => UMBAU_KATEGORIEN.includes(o.kategorie) && o.punkte >= 1).slice(0, 2);
  const wohnen = neu.filter((o) => o.punkte >= 1 && !["Garage", "Gewerbe", ...UMBAU_KATEGORIEN].includes(o.kategorie)).slice(0, MAX_DETAILS - umbau.length);
  const kandidaten = [...umbau, ...wohnen];
  await Promise.allSettled(kandidaten.map(async (o) => {
    try {
      const html = await holen(o.url.replace("https://www.kleinanzeigen.de/", ""));
      o.bewertung = bewerteDetail(o, html);
    } catch (e) { o.bewertung = null; }
  }));
  for (const o of neu) {
    // Gut nur ohne Datenwarnung; ohne Detailprüfung nur bei sehr starkem Faktor laut Anzeige
    // Gut = nach voller Detailrechnung "Top" (trägt sich zum Angebotspreis, auch im vorsichtigen Fall).
    // Ohne Detailprüfung nie "gut" – lieber eine Meldung weniger als eine, die sich später nicht hält.
    o.gut = o.bewertung?.stufe === "top";
    o.verhandeln = ["verhandeln", "pruefen"].includes(o.bewertung?.stufe);
  }

  // Archiv reihum nachprüfen (je Lauf bis zu 3 Anzeigen, jede höchstens einmal am Tag): Preis gesenkt? Noch online?
  const pruefen = naechstePruefung(archiv, 3, jetzt).filter((x) => !senkungen.some((s) => s.eintrag.id === x.id));
  await Promise.allSettled(pruefen.map(async (a) => {
    a.geprueft = jetzt.toISOString();
    geaendert.add(a.id);
    let html;
    try { html = await holen(a.url.replace("https://www.kleinanzeigen.de/", "")); }
    catch (e) { if (/HTTP 4(04|10)/.test(e.message)) a.status = "offline"; return; }
    if (!html.includes(`/${a.id}-`)) { a.status = "offline"; return; } // weitergeleitet = Anzeige gelöscht
    a.status = "online";
    const bw = bewerteDetail({ ...a, kategorie: a.kategorie || "Haus" }, html);
    if (!bw?.kaufpreis) return;
    const felder = preisAenderung(a, bw.kaufpreis, jetzt);
    Object.assign(a, felder);
    a.bewertung = { stufe: bw.stufe, ampel: bw.ampel, empfehlung: bw.empfehlung, max_kaufpreis: bw.beste?.max_kaufpreis ?? null, weg: bw.beste?.name ?? "" };
    if (bw.anbieter && !a.anbieter) a.anbieter = bw.anbieter;
    if (felder.gesenkt) senkungen.push({ eintrag: a, senkung: felder.gesenkt, stufe: bw.stufe });
  }));
  // Top- und Verhandlungs-Funde automatisch ins Archiv (Ordner "Beobachten"), damit Preissenkungen auffallen
  for (const o of neu.filter((x) => x.gut || x.verhandeln)) {
    if (imArchiv.has(o.id)) continue;
    archiv = einfuegen(archiv, { ...o, bewertung: o.bewertung, anbieter: o.bewertung?.anbieter }, "beobachten", jetzt).liste;
    geaendert.add(o.id);
  }
  // Frisch lesen und nur die eigenen Änderungen übernehmen – Ordnerwechsel aus der App in der Zwischenzeit bleiben erhalten
  if (geaendert.size) {
    const frisch = aufraeumen((await store.get("archiv/liste", { type: "json" })) || []);
    const meine = new Map(archiv.filter((x) => geaendert.has(x.id)).map((x) => [x.id, x]));
    const zusammen = frisch.map((x) => (meine.has(x.id) ? { ...meine.get(x.id), ordner: x.ordner } : x));
    for (const [id, x] of meine) if (!frisch.some((f) => f.id === id) && !imArchiv.has(id)) zusammen.unshift(x);
    await store.setJSON("archiv/liste", zusammen.slice(0, 1500));
  }
  for (const { eintrag: a, senkung, stufe } of senkungen.slice(0, 3)) {
    if (!meldenswert(a, senkung, stufe)) continue;
    const jetztInteressant = stufe === "top" ? " · jetzt Top!" : stufe === "verhandeln" ? " · jetzt mit Verhandlung interessant" : "";
    await sendePush(store, {
      titel: `📉 Preis −${String(senkung.prozent).replace(".", ",")} %: ${eur(senkung.auf)}${jetztInteressant}`,
      text: `${a.titel}\n${eur(senkung.von)} → ${eur(senkung.auf)} · ${a.ort.replace(/^\d{5}\s*/, "")}${a.ordner === "weggelegt" ? " (war weggelegt)" : ""}`,
      url: "/#archiv",
    });
  }

  await store.setJSON("funde/liste", [...neu, ...funde].slice(0, 300));
  await store.setJSON("scout/gesehen", [...gesehen].slice(-8000));
  const gute = neu.filter((o) => o.gut);
  await store.setJSON("scout/status", { zeit: new Date().toISOString(), neu: neu.length, gut: gute.length, verhandeln: neu.filter((x) => x.verhandeln).length, geprueft: kandidaten.length, archiv_geprueft: pruefen.length, senkungen: senkungen.length, fehler });

  for (const b of gute.slice(0, 3)) {
    const bw = b.bewertung;
    const zahlen = bw
      ? [bw.cashflow_monat != null ? `Cashflow ${bw.cashflow_monat >= 0 ? "+" : ""}${eur(bw.cashflow_monat)}/Monat` : null, bw.faktor ? `Faktor ${String(bw.faktor).replace(".", ",")}` : null, bw.beste?.max_kaufpreis ? `${bw.beste.name} bis ${eur(bw.beste.max_kaufpreis)}` : null].filter(Boolean).join(" · ")
      : `Faktor laut Anzeige ${String(b.faktor_inserat).replace(".", ",")}`;
    await sendePush(store, {
      titel: `${bw?.ampel === "gruen" ? "🟢" : "🏠"} ${b.preis_text} · ${b.km ?? "?"} km ${b.ort.replace(/^\d{5}\s*/, "")}`,
      text: `${b.titel}\n${zahlen}`,
      url: "/#funde",
    });
  }
  return { neu: neu.length, gut: gute.length, geprueft: kandidaten.length, archiv_geprueft: pruefen.length, senkungen: senkungen.length, fehler };
}

export default async () => {
  const ergebnis = await lauf(getStore({ name: "immo", consistency: "strong" }));
  console.log("Scout", JSON.stringify(ergebnis));
};

export const config = { schedule: "*/15 5-20 * * *" }; // UTC → ca. 6–22 Uhr deutscher Zeit, alle 15 Minuten
