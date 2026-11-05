// HausOps Immobilien: Konten löschen (braucht den Supabase-Service-Schlüssel, daher serverseitig).
// Aktionen: delete_self (eigenes Konto, DSGVO) und delete_user (nur Admins).
// Netlify-Umgebungsvariablen: IMMO_SUPABASE_URL, IMMO_SUPABASE_SERVICE_ROLE_KEY (geheim!)
const URL_ = process.env.IMMO_SUPABASE_URL;
const SERVICE = process.env.IMMO_SUPABASE_SERVICE_ROLE_KEY;

const headers = { "Content-Type": "application/json" };
const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
const svc = (extra = {}) => ({ apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...extra });

async function api(path, init = {}) {
  const res = await fetch(`${URL_}${path}`, { ...init, headers: svc(init.headers) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function deleteUserCompletely(userId) {
  // Belege im Storage-Ordner des Nutzers entfernen (seitenweise)
  for (let i = 0; i < 50; i++) {
    const list = await api("/storage/v1/object/list/belege", { method: "POST", body: JSON.stringify({ prefix: `${userId}/`, limit: 1000, offset: 0 }) });
    if (!list || !list.length) break;
    await api("/storage/v1/object/belege", { method: "DELETE", body: JSON.stringify({ prefixes: list.map((f) => `${userId}/${f.name}`) }) });
    if (list.length < 1000) break;
  }
  // Auth-Konto löschen → profiles und app_state werden per ON DELETE CASCADE entfernt
  await api(`/auth/v1/admin/users/${userId}`, { method: "DELETE" });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { success: false, error: "Nur POST" });
  if (!URL_ || !SERVICE) return reply(500, { success: false, error: "IMMO_SUPABASE_URL / IMMO_SUPABASE_SERVICE_ROLE_KEY fehlen in Netlify." });
  try {
    const token = (event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return reply(401, { success: false, error: "Nicht angemeldet" });
    const userRes = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: SERVICE, Authorization: `Bearer ${token}` } });
    if (!userRes.ok) return reply(401, { success: false, error: "Sitzung ungültig" });
    const caller = await userRes.json();
    const [me] = await api(`/rest/v1/profiles?id=eq.${caller.id}&select=id,role,status`);
    const body = JSON.parse(event.body || "{}");

    if (body.action === "delete_self") {
      if (me?.role === "admin") {
        const admins = await api("/rest/v1/profiles?role=eq.admin&status=eq.active&select=id");
        if (admins.length <= 1) return reply(400, { success: false, error: "Du bist der einzige Admin – bitte zuerst einen anderen Admin ernennen." });
      }
      await deleteUserCompletely(caller.id);
      return reply(200, { success: true });
    }

    if (body.action === "delete_user") {
      if (me?.role !== "admin" || me?.status !== "active") return reply(403, { success: false, error: "Nur für Admins" });
      if (!/^[0-9a-f-]{36}$/i.test(body.userId || "")) return reply(400, { success: false, error: "Ungültige Nutzer-ID" });
      if (body.userId === caller.id) return reply(400, { success: false, error: "Eigenes Konto bitte unter „Mein Konto“ löschen." });
      await api("/rest/v1/admin_log", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ admin_id: caller.id, target_id: body.userId, action: "delete_user", details: {} }) });
      await deleteUserCompletely(body.userId);
      return reply(200, { success: true });
    }
    return reply(400, { success: false, error: "Unbekannte Aktion" });
  } catch (e) {
    return reply(500, { success: false, error: e.message });
  }
};
