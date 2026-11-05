import { test } from "node:test";
import assert from "node:assert/strict";
import { kleinreparaturCheck, maintenanceDue, nextDue, repairStats, repairCost, fifteenPercent } from "../js/instand.js";

test("Kleinreparatur: innerhalb der Grenze zahlt der Mieter, darüber nichts", () => {
  const c = { kleinreparatur: { perCase: 10000, yearMax: 40000 } };
  assert.equal(kleinreparaturCheck(c, 8500).tenantPays, 8500);
  const over = kleinreparaturCheck(c, 10500);
  assert.equal(over.tenantPays, 0);
  assert.match(over.reason, /nichts/);
  assert.equal(kleinreparaturCheck(c, 8000, 35000).tenantPays, 5000); // Jahreshöchstbetrag
  assert.equal(kleinreparaturCheck({}, 5000).applies, false);
  assert.ok(kleinreparaturCheck({ kleinreparatur: { perCase: 10000 } }, 5000, 0, 900000).warn.some((w) => /Jahreshöchstbetrag/.test(w)));
});

test("Wartungsplan: nächster Termin und Fälligkeit", () => {
  assert.equal(nextDue({ lastDone: "2026-01-31", months: 1 }), "2026-02-28");
  const st = { maintenance: [
    { id: "m1", title: "Heizung", lastDone: "2025-11-20", months: 12 },
    { id: "m2", title: "Rauchmelder", lastDone: "2026-06-01", months: 12 },
    { id: "m3", title: "Legionellen", firstDue: "2026-10-01", months: 36 },
  ] };
  const due = maintenanceDue(st, "2026-11-05");
  assert.deepEqual(due.map((m) => m.id), ["m3", "m1"]);
  assert.equal(due[0].overdue, true);
});

test("Reparaturkosten je Jahr nach Kostenträger, verknüpfte Ausgaben zählen", () => {
  const st = {
    expenses: [{ id: "e1", amount: 45000 }, { id: "e2", amount: 5000 }],
    repairs: [
      { id: "r1", objectId: "o1", status: "erledigt", doneAt: "2026-03-01", expenseIds: ["e1"], payer: "vermieter", kind: "reparatur" },
      { id: "r2", objectId: "o1", status: "erledigt", doneAt: "2026-04-01", cost: 8000, payer: "kleinreparatur", kind: "reparatur" },
      { id: "r3", objectId: "o1", status: "beauftragt", reportedAt: "2026-10-01", quote: 120000, priority: "dringend", kind: "reparatur" },
    ],
  };
  assert.equal(repairCost(st, st.repairs[0]), 45000);
  const s = repairStats(st, 2026);
  assert.equal(s.total, 53000);
  assert.equal(s.landlord, 45000);
  assert.equal(s.byPayer.kleinreparatur, 8000);
  assert.equal(s.open, 1); assert.equal(s.urgent, 1); assert.equal(s.quotesOpen, 120000);
});

test("15-%-Grenze anschaffungsnahe Herstellungskosten", () => {
  const o = { id: "o1", purchaseDate: "2025-03-01", buildingShare: 20000000 };
  const st = { expenses: [{ objectId: "o1", category: "erhaltung", date: "2026-05-01", amount: 3570000 }] };
  const r = fifteenPercent(st, o, "2026-11-05");
  assert.equal(r.limit, 3000000); assert.equal(r.sum, 3000000); assert.equal(r.active, true); assert.equal(r.until, "2028-03-01");
});
