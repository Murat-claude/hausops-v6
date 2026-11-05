// HausOps Immobilien – Live-Synchronisation: Bank (Enable Banking, PSD2), Smoobu (HMAC), iCal (Airbnb/Booking …)
const crypto = require("crypto");

// ---------------------------------------------------------------- Smoobu HMAC-SHA256 (Pflicht seit 25.09.2026)
// Kanonischer String: METHOD \n PATH \n QUERY \n TIMESTAMP \n NONCE \n SHA256_HEX(body) \n API_KEY
function smoobuHeaders({ method, path, query = "", body = "", apiKey, secret, timestamp, nonce }) {
  const ts = timestamp || new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const n = nonce || crypto.randomUUID();
  const bodyHash = crypto.createHash("sha256").update(body, "utf8").digest("hex");
  const canonical = [method.toUpperCase(), path, query, ts, n, bodyHash, apiKey].join("\n");
  const signature = crypto.createHmac("sha256", secret).update(canonical, "utf8").digest("base64");
  return { "X-API-Key": apiKey, "X-Timestamp": ts, "X-Nonce": n, "X-Signature": signature, canonical };
}

async function smoobuGet(path, params, { apiKey = process.env.SMOOBU_API_KEY, secret = process.env.SMOOBU_API_SECRET, fetchImpl = fetch } = {}) {
  const query = new URLSearchParams(params).toString();
  const url = `https://login.smoobu.com${path}${query ? "?" + query : ""}`;
  let headers;
  if (secret) { const { canonical, ...h } = smoobuHeaders({ method: "GET", path, query, apiKey, secret }); headers = h; }
  else headers = { "Api-Key": apiKey }; // Altverfahren – wird von Smoobu seit 25.09.2026 abgelehnt
  const res = await fetchImpl(url, { headers: { ...headers, Accept: "application/json", "Content-Type": "application/json" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const hint = res.status === 401 ? (secret ? " – API-Key/Secret oder Uhrzeit prüfen" : " – Smoobu verlangt seit 25.09.2026 HMAC: SMOOBU_API_SECRET in Netlify setzen") : "";
    throw new Error(`Smoobu ${res.status}${hint}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// ---------------------------------------------------------------- Enable Banking (Open Banking / PSD2)

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

function ebJwt(appId, privateKeyPem, nowSec = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "RS256", kid: appId }));
  const payload = b64url(JSON.stringify({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat: nowSec, exp: nowSec + 3600 }));
  const sig = crypto.createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKeyPem);
  return `${header}.${payload}.${b64url(sig)}`;
}

async function eb(path, { method = "GET", body, query, fetchImpl = fetch, appId = process.env.ENABLEBANKING_APP_ID, key = (process.env.ENABLEBANKING_PRIVATE_KEY || "").replace(/\\n/g, "\n") } = {}) {
  const qs = query ? "?" + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString() : "";
  const res = await fetchImpl(`https://api.enablebanking.com${path}${qs}`, {
    method, headers: { Authorization: `Bearer ${ebJwt(appId, key)}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Bank-Schnittstelle ${res.status}: ${data.message || data.error || JSON.stringify(data).slice(0, 200)}`);
  return data;
}

// Umsatz der Bank → einheitliches Format der App (Betrag in Cent, Gutschrift positiv)
function normalizeEbTx(t) {
  const amt = Math.round(Math.abs(parseFloat(t.transaction_amount?.amount ?? t.amount ?? "0")) * 100);
  const credit = (t.credit_debit_indicator || "").toUpperCase() === "CRDT";
  const other = credit ? (t.debtor || {}) : (t.creditor || {});
  const otherAcc = credit ? (t.debtor_account || {}) : (t.creditor_account || {});
  const purpose = Array.isArray(t.remittance_information) ? t.remittance_information.join(" ") : (t.remittance_information || t.remittance_information_unstructured || "");
  return {
    extId: t.entry_reference || t.transaction_id || null,
    date: (t.booking_date || t.value_date || t.transaction_date || "").slice(0, 10),
    amount: credit ? amt : -amt,
    name: other.name || "",
    iban: (otherAcc.iban || "").replace(/\s+/g, ""),
    purpose: purpose.replace(/\s+/g, " ").trim(),
    pending: (t.status || "BOOK") !== "BOOK",
  };
}

// ---------------------------------------------------------------- iCal

// Nur bekannte Kalender-Anbieter abrufen (Schutz vor Missbrauch als offener Proxy)
const ICAL_HOSTS = ["airbnb.com", "airbnb.de", "booking.com", "vrbo.com", "homeaway.com", "fewo-direkt.de", "abritel.fr", "smoobu.com", "traum-ferienwohnungen.de", "holidu.com", "google.com", "e-domizil.de", "belvilla.com", "hometogo.com", "expedia.com", "tripadvisor.com", "beds24.com", "lodgify.com"];
function icalAllowed(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "webcal:") return false;
    return ICAL_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith("." + h));
  } catch { return false; }
}

const icsEsc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
function buildIcs(bookings, { name = "HausOps", now = new Date() } = {}) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//HausOps Immobilien//DE", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${icsEsc(name)}`];
  for (const b of bookings) {
    lines.push("BEGIN:VEVENT", `UID:${icsEsc(b.id)}@hausops`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${b.from.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${b.to.replace(/-/g, "")}`, `SUMMARY:${b.status === "eigennutzung" ? "Blockiert" : "Belegt"}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------- Zugriffsschutz der Funktionen
// Cloud-Modus: gültige Supabase-Sitzung; lokaler Modus: geheimer Sync-Schlüssel (IMMO_SYNC_TOKEN)
async function authorized(event, fetchImpl = fetch) {
  const h = event.headers || {};
  const token = process.env.IMMO_SYNC_TOKEN;
  const given = h["x-immo-token"] || h["X-Immo-Token"];
  if (token && given && given.length === token.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token))) return true;
  const bearer = (h.authorization || h.Authorization || "").replace(/^Bearer\s+/i, "");
  if (bearer && process.env.IMMO_SUPABASE_URL && process.env.IMMO_SUPABASE_ANON_KEY) {
    const res = await fetchImpl(`${process.env.IMMO_SUPABASE_URL}/auth/v1/user`, { headers: { apikey: process.env.IMMO_SUPABASE_ANON_KEY, Authorization: `Bearer ${bearer}` } });
    return res.ok;
  }
  return false;
}

module.exports = { smoobuHeaders, smoobuGet, ebJwt, eb, normalizeEbTx, icalAllowed, buildIcs, authorized, ICAL_HOSTS };
