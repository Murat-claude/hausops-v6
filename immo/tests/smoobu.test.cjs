const { test } = require("node:test");
const assert = require("node:assert/strict");
const { handle } = require("../../netlify/functions/immo-smoobu.js");

const env = { IMMO_SUPABASE_URL: "https://db.test", IMMO_SUPABASE_ANON_KEY: "anon", IMMO_SUPABASE_SERVICE_ROLE_KEY: "service" };
const OWNER = "00000000-0000-0000-0000-000000000011";
const json = (o, status = 200) => ({ ok: status < 400, status, json: async () => o, text: async () => JSON.stringify(o) });
function fakeFetch({ role = "owner", secret = { smoobu_key: "K1", smoobu_secret: "S1" } } = {}) {
  const calls = [];
  const f = async (url, opt = {}) => {
    calls.push({ url, opt });
    if (url.includes("/rpc/ws_role")) return json(role);
    if (url.includes("/immo_secrets")) { assert.equal(opt.headers.Authorization, "Bearer service"); return json(secret ? [secret] : []); }
    if (url.includes("login.smoobu.com/api/reservations")) {
      assert.equal(opt.headers["X-API-Key"] || opt.headers["Api-Key"], "K1");
      return json({ page_count: 1, bookings: [{ id: 7, apartment: { name: "FeWo Strandblick" }, "guest-name": "Max Muster", arrival: "2026-11-10", departure: "2026-11-13", price: 300, channel: { name: "Booking.com" }, email: "max@example.de", "company-name": "Muster GmbH", address: { street: "Weg 1", postalCode: "12345", location: "Hamm", country: "DE" } }] });
    }
    throw new Error("unerwartet: " + url);
  };
  f.calls = calls; return f;
}
const ev = (body, jwt = "user-jwt") => ({ httpMethod: "POST", headers: jwt ? { authorization: `Bearer ${jwt}` } : {}, body: JSON.stringify(body) });

test("Smoobu: Buchungen mit dem Schlüssel des eigenen Bestands", async () => {
  const f = fakeFetch();
  const r = await handle(ev({ owner: OWNER }), { fetchImpl: f, env });
  const out = JSON.parse(r.body);
  assert.equal(r.statusCode, 200);
  assert.equal(out.buchungen[0].gast_name, "Max Muster");
  assert.equal(out.buchungen[0].firma, "Muster GmbH");
  assert.equal(out.buchungen[0].adresse.location, "Hamm");
  // Rolle wurde mit dem Token des Nutzers geprüft
  assert.equal(f.calls[0].opt.headers.Authorization, "Bearer user-jwt");
});

test("Smoobu: ohne Anmeldung, fremder Bestand, nur lesen oder ohne Schlüssel → kein Abruf", async () => {
  assert.equal((await handle(ev({ owner: OWNER }, ""), { fetchImpl: fakeFetch(), env })).statusCode, 401);
  for (const role of [null, "viewer"]) {
    const f = fakeFetch({ role });
    assert.equal((await handle(ev({ owner: OWNER }), { fetchImpl: f, env })).statusCode, 403);
    assert.ok(!f.calls.some((c) => c.url.includes("immo_secrets")), "Schlüssel darf nicht gelesen werden");
  }
  const r = await handle(ev({ owner: OWNER }), { fetchImpl: fakeFetch({ secret: null }), env });
  assert.equal(JSON.parse(r.body).code, "not_connected");
});
