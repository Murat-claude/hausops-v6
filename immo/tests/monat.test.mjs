import { test } from "node:test";
import assert from "node:assert/strict";
import { monthReport, monthCsv } from "../js/monat.js";
import { demoState } from "../js/store.js";

test("Monatsbericht: Mieten Soll/Ist, FeWo-Rechnungen mit USt und Kurtaxe, offene Punkte", () => {
  const st = {
    objects: [{ id: "o1", name: "Haus" }],
    units: [{ id: "u1", objectId: "o1", name: "WE 1" }, { id: "f1", objectId: "o1", name: "FeWo", type: "ferienwohnung" }],
    tenants: [{ id: "t1", name: "Anna" }],
    contracts: [{ id: "c1", unitId: "u1", tenantIds: ["t1"], start: "2025-01-01", kalt: 70000, nk: 15000 }],
    payments: [
      { id: "p1", kind: "miete", contractId: "c1", period: "2026-10", date: "2026-10-02", amount: 85000 },
      { id: "p2", kind: "nk_nachzahlung", contractId: "c1", date: "2026-10-20", amount: 12000 },
      { id: "p3", kind: "fewo", invoiceId: "i1", date: "2026-10-12", amount: 64000 },
      { id: "p4", kind: "kaution", contractId: "c1", date: "2026-10-01", amount: 100000 },
    ],
    bookings: [{ id: "b1", unitId: "f1", guest: "Jan", from: "2026-10-05", to: "2026-10-10", total: 60000, channel: "Booking.com", invoiceId: "i1" },
      { id: "b2", unitId: "f1", guest: "Lisa", from: "2026-10-20", to: "2026-10-22", total: 20000, channel: "Airbnb" }],
    invoices: [{ id: "i1", number: "RE-2026-0001", date: "2026-10-11", status: "bezahlt", type: "rechnung", unitId: "f1", recipient: { name: "Jan" },
      lines: [{ qty: 5, price: 12000, vat: 7 }, { qty: 10, price: 400, vat: 0, passThrough: true }] }],
    expenses: [{ id: "e1", date: "2026-10-15", category: "fewo_provision", amount: 9000, vendor: "Booking.com" }],
  };
  const r = monthReport(st, "2026-10");
  assert.equal(r.rent.length, 1);
  assert.equal(r.totals.rentSoll, 85000); assert.equal(r.totals.rentIst, 85000);
  assert.equal(r.totals.inflows, 97000); // Miete + NK-Nachzahlung, ohne Kaution
  assert.equal(r.totals.deposits, 100000);
  assert.equal(r.totals.fewoGross, 64000);
  assert.equal(r.totals.kurtaxe, 4000);
  assert.equal(r.totals.fewoNet7 + r.totals.fewoVat7, 60000);
  assert.equal(r.totals.fewoVat7, 3925);
  assert.equal(r.totals.provisions, 9000);
  assert.equal(r.bookings.length, 2);
  assert.ok(r.open.some((x) => x.includes("Lisa") && x.includes("ohne Rechnung")));
  assert.ok(r.open.some((x) => x.includes("Beleg fehlt")));
  const csv = monthCsv(r);
  assert.ok(csv.startsWith("﻿"));
  assert.ok(csv.includes("RE-2026-0001") && csv.includes("640,00") && csv.includes("darin Kurtaxe 40,00"));
});

test("Monatsbericht mit Demo-Daten läuft für jeden Monat ohne Fehler", () => {
  const st = demoState();
  for (let m = 1; m <= 12; m++) monthReport(st, `2026-${String(m).padStart(2, "0")}`);
});
