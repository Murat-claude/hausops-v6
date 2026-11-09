// Gemeinsamer Speicher für die Immo-Analyse (Netlify Blobs).
// Geschützt durch einen gemeinsamen Zugangscode (Umgebungsvariable APP_ZUGANG).
//
// GET    /api/start                  -> { apiKey, objekte: [Kurzinfos] }
// PUT    /api/schluessel             -> { apiKey } speichern (für beide Geräte)
// GET    /api/objekte/:id            -> ganzes Objekt (Bericht, Daten, Rechner, Chat)
// PUT    /api/objekte/:id            -> Objekt speichern (ohne Chat; Chat bleibt erhalten)
// DELETE /api/objekte/:id            -> Objekt löschen
// POST   /api/objekte/:id/chat       -> { eintraege: [...] } an den Chat anhängen
// GET    /api/allgemein              -> allgemeiner Chat
// POST   /api/allgemein              -> { eintraege: [...] } anhängen
import { getStore } from "@netlify/blobs";
import { timingSafeEqual } from "node:crypto";

const MAX_CHAT = 400;

function json(status, daten) {
  return new Response(JSON.stringify(daten), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

function codeOk(gegeben, erwartet) {
  if (!erwartet || typeof gegeben !== "string") return false;
  const a = Buffer.from(gegeben);
  const b = Buffer.from(erwartet);
  return a.length === b.length && timingSafeEqual(a, b);
}

const gueltigeId = (id) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

function kurzinfo(o) {
  return {
    id: String(o.id),
    titel: String(o.titel || "Objekt").slice(0, 200),
    datum: o.datum || null,
    ampel: o.daten?.ampel || null,
    autor: o.autor || null,
    link: o.link || null,
  };
}

function bereinigeEintraege(eintraege) {
  if (!Array.isArray(eintraege)) return [];
  return eintraege.slice(0, 20).map((e) => ({
    rolle: e.rolle === "assistant" ? "assistant" : "user",
    text: String(e.text || "").slice(0, 60000),
    autor: String(e.autor || "").slice(0, 40),
    zeit: e.zeit || new Date().toISOString(),
  }));
}

export function erstelleHandler(store, zugang) {
  return async (req) => {
    if (!codeOk(req.headers.get("x-zugang"), zugang)) return json(401, { fehler: "Zugangscode falsch" });
    const url = new URL(req.url);
    const teile = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
    const methode = req.method;
    const body = async () => { try { return await req.json(); } catch { return null; } };

    if (teile[0] === "start" && methode === "GET") {
      const apiKey = (await store.get("einstellungen/apiKey", { type: "text" })) || "";
      const { blobs } = await store.list({ prefix: "objekte/" });
      const objekte = (await Promise.all(blobs.map(async (b) => (await store.getMetadata(b.key))?.metadata || null))).filter(Boolean);
      objekte.sort((a, b) => String(b.datum).localeCompare(String(a.datum)));
      return json(200, { apiKey, objekte });
    }

    if (teile[0] === "schluessel" && methode === "PUT") {
      const b = await body();
      const k = String(b?.apiKey || "").trim();
      if (!k.startsWith("sk-ant-") || k.length > 300) return json(400, { fehler: "Ungültiger Schlüssel" });
      await store.set("einstellungen/apiKey", k);
      return json(200, { ok: true });
    }

    if (teile[0] === "objekte" && teile[1] && gueltigeId(teile[1])) {
      const key = `objekte/${teile[1]}`;
      if (teile[2] === "chat" && methode === "POST") {
        const alt = await store.get(key, { type: "json" });
        if (!alt) return json(404, { fehler: "Objekt nicht gefunden" });
        const neu = bereinigeEintraege((await body())?.eintraege);
        alt.chat = [...(alt.chat || []), ...neu].slice(-MAX_CHAT);
        await store.setJSON(key, alt, { metadata: kurzinfo(alt) });
        return json(200, { chat: alt.chat });
      }
      if (methode === "GET") {
        const o = await store.get(key, { type: "json" });
        return o ? json(200, o) : json(404, { fehler: "Objekt nicht gefunden" });
      }
      if (methode === "PUT") {
        const o = await body();
        if (!o || typeof o !== "object") return json(400, { fehler: "Ungültige Daten" });
        const alt = await store.get(key, { type: "json" });
        const neu = { ...o, id: teile[1], chat: alt?.chat || o.chat || [] };
        const groesse = JSON.stringify(neu).length;
        if (groesse > 4_000_000) return json(413, { fehler: "Objekt zu groß" });
        await store.setJSON(key, neu, { metadata: kurzinfo(neu) });
        return json(200, { ok: true });
      }
      if (methode === "DELETE") {
        await store.delete(key);
        return json(200, { ok: true });
      }
    }

    if (teile[0] === "allgemein") {
      const key = "chat/allgemein";
      const chat = (await store.get(key, { type: "json" })) || [];
      if (methode === "GET") return json(200, { chat });
      if (methode === "POST") {
        const neu = [...chat, ...bereinigeEintraege((await body())?.eintraege)].slice(-MAX_CHAT);
        await store.setJSON(key, neu);
        return json(200, { chat: neu });
      }
    }

    return json(404, { fehler: "Unbekannte Anfrage" });
  };
}

export default async (req) => erstelleHandler(getStore({ name: "immo", consistency: "strong" }), process.env.APP_ZUGANG)(req);

export const config = { path: "/api/*" };
