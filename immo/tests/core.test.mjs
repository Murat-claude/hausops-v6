import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseAmount, parseDate, addMonths, periodForPayment, suggestAssignment, invoiceTotals,
  linesFromBooking, afaForYear, anlageV, datevCsv, datevRows, parseCsv, detectCsv, txFromCsv,
  parseCamt, sollIst, rentForMonth, toWin1252, nightsBetween, bookingsOverlap,
} from "../js/core.js";
import { emptyState } from "../js/store.js";

test("Beträge im deutschen und englischen Format", () => {
  assert.equal(parseAmount("1.234,56"), 123456);
  assert.equal(parseAmount("-1.234,56"), -123456);
  assert.equal(parseAmount("1,234.56"), 123456);
  assert.equal(parseAmount("850,00 €"), 85000);
  assert.equal(parseAmount("12,5"), 1250);
  assert.equal(parseAmount("1.200"), 120000);
  assert.equal(parseAmount("99.5"), 9950);
  assert.equal(parseAmount("45,00-"), -4500);
});

test("Datum & Monate", () => {
  assert.equal(parseDate("03.11.2026"), "2026-11-03");
  assert.equal(parseDate("3.1.26"), "2026-01-03");
  assert.equal(addMonths("2026-12", 1), "2027-01");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(nightsBetween("2026-07-01", "2026-07-08"), 7);
});

test("Soll-Monat einer Mietzahlung", () => {
  assert.equal(periodForPayment("2026-10-29", "Miete"), "2026-11");
  assert.equal(periodForPayment("2026-11-03", "Miete"), "2026-11");
  assert.equal(periodForPayment("2026-11-03", "Miete 10/2026"), "2026-10");
  assert.equal(periodForPayment("2026-12-28", "Miete Januar"), "2027-01");
  assert.equal(periodForPayment("2026-11-03", "August Meier Miete November"), "2026-11");
  assert.equal(periodForPayment("2026-11-03", "Rechnung vom 01.10.2026"), "2026-11");
});

function demo() {
  const s = emptyState();
  s.settings.sollStart = "";
  s.objects = [{ id: "o1", name: "Haus A", short: "HA", purchaseDate: "2020-07-15", buildingShare: 30000000, afaRate: 2 }];
  s.units = [
    { id: "u1", objectId: "o1", name: "WE 1", type: "wohnung", vat: 0 },
    { id: "u2", objectId: "o1", name: "FeWo", type: "ferienwohnung", vat: 7 },
  ];
  s.tenants = [{ id: "t1", name: "Anna Schmidt", ibans: ["DE89 3704 0044 0532 0130 00"] }];
  s.contracts = [{ id: "c1", unitId: "u1", tenantIds: ["t1"], start: "2025-01-01", kalt: 80000, nk: 20000, extra: 0, steps: [{ from: "2026-07", kalt: 85000 }] }];
  return s;
}

test("Mietanpassung und Soll/Ist", () => {
  const s = demo();
  assert.equal(rentForMonth(s.contracts[0], "2026-06").total, 100000);
  assert.equal(rentForMonth(s.contracts[0], "2026-07").total, 105000);
  s.payments = [{ id: "p1", kind: "miete", contractId: "c1", period: "2026-07", amount: 100000, date: "2026-07-01" }];
  const rows = sollIst(s, "2026-07", "2026-07");
  assert.deepEqual(rows.map((r) => r.diff), [-5000]);
  s.settings.sollStart = "2026-08";
  assert.equal(sollIst(s, "2026-07", "2026-07").length, 0); // vor Abgleich-Start keine Rückstände
});

test("Mieteingang wird per IBAN und Betrag erkannt", () => {
  const s = demo();
  const sug = suggestAssignment({ date: "2026-05-30", amount: 100000, name: "A. Schmidt", iban: "DE89370400440532013000", purpose: "Miete" }, s);
  assert.equal(sug.kind, "miete");
  assert.equal(sug.contractId, "c1");
  assert.equal(sug.period, "2026-06");
  assert.ok(sug.score >= 80, `score ${sug.score}`);
});

test("Gelernte Regel für Ausgaben", () => {
  const s = demo();
  s.rules = { "name:stadtwerke musterstadt": { kind: "ausgabe", category: "versorgung", objectId: "o1" } };
  const sug = suggestAssignment({ date: "2026-05-05", amount: -12000, name: "Stadtwerke Musterstadt", iban: "", purpose: "Abschlag" }, s);
  assert.equal(sug.category, "versorgung");
  assert.equal(sug.objectId, "o1");
});

test("Ferienwohnungs-Rechnung: 7 % USt, Kurtaxe durchlaufend", () => {
  const b = { from: "2026-07-01", to: "2026-07-08", total: 70000, cleaning: 6000, adults: 2, kurtaxe: 250 };
  const lines = linesFromBooking(b, { name: "FeWo" });
  const t = invoiceTotals({ lines });
  assert.equal(t.gross, 70000 + 6000 + 2 * 7 * 250);
  assert.equal(t.passThrough, 3500);
  assert.equal(t.taxes.length, 1);
  assert.equal(t.taxes[0].rate, 7);
  assert.equal(t.taxes[0].net + t.taxes[0].vat, 76000);
  assert.equal(t.taxes[0].vat, 4972);
  const ku = invoiceTotals({ lines, kleinunternehmer: true });
  assert.equal(ku.vat, 0);
});

test("Überschneidende Buchungen", () => {
  const a = { id: 1, unitId: "u", from: "2026-07-01", to: "2026-07-08" };
  assert.ok(bookingsOverlap(a, { id: 2, unitId: "u", from: "2026-07-07", to: "2026-07-10" }));
  assert.ok(!bookingsOverlap(a, { id: 2, unitId: "u", from: "2026-07-08", to: "2026-07-10" }));
});

test("AfA zeitanteilig im Erwerbsjahr", () => {
  const o = { purchaseDate: "2020-07-15", buildingShare: 30000000, afaRate: 2 };
  assert.equal(afaForYear(o, 2019), 0);
  assert.equal(afaForYear(o, 2020), 300000); // 6/12 von 600.000 ct
  assert.equal(afaForYear(o, 2021), 600000);
});

test("Anlage V und DATEV aus Zahlungen und Ausgaben", () => {
  const s = demo();
  s.invoices = [{ id: "i1", number: "RE-2026-0001", unitId: "u2", lines: [
    { desc: "Übernachtung", qty: 1, price: 10700, vat: 7 },
    { desc: "Kurtaxe", qty: 1, price: 500, vat: 0, passThrough: true },
  ] }];
  s.payments = [
    { id: "p1", kind: "miete", contractId: "c1", period: "2026-06", amount: 100000, date: "2026-06-01", txId: "x" },
    { id: "p2", kind: "fewo", invoiceId: "i1", amount: 11200, date: "2026-06-10", txId: "y" },
  ];
  s.expenses = [{ id: "e1", category: "erhaltung", objectId: "o1", amount: 25000, date: "2026-06-12", vendor: "Maler Klein", txId: "z" }];
  const av = anlageV(s, 2026).find((r) => r.objectId === "o1");
  assert.equal(av.income.kalt, 80000);
  assert.equal(av.income.umlage, 20000);
  assert.equal(av.income.fewo, 10000);
  assert.equal(av.costs.erhaltung, 25000);
  assert.equal(av.costs.afa, 600000);

  const rows = datevRows(s, "2026-06-01", "2026-06-30");
  assert.deepEqual(rows.map((r) => [r.amount, r.konto, r.gegen, r.sh]), [
    [80000, "1200", "8100", "S"], [20000, "1200", "8100", "S"],
    [10700, "1200", "8300", "S"], [500, "1200", "1590", "S"],
    [25000, "1200", "4260", "H"],
  ]);
  const csv = datevCsv(s, "2026-06-01", "2026-06-30", new Date(2026, 6, 1, 12, 0, 0));
  const lines = csv.trim().split("\r\n");
  assert.match(lines[0], /^"EXTF";700;21;"Buchungsstapel";13;20260701120000000;/);
  assert.match(lines[0], /;20260601;20260630;/);
  assert.match(lines[2], /^800,00;"S";"EUR";;;"";1200;8100;"";0106;"M202606";/);
  assert.equal(toWin1252("€ä")[0], 0x80);
  assert.equal(toWin1252("€ä")[1], 0xe4);
});

test("CSV-Import Sparkasse-Format", () => {
  const csv = `"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"
"DE02120300000000202051";"30.10.26";"30.10.26";"GUTSCHR. UEBERWEISUNG";"Miete November";"Anna Schmidt";"DE89370400440532013000";"COBADEFFXXX";"1.000,00";"EUR";"Umsatz gebucht"
"DE02120300000000202051";"02.11.26";"02.11.26";"LASTSCHRIFT";"Abschlag 11/2026";"Stadtwerke";"DE44100500000190000001";"BELADEBEXXX";"-215,00";"EUR";"Umsatz gebucht"`;
  const rows = parseCsv(csv);
  const det = detectCsv(rows);
  assert.equal(det.headers[det.mapping.date], "Buchungstag");
  assert.equal(det.headers[det.mapping.amount], "Betrag");
  assert.equal(det.headers[det.mapping.purpose], "Verwendungszweck");
  const txs = txFromCsv(rows, det.headerIdx, det.mapping, "a1");
  assert.equal(txs.length, 2);
  assert.deepEqual([txs[0].date, txs[0].amount, txs[0].name, txs[0].iban], ["2026-10-30", 100000, "Anna Schmidt", "DE89370400440532013000"]);
  assert.equal(txs[1].amount, -21500);
});

test("CSV-Import mit getrennten Soll/Haben-Spalten", () => {
  const csv = `Buchungsdatum;Auftraggeber;Verwendungszweck;Soll;Haben\n01.11.2026;Jonas Becker;Garage;;60,00\n02.11.2026;Handwerker;Rechnung 12;120,00;`;
  const rows = parseCsv(csv);
  const det = detectCsv(rows);
  const txs = txFromCsv(rows, det.headerIdx, det.mapping, "a1");
  assert.deepEqual(txs.map((t) => t.amount), [6000, -12000]);
});

test("CAMT.053 Import", () => {
  const xml = `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt><Stmt>
  <Ntry><Amt Ccy="EUR">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-10-30</Dt></BookgDt>
  <NtryDtls><TxDtls><RltdPties><Dbtr><Pty><Nm>Anna Schmidt</Nm></Pty></Dbtr><DbtrAcct><Id><IBAN>DE89370400440532013000</IBAN></Id></DbtrAcct></RltdPties>
  <RmtInf><Ustrd>Miete November</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
  <Ntry><Amt Ccy="EUR">215.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-11-02</Dt></BookgDt>
  <NtryDtls><TxDtls><RltdPties><Cdtr><Nm>Stadtwerke &amp; Co</Nm></Cdtr></RltdPties><RmtInf><Ustrd>Abschlag</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
  </Stmt></BkToCstmrStmt></Document>`;
  const txs = parseCamt(xml, "a1");
  assert.equal(txs.length, 2);
  assert.deepEqual([txs[0].amount, txs[0].name, txs[0].iban, txs[0].purpose], [100000, "Anna Schmidt", "DE89370400440532013000", "Miete November"]);
  assert.deepEqual([txs[1].amount, txs[1].name], [-21500, "Stadtwerke & Co"]);
});

import { nkAbrechnung, fewoStats, parseOwners, incomeByUnitMonth, taxOpenPoints } from "../js/core.js";

test("Nebenkostenabrechnung tagegenau mit Leerstand und Personen", () => {
  const s = emptyState();
  s.settings.sollStart = "";
  s.units = [
    { id: "a", objectId: "o", name: "WE 1", area: 60 },
    { id: "b", objectId: "o", name: "WE 2", area: 40 },
  ];
  s.contracts = [
    { id: "c1", unitId: "a", tenantIds: [], start: "2020-01-01", end: "", kalt: 50000, nk: 10000, persons: 2 },
    // WE 2 erst ab 1.7. vermietet → Leerstand 1.1.–30.6. trägt der Vermieter
    { id: "c2", unitId: "b", tenantIds: [], start: "2025-07-01", end: "", kalt: 40000, nk: 8000, persons: 1 },
  ];
  s.payments = [{ id: "p", kind: "miete", contractId: "c1", period: "2025-03", amount: 60000, date: "2025-03-01" }];
  const r = nkAbrechnung(s, { objectId: "o", from: "2025-01-01", to: "2025-12-31", items: [
    { label: "Grundsteuer", amount: 36500, key: "flaeche" },
    { label: "Wasser", amount: 10000, key: "personen" },
  ] });
  assert.equal(r.check, r.total);
  assert.equal(r.total, 46500);
  const c1 = r.contracts.find((x) => x.contractId === "c1");
  const c2 = r.contracts.find((x) => x.contractId === "c2");
  assert.equal(c1.items[0].amount, 21900); // 60 % von 365 €
  assert.equal(c2.items[0].amount, Math.round(14600 * 184 / 365));
  assert.ok(r.owner.total > 0); // Leerstandsanteil
  // Wasser nach Personentagen: 2×365 vs. 1×184
  assert.equal(c1.items[1].amount, Math.round(10000 * 730 / 914));
  assert.equal(c1.prepaid, 10000);
  assert.equal(c1.saldo, c1.total - 10000);
  assert.equal(r.deadline, "2026-12-31");
});

test("Heizkosten nach HeizkostenV 70 % Verbrauch", () => {
  const s = emptyState();
  s.units = [{ id: "a", objectId: "o", area: 50 }, { id: "b", objectId: "o", area: 50 }];
  s.contracts = [
    { id: "c1", unitId: "a", start: "2020-01-01", nk: 0 }, { id: "c2", unitId: "b", start: "2020-01-01", nk: 0 },
  ];
  const r = nkAbrechnung(s, { objectId: "o", from: "2025-01-01", to: "2025-12-31", items: [
    { label: "Heizung", amount: 100000, key: "heizkosten", pct: 70, shares: { a: 3, b: 1 } },
  ] });
  assert.equal(r.contracts[0].total, 15000 + 52500);
  assert.equal(r.contracts[1].total, 15000 + 17500);
});

test("FeWo-Kennzahlen ADR / RevPAR / Stornoquote", () => {
  const s = emptyState();
  s.bookings = [
    { id: 1, unitId: "f", from: "2026-07-01", to: "2026-07-08", total: 70000, status: "bestaetigt", channel: "Direkt" },
    { id: 2, unitId: "f", from: "2026-07-10", to: "2026-07-13", total: 36000, status: "bestaetigt", channel: "Airbnb" },
    { id: 3, unitId: "f", from: "2026-07-20", to: "2026-07-25", total: 50000, status: "storniert", channel: "Airbnb" },
    { id: 4, unitId: "f", from: "2026-07-28", to: "2026-08-01", status: "eigennutzung" },
  ];
  const k = fewoStats(s, ["f"], "2026-07-01", "2026-08-01");
  assert.equal(k.nights, 10);
  assert.equal(k.available, 31 - 4);
  assert.equal(k.adr, 10600);
  assert.equal(k.revpar, Math.round(106000 / 27));
  assert.equal(k.cancelRate, 1 / 3);
  assert.equal(k.directShare, 0.5);
});

test("Miteigentum, Monatstabelle, offene Punkte", () => {
  assert.deepEqual(parseOwners("Murat 50; Yasemin 50 %"), [{ name: "Murat", share: 50 }, { name: "Yasemin", share: 50 }]);
  const s = emptyState();
  s.units = [{ id: "u", objectId: "o", name: "WE", vat: 0 }];
  s.contracts = [{ id: "c", unitId: "u", start: "2025-01-01", kalt: 80000, nk: 20000 }];
  s.payments = [{ id: "p", kind: "miete", contractId: "c", period: "2025-02", amount: 100000, date: "2025-01-30" }];
  const t = incomeByUnitMonth(s, 2025);
  assert.deepEqual(t.u[1], { kalt: 80000, umlage: 20000, fewo: 0, sonstige: 0 });
  s.objects = [{ id: "o", name: "Haus", owners: "A 50; B 40" }];
  const pts = taxOpenPoints(s, 2025).join(" ");
  assert.match(pts, /100 %/);
  assert.match(pts, /AfA/);
});

import { consumptionFor, checkMove, nkItemsFromExpenses } from "../js/core.js";

test("Verbrauch aus Zählerständen und Mieterwechsel-Prüfung", () => {
  const s = emptyState();
  s.meterReadings = [
    { unitId: "u", type: "wasser_kalt", date: "2024-12-31", value: 100 },
    { unitId: "u", type: "wasser_kalt", date: "2025-06-30", value: 140 }, // Mieterwechsel
    { unitId: "u", type: "wasser_kalt", date: "2026-01-03", value: 182.5 },
  ];
  assert.equal(consumptionFor(s, "u", "wasser_kalt", "2025-01-01", "2025-12-31"), 82.5);
  assert.equal(consumptionFor(s, "u", "heizung", "2025-01-01", "2025-12-31"), null);
  assert.equal(checkMove({ start: "2020-01-01" }, "2025-06-30", "2025-07-01").vacancyDays, 0);
  assert.equal(checkMove({ start: "2020-01-01" }, "2025-06-30", "2025-08-01").vacancyDays, 31);
  assert.equal(checkMove({ start: "2020-01-01" }, "2025-06-30", "2025-06-15").warnings.length, 1);
});

test("Nur der umlagefähige Anteil einer Rechnung geht in die NK-Abrechnung", () => {
  const s = emptyState();
  s.expenses = [
    { id: "e1", objectId: "o", date: "2025-03-01", amount: 120000, category: "erhaltung", betrkv: "hauswart", umlageAmount: 80000 },
    { id: "e2", objectId: "o", date: "2025-03-01", amount: 50000, category: "erhaltung" }, // Reparatur: nicht umlagefähig
    { id: "e3", objectId: "o", date: "2025-05-01", amount: 30000, category: "versicherung" },
  ];
  const items = nkItemsFromExpenses(s, "o", "2025-01-01", "2025-12-31");
  assert.deepEqual(items.map((i) => [i.kind, i.amount]).sort(), [["hauswart", 80000], ["versicherung", 30000]]);
});

import { parseIcs, mergeIcal, mergeBankTx } from "../js/core.js";

test("iCal von Airbnb/Booking einlesen und abgleichen", () => {
  const airbnb = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261210\r\nDTEND;VALUE=DATE:20261215\r\nSUMMARY:Reserved\r\nUID:abc@airbnb.com\r\nDESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMABC12345\\nPhone Number (Last 4 Digits): 4711\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261220\r\nDTEND;VALUE=DATE:20261222\r\nSUMMARY:Airbnb (Not available)\r\nUID:blk@airbnb.com\r\nEND:VEVENT\r\nEND:VCALENDAR";
  const ev = parseIcs(airbnb);
  assert.equal(ev.length, 2);
  let r = mergeIcal([], { unitId: "f", feedId: "air", channel: "Airbnb", events: ev, todayIso: "2026-11-05" });
  assert.equal(r.added, 2);
  assert.equal(r.bookings[0].guest, "Airbnb-Gast HMABC12345");
  assert.match(r.bookings[0].note, /4711/);
  assert.equal(r.bookings[1].status, "eigennutzung");
  // erneuter Abruf: nichts doppelt; Buchung entfällt → storniert
  r = mergeIcal(r.bookings, { unitId: "f", feedId: "air", channel: "Airbnb", events: ev.slice(1), todayIso: "2026-11-05" });
  assert.equal(r.added, 0); assert.equal(r.cancelled, 1);
  // Über Smoobu schon vorhanden → nur verknüpfen
  const smoobu = [{ id: "s1", unitId: "f", from: "2027-01-02", to: "2027-01-05", status: "bestaetigt", guest: "Max" }];
  const bk = parseIcs("BEGIN:VEVENT\nDTSTART;VALUE=DATE:20270102\nDTEND;VALUE=DATE:20270105\nSUMMARY:CLOSED - Not available\nUID:bk1\nEND:VEVENT");
  r = mergeIcal(smoobu, { unitId: "f", feedId: "bkg", channel: "Booking.com", events: bk, todayIso: "2026-11-05" });
  assert.equal(r.added, 0); assert.equal(r.bookings[0].icalKey, "bkg:bk1"); assert.equal(r.bookings[0].guest, "Max");
});

test("Live-Bankumsätze ohne Duplikate übernehmen", () => {
  const inc = [{ extId: "E1", date: "2026-10-30", amount: 90000, name: "Anna", iban: "DE89", purpose: "Miete" }, { extId: "E2", date: "2026-10-31", amount: -500, name: "X", purpose: "", pending: true }];
  const first = mergeBankTx([], "acc", inc);
  assert.equal(first.length, 1);
  assert.equal(mergeBankTx(first, "acc", inc).length, 0);
});

test("Live-Umsatz erkennt vorher per CSV importierten Umsatz", () => {
  const csv = [{ accountId: "acc", date: "2026-10-30", amount: 90000, name: "Anna Schmidt", iban: "DE89370400440532013000", purpose: "MIETE NOV", hash: "h1" }];
  const fresh = mergeBankTx(csv, "acc", [{ extId: "E1", date: "2026-10-31", amount: 90000, name: "Anna Schmidt", iban: "DE89370400440532013000", purpose: "Miete November" }]);
  assert.equal(fresh.length, 0);
  assert.equal(csv[0].extId, "acc:E1");
});

import { recipientLines, recipientFromBooking, channelNote, recipientName, recipientHasAddress } from "../js/core.js";
test("Rechnungsempfänger: Firma statt Gast, Auslandsadresse, Altformat", () => {
  const b = { guest: "Anna Gast", guestStreet: "Hauptstr. 1", guestZip: "1010", guestCity: "Wien", guestCountry: "AT", email: "anna@example.at", channel: "Booking.com", channelRef: "4711" };
  const r = recipientFromBooking(b);
  assert.deepEqual(recipientLines(r), ["Anna Gast", "Hauptstr. 1", "1010 Wien", "ÖSTERREICH"]);
  const firma = { ...r, company: "Muster GmbH", street: "Industriestr. 5", zip: "20095", city: "Hamburg", country: "DE" };
  assert.deepEqual(recipientLines(firma), ["Muster GmbH", "z. Hd. Anna Gast", "Industriestr. 5", "20095 Hamburg"]);
  assert.equal(recipientName(firma), "Muster GmbH");
  assert.deepEqual(recipientLines({ name: "Alt", address: "Weg 2\n12345 Ort" }), ["Alt", "Weg 2", "12345 Ort"]);
  assert.equal(recipientHasAddress({ name: "X" }), false);
  assert.equal(channelNote(b), "Buchung über Booking.com (Buchungsnr. 4711).");
});

test("Sammelüberweisung: 2 Garagen à 70 € mit einer Zahlung über 140 € werden aufgeteilt", async () => {
  const { splitAmount } = await import("../js/core.js");
  const s = emptyState();
  s.units = [{ id: "g1", name: "Garage 1", type: "garage" }, { id: "g2", name: "Garage 2", type: "garage" }, { id: "w1", name: "WE 1", type: "wohnung" }];
  // Mieter wurde zweimal angelegt (je Garage ein Einzug) – Name gleich
  s.tenants = [{ id: "t1", name: "Kate Mcintosch", ibans: [] }, { id: "t2", name: "Kate Mcintosch", ibans: [] }, { id: "t3", name: "Gülhanim Bacak", ibans: [] }];
  const k = (id, unitId, t, kalt) => ({ id, unitId, tenantIds: [t], start: "2026-01-01", end: "", kalt, nk: 0, extra: 0, steps: [] });
  s.contracts = [k("c1", "g1", "t1", 7000), k("c2", "g2", "t2", 7000), k("c3", "w1", "t3", 78800)];
  const tx = { id: "x", date: "2026-11-03", amount: 14000, name: "KATE MCINTOSCH", purpose: "Miete Garagen November", iban: "DE001" };
  const sug = suggestAssignment(tx, s);
  assert.equal(sug.kind, "miete");
  assert.deepEqual(sug.splits.map((x) => [x.contractId, x.amount]), [["c1", 7000], ["c2", 7000]]);
  assert.ok(sug.score >= 60, `Score ${sug.score}`);
  // Nur eine Garage bezahlt → normaler Einzel-Vorschlag
  const one = suggestAssignment({ ...tx, amount: 7000 }, s);
  assert.equal(one.splits, undefined);
  // Gelernte Regel mit mehreren Verträgen greift auch ohne Namen
  s.rules = { "iban:DE001": { kind: "miete", contractIds: ["c1", "c2"] } };
  const byRule = suggestAssignment({ ...tx, name: "Firma XY", purpose: "" }, s);
  assert.equal(byRule.splits.length, 2);
  // Aufteilen nach Warmmiete, Cent-Rest auf den letzten Vertrag
  assert.deepEqual(splitAmount(14000, [7000, 7000]), [7000, 7000]);
  assert.deepEqual(splitAmount(10000, [7000, 7000]), [5000, 5000]);
  assert.deepEqual(splitAmount(10001, [5000, 10000]), [3333, 6668]);
});

test("Ablage: Dateien nach Thema sortieren", async () => {
  const { guessFolder } = await import("../js/core.js");
  assert.equal(guessFolder("Schornsteinfeger Rechnung 2024.pdf"), "schornsteinfeger");
  assert.equal(guessFolder("Gasrechnung_Stadtwerke_Hamm.pdf"), "gas_heizung");
  assert.equal(guessFolder("Stromabrechnung 2023.pdf"), "strom");
  assert.equal(guessFolder("Grundsteuerbescheid.pdf"), "grundsteuer");
  assert.equal(guessFolder("Mietvertrag Bacak.pdf"), "mieter");
  assert.equal(guessFolder("Brief an Vermieter.pdf"), "sonstiges");
  assert.equal(guessFolder("IMG_2034.jpg", "Haus/Versicherung/IMG_2034.jpg"), "versicherung");
});

test("Gewerblicher Mieter: Miete netto zzgl. 19 % USt", async () => {
  const { rentForMonth, sollIst } = await import("../js/core.js");
  const { vatFor } = await import("../js/recht.js");
  const c = { id: "c1", unitId: "u1", tenantIds: ["t1"], start: "2026-01-01", kalt: 100000, nk: 20000, extra: 0, ustRate: "19", steps: [] };
  const r = rentForMonth(c, "2026-11");
  assert.deepEqual([r.net, r.vat, r.total], [120000, 22800, 142800]);
  const s = emptyState(); s.units = [{ id: "u1", objectId: "o1", type: "gewerbe", name: "Laden" }]; s.contracts = [c]; s.tenants = [{ id: "t1", name: "Firma Müller GmbH", ibans: [] }];
  assert.equal(vatFor(s, c).vat, 19);
  assert.equal(sollIst(s, "2026-11", "2026-11")[0].soll, 142800);
  // Bank erkennt den Bruttobetrag
  const sug = suggestAssignment({ id: "x", date: "2026-11-02", amount: 142800, name: "Firma Müller GmbH", purpose: "Miete November", iban: "" }, s);
  assert.equal(sug.contractId, "c1");
  // ohne USt unverändert
  assert.equal(rentForMonth({ ...c, ustRate: "" }, "2026-11").total, 120000);
});

test("Vergangene Monate nachtragen: nur fehlende Beträge", async () => {
  const { backfillPayments } = await import("../js/core.js");
  const s = emptyState();
  s.contracts = [{ id: "c1", unitId: "u1", tenantIds: ["t1"], start: "2026-09-15", kalt: 50000, nk: 10000, extra: 0, steps: [] }];
  s.payments = [{ id: "p1", kind: "miete", contractId: "c1", period: "2026-10", amount: 20000, date: "2026-10-03" }];
  const ps = backfillPayments(s, { from: "2026-08", to: "2026-10", contractIds: ["c1"], day: 3 });
  // August: vor Mietbeginn → nichts; September: volle Miete (Datum = Mietbeginn); Oktober: Rest 400 €
  assert.deepEqual(ps.map((p) => [p.period, p.amount, p.date]), [["2026-09", 60000, "2026-09-15"], ["2026-10", 40000, "2026-10-03"]]);
  assert.equal(backfillPayments(s, { from: "2026-10", to: "2026-09", contractIds: ["c1"] }).length, 0);
});

test("USt-IdNr. ausländischer Firmen: Format prüfen", async () => {
  const { vatIdFormatOk, normVatId } = await import("../js/core.js");
  assert.equal(normVatId("nl 1234.56789 b01"), "NL123456789B01");
  assert.equal(vatIdFormatOk("NL123456789B01"), true);
  assert.equal(vatIdFormatOk("ATU12345678"), true);
  assert.equal(vatIdFormatOk("PL 123-456-78-90"), true);
  assert.equal(vatIdFormatOk("DE12345"), false);
  assert.equal(vatIdFormatOk("GB123456789"), null);
});

test("Angemietete Ferienwohnung: keine AfA, Miete an Vermieter als Ausgabe, Bank erkennt Zahlung", async () => {
  const { backfillLeaseExpenses, afaForYear } = await import("../js/core.js");
  const s = emptyState();
  s.objects = [{ id: "o1", name: "Drensteinfurt Herrenstein 28a", ownership: "angemietet", landlordName: "Heinz Vermieter", leaseRent: 95000, leaseStart: "2026-03-01", buildingShare: 10000000, afaRate: 2, purchaseDate: "2020-01-01" }];
  assert.equal(afaForYear(s.objects[0], 2026), 0);
  const ex = backfillLeaseExpenses(s, "o1", { from: "2026-01", to: "2026-05" });
  assert.deepEqual(ex.map((e) => e.date), ["2026-03-01", "2026-04-01", "2026-05-01"]);
  s.expenses = ex;
  assert.equal(backfillLeaseExpenses(s, "o1", { from: "2026-01", to: "2026-05" }).length, 0);
  const sug = suggestAssignment({ id: "t", date: "2026-06-01", amount: -95000, name: "Heinz Vermieter", purpose: "Miete Juni Herrenstein", iban: "" }, s);
  assert.equal(sug.category, "anmietung"); assert.equal(sug.objectId, "o1");
  const { anlageV } = await import("../js/core.js");
  const r = anlageV(s, 2026).find((x) => x.objectId === "o1");
  assert.equal(r.angemietet, true); assert.equal(r.costs.afa, 0); assert.equal(r.costs.sonstige, 285000);
});
