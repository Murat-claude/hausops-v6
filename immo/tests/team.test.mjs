import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeStates } from "../js/store.js";

const base = {
  objects: [{ id: "o1", name: "Haus A" }, { id: "o2", name: "Haus B" }],
  tenants: [{ id: "t1", name: "Meier", phone: "1" }],
  settings: { ownerName: "Murat", skr: "03", invoiceCounters: { 2026: 4 } },
  rules: {},
};

test("Beide fügen unterschiedliche Datensätze hinzu – nichts geht verloren", () => {
  const local = { ...base, objects: [...base.objects, { id: "o3", name: "Garage" }] };
  const remote = { ...base, tenants: [...base.tenants, { id: "t2", name: "Schulz" }] };
  const { merged, conflicts } = mergeStates(base, local, remote);
  assert.deepEqual(merged.objects.map((o) => o.id), ["o1", "o2", "o3"]);
  assert.deepEqual(merged.tenants.map((t) => t.id), ["t1", "t2"]);
  assert.equal(conflicts, 0);
});

test("Verschiedene Felder desselben Datensatzes werden kombiniert", () => {
  const local = { ...base, tenants: [{ id: "t1", name: "Meier", phone: "0171" }] };
  const remote = { ...base, tenants: [{ id: "t1", name: "Meier-Schulz", phone: "1" }] };
  const { merged, conflicts } = mergeStates(base, local, remote);
  assert.deepEqual(merged.tenants, [{ id: "t1", name: "Meier-Schulz", phone: "0171" }]);
  assert.equal(conflicts, 0);
});

test("Löschen auf einer Seite, Einstellungen auf der anderen", () => {
  const local = { ...base, objects: [base.objects[0]] };
  const remote = { ...base, settings: { ...base.settings, skr: "04" } };
  const { merged } = mergeStates(base, local, remote);
  assert.deepEqual(merged.objects.map((o) => o.id), ["o1"]);
  assert.equal(merged.settings.skr, "04");
  assert.equal(merged.settings.ownerName, "Murat");
});

test("Gleiches Feld unterschiedlich geändert: eigene Änderung gewinnt, Konflikt wird gezählt", () => {
  const local = { ...base, objects: [{ id: "o1", name: "Haus A1" }, base.objects[1]] };
  const remote = { ...base, objects: [{ id: "o1", name: "Haus A2" }, base.objects[1]] };
  const { merged, conflicts } = mergeStates(base, local, remote);
  assert.equal(merged.objects[0].name, "Haus A1");
  assert.equal(conflicts, 1);
});

test("Von anderen gelöschter, von mir geänderter Datensatz bleibt erhalten", () => {
  const local = { ...base, tenants: [{ id: "t1", name: "Meier", phone: "9" }] };
  const remote = { ...base, tenants: [] };
  const { merged, conflicts } = mergeStates(base, local, remote);
  assert.equal(merged.tenants.length, 1);
  assert.equal(conflicts, 1);
});

test("Rechnungsnummern-Zähler: höherer Stand der anderen bleibt erhalten, wenn ich nichts vergeben habe", () => {
  const remote = { ...base, settings: { ...base.settings, invoiceCounters: { 2026: 6 } } };
  const { merged } = mergeStates(base, base, remote);
  assert.equal(merged.settings.invoiceCounters[2026], 6);
});

test("Rechnungszähler: beide vergeben gleichzeitig – höchster Stand, doppelte Nummer wird gemeldet", () => {
  const b = { ...base, invoices: [] };
  const local = { ...b, invoices: [{ id: "i1", number: "RE-2026-5" }], settings: { ...base.settings, invoiceCounters: { 2026: 5 } } };
  const remote = { ...b, invoices: [{ id: "i2", number: "RE-2026-5" }, { id: "i3", number: "RE-2026-6" }], settings: { ...base.settings, invoiceCounters: { 2026: 6 } } };
  const { merged, duplicateNumbers } = mergeStates(b, local, remote);
  assert.equal(merged.settings.invoiceCounters[2026], 6);
  assert.deepEqual(duplicateNumbers, ["RE-2026-5"]);
});
