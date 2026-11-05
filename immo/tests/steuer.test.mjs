import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "../js/steuer.js";
import { emptyState } from "../js/store.js";

function base() {
  const s = emptyState(); s.settings.sollStart = "";
  s.objects = [{ id: "o", name: "Haus", purchaseDate: "2024-03-01", buildingShare: 20000000, afaRate: 2, vergleichsmiete: 1000 }];
  s.units = [{ id: "w", objectId: "o", type: "wohnung", area: 70, name: "WE1" }, { id: "g", objectId: "o", type: "garage", name: "G1" }, { id: "f", objectId: "o", type: "ferienwohnung", vat: 7, name: "FeWo" }];
  s.tenants = [{ id: "t1", name: "A" }, { id: "t2", name: "B" }];
  s.contracts = [{ id: "cw", unitId: "w", tenantIds: ["t1"], start: "2024-04-01", kalt: 70000, nk: 15000 }, { id: "cg", unitId: "g", tenantIds: ["t2"], start: "2024-04-01", kalt: 5950, nk: 0 }];
  s.payments = [
    { id: "p1", kind: "miete", contractId: "cw", period: "2025-01", amount: 85000, date: "2025-01-02" },
    { id: "p2", kind: "miete", contractId: "cg", period: "2025-01", amount: 5950, date: "2025-01-02" },
  ];
  return s;
}

test("Werte je Objekt: Wohnen, Garage (19 % USt), Umlagen, AfA, verteilte Erhaltung", () => {
  const s = base();
  s.expenses = [
    { id: "e1", objectId: "o", date: "2025-05-01", amount: 300000, category: "erhaltung", distribute: 3 },
    { id: "e2", objectId: "o", date: "2025-02-01", amount: 120000, category: "grundsteuer" },
    { id: "e3", objectId: "o", date: "2025-02-01", amount: 50000, category: "zinsen" },
  ];
  const f = T.taxFigures(s, "o", 2025);
  assert.equal(f.wohnen, 70000);
  assert.equal(f.umlagen, 15000);
  assert.equal(f.andere, 5000);           // Garage netto (separat vermietet → 19 %)
  assert.equal(f.ustEingenommen, 950);
  assert.equal(f.afa, 400000);            // 2 % von 200.000 €
  assert.equal(f.erhaltungVerteilt, 100000); // 1/3 von 3.000 €
  assert.equal(T.taxFigures(s, "o", 2027).erhaltungVerteilt, 100000);
  assert.equal(T.taxFigures(s, "o", 2028).erhaltungVerteilt, 0);
  assert.equal(f.betrieb, 120000); assert.equal(f.zinsen, 50000);
  assert.equal(T.euroDown(70099), 700); assert.equal(T.euroUp(70001), 701);
});

test("Vorprüfung: 15-%-Grenze, verbilligte Vermietung, Eigennutzung FeWo, Miteigentum", () => {
  const s = base();
  s.expenses = [{ id: "e", objectId: "o", date: "2025-06-01", amount: 3800000, category: "erhaltung" }]; // 38.000 € brutto ≈ 31.933 € netto > 30.000 €
  s.contracts[0].kalt = 30000; // 300 € statt ortsüblich 700 €
  s.bookings = [{ id: "b1", unitId: "f", from: "2025-07-01", to: "2025-07-15", status: "bestaetigt" }, { id: "b2", unitId: "f", from: "2025-08-01", to: "2025-08-08", status: "eigennutzung" }];
  s.objects[0].owners = "Max 50; Bruder 50";
  const c = T.taxChecks(s, 2025, "2026-03-01");
  const txt = c.map((x) => x.text).join(" | ");
  assert.match(txt, /Anschaffungsnaher Aufwand/);
  assert.match(txt, /ortsüblichen Warmmiete/);
  assert.match(txt, /Eigennutzung 7 Tage, Vermietung 14 Tage/);
  assert.match(txt, /Feststellungserklärung/);
  assert.equal(T.fewoUsage(s, "f", 2025).costQuote, 14 / 21);
});

test("Umsatzsteuer-Voranmeldung: Kennzahlen 81/86/66", () => {
  const s = base();
  s.invoices = [{ id: "i", unitId: "f", lines: [{ qty: 1, price: 10700, vat: 7 }, { qty: 1, price: 500, vat: 0, passThrough: true }] }];
  s.payments.push({ id: "p3", kind: "fewo", invoiceId: "i", amount: 11200, date: "2025-01-20" });
  s.expenses = [{ id: "e", objectId: "o", date: "2025-01-10", amount: 11900, vorsteuer: 1900, category: "fewo_reinigung" }];
  const u = T.ustVa(s, "2025-01-01", "2025-01-31");
  assert.deepEqual(u, { kz81: 5000, kz86: 10000, steuer: 950 + 700, kz66: 1900, zahllast: 1650 - 1900 });
});
