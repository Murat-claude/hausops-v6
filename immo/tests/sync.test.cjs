const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const lib = require("../../netlify/lib/immo-sync-lib.js");

test("Smoobu HMAC: kanonischer String und Base64-Signatur", () => {
  const h = lib.smoobuHeaders({ method: "get", path: "/api/reservations", query: "page=1", apiKey: "KEY", secret: "SECRET", timestamp: "2026-11-05T10:00:00Z", nonce: "n-1" });
  const emptyHash = crypto.createHash("sha256").update("").digest("hex");
  assert.equal(h.canonical, `GET\n/api/reservations\npage=1\n2026-11-05T10:00:00Z\nn-1\n${emptyHash}\nKEY`);
  assert.equal(h["X-Signature"], crypto.createHmac("sha256", "SECRET").update(h.canonical).digest("base64"));
  assert.deepEqual(Object.keys(h).filter((k) => k.startsWith("X-")), ["X-API-Key", "X-Timestamp", "X-Nonce", "X-Signature"]);
});

test("Enable Banking: JWT RS256 mit kid und Ansprüchen, verifizierbar", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const jwt = lib.ebJwt("app-123", pem, 1_800_000_000);
  const [h, p, s] = jwt.split(".");
  const dec = (x) => JSON.parse(Buffer.from(x, "base64url").toString());
  assert.deepEqual(dec(h), { typ: "JWT", alg: "RS256", kid: "app-123" });
  assert.deepEqual(dec(p), { iss: "enablebanking.com", aud: "api.enablebanking.com", iat: 1_800_000_000, exp: 1_800_003_600 });
  assert.ok(crypto.createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s, "base64url")));
});

test("Bankumsatz normalisieren", () => {
  const t = lib.normalizeEbTx({ entry_reference: "E1", transaction_amount: { amount: "900.00", currency: "EUR" }, credit_debit_indicator: "CRDT", booking_date: "2026-10-30", debtor: { name: "Anna Schmidt" }, debtor_account: { iban: "DE89 3704 0044 0532 0130 00" }, remittance_information: ["Miete", "November"], status: "BOOK" });
  assert.deepEqual(t, { extId: "E1", date: "2026-10-30", amount: 90000, name: "Anna Schmidt", iban: "DE89370400440532013000", purpose: "Miete November", pending: false });
  assert.equal(lib.normalizeEbTx({ transaction_amount: { amount: "12.5" }, credit_debit_indicator: "DBIT", booking_date: "2026-11-01", creditor: { name: "Stadtwerke" } }).amount, -1250);
});

test("iCal: nur erlaubte Anbieter, Export-Kalender", () => {
  assert.equal(lib.icalAllowed("https://www.airbnb.de/calendar/ical/123.ics?s=abc"), true);
  assert.equal(lib.icalAllowed("https://admin.booking.com/hotel/hoteladmin/ical.html?t=x"), true);
  assert.equal(lib.icalAllowed("https://evil.example.com/x.ics"), false);
  assert.equal(lib.icalAllowed("https://airbnb.com.evil.com/x.ics"), false);
  assert.equal(lib.icalAllowed("http://www.airbnb.de/x.ics"), false);
  const ics = lib.buildIcs([{ id: "b1", from: "2026-12-01", to: "2026-12-05", status: "bestaetigt" }], { name: "FeWo", now: new Date("2026-11-05T10:00:00Z") });
  assert.match(ics, /DTSTART;VALUE=DATE:20261201\r\nDTEND;VALUE=DATE:20261205\r\nSUMMARY:Belegt/);
});
