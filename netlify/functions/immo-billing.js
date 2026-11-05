// HausOps Immobilien: Stripe Checkout (Abo buchen) und Kundenportal (Zahlungsart, Rechnungen, Kündigung, Tarifwechsel).
// Netlify-Umgebungsvariablen: STRIPE_SECRET_KEY, IMMO_SUPABASE_URL, IMMO_SUPABASE_SERVICE_ROLE_KEY, optional IMMO_PUBLIC_URL
const { stripe, supa } = require("../lib/immo-billing-lib.js");

const reply = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { success: false, error: "Nur POST" });
  if (!process.env.STRIPE_SECRET_KEY) return reply(501, { success: false, error: "Online-Bezahlung ist noch nicht eingerichtet (STRIPE_SECRET_KEY fehlt)." });
  try {
    const db = supa();
    const token = (event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
    const user = token && (await db.userFromToken(token));
    if (!user) return reply(401, { success: false, error: "Nicht angemeldet" });
    const profile = await db.profile(user.id);
    const body = JSON.parse(event.body || "{}");
    const base = (process.env.IMMO_PUBLIC_URL || `https://${event.headers.host}`).replace(/\/$/, "");
    const back = `${base}/immo/`;

    let customer = profile.stripe_customer_id;
    if (!customer) {
      const c = await stripe("/v1/customers", { params: { email: profile.email, name: profile.company || profile.full_name || undefined, metadata: { user_id: user.id } } });
      customer = c.id;
      await db.patchProfile(user.id, { stripe_customer_id: customer });
    }

    const portal = async () => (await stripe("/v1/billing_portal/sessions", { params: { customer, return_url: `${back}#/konto`, locale: "de" } })).url;

    if (body.action === "portal") return reply(200, { success: true, url: await portal() });

    if (body.action === "checkout") {
      // Bestehendes Abo → Tarifwechsel/Kündigung über das Kundenportal
      if (["active", "trialing", "past_due"].includes(profile.subscription_status) && profile.stripe_subscription_id) {
        return reply(200, { success: true, url: await portal(), portal: true });
      }
      const plans = await db.plans();
      const plan = plans.find((p) => p.id === body.planId && p.active && p.stripe_price_id);
      if (!plan) return reply(400, { success: false, error: "Dieser Tarif ist nicht online buchbar." });
      const session = await stripe("/v1/checkout/sessions", {
        params: {
          mode: "subscription",
          customer,
          client_reference_id: user.id,
          line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
          subscription_data: { metadata: { user_id: user.id, plan_id: plan.id } },
          metadata: { user_id: user.id, plan_id: plan.id },
          allow_promotion_codes: "true",
          billing_address_collection: "required",
          tax_id_collection: { enabled: "true" },
          customer_update: { address: "auto", name: "auto" },
          locale: "de",
          success_url: `${back}?checkout=success#/konto`,
          cancel_url: `${back}?checkout=cancel#/konto`,
        },
      });
      return reply(200, { success: true, url: session.url });
    }
    return reply(400, { success: false, error: "Unbekannte Aktion" });
  } catch (e) {
    return reply(500, { success: false, error: e.message });
  }
};
