const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildMail, fromHeader, rateLimited } = require("../../netlify/lib/immo-mail-lib.js");

test("Rechnungsmail: Absendername, Antwortadresse, Kopie, PDF-Anhang", () => {
  const m = buildMail({ to: "buchhaltung@firma.de", bcc: "ich@example.de", replyTo: "ich@example.de", fromName: "Murat \"FeWo\"\nX", subject: "Rechnung RE-2026-5\r\nBcc: spam@x.de", text: "Hallo", attachment: { filename: "Rechnung RE-2026-5 Muster/GmbH.pdf", content: "JVBERi0xLjMK" } }, { mailFrom: "Rechnungen <rechnung@hausops.de>" });
  assert.equal(m.from, '"Murat FeWoX" <rechnung@hausops.de>');
  assert.deepEqual(m.to, ["buchhaltung@firma.de"]);
  assert.deepEqual(m.bcc, ["ich@example.de"]);
  assert.equal(m.reply_to, "ich@example.de");
  assert.equal(m.subject, "Rechnung RE-2026-5 Bcc: spam@x.de"); // keine Kopfzeilen-Injektion
  assert.equal(m.attachments[0].filename, "Rechnung RE-2026-5 Muster_GmbH.pdf");
});

test("Rechnungsmail: ungültige Empfänger und Anhänge werden abgelehnt", () => {
  assert.throws(() => buildMail({ to: "a@b.de, c@d.de", subject: "x" }, { mailFrom: "x@y.de" }), /Empfänger/);
  assert.throws(() => buildMail({ to: "a@b.de", subject: "x", attachment: { filename: "x.exe", content: "AAAA" } }, { mailFrom: "x@y.de" }), /PDF/);
  assert.throws(() => buildMail({ to: "a@b.de", subject: "x", attachment: { filename: "x.pdf", content: "A".repeat(6e6) } }, { mailFrom: "x@y.de" }), /groß/);
  assert.equal(fromHeader("x@y.de", ""), "x@y.de");
});

test("Versandlimit je Nutzer", () => {
  for (let i = 0; i < 3; i++) assert.equal(rateLimited("u1", { max: 3, now: 1000 + i }), false);
  assert.equal(rateLimited("u1", { max: 3, now: 2000 }), true);
  assert.equal(rateLimited("u1", { max: 3, now: 1000 + 3600e3 + 10 }), false);
});
