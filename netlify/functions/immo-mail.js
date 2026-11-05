// HausOps Immobilien: Rechnungen (PDF) per E-Mail versenden – über Resend.
// Netlify-Variablen: RESEND_API_KEY, IMMO_MAIL_FROM (z. B. "Rechnungen <rechnung@deine-domain.de>", Domain bei Resend verifiziert).
// Zugriffsschutz: IMMO_SYNC_TOKEN (lokaler Modus) oder Supabase-Sitzung (Cloud-Modus). Antworten des Gastes gehen an die Vermieter-E-Mail (Reply-To).
const { authorized } = require("../lib/immo-sync-lib.js");
const { buildMail, rateLimited } = require("../lib/immo-mail-lib.js");

const reply = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { success: false, error: "Nur POST" });
  if (!process.env.RESEND_API_KEY || !process.env.IMMO_MAIL_FROM) return reply(501, { success: false, notConfigured: true, error: "E-Mail-Versand ist noch nicht eingerichtet (RESEND_API_KEY / IMMO_MAIL_FROM in Netlify)." });
  if (!(await authorized(event))) return reply(401, { success: false, error: "Nicht berechtigt – bitte anmelden bzw. Sync-Schlüssel prüfen." });
  const who = (event.headers?.authorization || event.headers?.Authorization || event.headers?.["x-immo-token"] || "").slice(-24);
  if (rateLimited(who)) return reply(429, { success: false, error: "Zu viele E-Mails in kurzer Zeit – bitte später erneut versuchen." });
  try {
    const msg = buildMail(JSON.parse(event.body || "{}"), { mailFrom: process.env.IMMO_MAIL_FROM });
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(msg),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return reply(502, { success: false, error: `Mail-Dienst: ${out.message || res.status}` });
    return reply(200, { success: true, id: out.id || null });
  } catch (e) {
    return reply(e.status || 500, { success: false, error: e.message });
  }
};
