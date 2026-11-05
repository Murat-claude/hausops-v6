import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "../js/recht.js";
import { splitPayment, nkAbrechnung } from "../js/core.js";
import { emptyState } from "../js/store.js";

function base() {
  const s = emptyState(); s.settings.sollStart = "";
  s.objects = [{ id: "o", name: "Haus" }];
  s.units = [{ id: "w", objectId: "o", type: "wohnung", area: 60 }, { id: "g", objectId: "o", type: "garage", area: 18 }, { id: "k", objectId: "o", type: "keller", area: 10 }];
  s.contracts = [
    { id: "cw", unitId: "w", tenantIds: ["t1"], start: "2022-01-01", end: "", kalt: 70000, nk: 15000 },
    { id: "cg1", unitId: "g", tenantIds: ["t1"], start: "2022-01-01", end: "", kalt: 6000, nk: 0 },
    { id: "cg2", unitId: "g", tenantIds: ["t9"], start: "2025-01-01", end: "", kalt: 7140, nk: 0 },
  ];
  return s;
}

test("Umsatzsteuer: Garage als Nebenleistung steuerfrei, separat vermietet 19 %", () => {
  const s = base();
  assert.equal(R.vatFor(s, s.contracts[1]).vat, 0);
  assert.equal(R.vatFor(s, s.contracts[2]).vat, 19);
  assert.equal(R.vatFor(s, s.contracts[0]).vat, 0);
  s.settings.kleinunternehmer = true;
  assert.equal(R.vatFor(s, s.contracts[2]).vat, 0);
  s.settings.kleinunternehmer = false;
  const parts = splitPayment(s, { kind: "miete", contractId: "cg2", period: "2025-03", amount: 7140, date: "2025-03-01" });
  assert.equal(parts[0].vat, 19);
});

test("Betriebskosten: Garage und Keller standardmäßig nicht beteiligt, umstellbar", () => {
  assert.equal(R.nkParticipates({ type: "wohnung" }), true);
  assert.equal(R.nkParticipates({ type: "garage" }), false);
  assert.equal(R.nkParticipates({ type: "keller" }), false);
  assert.equal(R.nkParticipates({ type: "garage", nkUmlage: true }), true);
});

test("Kaution max. 3 Nettokaltmieten bei Wohnraum", () => {
  const s = base();
  assert.equal(R.depositCheck(s.units[0], { kalt: 70000, kaution: 210000 }).filter((x) => x.level === "bad").length, 0);
  assert.equal(R.depositCheck(s.units[0], { kalt: 70000, kaution: 230000 }).filter((x) => x.level === "bad").length, 1);
  assert.equal(R.depositCheck(s.units[1], { kalt: 6000, kaution: 50000 }).length, 0);
});

test("Mieterhöhung: 15-Monats-Frist, Kappungsgrenze, Staffel/Index", () => {
  const s = base(); const w = s.units[0];
  const c = { ...s.contracts[0], start: "2025-01-01", steps: [] };
  assert.ok(R.rentIncreaseCheck(w, {}, c, { from: "2026-02", kalt: 75000 }).some((x) => /15 Monate/.test(x.text)));
  assert.ok(!R.rentIncreaseCheck(w, {}, c, { from: "2026-04", kalt: 75000 }).some((x) => x.level === "bad"));
  assert.ok(R.rentIncreaseCheck(w, {}, c, { from: "2026-04", kalt: 85000 }).some((x) => /Kappungsgrenze/.test(x.text)));
  assert.ok(R.rentIncreaseCheck(w, { kappung15: true }, c, { from: "2026-04", kalt: 81000 }).some((x) => /Kappungsgrenze/.test(x.text)));
  assert.ok(R.rentIncreaseCheck(w, {}, { ...c, mietart: "index" }, { from: "2025-08", kalt: 72000 }).some((x) => /Indexmiete/.test(x.text) && x.level === "bad"));
  assert.ok(R.rentIncreaseCheck(s.units[1], {}, s.contracts[1], { from: "2022-03", kalt: 9000 }).every((x) => x.level !== "bad"));
});

test("Chancen für Mieterhöhung und Mietpreisbremse", () => {
  const s = base();
  const opp = R.increaseOpportunities(s, "2026-11-05");
  assert.equal(opp.length, 1);
  assert.equal(opp[0].maxByCap, 84000);
  const bad = R.rentBrakeCheck({ mietpreisbremse: true }, { type: "wohnung", area: 60 }, 80000, 70000, 1100);
  assert.ok(bad.some((x) => x.level === "bad")); // 11 €/m² × 60 × 1,1 = 726 €
  assert.ok(!R.rentBrakeCheck({ mietpreisbremse: true }, { type: "wohnung", area: 60 }, 72000, 0, 1100).some((x) => x.level === "bad"));
});

test("CO2-Kostenaufteilung und NK-Zeitraum", () => {
  assert.deepEqual([R.co2Split(100000, 11).landlordPct, R.co2Split(100000, 30).landlordPct, R.co2Split(100000, 60).landlordPct], [0, 40, 95]);
  assert.equal(R.co2Split(100000, 0, false).landlordPct, 50);
  assert.equal(R.nkPeriodCheck("2025-01-01", "2026-01-31").filter((x) => x.level === "bad").length, 1);
  const s = base();
  const r = nkAbrechnung(s, { objectId: "o", from: "2025-01-01", to: "2025-12-31", items: [{ label: "Heizung", amount: 300000, key: "flaeche", co2Cost: 40000, co2Kg: 30 }] });
  assert.equal(r.owner.total, 16000); // 40 % von 400 €
  assert.equal(r.contracts.find((c) => c.contractId === "cw").total, 284000);
  assert.equal(r.check, r.total);
});

test("Aufbewahrung, Anonymisierung, Pseudonymisierung", () => {
  const s = base();
  s.tenants = [{ id: "t_old1", name: "Erika Alt", email: "e@x.de" }, { id: "t1", name: "Anna Neu" }];
  s.contracts.push({ id: "cold", unitId: "w", tenantIds: ["t_old1"], start: "2010-01-01", end: "2017-06-30" });
  s.bookings = [{ id: "b", guest: "Gast X", to: "2025-01-10", nationality: "NL" }];
  const due = R.retentionDue(s, "2026-11-05");
  assert.deepEqual(due.tenants.map((t) => t.id), ["t_old1"]);
  assert.equal(due.guests.length, 1);
  assert.equal(R.anonymizeTenant(s.tenants[0]).email, "");
  const ps = R.pseudonymizer(s);
  assert.equal(ps("Anna Neu zahlt, IBAN DE89 3704 0044 0532 0130 00"), "Mieter 2 zahlt, IBAN [IBAN]");
  assert.match(R.eInvoiceHint({ date: "2028-02-01", recipient: { business: true } }), /Pflicht/);
});

test("Heizkosten ohne Verbrauchswerte: Verteilung nach Fläche mit Hinweis auf § 12 HeizkostenV", () => {
  const s = emptyState(); s.settings.sollStart = "";
  s.units = [{ id: "a", objectId: "o", type: "wohnung", area: 60 }, { id: "b", objectId: "o", type: "wohnung", area: 40 }];
  s.contracts = [{ id: "c1", unitId: "a", start: "2020-01-01", nk: 0 }, { id: "c2", unitId: "b", start: "2020-01-01", nk: 0 }];
  const r = nkAbrechnung(s, { objectId: "o", from: "2025-01-01", to: "2025-12-31", items: [{ label: "Heizung", amount: 100000, key: "heizkosten", pct: 70, shares: {} }] });
  assert.deepEqual(r.contracts.map((c) => c.total), [60000, 40000]);
  assert.equal(r.owner.total, 0);
  assert.match(r.warnings.join(" "), /§ 12 HeizkostenV/);
});
