// HausOps Immobilien: iCal-Kalender von Airbnb, Booking.com, FeWo-direkt & Co. abrufen (der Browser darf das wegen CORS nicht direkt).
// Nur bekannte Kalender-Anbieter sind erlaubt. Zugriffsschutz wie bei immo-bank (IMMO_SYNC_TOKEN oder Supabase-Sitzung).
const { icalAllowed, authorized } = require("../lib/immo-sync-lib.js");

exports.handler = async (event) => {
  const json = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (event.httpMethod !== "POST") return json(405, { success: false, error: "Nur POST" });
  if (!(await authorized(event))) return json(401, { success: false, error: "Nicht berechtigt – Sync-Schlüssel prüfen bzw. anmelden." });
  try {
    const { url } = JSON.parse(event.body || "{}");
    if (!icalAllowed(url)) return json(400, { success: false, error: "Diese Kalender-Adresse wird nicht unterstützt (nur Airbnb, Booking.com, FeWo-direkt/Vrbo, Smoobu u. a.)." });
    const res = await fetch(url.replace(/^webcal:/, "https:"), { headers: { "User-Agent": "HausOps-Immobilien/1.0 (iCal-Sync)" }, redirect: "follow" });
    if (!res.ok) return json(502, { success: false, error: `Kalender nicht abrufbar (${res.status})` });
    const text = await res.text();
    if (!text.includes("BEGIN:VCALENDAR")) return json(502, { success: false, error: "Die Adresse liefert keinen iCal-Kalender." });
    return json(200, { success: true, ics: text.slice(0, 2_000_000) });
  } catch (e) {
    return json(500, { success: false, error: e.message });
  }
};
