// Stündlicher Immo-Scout (ca. 6–21 Uhr): sucht neue Anzeigen um Hamm (30 km),
// speichert sie als "Funde" und schickt bei guten Treffern sofort eine Push-Nachricht.
import { getStore } from "@netlify/blobs";
import { SUCHEN, UA, parseListe, bewerte, istNeu, istGut } from "../../lib/scout-kern.mjs";
import { sendePush } from "../../lib/push.mjs";

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export async function lauf(store, holen = (pfad) => fetch(`https://www.kleinanzeigen.de/${pfad}`, { headers: { "User-Agent": UA, "Accept-Language": "de-DE" } }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })) {
  const gesehen = new Set((await store.get("scout/gesehen", { type: "json" })) || []);
  const funde = (await store.get("funde/liste", { type: "json" })) || [];
  const neu = [], fehler = [];
  for (const [kategorie, pfad] of SUCHEN) {
    try {
      for (const o of parseListe(await holen(pfad), kategorie).map(bewerte)) {
        if (gesehen.has(o.id)) continue;
        gesehen.add(o.id);
        if (istNeu(o) && !o.ausschluss) neu.push({ ...o, gefunden: new Date().toISOString(), gut: istGut(o) });
      }
    } catch (e) { fehler.push(`${kategorie}: ${e.message}`); }
    await pause(1200);
  }
  neu.sort((a, b) => b.punkte - a.punkte || (a.preis_m2 ?? 9e9) - (b.preis_m2 ?? 9e9));
  await store.setJSON("funde/liste", [...neu, ...funde].slice(0, 200));
  await store.setJSON("scout/gesehen", [...gesehen].slice(-6000));
  await store.setJSON("scout/status", { zeit: new Date().toISOString(), neu: neu.length, gut: neu.filter((o) => o.gut).length, fehler });
  const gute = neu.filter((o) => o.gut);
  if (gute.length) {
    const b = gute[0];
    const f = b.faktor_inserat ?? b.faktor;
    await sendePush(store, {
      titel: gute.length === 1 ? "🏠 Neuer guter Fund" : `🏠 ${gute.length} neue gute Funde`,
      text: `${b.titel} · ${b.preis_text}${b.preis_m2 ? ` · ${b.preis_m2} €/m²` : ""}${f ? ` · Faktor ~${f}` : ""} · ${b.km ?? "?"} km${gute.length > 1 ? ` (+${gute.length - 1} weitere)` : ""}`,
      url: "/#funde",
    });
  }
  return { neu: neu.length, gut: gute.length, fehler };
}

export default async () => {
  const ergebnis = await lauf(getStore({ name: "immo", consistency: "strong" }));
  console.log("Scout", JSON.stringify(ergebnis));
};

export const config = { schedule: "7 5-20 * * *" }; // UTC → ca. 6–21 Uhr deutscher Zeit
