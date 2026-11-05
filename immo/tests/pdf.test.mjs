import { test } from "node:test";
import assert from "node:assert/strict";
import { invoicePdfBytes, pdfSafe } from "../js/pdf.js";

const model = {
  draft: false, title: "Rechnung RE-2026-7", author: "Murat", senderLine: "Murat · Weg 1 · 12345 Ort",
  recipient: ["Muster GmbH", "z. Hd. Anna Gast", "Industriestr. 5", "20095 Hamburg"], info: ["Murat", "Weg 1", "12345 Ort"],
  meta: [["Rechnungsnr.", "RE-2026-7"], ["Datum", "05.11.2026"]], intro: ["Unterkunft: FeWo Strandblick", "Gast: Anna Gast"],
  lines: Array.from({ length: 40 }, (_, i) => ({ pos: i + 1, desc: `Übernachtung Nacht ${i + 1} mit längerer Beschreibung, damit umbrochen wird – Größe`, sub: "", qty: "1", price: "95,00 €", vat: "7 %", total: "95,00 €" })),
  totals: [["Nettobetrag 7 %", "3.551,40 €"], ["zzgl. 7 % USt", "248,60 €"], ["Gesamtbetrag", "3.800,00 €", true]],
  paragraphs: ["Der Betrag wurde bereits über Booking.com bezahlt."], footer: [["Murat"], ["St.-Nr. 1"], ["IBAN DE00"]],
};

test("PDF-Rechnung: gültige Datei, mehrseitig bei vielen Positionen", () => {
  const bytes = invoicePdfBytes(model);
  const head = new TextDecoder().decode(bytes.slice(0, 8));
  assert.ok(head.startsWith("%PDF-1."));
  const txt = new TextDecoder("latin1").decode(bytes);
  assert.ok((txt.match(/\/Type \/Page\b/g) || []).length >= 2, "mehrere Seiten");
  assert.ok(bytes.length > 3000);
});

test("PDF-Zeichensatz: Umlaute/€ bleiben, Fremdzeichen werden umschrieben", () => {
  assert.equal(pdfSafe("Größe 12 € – „ok“"), "Größe 12 € – „ok“");
  assert.equal(pdfSafe("Łódź Dvořák"), "Lódz Dvorák"); // ó, á gibt es in Windows-1252
  assert.equal(pdfSafe("Иван"), "????");
});
