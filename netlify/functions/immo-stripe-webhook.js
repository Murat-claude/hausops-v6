// HausOps Immobilien: Stripe-Webhook → Tarif/Abo-Status im Kundenprofil aktualisieren.
// In Stripe → Developers → Webhooks: Endpoint https://<deine-seite>/.netlify/functions/immo-stripe-webhook
// Ereignisse: checkout.session.completed, customer.subscription.created/updated/deleted, invoice.payment_failed
// Netlify-Umgebungsvariablen: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, IMMO_SUPABASE_URL, IMMO_SUPABASE_SERVICE_ROLE_KEY
const { stripe, supa, verifySignature, handleEvent } = require("../lib/immo-billing-lib.js");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Nur POST" };
  const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "";
  const sig = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
  if (!verifySignature(raw, sig, process.env.STRIPE_WEBHOOK_SECRET)) return { statusCode: 400, body: "Ungültige Signatur" };
  try {
    const result = await handleEvent(JSON.parse(raw), { db: supa(), stripeGet: (path) => stripe(path, { method: "GET" }) });
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ received: true, ...result }) };
  } catch (e) {
    // 500 → Stripe wiederholt die Zustellung automatisch
    return { statusCode: 500, body: e.message };
  }
};
