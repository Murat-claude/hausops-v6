import { test } from "node:test";
import assert from "node:assert/strict";
import { euer, bizChecks } from "../js/euer.js";

test("EÜR: Umsatzsteuer, Bewirtung 70 %, Homeoffice-Pauschale, Gewinn", () => {
  const s = { businesses: [{ id: "b1", kind: "freiberuflich", kleinunternehmer: false, yearData: { 2026: { homeofficeDays: 250, km: 1000 } } }],
    bizEntries: [
      { id: "1", businessId: "b1", date: "2026-02-10", amount: 1190000, category: "umsatz", vat: 19 },
      { id: "2", businessId: "b1", date: "2026-03-01", amount: 119000, category: "buero", vat: 19 },
      { id: "3", businessId: "b1", date: "2026-04-01", amount: 10000, category: "bewirtung", vat: 0 },
      { id: "4", businessId: "b1", date: "2025-12-31", amount: 999999, category: "umsatz", vat: 19 },
    ] };
  const r = euer(s, "b1", 2026);
  assert.equal(r.lines.umsatz, 1000000);
  assert.equal(r.lines.ust_vereinnahmt, 190000);
  assert.equal(r.lines.vorsteuer, 19000);
  assert.equal(r.lines.bewirtung, 7000);
  assert.equal(r.lines.homeoffice, 126000); // 250 Tage × 6 € = 1.500 € → gedeckelt auf 1.260 €
  assert.equal(r.lines.km, 30000);
  assert.equal(r.profit, 1190000 - (100000 + 19000 + 7000 + 126000 + 30000));
});

test("EÜR: Kleinunternehmer ohne Umsatzsteuer, Hinweise", () => {
  const s = { businesses: [{ id: "b1", kind: "gewerblich", kleinunternehmer: true }], bizEntries: [{ id: "1", businessId: "b1", date: "2026-05-01", amount: 3000000, category: "umsatz", vat: 19 }] };
  const r = euer(s, "b1", 2026);
  assert.equal(r.lines.umsatz_frei, 3000000);
  assert.equal(r.lines.ust_vereinnahmt, undefined);
  const c = bizChecks(s, "b1", 2026).map((x) => x.text).join(" ");
  assert.match(c, /25\.000/); assert.match(c, /Gewerbeamt/); assert.match(c, /24\.500/);
});

test("Ferienwohnungs-Umsatz aus der Monatstabelle landet in der Anlage V-FeWo des Objekts", async () => {
  const { taxFigures } = await import("../js/steuer.js");
  const s = { objects: [{ id: "o1", name: "Hamm" }], units: [{ id: "f1", objectId: "o1", type: "ferienwohnung", name: "Apart79" }], payments: [{ id: "p", kind: "fewo", unitId: "f1", date: "2026-03-31", amount: 107000 }], settings: {} };
  assert.equal(taxFigures(s, "o1", 2026).fewo, 100000);
});
