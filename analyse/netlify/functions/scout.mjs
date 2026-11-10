// Immo-Scout alle 15 Minuten (ca. 6–22 Uhr): sucht neue Anzeigen um Hamm (30 km),
// rechnet die vielversprechendsten sofort durch und meldet nur echte Kandidaten per Push.
import { getStore } from "@netlify/blobs";
import { SUCHEN, UA, parseListe, bewerte, istNeu, istGut, UMBAU_KATEGORIEN } from "../../lib/scout-kern.mjs";
import { leseKleinanzeigenHtml } from "../../lib/inserat-parse.js";
import { auswerten } from "../../lib/auswertung.js";
import { sendePush } from "../../lib/push.mjs";

const MAX_DETAILS = 4; // Detailseiten pro Lauf (zurückhaltend)
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
    ampel: daten.ampel, score: daten.score, empfehlung: daten.empfehlung, verhandlungsziel: daten.verhandlungsziel,
    cashflow_monat: halten?.cashflow_monat ?? null,
    faktor: real?.kaltmiete_monat ? Math.round((daten.kaufpreis / (real.kaltmiete_monat * 12)) * 10) / 10 : null,
    beste: beste ? { name: beste.name, eignung: beste.eignung, max_kaufpreis: beste.max_kaufpreis } : null,
    ist_miete: Boolean(e.ist_miete_jahr || e.ist_miete_monat),
    warnungen: daten.warnungen || [],
    kaufpreis: daten.kaufpreis, wohnflaeche: daten.wohnflaeche_m2,
    baujahr: e.baujahr || null, einheiten: e.einheiten || null,
  };
}

export async function lauf(store, holen = holenStandard, jetzt = new Date()) {
  const gesehen = new Set((await store.get("scout/gesehen", { type: "json" })) || []);
  const funde = (await store.get("funde/liste", { type: "json" })) || [];
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
    o.gut = o.bewertung ? !o.bewertung.warnungen?.length && (o.bewertung.ampel === "gruen" || (o.bewertung.cashflow_monat ?? -1) >= 0) : istGut(o) && (o.faktor_inserat ?? 99) <= 12;
  }

  await store.setJSON("funde/liste", [...neu, ...funde].slice(0, 300));
  await store.setJSON("scout/gesehen", [...gesehen].slice(-8000));
  const gute = neu.filter((o) => o.gut);
  await store.setJSON("scout/status", { zeit: new Date().toISOString(), neu: neu.length, gut: gute.length, geprueft: kandidaten.length, fehler });

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
  return { neu: neu.length, gut: gute.length, geprueft: kandidaten.length, fehler };
}

export default async () => {
  const ergebnis = await lauf(getStore({ name: "immo", consistency: "strong" }));
  console.log("Scout", JSON.stringify(ergebnis));
};

export const config = { schedule: "*/15 5-20 * * *" }; // UTC → ca. 6–22 Uhr deutscher Zeit, alle 15 Minuten
