// Monatsbericht für den Steuerberater: alle Mieteinnahmen und alle Ferienwohnungs-Einnahmen eines Monats
import { rentForMonth, contractActiveIn, invoiceTotals, paidForInvoice, nightsBetween, daysInMonth } from "./core.js";

const inMonth = (iso, key) => typeof iso === "string" && iso.slice(0, 7) === key;

export function monthReport(state, key) {
  const from = `${key}-01`, to = `${key}-${String(daysInMonth(key)).padStart(2, "0")}`;
  const units = new Map((state.units || []).map((u) => [u.id, u])), objects = new Map((state.objects || []).map((o) => [o.id, o]));
  const tenants = new Map((state.tenants || []).map((t) => [t.id, t]));
  const payments = state.payments || [];
  const unitLabel = (uid) => { const u = units.get(uid); const o = u && objects.get(u.objectId); return [o?.name, u?.name].filter(Boolean).join(" · "); };

  // ---- Mieten: Soll laut Vertrag und Ist (Zahlungen für diesen Monat)
  const rent = [];
  for (const c of state.contracts || []) {
    if (!contractActiveIn(c, key)) continue;
    const soll = rentForMonth(c, key);
    const paid = payments.filter((p) => p.kind === "miete" && p.contractId === c.id && p.period === key);
    const ist = paid.reduce((s, p) => s + p.amount, 0);
    rent.push({
      contractId: c.id, unitId: c.unitId, objectId: units.get(c.unitId)?.objectId || "", where: unitLabel(c.unitId),
      tenant: (c.tenantIds || []).map((id) => tenants.get(id)?.name).filter(Boolean).join(", "),
      kalt: soll.kalt, nk: soll.nk, extra: soll.extra || 0, vat: soll.vat || 0, soll: soll.total, ist, diff: ist - soll.total,
      dates: paid.map((p) => p.date).sort(),
    });
  }
  rent.sort((a, b) => a.where.localeCompare(b.where, "de"));
  // Alle Zahlungseingänge im Monat (Zuflussprinzip § 11 EStG) – inkl. Nachzahlungen für andere Monate, NK-Nachzahlungen
  const inflows = payments.filter((p) => inMonth(p.date, key) && ["miete", "nk_nachzahlung", "sonstige"].includes(p.kind))
    .map((p) => ({ date: p.date, kind: p.kind, amount: p.amount, period: p.period || "", contractId: p.contractId || "", where: unitLabel((state.contracts || []).find((c) => c.id === p.contractId)?.unitId), note: p.note || "" }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const deposits = payments.filter((p) => inMonth(p.date, key) && p.kind === "kaution").reduce((s, p) => s + p.amount, 0);

  // ---- Ferienwohnung: Buchungen mit Anreise im Monat, Rechnungen des Monats, Zahlungseingänge
  const fewoIds = new Set((state.units || []).filter((u) => u.type === "ferienwohnung").map((u) => u.id));
  const invoices = (state.invoices || []).filter((i) => i.status !== "entwurf" && inMonth(i.date, key));
  const invRows = invoices.map((i) => {
    const t = invoiceTotals(i);
    const r7 = t.taxes.find((x) => x.rate === 7), r19 = t.taxes.find((x) => x.rate === 19), r0 = t.taxes.find((x) => x.rate === 0);
    return { id: i.id, number: i.number, date: i.date, type: i.type, status: i.status, recipient: i.recipient?.company || i.recipient?.name || "", period: i.serviceFrom ? `${i.serviceFrom}|${i.serviceTo || i.serviceFrom}` : "",
      where: unitLabel(i.unitId), net7: r7?.net || 0, vat7: r7?.vat || 0, net19: r19?.net || 0, vat19: r19?.vat || 0, net0: r0?.net || 0, kurtaxe: t.passThrough, gross: t.gross,
      paid: i.type === "storno" ? 0 : paidForInvoice(state, i.id) };
  }).sort((a, b) => (a.number < b.number ? -1 : 1));
  const bookings = (state.bookings || []).filter((b) => fewoIds.has(b.unitId) && inMonth(b.from, key) && b.status !== "eigennutzung")
    .map((b) => ({ id: b.id, guest: b.guest || "", where: unitLabel(b.unitId), from: b.from, to: b.to, nights: nightsBetween(b.from, b.to), channel: b.channel || "Direkt", ref: b.channelRef || "",
      total: b.total || 0, status: b.status || "bestaetigt", invoice: (state.invoices || []).find((i) => i.id === b.invoiceId)?.number || "" }))
    .sort((a, b) => (a.from < b.from ? -1 : 1));
  const fewoPayments = payments.filter((p) => inMonth(p.date, key) && p.kind === "fewo")
    .map((p) => ({ date: p.date, amount: p.amount, invoice: (state.invoices || []).find((i) => i.id === p.invoiceId)?.number || "", note: p.note || "" }));
  const provisions = (state.expenses || []).filter((e) => inMonth(e.date, key) && e.category === "fewo_provision").reduce((s, e) => s + e.amount, 0);

  // ---- Ausgaben des Monats (zur Info)
  const expenses = (state.expenses || []).filter((e) => inMonth(e.date, key) && e.category !== "privat")
    .map((e) => ({ date: e.date, vendor: e.vendor || "", category: e.category, amount: e.amount, objectId: e.objectId || "", note: e.note || "", beleg: !!(e.belegNr || (e.fileIds || []).length) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
  const totals = {
    rentSoll: sum(rent, (r) => r.soll), rentIst: sum(rent, (r) => r.ist), kalt: sum(rent, (r) => r.kalt), nk: sum(rent, (r) => r.nk), extra: sum(rent, (r) => r.extra), rentVat: sum(rent, (r) => r.vat),
    inflows: sum(inflows, (p) => p.amount), deposits,
    fewoNet7: sum(invRows, (i) => i.net7), fewoVat7: sum(invRows, (i) => i.vat7), fewoNet19: sum(invRows, (i) => i.net19), fewoVat19: sum(invRows, (i) => i.vat19), fewoNet0: sum(invRows, (i) => i.net0),
    kurtaxe: sum(invRows, (i) => i.kurtaxe), fewoGross: sum(invRows, (i) => i.gross), fewoPaid: sum(fewoPayments, (p) => p.amount),
    bookings: sum(bookings.filter((b) => b.status !== "storniert"), (b) => b.total), nights: sum(bookings.filter((b) => b.status !== "storniert"), (b) => b.nights), provisions,
    expenses: sum(expenses, (e) => e.amount),
  };
  const open = [
    ...rent.filter((r) => r.diff < 0).map((r) => `Miete ${r.tenant || r.where}: ${(-r.diff / 100).toFixed(2).replace(".", ",")} € fehlen`),
    ...bookings.filter((b) => b.status !== "storniert" && !b.invoice).map((b) => `Buchung ${b.guest} (${b.where}) ohne Rechnung`),
    ...invRows.filter((i) => i.type !== "storno" && i.status !== "storniert" && i.paid < i.gross).map((i) => `Rechnung ${i.number} noch offen`),
    ...expenses.filter((e) => !e.beleg).map((e) => `Beleg fehlt: ${e.vendor || e.category} vom ${e.date}`),
  ];
  return { key, from, to, rent, inflows, invoices: invRows, bookings, fewoPayments, expenses, totals, open };
}

// CSV für Excel / den Steuerberater (Semikolon, deutsche Zahlen, mit BOM)
export function monthCsv(r, labels = {}) {
  const n = (c) => (Number(c || 0) / 100).toFixed(2).replace(".", ",");
  const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const L = [];
  L.push(["Bereich", "Datum", "Objekt / Einheit", "Mieter / Gast / Empfänger", "Beschreibung", "Netto", "USt", "Brutto / Betrag", "Hinweis"].join(";"));
  for (const x of r.rent) L.push(["Miete Soll/Ist", r.key, q(x.where), q(x.tenant), q(`Soll ${n(x.soll)} (kalt ${n(x.kalt)}, NK ${n(x.nk)}${x.extra ? `, Zuschlag ${n(x.extra)}` : ""}${x.vat ? `, zzgl. USt ${n(x.vat)}` : ""})`), "", "", n(x.ist), q(x.diff ? `Differenz ${n(x.diff)}` : "vollständig")].join(";"));
  for (const p of r.inflows) L.push(["Zahlungseingang Miete", p.date, q(p.where), "", q(`${labels[p.kind] || p.kind}${p.period ? ` für ${p.period}` : ""}`), "", "", n(p.amount), q(p.note)].join(";"));
  for (const i of r.invoices) L.push([i.type === "storno" ? "FeWo Stornorechnung" : "FeWo Rechnung", i.date, q(i.where), q(i.recipient), q(`${i.number}${i.period ? ` · ${i.period.replace("|", " – ")}` : ""}`), n(i.net7 + i.net19 + i.net0), n(i.vat7 + i.vat19), n(i.gross), q(i.kurtaxe ? `darin Kurtaxe ${n(i.kurtaxe)} (durchlaufend)` : "")].join(";"));
  for (const b of r.bookings) L.push(["FeWo Buchung", b.from, q(b.where), q(b.guest), q(`${b.nights} Nächte · ${b.channel}${b.ref ? ` Nr. ${b.ref}` : ""}`), "", "", n(b.total), q(b.status === "storniert" ? "storniert" : b.invoice ? `Rechnung ${b.invoice}` : "noch keine Rechnung")].join(";"));
  for (const p of r.fewoPayments) L.push(["FeWo Zahlungseingang", p.date, "", "", q(p.invoice ? `zu ${p.invoice}` : p.note), "", "", n(p.amount), ""].join(";"));
  for (const e of r.expenses) L.push(["Ausgabe", e.date, "", q(e.vendor), q(e.category), "", "", n(e.amount), q(e.beleg ? "" : "Beleg fehlt")].join(";"));
  return "﻿" + L.join("\r\n") + "\r\n";
}
