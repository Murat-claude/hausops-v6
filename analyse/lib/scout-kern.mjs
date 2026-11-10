// Kern des Immo-Scouts (Suche, Auslesen, Bewertung) – ohne Netlify-Abhängigkeiten, damit testbar.
export const UA = "immo-scout/1.0 (private Objektsuche, wenige Abrufe)";
const ORT = "hamm", ORT_ID = "l2018r30"; // Hamm, Umkreis 30 km
export const SUCHEN = [
  ["Mehrfamilienhaus", `s-haus-kaufen/${ORT}/sortierung:neuste/c208${ORT_ID}+haus_kaufen.haustyp_s:mehrfamilienhaus`],
  ["Haus", `s-haus-kaufen/${ORT}/sortierung:neuste/c208${ORT_ID}`],
  ["Sanierungsobjekt", `s-haus-kaufen/${ORT}/sortierung:neuste/sanierungsbeduerftig/k0c208${ORT_ID}`],
  ["Eigentumswohnung", `s-eigentumswohnung/${ORT}/sortierung:neuste/c196${ORT_ID}`],
  ["Grundstück", `s-grundstuecke-garten/${ORT}/sortierung:neuste/c207${ORT_ID}`],
  ["Gewerbe", `s-gewerbeimmobilien/${ORT}/sortierung:neuste/kaufen/k0c277${ORT_ID}`],
  ["Garage", `s-garage-lagerraum/${ORT}/sortierung:neuste/garage-kaufen/k0c197${ORT_ID}`],
];
const MIETE = 7.5; // €/m² Schätzung für den Schnell-Faktor
const AUSSCHLUSS = ["neubau", "bauen sie", "hausbau", "massa", "town & country", "fertighaus", "wir suchen", "gesucht", "ankauf", "kostenlose vermarktung", "zu verkaufen?", "bauträger", "zu vermieten",
  "planbar", "ausbauhaus", "als ausbauhaus", "schlüsselfertig", "bauvorhaben", "neubauprojekt", "projektiert", "inkl. grundstück und", "mit förderung bauen", "haus bauen", "traumhaus bauen"];

const ent = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");

export function zahl(s) {
  const m = /(\d[\d.]*(?:,\d+)?)/.exec(s || "");
  if (!m) return null;
  const n = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function einstelldaten(roh) {
  const t = ent(roh), daten = {};
  const teile = t.split(/"id":\[0,"?(\d{8,})"?\]/);
  for (let i = 1; i < teile.length - 1; i += 2) {
    const m = /"sortingDate":\[0,"([^"]+)"\]/.exec(teile[i + 1].slice(0, 8000));
    if (m && !(teile[i] in daten)) daten[teile[i]] = m[1];
  }
  return daten;
}

export function parseListe(seite, kategorie) {
  const datum = einstelldaten(seite);
  const treffer = [];
  for (const [a] of seite.matchAll(/<article [\s\S]*?<\/article>/g)) {
    const href = /data-href="([^"]+)"/.exec(a);
    if (!href) continue;
    const id = (/\/(\d+)-\d+-\d+$/.exec(href[1]) || [])[1] || href[1];
    let beschreibung = "";
    const ld = /(\{"creditText"[\s\S]*?\})\s*</.exec(a);
    if (ld) { try { beschreibung = JSON.parse(ent(ld[1])).description || ""; } catch { /* egal */ } }
    const zeilen = ent(a.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, "\n")).split("\n").map((z) => z.trim()).filter(Boolean);
    const kmZeile = zeilen.find((z) => /^\((ca\. )?\d+ km\)$/.test(z)) || "";
    const i = kmZeile ? zeilen.indexOf(kmZeile) : 0;
    treffer.push({
      id, kategorie,
      titel: kmZeile ? zeilen[i + 1] || "" : "",
      ort: kmZeile ? zeilen[i - 1] || "" : "",
      km: kmZeile ? parseInt(kmZeile.replace(/\D/g, ""), 10) : null,
      preis_text: zeilen.find((z) => z.includes("€") || z === "VB") || "",
      groesse_text: zeilen.find((z) => /m²|Zi\./.test(z) && z.length < 40) || "",
      beschreibung: beschreibung.slice(0, 400),
      eingestellt: datum[id] || "",
      url: "https://www.kleinanzeigen.de" + href[1],
    });
  }
  return treffer;
}

export function bewerte(o) {
  const p = zahl(o.preis_text), a = zahl(o.groesse_text);
  const t = `${o.titel} ${o.beschreibung}`.toLowerCase();
  o.preis = p; o.flaeche = a;
  o.preis_m2 = p && a && !o.groesse_text.includes("€/m²") ? Math.round(p / a) : null;
  o.faktor = o.preis_m2 && !["Grundstück", "Garage", "Gewerbe"].includes(o.kategorie) ? Math.round((p / (a * MIETE * 12)) * 10) / 10 : null;
  const fi = /faktor\s*(\d+[,.]?\d*)/.exec(t);
  if (fi) o.faktor_inserat = parseFloat(fi[1].replace(",", "."));
  const f = o.faktor_inserat ?? o.faktor;
  let punkte = 0;
  if (f != null) punkte += f <= 12 ? 3 : f <= 15 ? 2 : f <= 18 ? 1 : 0;
  if (/vermietet|mieteinnahm|rendite|kapitalanlage|wohneinheiten|mehrfamilien/.test(t)) punkte += 1;
  if (/sanier|renovier|handwerker|modernisierungsbed/.test(t)) punkte += 1;
  if (o.kategorie === "Grundstück" && /baugenehmigung|genehmigt|§\s*34|bebauungsplan/.test(t)) punkte += 2;
  o.punkte = punkte;
  const kauf = o.kategorie !== "Garage";
  const miete = (o.preis_text + o.groesse_text).includes("€/m²") || /miete/.test((o.preis_text + o.titel).toLowerCase());
  o.ausschluss = AUSSCHLUSS.some((w) => t.includes(w)) || (o.km != null && o.km > 32) || !p || (kauf && (p < 30000 || miete));
  return o;
}

export const istNeu = (o) => /^(Heute|Gestern)/.test(o.eingestellt || "");
export const istGut = (o) => o.punkte >= 3 || (o.faktor_inserat ?? o.faktor ?? 99) <= 13;
