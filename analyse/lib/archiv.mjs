// Archiv: Objekte bleiben ein halbes Jahr gespeichert, sortiert in Ordnern, mit Preisverlauf.
// Reine Logik ohne Netlify – damit testbar. Gespeichert wird im Blob-Store unter "archiv/liste".
export const ORDNER = [
  ["favoriten", "Favoriten"],
  ["beobachten", "Beobachten"],
  ["angefragt", "Angefragt"],
  ["weggelegt", "Weggelegt"],
];
const ORDNER_IDS = new Set(ORDNER.map(([id]) => id));
export const HALTEDAUER_TAGE = 183;
const TAG = 24 * 3600 * 1000;

const text = (v, n) => String(v ?? "").slice(0, n);
const zahl = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);

// Kleinanzeigen-ID aus einem Link (für den Abgleich mit dem Scout)
export function idAusUrl(url) {
  const m = /\/(\d{6,})-\d+-\d+\/?$/.exec(String(url || ""));
  return m ? m[1] : null;
}

export function bereinige(e = {}, ordner) {
  const id = text(e.id || idAusUrl(e.url) || "", 80).replace(/[^\w-]/g, "");
  if (!id) return null;
  const bw = e.bewertung || {};
  return {
    id,
    url: /^https:\/\/(www\.)?kleinanzeigen\.de\//.test(e.url || "") || /^#objekt-/.test(e.url || "") ? text(e.url, 500) : "",
    objekt_id: e.objekt_id ? text(e.objekt_id, 64) : null,
    titel: text(e.titel || "Objekt", 200),
    ort: text(e.ort, 80),
    kategorie: text(e.kategorie, 40),
    preis: zahl(e.preis),
    flaeche: zahl(e.flaeche),
    ordner: ORDNER_IDS.has(ordner || e.ordner) ? ordner || e.ordner : "beobachten",
    bewertung: e.bewertung ? {
      stufe: text(bw.stufe, 20) || null, ampel: text(bw.ampel, 10) || null, empfehlung: text(bw.empfehlung, 240),
      max_kaufpreis: zahl(bw.beste?.max_kaufpreis ?? bw.max_kaufpreis), weg: text(bw.beste?.name ?? bw.weg, 60),
    } : null,
    anbieter: e.anbieter ? {
      name: text(e.anbieter.name, 80), firma: text(e.anbieter.firma, 120), email: text(e.anbieter.email, 120),
      telefon: text(e.anbieter.telefon, 40), anzeigen_id: text(e.anbieter.anzeigen_id, 20), objekt_nr: text(e.anbieter.objekt_nr, 30),
    } : null,
    von: text(e.von, 40),
  };
}

// Neu anlegen oder zusammenführen; Preisverlauf und Speicherdatum bleiben erhalten
export function einfuegen(liste, roh, ordner, jetzt = new Date()) {
  const e = bereinige(roh, ordner);
  if (!e) return { liste, eintrag: null };
  const alt = liste.find((x) => x.id === e.id);
  const iso = jetzt.toISOString();
  let eintrag;
  if (alt) {
    eintrag = {
      ...alt,
      ...Object.fromEntries(Object.entries(e).filter(([k, v]) => v != null && v !== "" && k !== "ordner" && k !== "preis")),
      ordner: ordner ? e.ordner : alt.ordner,
      aktualisiert: iso,
    };
    if (e.preis && e.preis !== alt.preis) Object.assign(eintrag, preisAenderung(alt, e.preis, jetzt));
  } else {
    eintrag = { ...e, gespeichert: iso, aktualisiert: iso, geprueft: iso, status: "online", verlauf: e.preis ? [{ d: iso, p: e.preis }] : [] };
  }
  return { liste: [eintrag, ...liste.filter((x) => x.id !== e.id)], eintrag };
}

// Preisänderung festhalten; liefert die geänderten Felder (inkl. Senkung in Prozent)
export function preisAenderung(eintrag, neuerPreis, jetzt = new Date()) {
  const p = zahl(neuerPreis);
  if (!p || p === eintrag.preis) return {};
  const iso = jetzt.toISOString();
  const verlauf = [...(eintrag.verlauf || []), { d: iso, p }].slice(-20);
  const felder = { preis: p, verlauf, aktualisiert: iso };
  if (eintrag.preis && p < eintrag.preis) {
    felder.gesenkt = { d: iso, von: eintrag.preis, auf: p, prozent: Math.round((1 - p / eintrag.preis) * 1000) / 10 };
  }
  return felder;
}

// Älter als ein halbes Jahr → raus
export function aufraeumen(liste, jetzt = new Date()) {
  return liste.filter((x) => jetzt - new Date(x.gespeichert || x.aktualisiert || 0) < HALTEDAUER_TAGE * TAG);
}

export const restTage = (x, jetzt = new Date()) => Math.max(0, Math.ceil(HALTEDAUER_TAGE - (jetzt - new Date(x.gespeichert)) / TAG));

// Welche Einträge prüft der Scout als Nächstes? Die am längsten nicht geprüften, höchstens einmal am Tag
export function naechstePruefung(liste, anzahl = 3, jetzt = new Date()) {
  return liste
    .filter((x) => x.url && x.url.startsWith("https://") && x.status !== "offline" && jetzt - new Date(x.geprueft || 0) > 20 * 3600 * 1000)
    .sort((a, b) => new Date(a.geprueft || 0) - new Date(b.geprueft || 0))
    .slice(0, anzahl);
}

// Soll eine Preissenkung gemeldet werden? Weggelegte nur bei deutlicher Senkung oder wenn sie jetzt interessant sind
export function meldenswert(eintrag, senkung, neueStufe) {
  if (!senkung) return false;
  if (["top", "verhandeln"].includes(neueStufe)) return true;
  if (eintrag.ordner === "weggelegt") return senkung.prozent >= 8;
  return senkung.prozent >= 3;
}
