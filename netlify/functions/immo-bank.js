// HausOps Immobilien: Live-Bankanbindung über Enable Banking (lizenzierter Kontoinformationsdienst, PSD2).
// Netlify-Variablen: ENABLEBANKING_APP_ID, ENABLEBANKING_PRIVATE_KEY (PEM, Zeilenumbrüche als \n erlaubt),
// Zugriffsschutz: IMMO_SYNC_TOKEN (lokaler Modus) oder Supabase-Sitzung (Cloud-Modus).
// Aktionen (POST JSON): banks {country} · connect {bank, country, redirectUrl} · session {code} · transactions {accountUid, dateFrom}
const { eb, normalizeEbTx, authorized } = require("../lib/immo-sync-lib.js");

const reply = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { success: false, error: "Nur POST" });
  if (!process.env.ENABLEBANKING_APP_ID || !process.env.ENABLEBANKING_PRIVATE_KEY) return reply(501, { success: false, error: "Live-Bankanbindung ist noch nicht eingerichtet (ENABLEBANKING_APP_ID / ENABLEBANKING_PRIVATE_KEY fehlen)." });
  if (!(await authorized(event))) return reply(401, { success: false, error: "Nicht berechtigt – Sync-Schlüssel in den Einstellungen prüfen bzw. anmelden." });
  try {
    const b = JSON.parse(event.body || "{}");
    if (b.action === "banks") {
      const r = await eb("/aspsps", { query: { country: b.country || "DE", psu_type: "personal" } });
      return reply(200, { success: true, banks: (r.aspsps || []).map((a) => ({ name: a.name, country: a.country, logo: a.logo || "" })) });
    }
    if (b.action === "connect") {
      if (!/^https:\/\/|^http:\/\/localhost/.test(b.redirectUrl || "")) return reply(400, { success: false, error: "Ungültige Rücksprungadresse" });
      const validUntil = new Date(Date.now() + 180 * 864e5).toISOString(); // max. 180 Tage Zugriff (PSD2), dann erneut bestätigen
      const r = await eb("/auth", { method: "POST", body: { access: { valid_until: validUntil }, aspsp: { name: b.bank, country: b.country || "DE" }, state: b.state, redirect_url: b.redirectUrl, psu_type: "personal" } });
      return reply(200, { success: true, url: r.url, validUntil });
    }
    if (b.action === "session") {
      const r = await eb("/sessions", { method: "POST", body: { code: b.code } });
      const accounts = (r.accounts || []).map((a) => ({ uid: a.uid, iban: a.account_id?.iban || "", name: a.name || a.product || "Konto", currency: a.currency || "EUR" }));
      return reply(200, { success: true, sessionId: r.session_id, validUntil: r.access?.valid_until || null, accounts });
    }
    if (b.action === "transactions") {
      const out = [];
      let continuation;
      for (let page = 0; page < 20; page++) {
        const r = await eb(`/accounts/${encodeURIComponent(b.accountUid)}/transactions`, { query: { date_from: b.dateFrom, continuation_key: continuation } });
        out.push(...(r.transactions || []).map(normalizeEbTx));
        continuation = r.continuation_key;
        if (!continuation) break;
      }
      return reply(200, { success: true, transactions: out.filter((t) => t.date && t.amount) });
    }
    return reply(400, { success: false, error: "Unbekannte Aktion" });
  } catch (e) {
    const expired = /expired|invalid.*session|consent/i.test(e.message);
    return reply(expired ? 410 : 502, { success: false, error: expired ? "Die Freigabe bei der Bank ist abgelaufen – bitte das Konto neu verbinden." : e.message });
  }
};
