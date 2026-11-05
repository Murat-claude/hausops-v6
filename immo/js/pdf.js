// PDF-Rechnungen (echte, durchsuchbare PDF-Datei, A4 nach DIN 5008 – Anschriftfeld passt in Fensterumschläge)
// Erwartet ein fertig formatiertes „Modell“ (Texte, Beträge als Zeichenketten) – siehe invoiceModel() in app.js.
import { jsPDF } from "../vendor/jspdf.js";

// Standardschriften im PDF kennen nur den Windows-1252-Zeichensatz: andere Zeichen umschreiben (ł → l, Ж → ?)
const EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
export function pdfSafe(text) {
  return [...String(text ?? "")].map((ch) => {
    const c = ch.codePointAt(0);
    if (c === 10 || (c >= 32 && c <= 126) || (c >= 160 && c <= 255) || EXTRA.includes(ch)) return ch;
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (base && [...base].every((x) => x.codePointAt(0) < 256)) return base;
    return { "ł": "l", "Ł": "L", "đ": "d", "Đ": "D", "ı": "i", "ø": "ø", " ": " ", " ": " ", " ": " " }[ch] ?? "?";
  }).join("");
}

export function invoicePdfDoc(m) {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.setProperties({ title: pdfSafe(m.title), subject: pdfSafe(m.title), author: pdfSafe(m.author || ""), creator: "Homevio" });
  const L = 20, R = 190, BOTTOM = 258;
  const grey = [110, 110, 110], dark = [25, 25, 25];
  const font = (size, style = "normal", color = dark) => { doc.setFont("helvetica", style); doc.setFontSize(size); doc.setTextColor(...color); };
  const text = (t, x, y, opt) => doc.text(pdfSafe(t), x, y, opt);

  if (m.draft) { // Wasserzeichen
    font(70, "bold", [235, 235, 235]);
    text("ENTWURF", 105, 175, { align: "center", angle: 35 });
  }

  // Absenderzeile über dem Anschriftfeld + Anschrift (DIN 5008 Form B: Anschriftfeld ab 45 mm)
  font(7, "normal", grey);
  text(m.senderLine || "", L, 48);
  doc.setDrawColor(180); doc.setLineWidth(0.2); doc.line(L, 49.2, L + 85, 49.2);
  font(10.5);
  let y = 55;
  for (const line of m.recipient || []) { text(line, L, y); y += 5; }
  const recEnd = y;

  // Rechter Block: Absender + Rechnungsdaten
  let ry = 32;
  font(10, "bold"); text(m.info?.[0] || "", 125, ry); ry += 4.6;
  font(8.5, "normal", grey);
  for (const line of (m.info || []).slice(1)) { text(line, 125, ry); ry += 4.2; }
  ry += 3;
  for (const [k, v] of m.meta || []) {
    font(8.5, "normal", grey); text(k, 125, ry);
    font(8.5, "bold"); text(v, R, ry, { align: "right" });
    ry += 4.6;
  }
  y = Math.max(recEnd, ry) + 12;

  // Titel und Einleitung
  font(15, "bold"); text(m.title, L, y); y += 8;
  font(9.5);
  for (const line of m.intro || []) { for (const part of doc.splitTextToSize(pdfSafe(line), R - L)) { text(part, L, y); y += 4.8; } }
  y += 3;

  // Positionen
  const ku = !!m.kleinunternehmer;
  const col = ku ? { qty: 138, price: 164 } : { qty: 128, price: 152, vat: 166 };
  const descW = (ku ? 112 : 100) - 10;
  const head = () => {
    doc.setFillColor(243, 244, 246); doc.rect(L, y - 4.5, R - L, 7, "F");
    font(8.5, "bold", grey);
    text("Pos.", L + 1, y); text("Beschreibung", L + 10, y);
    text("Menge", col.qty, y, { align: "right" }); text("Einzelpreis", col.price, y, { align: "right" });
    if (!ku) text("USt", col.vat, y, { align: "right" });
    text("Gesamt", R - 1, y, { align: "right" });
    y += 7;
  };
  const newPage = () => { doc.addPage(); y = 25; };
  head();
  for (const row of m.lines || []) {
    const desc = doc.splitTextToSize(pdfSafe(row.desc), descW);
    const h = desc.length * 4.6 + (row.sub ? 4 : 0) + 2.5;
    if (y + h > BOTTOM) { newPage(); head(); }
    font(9.5);
    text(String(row.pos), L + 1, y);
    desc.forEach((part, i) => text(part, L + 10, y + i * 4.6));
    text(row.qty, col.qty, y, { align: "right" }); text(row.price, col.price, y, { align: "right" });
    if (!ku) text(row.vat, col.vat, y, { align: "right" });
    text(row.total, R - 1, y, { align: "right" });
    if (row.sub) { font(7.5, "normal", grey); text(row.sub, L + 10, y + desc.length * 4.6 - 0.6); }
    y += h;
    doc.setDrawColor(225); doc.line(L, y - 3.2, R, y - 3.2);
  }

  // Summen
  y += 2;
  if (y + (m.totals || []).length * 5.5 > BOTTOM) newPage();
  for (const [k, v, bold] of m.totals || []) {
    if (bold) { doc.setDrawColor(60); doc.setLineWidth(0.4); doc.line(115, y - 3.8, R, y - 3.8); doc.setLineWidth(0.2); }
    font(bold ? 10.5 : 9.5, bold ? "bold" : "normal");
    text(k, 115, y); text(v, R - 1, y, { align: "right" });
    y += bold ? 6.5 : 5.2;
  }
  y += 6;

  // Hinweise
  font(9.5);
  for (const p of m.paragraphs || []) {
    for (const part of doc.splitTextToSize(pdfSafe(p), R - L)) {
      if (y > BOTTOM) newPage();
      text(part, L, y); y += 4.8;
    }
    y += 2.5;
  }

  // Fußzeile und Seitenzahlen auf jeder Seite
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(200); doc.line(L, 268, R, 268);
    font(7.5, "normal", grey);
    (m.footer || []).forEach((colLines, ci) => colLines.forEach((line, li) => text(line, L + ci * 60, 272 + li * 3.6)));
    if (pages > 1) text(`Seite ${i} von ${pages}`, R, 290, { align: "right" });
  }
  return doc;
}

export const invoicePdf = (m) => invoicePdfDoc(m).output("blob");
export const invoicePdfBytes = (m) => new Uint8Array(invoicePdfDoc(m).output("arraybuffer"));

// ---------------------------------------------------------------- Berichte (z. B. Monatsbericht für den Steuerberater), A4 quer
// model: { title, subtitle, author, summary: [[label, value, bold?]], sections: [{ heading, note?, cols: [{ label, w, align? }], rows: [[...]], total?: [...] }], footer }
export function reportPdfDoc(m) {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: true });
  doc.setProperties({ title: pdfSafe(m.title), author: pdfSafe(m.author || ""), creator: "Homevio" });
  const L = 14, R = 283, BOTTOM = 196;
  const grey = [110, 110, 110], dark = [25, 25, 25];
  const font = (size, style = "normal", color = dark) => { doc.setFont("helvetica", style); doc.setFontSize(size); doc.setTextColor(...color); };
  const text = (t, x, y, opt) => doc.text(pdfSafe(t), x, y, opt);
  let y = 18;
  font(16, "bold"); text(m.title, L, y); y += 6;
  font(9.5, "normal", grey); text(m.subtitle || "", L, y); y += 8;
  // Zusammenfassung in zwei Spalten
  if (m.summary?.length) {
    const half = Math.ceil(m.summary.length / 2);
    m.summary.forEach(([k, v, bold], i) => {
      const col = i < half ? 0 : 1, row = i < half ? i : i - half;
      const x = L + col * 135, yy = y + row * 5.4;
      font(9.5, bold ? "bold" : "normal"); text(k, x, yy); text(v, x + 120, yy, { align: "right" });
    });
    y += half * 5.4 + 6;
  }
  const newPage = () => { doc.addPage(); y = 16; };
  for (const s of m.sections || []) {
    if (y + 22 > BOTTOM) newPage();
    font(11.5, "bold"); text(s.heading, L, y); y += 5;
    if (s.note) { font(8, "normal", grey); for (const part of doc.splitTextToSize(pdfSafe(s.note), R - L)) { text(part, L, y); y += 3.8; } y += 1; }
    const total = s.cols.reduce((a, c) => a + c.w, 0), scale = (R - L) / total;
    const xs = []; let x = L; for (const c of s.cols) { xs.push(x); x += c.w * scale; }
    const head = () => {
      doc.setFillColor(31, 78, 95); doc.rect(L, y - 4, R - L, 6, "F");
      font(8, "bold", [255, 255, 255]);
      s.cols.forEach((c, i) => text(c.label, c.align === "right" ? xs[i] + c.w * scale - 1.5 : xs[i] + 1.5, y, { align: c.align === "right" ? "right" : "left" }));
      y += 5.5;
    };
    if (!s.rows.length) { font(8.5, "normal", grey); text("– keine Einträge –", L, y); y += 7; continue; }
    head();
    const drawRow = (row, bold) => {
      const cells = row.map((v, i) => doc.splitTextToSize(pdfSafe(v ?? ""), s.cols[i].w * scale - 3));
      const h = Math.max(...cells.map((c) => c.length)) * 3.8 + 1.6;
      if (y + h > BOTTOM) { newPage(); head(); }
      font(8.3, bold ? "bold" : "normal");
      cells.forEach((lines, i) => lines.forEach((ln, li) => text(ln, s.cols[i].align === "right" ? xs[i] + s.cols[i].w * scale - 1.5 : xs[i] + 1.5, y + li * 3.8, { align: s.cols[i].align === "right" ? "right" : "left" })));
      y += h; doc.setDrawColor(225); doc.line(L, y - 3, R, y - 3);
    };
    s.rows.forEach((r) => drawRow(r, false));
    if (s.total) drawRow(s.total, true);
    y += 5;
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) { doc.setPage(i); font(7.5, "normal", grey); text(m.footer || "", L, 204); text(`Seite ${i} von ${pages}`, R, 204, { align: "right" }); }
  return doc;
}
export const reportPdf = (m) => reportPdfDoc(m).output("blob");
export const reportPdfBytes = (m) => new Uint8Array(reportPdfDoc(m).output("arraybuffer"));
