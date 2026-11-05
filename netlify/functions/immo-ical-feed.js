// HausOps Immobilien: Export-Kalender (iCal) je Ferienwohnung für Airbnb, Booking.com & Co. – verhindert Doppelbuchungen.
// Aufruf: /.netlify/functions/immo-ical-feed?u=<userId>&unit=<unitId>&t=<geheimer Kalender-Token>[&x=<Kanal ausblenden>]
// Nur im Cloud-Modus (liest die Buchungen serverseitig). Netlify-Variablen: IMMO_SUPABASE_URL, IMMO_SUPABASE_SERVICE_ROLE_KEY
const crypto = require("crypto");
const { buildIcs } = require("../lib/immo-sync-lib.js");

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const text = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "text/plain; charset=utf-8" }, body });
  if (!/^[0-9a-f-]{36}$/i.test(q.u || "") || !q.unit || !q.t) return text(400, "Ungültiger Kalender-Link");
  const url = process.env.IMMO_SUPABASE_URL, key = process.env.IMMO_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return text(501, "Export-Kalender nur im Cloud-Modus verfügbar");
  const res = await fetch(`${url}/rest/v1/app_state?user_id=eq.${q.u}&select=data`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  const [row] = res.ok ? await res.json() : [];
  const unit = (row?.data?.units || []).find((u) => u.id === q.unit);
  const tok = unit?.icalToken || "";
  if (!unit || tok.length !== q.t.length || !crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(q.t))) return text(404, "Kalender nicht gefunden");
  const today = new Date().toISOString().slice(0, 10);
  const exclude = (q.x || "").toLowerCase();
  const bookings = (row.data.bookings || []).filter((b) => b.unitId === unit.id && b.status !== "storniert" && b.to >= today && !(exclude && String(b.channel || "").toLowerCase().includes(exclude)));
  return { statusCode: 200, headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "max-age=300" }, body: buildIcs(bookings, { name: unit.name }) };
};
