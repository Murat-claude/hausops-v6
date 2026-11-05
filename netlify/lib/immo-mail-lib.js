// HausOps Immobilien: Rechnungsversand per E-Mail (Resend) – Prüfung und Aufbau der Nachricht
const EMAIL = /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[^@\s<>"',;]+$/;
const MAX_PDF_BYTES = 4 * 1024 * 1024; // Netlify-Funktionen nehmen max. 6 MB Anfrage (Base64 ≈ +33 %)

// Absendername aus den Vermieterdaten, Adresse aus IMMO_MAIL_FROM (verifizierte Domain bei Resend)
function fromHeader(mailFrom, fromName) {
  const addr = (String(mailFrom).match(/<([^>]+)>/) || [null, String(mailFrom).trim()])[1];
  const name = String(fromName || "").replace(/[\r\n"<>]/g, "").trim().slice(0, 80);
  return name ? `"${name}" <${addr}>` : String(mailFrom);
}

function buildMail(body, { mailFrom }) {
  const b = body || {};
  const to = String(b.to || "").trim();
  if (!EMAIL.test(to)) throw Object.assign(new Error("Ungültige Empfängeradresse."), { status: 400 });
  const bcc = String(b.bcc || "").trim();
  const replyTo = String(b.replyTo || "").trim();
  const subject = String(b.subject || "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  const text = String(b.text || "").slice(0, 20000);
  if (!subject) throw Object.assign(new Error("Betreff fehlt."), { status: 400 });
  const msg = { from: fromHeader(mailFrom, b.fromName), to: [to], subject, text };
  if (bcc && EMAIL.test(bcc)) msg.bcc = [bcc];
  if (replyTo && EMAIL.test(replyTo)) msg.reply_to = replyTo;
  if (b.attachment) {
    const content = String(b.attachment.content || "");
    if (!/^[A-Za-z0-9+/=\s]+$/.test(content)) throw Object.assign(new Error("Anhang ungültig."), { status: 400 });
    if (content.length * 0.75 > MAX_PDF_BYTES) throw Object.assign(new Error("Anhang zu groß (max. 4 MB)."), { status: 413 });
    const filename = String(b.attachment.filename || "Rechnung.pdf").replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 120);
    if (!/\.pdf$/i.test(filename)) throw Object.assign(new Error("Nur PDF-Anhänge erlaubt."), { status: 400 });
    msg.attachments = [{ filename, content: content.replace(/\s+/g, "") }];
  }
  return msg;
}

// Einfacher Schutz gegen Massenversand (je laufender Funktionsinstanz)
const sent = new Map();
function rateLimited(key, { max = 60, windowMs = 3600e3, now = Date.now() } = {}) {
  const list = (sent.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) { sent.set(key, list); return true; }
  list.push(now); sent.set(key, list);
  return false;
}

module.exports = { buildMail, fromHeader, rateLimited, MAX_PDF_BYTES };
