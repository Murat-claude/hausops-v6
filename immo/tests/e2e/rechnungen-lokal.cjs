// Test im lokalen Modus: Rechnungen für Portal-Buchungen (Smoobu), Firma als Empfänger, PDF, E-Mail
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:8888/immo/';
const out = process.env.E2E_OUT || require('os').tmpdir();
const R = []; const ok = (n, c, i = '') => R.push(`${c ? '✅' : '❌'} ${n}${i ? ' – ' + i : ''}`);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, acceptDownloads: true });
  await ctx.route('**/.netlify/functions/immo-config', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' })); // lokaler Modus
  const mails = []; let mailMode = 'ok';
  await ctx.route('**/.netlify/functions/smoobu-sync*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, buchungen: [
    { smoobu_id: 901, einheit_name: 'FeWo Strandblick', gast_name: 'Jan de Vries', personen: 2, erwachsene: 2, kinder: 0, start_datum: '2026-10-20', end_datum: '2026-10-25', preis: 640, status: 'confirmed', kanal: 'Booking.com', email: 'jdevri.123@guest.booking.com', telefon: '+31 6 1234', adresse: { street: 'Keizersgracht 12', postalCode: '1015 CS', location: 'Amsterdam', country: 'NL' }, referenz: '4711223344', firma: '' },
    { smoobu_id: 902, einheit_name: 'FeWo Strandblick', gast_name: 'Lisa Airbnb', erwachsene: 1, start_datum: '2026-11-01', end_datum: '2026-11-03', preis: 210, status: 'confirmed', kanal: 'Airbnb', email: '', adresse: null, referenz: 'HMABC' }] }) }));
  await ctx.route('**/.netlify/functions/immo-mail', async (r) => {
    const body = JSON.parse(r.request().postData()); mails.push(body);
    if (mailMode === 'off') return r.fulfill({ status: 501, contentType: 'application/json', body: JSON.stringify({ success: false, notConfigured: true, error: 'E-Mail-Versand ist noch nicht eingerichtet.' }) });
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, id: 'm1' }) });
  });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('dialog', (d) => { errs.push('dialog: ' + d.message().slice(0, 120)); d.accept(); });
  await p.goto(BASE); await p.waitForTimeout(500);
  await p.click('text=Demo-Daten ansehen'); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('[data-act=smoobu]')?.click());
  await p.goto(BASE + '#/ferien'); await p.waitForTimeout(300);
  const sm = await p.$('[data-act=smoobu]'); if (sm) { await sm.click(); } else { await p.evaluate(() => { const b = document.createElement('button'); b.dataset.act = 'smoobu'; document.body.append(b); b.click(); }); }
  await p.waitForTimeout(800);
  await p.goto(BASE + '#/rechnungen'); await p.waitForTimeout(400);
  await p.screenshot({ path: out + '/150-ohne-rechnung.png', fullPage: true });
  ok('Smoobu-Buchungen ohne Rechnung gelistet', (await p.locator('.card').first().innerText()).includes('Jan de Vries'));
  // Rechnung aus Booking.com-Buchung
  await p.click('tr:has-text("Jan de Vries") button[data-act=invoiceFromBooking]'); await p.waitForTimeout(400);
  await p.click('button[data-act=invoiceRecipient]'); await p.waitForTimeout(200);
  await p.fill('#modal input[name=rcompany]', 'Muster Consulting GmbH');
  await p.fill('#modal input[name=rstreet]', 'Industriestraße 5'); await p.fill('#modal input[name=rzip]', '20095'); await p.fill('#modal input[name=rcity]', 'Hamburg'); await p.fill('#modal input[name=rcountry]', '');
  await p.fill('#modal input[name=rvat]', 'DE123456789'); await p.fill('#modal input[name=remail]', 'buchhaltung@muster.de');
  await p.screenshot({ path: out + '/151-empfaenger-firma.png' });
  await p.click('#modal button[type=submit]'); await p.waitForTimeout(300);
  ok('Firma als Empfänger, Gast z. Hd.', (await p.locator('.paper .top').innerText()).includes('z. Hd. Jan de Vries'));
  // Vorschau-PDF
  let [dl] = await Promise.all([p.waitForEvent('download'), p.click('button[data-act=invoicePdf]')]);
  await dl.saveAs(out + '/entwurf.pdf'); ok('Vorschau-PDF', dl.suggestedFilename().includes('Entwurf'));
  // Festschreiben
  await p.click('button[data-act=finalizeInvoice]'); await p.waitForTimeout(1200);
  await p.screenshot({ path: out + '/152-festgeschrieben.png', fullPage: true });
  ok('PDF beim Festschreiben abgelegt', (await p.locator('.note.small').first().innerText()).includes('PDF abgelegt'));
  [dl] = await Promise.all([p.waitForEvent('download'), p.click('button[data-act=invoicePdf]')]);
  await dl.saveAs(out + '/rechnung.pdf'); ok('PDF-Datei gültig', require('fs').readFileSync(out + '/rechnung.pdf').slice(0, 5).toString() === '%PDF-');
  // E-Mail
  await p.click('button[data-act=emailInvoice]'); await p.waitForTimeout(300);
  await p.screenshot({ path: out + '/153-email.png' });
  ok('E-Mail an Buchhaltung vorausgefüllt', (await p.inputValue('#modal input[name=to]')) === 'buchhaltung@muster.de');
  await p.click('#modal button[type=submit]'); await p.waitForTimeout(1200);
  const m = mails[0]; ok('Mail mit PDF-Anhang gesendet', m && m.attachment.filename.endsWith('.pdf') && m.attachment.content.length > 1000);
  // Empfänger nach Festschreiben ändern → Storno + neu
  await p.click('button[data-act=invoiceRecipient]'); await p.waitForTimeout(200);
  await p.fill('#modal input[name=rcompany]', 'Muster Consulting AG'); await p.click('#modal button[type=submit]'); await p.waitForTimeout(1500);
  ok('Empfänger nach Festschreiben geändert (Storno + neu)', (await p.locator('.note.small').first().innerText()).includes('Ersetzt Rechnung'));
  await p.goto(BASE + '#/rechnungen'); await p.waitForTimeout(400);
  ok('Storno in der Liste', (await p.locator('.card').nth(1).innerText()).includes('Storno'));
  // Dokumente
  await p.goto(BASE + '#/dokumente'); await p.waitForTimeout(400);
  await p.click('.tabs button[data-id=ausgangsrechnung]').catch(() => {}); await p.waitForTimeout(300);
  await p.screenshot({ path: out + '/154-ordner.png', fullPage: true });
  ok('3 PDFs im Ordner Ausgangsrechnungen', (await p.evaluate(() => JSON.parse(localStorage.getItem('hausops-immo-v1')).documents.filter((d) => d.kind === 'ausgangsrechnung').length)) === 3);
  // Ohne Mailserver → Fallback
  mailMode = 'off';
  const st = await p.evaluate(() => JSON.parse(localStorage.getItem('hausops-immo-v1')).invoices.filter((i) => i.status === 'offen').map((i) => i.id));
  await p.goto(BASE + '#/rechnung/' + st[0]); await p.waitForTimeout(400);
  await p.click('button[data-act=emailInvoice]'); await p.waitForTimeout(200);
  const dlp = p.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  await p.click('#modal button[type=submit]'); const d2 = await dlp; await p.waitForTimeout(800);
  ok('Ohne Mailserver: PDF-Download + Mail-Programm', !!d2);
  // Mobil
  const pm = await ctx.newPage(); await pm.setViewportSize({ width: 390, height: 844 });
  await pm.goto(BASE + '#/rechnung/' + st[0]); await pm.waitForTimeout(600);
  await pm.screenshot({ path: out + '/155-mobil.png' });
  ok('Keine Skriptfehler', !errs.some((e) => e.startsWith('pageerror')));
  console.log(R.join('\n'));
  const failed = R.filter((x) => x.startsWith('❌')).length; console.log(failed ? `${failed} FEHLGESCHLAGEN` : 'ALLE BESTANDEN'); await b.close(); process.exit(failed ? 1 : 0);
})();
