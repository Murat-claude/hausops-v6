// Speicher für Analysen und Chats.
// "gemeinsam": Netlify-Funktion /api (Zugangscode, beide Partner sehen alles)
// "lokal":     Browser-Speicher dieses Geräts (Rückfall, wenn kein Server da ist)

const LOKAL = { zugang: "immo-zugang", name: "immo-name", key: "immo-analyse-apikey", verlauf: "immo-analyse-verlauf", allgemein: "immo-allgemein" };

export function lese(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
export function schreibe(key, wert) {
  try { localStorage.setItem(key, JSON.stringify(wert)); return true; } catch { return false; }
}
export function entferne(key) {
  try { localStorage.removeItem(key); } catch { /* egal */ }
}

export const geraet = {
  get zugang() { return lese(LOKAL.zugang, ""); },
  set zugang(v) { v ? schreibe(LOKAL.zugang, v) : entferne(LOKAL.zugang); },
  get name() { return lese(LOKAL.name, ""); },
  set name(v) { schreibe(LOKAL.name, v); },
};

export class ZugangFalsch extends Error {}

async function api(pfad, methode = "GET", body) {
  const r = await fetch("api/" + pfad, {
    method: methode,
    headers: { "x-zugang": geraet.zugang, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) throw new ZugangFalsch("Zugangscode falsch");
  const daten = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(daten.fehler || `Serverfehler ${r.status}`);
  return daten;
}

const ohneChat = ({ chat, ...rest }) => rest;
const kurz = (o) => ({ id: String(o.id), titel: o.titel, datum: o.datum, ampel: o.daten?.ampel || null, autor: o.autor || null, link: o.link || null });

export const speicher = {
  modus: "lokal",

  // Prüft, ob der gemeinsame Speicher erreichbar ist. Liefert { apiKey, objekte }.
  async start() {
    if (geraet.zugang) {
      try {
        const d = await api("start");
        this.modus = "gemeinsam";
        return d;
      } catch (e) {
        if (e instanceof ZugangFalsch) throw e;
        // Kein Server (z. B. lokale Datei) -> lokal weiter
      }
    }
    this.modus = "lokal";
    return { apiKey: lese(LOKAL.key, ""), objekte: lese(LOKAL.verlauf, []).map(kurz) };
  },

  async serverDa() {
    try { const r = await fetch("api/start", { headers: { "x-zugang": "-" } }); return r.status === 401; } catch { return false; }
  },

  async schluesselSpeichern(k) {
    if (this.modus === "gemeinsam") await api("schluessel", "PUT", { apiKey: k });
    else schreibe(LOKAL.key, k);
  },

  async liste() {
    if (this.modus === "gemeinsam") return (await api("start")).objekte;
    return lese(LOKAL.verlauf, []).map(kurz);
  },

  async laden(id) {
    if (this.modus === "gemeinsam") return api(`objekte/${encodeURIComponent(id)}`);
    return lese(LOKAL.verlauf, []).find((o) => String(o.id) === String(id)) || null;
  },

  async speichern(o) {
    if (this.modus === "gemeinsam") return api(`objekte/${encodeURIComponent(o.id)}`, "PUT", ohneChat(o));
    let liste = lese(LOKAL.verlauf, []).filter((e) => String(e.id) !== String(o.id));
    liste.unshift(o);
    liste = liste.slice(0, 25);
    while (liste.length && !schreibe(LOKAL.verlauf, liste)) liste.pop();
  },

  async loeschen(id) {
    if (this.modus === "gemeinsam") return api(`objekte/${encodeURIComponent(id)}`, "DELETE");
    schreibe(LOKAL.verlauf, lese(LOKAL.verlauf, []).filter((e) => String(e.id) !== String(id)));
  },

  // Hängt Chat-Einträge an. Liefert den kompletten Chat zurück.
  async chatAnhaengen(id, eintraege) {
    if (id == null) {
      if (this.modus === "gemeinsam") return (await api("allgemein", "POST", { eintraege })).chat;
      const chat = [...lese(LOKAL.allgemein, []), ...eintraege].slice(-400);
      schreibe(LOKAL.allgemein, chat);
      return chat;
    }
    if (this.modus === "gemeinsam") return (await api(`objekte/${encodeURIComponent(id)}/chat`, "POST", { eintraege })).chat;
    const liste = lese(LOKAL.verlauf, []);
    const o = liste.find((e) => String(e.id) === String(id));
    if (!o) return eintraege;
    o.chat = [...(o.chat || []), ...eintraege].slice(-400);
    schreibe(LOKAL.verlauf, liste);
    return o.chat;
  },

  async allgemeinerChat() {
    if (this.modus === "gemeinsam") return (await api("allgemein")).chat;
    return lese(LOKAL.allgemein, []);
  },

  // Analysen, die vorher nur auf diesem Gerät lagen, in den gemeinsamen Speicher übernehmen
  async lokaleHochladen() {
    if (this.modus !== "gemeinsam") return 0;
    const lokal = lese(LOKAL.verlauf, []);
    for (const o of lokal) {
      await api(`objekte/${encodeURIComponent(o.id)}`, "PUT", o);
    }
    if (lokal.length) entferne(LOKAL.verlauf);
    return lokal.length;
  },
};

// ---------- Funde & Benachrichtigungen (nur gemeinsamer Speicher) ----------
export const extras = {
  async funde() { return speicher.modus === "gemeinsam" ? api("funde") : { funde: [], status: null }; },
  async pushAbo(subscription, name) { return api("push/abo", "POST", { subscription, name }); },
  async pushAbmelden(endpoint) { return api("push/abo", "DELETE", { endpoint }); },
  async pushTest() { return api("push/test", "POST", {}); },
};
