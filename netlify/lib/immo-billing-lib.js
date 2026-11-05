// HausOps Immobilien – Stripe-Abos (ohne SDK, direkt über die Stripe-REST-API) + Supabase-Abgleich.
const crypto = require("crypto");

// ---------------------------------------------------------------- Stripe

// Stripe erwartet application/x-www-form-urlencoded mit verschachtelten Schlüsseln: a[b][0][c]=…
function formEncode(obj, prefix = "") {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => {
      if (item && typeof item === "object") parts.push(formEncode(item, `${key}[${i}]`));
      else parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(item)}`);
    });
    else if (typeof v === "object") parts.push(formEncode(v, key));
    else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return parts.filter(Boolean).join("&");
}

async function stripe(path, { method = "POST", params, key = process.env.STRIPE_SECRET_KEY, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`https://api.stripe.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: method === "GET" ? undefined : formEncode(params || {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe: ${data.error?.message || res.status}`);
  return data;
}

// Prüft die Stripe-Signatur (Header "Stripe-Signature: t=…,v1=…") – schützt vor gefälschten Webhooks
function verifySignature(rawBody, header, secret, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)) {
  if (!header || !secret) return false;
  const items = {};
  const v1 = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=");
    if (k === "t") items.t = v;
    if (k === "v1") v1.push(v);
  }
  if (!items.t || !v1.length) return false;
  if (Math.abs(nowSec - Number(items.t)) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${items.t}.${rawBody}`, "utf8").digest("hex");
  return v1.some((sig) => sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
}

// ---------------------------------------------------------------- Supabase (Service-Schlüssel)

function supa({ url = process.env.IMMO_SUPABASE_URL, key = process.env.IMMO_SUPABASE_SERVICE_ROLE_KEY, fetchImpl = fetch } = {}) {
  const h = (extra = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extra });
  const call = async (path, init = {}) => {
    const res = await fetchImpl(`${url}${path}`, { ...init, headers: h(init.headers) });
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase ${path}: ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  };
  return {
    async userFromToken(token) {
      const res = await fetchImpl(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
      return res.ok ? res.json() : null;
    },
    profile: async (id) => (await call(`/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=*`))[0] || null,
    profileByCustomer: async (cus) => (await call(`/rest/v1/profiles?stripe_customer_id=eq.${encodeURIComponent(cus)}&select=*`))[0] || null,
    plans: () => call("/rest/v1/plans?select=*"),
    patchProfile: (id, patch) => call(`/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) }),
    log: (row) => call("/rest/v1/admin_log", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) }).catch(() => {}),
  };
}

// ---------------------------------------------------------------- Abo-Status → Profil

const ACTIVE = ["active", "trialing", "past_due"];

function profilePatchFromSubscription(sub, plans, nowIso = new Date().toISOString()) {
  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id;
  const plan = plans.find((p) => p.stripe_price_id && p.stripe_price_id === priceId);
  const periodEnd = item?.current_period_end ?? sub.current_period_end;
  const patch = {
    stripe_subscription_id: sub.id,
    subscription_status: sub.status,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
  };
  if (typeof sub.customer === "string") patch.stripe_customer_id = sub.customer;
  if (ACTIVE.includes(sub.status)) {
    if (plan) { patch.plan = plan.id; patch.trial_ends_at = null; }
  } else {
    // Abo beendet / nicht bezahlt → zurück auf (abgelaufene) Testphase = nur noch lesen
    patch.plan = "trial";
    patch.trial_ends_at = nowIso;
  }
  return { patch, planId: plan?.id || null };
}

// Verarbeitet ein Stripe-Ereignis; deps erlaubt Tests ohne Netzwerk
async function handleEvent(event, deps) {
  const { db, stripeGet } = deps;
  const obj = event.data.object;
  const findUser = async (metaUserId, customer) => (metaUserId ? await db.profile(metaUserId) : null) || (customer ? await db.profileByCustomer(customer) : null);
  switch (event.type) {
    case "checkout.session.completed": {
      if (obj.mode !== "subscription") return { ignored: true };
      const user = await findUser(obj.client_reference_id || obj.metadata?.user_id, obj.customer);
      if (!user) return { error: "user_not_found" };
      const sub = await stripeGet(`/v1/subscriptions/${obj.subscription}`);
      const { patch, planId } = profilePatchFromSubscription(sub, await db.plans());
      await db.patchProfile(user.id, { ...patch, stripe_customer_id: obj.customer });
      await db.log({ admin_id: null, target_id: user.id, action: "abo_abgeschlossen", details: { plan: planId, status: sub.status } });
      return { userId: user.id, patch };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const user = await findUser(obj.metadata?.user_id, obj.customer);
      if (!user) return { error: "user_not_found" };
      const { patch, planId } = profilePatchFromSubscription(obj, await db.plans());
      await db.patchProfile(user.id, patch);
      if (event.type === "customer.subscription.deleted") await db.log({ admin_id: null, target_id: user.id, action: "abo_beendet", details: {} });
      return { userId: user.id, patch, planId };
    }
    case "invoice.payment_failed": {
      const user = await findUser(null, obj.customer);
      if (!user) return { error: "user_not_found" };
      await db.patchProfile(user.id, { subscription_status: "past_due" });
      await db.log({ admin_id: null, target_id: user.id, action: "zahlung_fehlgeschlagen", details: { invoice: obj.id } });
      return { userId: user.id, patch: { subscription_status: "past_due" } };
    }
    default:
      return { ignored: true };
  }
}

module.exports = { formEncode, stripe, verifySignature, supa, profilePatchFromSubscription, handleEvent };
