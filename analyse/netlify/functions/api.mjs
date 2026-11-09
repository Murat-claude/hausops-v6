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
import { timingSafeEqual, createHash } from "node:crypto";
import { sendePush } from "../../lib/push.mjs";
import { leseKleinanzeigenHtml } from "../../lib/inserat-parse.js";

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

export function erstelleHandler(store, zugang, benachrichtige = (n) => sendePush(store, n)) {
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
        const frage = neu.find((e) => e.rolle === "user");
        if (frage) await benachrichtige({ titel: `📝 ${frage.autor || "Partner"}: Notiz zu ${alt.titel || "einem Objekt"}`, text: frage.text.slice(0, 140), url: `/#objekt-${teile[1]}`, ausser: frage.autor }).catch(() => 0);
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
        if (!alt) {
          const ampel = { gruen: "🟢", gelb: "🟡", rot: "🔴" }[neu.daten?.ampel] || "🏠";
          await benachrichtige({ titel: `${ampel} ${neu.autor || "Partner"} hat ein Objekt analysiert`, text: `${neu.titel}${neu.daten?.empfehlung ? " – " + neu.daten.empfehlung : ""}`.slice(0, 160), url: `/#objekt-${teile[1]}`, ausser: neu.autor }).catch(() => 0);
        }
        return json(200, { ok: true });
      }
      if (methode === "DELETE") {
        await store.delete(key);
        return json(200, { ok: true });
      }
    }

    if (teile[0] === "push" && teile[1] === "abo") {
      const b = await body();
      const endpoint = b?.subscription?.endpoint || b?.endpoint;
      if (!endpoint || !/^https:\/\//.test(endpoint)) return json(400, { fehler: "Ungültiges Abo" });
      const key = "abos/" + createHash("sha256").update(endpoint).digest("hex").slice(0, 24);
      if (methode === "POST") {
        await store.setJSON(key, { subscription: b.subscription, name: String(b.name || "").slice(0, 40), seit: new Date().toISOString() });
        return json(200, { ok: true });
      }
      if (methode === "DELETE") { await store.delete(key); return json(200, { ok: true }); }
    }

    if (teile[0] === "push" && teile[1] === "test" && methode === "POST") {
      const n = await benachrichtige({ titel: "🔔 Benachrichtigungen aktiv", text: "So sehen Meldungen der Immo-Analyse aus.", url: "/" });
      return json(200, { gesendet: n });
    }

    // Kleinanzeigen-Anzeige serverseitig auslesen (nur diese Adresse, kein beliebiger Abruf)
    if (teile[0] === "inserat" && methode === "GET") {
      const ziel = url.searchParams.get("url") || "";
      let u;
      try { u = new URL(ziel); } catch { return json(400, { fehler: "Ungültiger Link" }); }
      if (u.protocol !== "https:" || !/^(www\.)?kleinanzeigen\.de$/.test(u.hostname) || !u.pathname.startsWith("/s-anzeige/")) {
        return json(400, { fehler: "Automatisch auslesen geht nur bei Kleinanzeigen-Anzeigen. Bei anderen Portalen den Text der Anzeige kopieren und einfügen." });
      }
      let html;
      try {
        const r = await fetch(`https://www.kleinanzeigen.de${u.pathname}`, { headers: { "User-Agent": "immo-scout/1.0 (private Objektsuche, wenige Abrufe)", "Accept-Language": "de-DE" } });
        if (!r.ok) return json(502, { fehler: `Anzeige nicht erreichbar (${r.status}). Ist sie noch online?` });
        // Gelöschte Anzeigen leiten auf andere Seiten weiter – dann nichts übernehmen
        const id = (/\/(\d+)-\d+-\d+\/?$/.exec(u.pathname) || [])[1];
        if (id && !new URL(r.url).pathname.includes(`/${id}-`)) return json(404, { fehler: "Diese Anzeige gibt es nicht mehr (Kleinanzeigen leitet weiter). Bitte prüfen, ob der Link stimmt." });
        html = await r.text();
        if (id && !html.includes(`/${id}-`)) return json(404, { fehler: "Diese Anzeige gibt es nicht mehr. Bitte prüfen, ob der Link stimmt." });
      } catch {
        return json(502, { fehler: "Kleinanzeigen ist gerade nicht erreichbar. Bitte den Anzeigentext kopieren und einfügen." });
      }
      const daten = leseKleinanzeigenHtml(html);
      return json(200, { daten: { ...daten, link: `https://www.kleinanzeigen.de${u.pathname}` } });
    }

    if (teile[0] === "funde" && methode === "GET") {
      const funde = (await store.get("funde/liste", { type: "json" })) || [];
      const status = await store.get("scout/status", { type: "json" });
      return json(200, { funde, status });
    }

    // ---------- Merkliste: Favoriten und To-dos (gemeinsam) ----------
    if (teile[0] === "merkliste" && methode === "GET") {
      const favoriten = (await store.get("merkliste/favoriten", { type: "json" })) || [];
      const todos = (await store.get("merkliste/todos", { type: "json" })) || [];
      return json(200, { favoriten, todos });
    }
    if (teile[0] === "favoriten" && methode === "POST") {
      const b = (await body()) || {};
      const e = b.eintrag || {};
      const id = String(e.id || "").slice(0, 80);
      if (!id) return json(400, { fehler: "Eintrag fehlt" });
      let liste = (await store.get("merkliste/favoriten", { type: "json" })) || [];
      liste = liste.filter((x) => x.id !== id);
      if (b.aktion !== "entfernen") {
        liste.unshift({
          id, art: e.art === "objekt" ? "objekt" : "fund",
          titel: String(e.titel || "").slice(0, 200), url: String(e.url || "").slice(0, 500),
          preis_text: String(e.preis_text || "").slice(0, 40), ort: String(e.ort || "").slice(0, 80),
          info: String(e.info || "").slice(0, 200), ampel: e.ampel || null,
          von: String(e.von || "").slice(0, 40), zeit: new Date().toISOString(),
        });
        await benachrichtige({ titel: `⭐ ${e.von || "Partner"} hat einen Favoriten gemerkt`, text: `${e.titel || ""}${e.preis_text ? " · " + e.preis_text : ""}`.slice(0, 160), url: "/#merkliste", ausser: e.von }).catch(() => 0);
      }
      await store.setJSON("merkliste/favoriten", liste.slice(0, 300));
      return json(200, { favoriten: liste });
    }
    if (teile[0] === "todos" && methode === "POST") {
      const b = (await body()) || {};
      let liste = (await store.get("merkliste/todos", { type: "json" })) || [];
      if (b.aktion === "neu") {
        const text = String(b.text || "").trim().slice(0, 300);
        if (!text) return json(400, { fehler: "Text fehlt" });
        const t = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, fuer: String(b.fuer || "").slice(0, 40), von: String(b.von || "").slice(0, 40), objekt: b.objekt ? { id: String(b.objekt.id).slice(0, 80), titel: String(b.objekt.titel || "").slice(0, 120), url: String(b.objekt.url || "").slice(0, 500) } : null, faellig: b.faellig || null, erledigt: false, zeit: new Date().toISOString() };
        liste.unshift(t);
        if (t.fuer && t.fuer !== t.von) await benachrichtige({ titel: `✅ Neues To-do von ${t.von || "Partner"}`, text: t.text.slice(0, 160), url: "/#merkliste", ausser: t.von }).catch(() => 0);
      } else if (b.aktion === "umschalten") {
        liste = liste.map((t) => (t.id === b.id ? { ...t, erledigt: !t.erledigt, erledigt_von: b.von || null } : t));
      } else if (b.aktion === "entfernen") {
        liste = liste.filter((t) => t.id !== b.id);
      } else return json(400, { fehler: "Unbekannte Aktion" });
      await store.setJSON("merkliste/todos", liste.slice(0, 500));
      return json(200, { todos: liste });
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
