// Homevio ↔ Smoobu: Buchungen und Gastdaten mit dem Smoobu-Zugang des jeweiligen Bestands holen.
// Ablauf: Anmeldung prüfen → Rolle im Bestand prüfen (Inhaber/bearbeiten) → Schlüssel mit Service-Rolle lesen → Smoobu abrufen.
// Der Schlüssel verlässt den Server nie. (Die alte Funktion smoobu-sync bleibt unverändert für Livora Clean.)
const { fetchBookings } = require("../lib/immo-smoobu-lib.js");

const reply = (status, body) => ({ statusCode: status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) });

async function handle(event, { fetchImpl = fetch, env = process.env } = {}) {
  if (event.httpMethod !== "POST") return reply(405, { success: false, error: "Nur POST" });
  const URL_ = env.IMMO_SUPABASE_URL, ANON = env.IMMO_SUPABASE_ANON_KEY, SERVICE = env.IMMO_SUPABASE_SERVICE_ROLE_KEY;
  if (!URL_ || !ANON || !SERVICE) return reply(500, { success: false, error: "Server ist nicht vollständig eingerichtet (Supabase-Variablen)." });
  const h = event.headers || {};
  const jwt = (h.authorization || h.Authorization || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return reply(401, { success: false, error: "Bitte anmelden." });
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { return reply(400, { success: false, error: "Ungültige Anfrage" }); }
  const owner = String(body.owner || "");
  if (!/^[0-9a-f-]{36}$/i.test(owner)) return reply(400, { success: false, error: "Bestand fehlt" });

  // Rolle des angemeldeten Nutzers im Bestand (mit SEINEM Token – die Datenbank entscheidet)
  const roleRes = await fetchImpl(`${URL_}/rest/v1/rpc/ws_role`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_owner: owner }) });
  if (roleRes.status === 401) return reply(401, { success: false, error: "Sitzung abgelaufen – bitte neu anmelden." });
  const role = roleRes.ok ? await roleRes.json() : null;
  if (!["owner", "editor"].includes(role)) return reply(403, { success: false, error: "Kein Zugriff auf diesen Bestand." });

  const secRes = await fetchImpl(`${URL_}/rest/v1/immo_secrets?user_id=eq.${owner}&select=smoobu_key,smoobu_secret`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
  const row = secRes.ok ? (await secRes.json())[0] : null;
  if (!row?.smoobu_key) return reply(400, { success: false, code: "not_connected", error: "Smoobu ist noch nicht verbunden – API-Key und API-Secret unter Ferienwohnung → Kanäle eintragen." });
  const creds = { apiKey: row.smoobu_key, secret: row.smoobu_secret || "" };

  try {
    if (body.action === "test") {
      const r = await fetchBookings(creds, { daysBack: 30, daysAhead: 30, guests: false, fetchImpl });
      return reply(200, { success: true, count: r.buchungen.length, einheiten: [...new Set(r.buchungen.map((b) => b.einheit_name))] });
    }
    const r = await fetchBookings(creds, { daysBack: Math.min(Number(body.daysBack) || 365, 730), guests: true, fetchImpl });
    return reply(200, { success: true, count: r.buchungen.length, ...r });
  } catch (e) {
    const msg = String(e.message || e);
    const error = /Smoobu 40[13]/.test(msg) ? "Smoobu lehnt den Zugang ab – API-Key und API-Secret prüfen (Smoobu → Einstellungen → Entwickler / API)."
      : /fetch failed|ENOTFOUND|ECONNRE|ETIMEDOUT/i.test(msg) ? "Smoobu ist gerade nicht erreichbar – bitte später erneut versuchen." : msg.slice(0, 300);
    return reply(502, { success: false, error });
  }
}

exports.handler = (event) => handle(event);
exports.handle = handle;
