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
