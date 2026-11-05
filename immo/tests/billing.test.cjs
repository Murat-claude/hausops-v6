const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const lib = require("../../netlify/lib/immo-billing-lib.js");
const webhook = require("../../netlify/functions/immo-stripe-webhook.js");

test("Stripe-Formularkodierung mit verschachtelten Feldern", () => {
  const s = lib.formEncode({ mode: "subscription", line_items: [{ price: "price_1", quantity: 1 }], metadata: { user_id: "u 1" }, skip: undefined });
  assert.equal(decodeURIComponent(s), "mode=subscription&line_items[0][price]=price_1&line_items[0][quantity]=1&metadata[user_id]=u 1");
});

test("Webhook-Signatur: gültig, manipuliert, zu alt", () => {
  const secret = "whsec_test", body = '{"id":"evt_1"}', t = 1_800_000_000;
  const sig = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  assert.equal(lib.verifySignature(body, `t=${t},v1=${sig}`, secret, 300, t + 10), true);
  assert.equal(lib.verifySignature(body.replace("1", "2"), `t=${t},v1=${sig}`, secret, 300, t + 10), false);
  assert.equal(lib.verifySignature(body, `t=${t},v1=${sig}`, secret, 300, t + 1000), false);
  assert.equal(lib.verifySignature(body, `t=${t},v1=${sig}`, "falsch", 300, t), false);
});

const plans = [{ id: "pro", stripe_price_id: "price_pro" }, { id: "basis", stripe_price_id: "price_basis" }];
const sub = (status, price = "price_pro", extra = {}) => ({ id: "sub_1", customer: "cus_1", status, cancel_at_period_end: false, metadata: { user_id: "u1" }, items: { data: [{ price: { id: price }, current_period_end: 1_800_000_000 }] }, ...extra });

test("Abo-Status wird auf Tarif und Schreibrecht abgebildet", () => {
  assert.deepEqual(lib.profilePatchFromSubscription(sub("active"), plans).patch.plan, "pro");
  assert.equal(lib.profilePatchFromSubscription(sub("active"), plans).patch.trial_ends_at, null);
  assert.equal(lib.profilePatchFromSubscription(sub("past_due", "price_basis"), plans).patch.plan, "basis");
  const ended = lib.profilePatchFromSubscription(sub("canceled"), plans, "2026-11-06T00:00:00Z").patch;
  assert.deepEqual([ended.plan, ended.trial_ends_at], ["trial", "2026-11-06T00:00:00Z"]);
});

function fakeDb() {
  const profiles = { u1: { id: "u1", stripe_customer_id: "cus_1" } }; const logs = [];
  return { profiles, logs, profile: async (id) => profiles[id] || null, profileByCustomer: async (c) => Object.values(profiles).find((p) => p.stripe_customer_id === c) || null, plans: async () => plans, patchProfile: async (id, p) => Object.assign(profiles[id], p), log: async (r) => logs.push(r) };
}

test("Ereignisse: Checkout, Kündigung, Zahlungsausfall", async () => {
  const db = fakeDb();
  await lib.handleEvent({ type: "checkout.session.completed", data: { object: { mode: "subscription", client_reference_id: "u1", customer: "cus_1", subscription: "sub_1" } } }, { db, stripeGet: async () => sub("active") });
  assert.equal(db.profiles.u1.plan, "pro");
  await lib.handleEvent({ type: "invoice.payment_failed", data: { object: { id: "in_1", customer: "cus_1" } } }, { db });
  assert.equal(db.profiles.u1.subscription_status, "past_due");
  await lib.handleEvent({ type: "customer.subscription.updated", data: { object: sub("active", "price_basis", { cancel_at_period_end: true }) } }, { db });
  assert.deepEqual([db.profiles.u1.plan, db.profiles.u1.cancel_at_period_end], ["basis", true]);
  await lib.handleEvent({ type: "customer.subscription.deleted", data: { object: sub("canceled") } }, { db });
  assert.equal(db.profiles.u1.plan, "trial");
  assert.deepEqual(db.logs.map((l) => l.action), ["abo_abgeschlossen", "zahlung_fehlgeschlagen", "abo_beendet"]);
});

test("Webhook-Function lehnt unsignierte Aufrufe ab", async () => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  const res = await webhook.handler({ httpMethod: "POST", headers: {}, body: '{"type":"x"}' });
  assert.equal(res.statusCode, 400);
});
