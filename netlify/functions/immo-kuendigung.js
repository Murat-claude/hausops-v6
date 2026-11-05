// HausOps Immobilien: Kündigungsbutton nach § 312k BGB ("Verträge hier kündigen" → "jetzt kündigen").
// Öffentlich erreichbar (ohne Anmeldung). Speichert die Kündigung, kündigt ein Stripe-Abo zum Laufzeitende
// und bestätigt sie sofort – auf der Seite (zum Speichern/Drucken) und, falls eingerichtet, per E-Mail (Textform).
// Netlify-Variablen: IMMO_SUPABASE_URL, IMMO_SUPABASE_SERVICE_ROLE_KEY, optional STRIPE_SECRET_KEY,
// optional RESEND_API_KEY + IMMO_MAIL_FROM (z. B. "HausOps <kuendigung@deine-domain.de>") für die Bestätigungsmail.
const { stripe } = require("../lib/immo-billing-lib.js");

const URL_ = process.env.IMMO_SUPABASE_URL;
const KEY = process.env.IMMO_SUPABASE_SERVICE_ROLE_KEY;
const reply = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function db(path, init = {}) {
  const res = await fetch(`${URL_}${path}`, { ...init, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function sendMail(to, subject, text) {
  if (!process.env.RESEND_API_KEY || !process.env.IMMO_MAIL_FROM) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.IMMO_MAIL_FROM, to: [to], subject, text }),
  });
  return res.ok;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { success: false, error: "Nur POST" });
  if (!URL_ || !KEY) return reply(501, { success: false, error: "Kündigung online noch nicht eingerichtet – bitte per E-Mail an den Support kündigen." });
  try {
    const b = JSON.parse(event.body || "{}");
    const name = String(b.name || "").trim().slice(0, 200);
    const email = String(b.email || "").trim().toLowerCase().slice(0, 200);
    const accountEmail = String(b.accountEmail || email).trim().toLowerCase().slice(0, 200);
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply(400, { success: false, error: "Bitte Name und eine gültige E-Mail-Adresse angeben." });
    const kind = ["ausserordentlich", "widerruf"].includes(b.kind) ? b.kind : "ordentlich";
    const createdAt = new Date().toISOString();

    // Konto suchen (über die angegebene Konto-E-Mail)
    const [prof] = await db(`/rest/v1/profiles?email=eq.${encodeURIComponent(accountEmail)}&select=id,email,full_name,stripe_subscription_id,subscription_status,current_period_end`);
    let effectiveAt = null, statusText = "eingegangen";
    if (prof?.stripe_subscription_id && process.env.STRIPE_SECRET_KEY && ["active", "trialing", "past_due"].includes(prof.subscription_status)) {
      // Kündigung zum Ende des bezahlten Zeitraums (jederzeit im Kundenportal widerrufbar)
      const sub = await stripe(`/v1/subscriptions/${prof.stripe_subscription_id}`, { params: { cancel_at_period_end: "true", metadata: { cancelled_via: "kuendigungsbutton" } } });
      const end = sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end;
      effectiveAt = end ? new Date(end * 1000).toISOString() : null;
      statusText = "abo_gekuendigt";
      await db(`/rest/v1/profiles?id=eq.${prof.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ cancel_at_period_end: true }) });
    } else if (prof) statusText = "kein_aktives_abo";

    const [row] = await db("/rest/v1/cancellations", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
      name, email, account_email: accountEmail, contract_ref: String(b.contractRef || "").slice(0, 200), kind, reason: String(b.reason || "").slice(0, 2000),
      wished_date: String(b.wishedDate || "naechstmoeglich").slice(0, 40), user_id: prof?.id || null, effective_at: effectiveAt, status: statusText,
    }) });
    const ref = `K-${String(row.id).padStart(6, "0")}`;
    const fmt = (iso) => new Date(iso).toLocaleString("de-DE", { timeZone: "Europe/Berlin" });
    const text = `Bestätigung Ihrer ${kind === "widerruf" ? "Widerrufserklärung" : "Kündigung"}\n\nEingang: ${fmt(createdAt)}\nReferenz: ${ref}\nName: ${name}\nKonto: ${accountEmail}\nArt: ${{ ordentlich: "ordentliche Kündigung", ausserordentlich: "außerordentliche Kündigung", widerruf: "Widerruf des Vertrags (14-Tage-Frist)" }[kind]}${kind === "widerruf" ? "\nBereits gezahlte Beträge erstatten wir abzüglich eines anteiligen Wertersatzes für die bis zum Widerruf erbrachte Leistung (§ 357a BGB), spätestens binnen 14 Tagen." : ""}\nGewünschter Zeitpunkt: ${b.wishedDate === "naechstmoeglich" || !b.wishedDate ? "nächstmöglicher Zeitpunkt" : b.wishedDate}\n${effectiveAt ? `Ihr Abo endet am: ${new Date(effectiveAt).toLocaleDateString("de-DE")}\n` : prof ? "Für dieses Konto besteht kein zahlungspflichtiges Abo.\n" : "Wir prüfen Ihre Angaben und melden uns, falls wir das Konto nicht zuordnen können.\n"}\nIhre Daten können Sie bis zum Vertragsende unter „Mein Konto“ exportieren.`;
    const mailed = (await sendMail(email, `Kündigungsbestätigung ${ref}`, text)) || false;
    // Schutz vor Fremd-Kündigungen: Kontoinhaber zusätzlich informieren (Abo-Kündigung ist im Kundenportal widerrufbar)
    if (prof && prof.email !== email) await sendMail(prof.email, `Hinweis: Kündigung für Ihr Konto (${ref})`, `${text}

Falls Sie diese Kündigung nicht veranlasst haben, können Sie sie unter „Mein Konto“ → „Zahlungen, Rechnungen & Kündigung“ zurücknehmen.`);
    if (mailed) await db(`/rest/v1/cancellations?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ confirmation_sent: true }) });
    return reply(200, { success: true, ref, createdAt, effectiveAt, status: statusText, confirmationText: text, mailed });
  } catch (e) {
    return reply(500, { success: false, error: "Die Kündigung konnte nicht gespeichert werden. Bitte kündigen Sie per E-Mail an den Support. (" + e.message + ")" });
  }
};
