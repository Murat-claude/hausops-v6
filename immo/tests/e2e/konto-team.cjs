// Echt-Test: Registrierung, Cloud-Speicherung, Belege, Team, Zusammenführen, Nur-Lesen, Admin, Kündigung, Konto löschen
// Echt-Test gegen lokale Supabase (Auth, Datenbank, Storage) + Netlify-Funktionen
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8888/immo/';
const out = process.env.E2E_OUT || require('os').tmpdir();
const R = []; const ok = (name, cond, info = '') => { R.push(`${cond ? '✅' : '❌'} ${name}${info ? ' – ' + info : ''}`); };
async function mk(b, w = 1300) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage(); p.errs = [];
  p.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) p.errs.push('HTTP ' + r.status() + ' ' + r.request().method() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 120)); });
  p.on('pageerror', (e) => p.errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) p.errs.push('console: ' + m.text().slice(0, 160)); });
  p.on('dialog', (d) => { p.errs.push('dialog: ' + d.message().slice(0, 100)); d.accept(d.type() === 'prompt' ? (p.promptAnswer || '') : undefined); });
  return p;
}
async function register(p, name, email) {
  await p.click('.auth-box .tabs button[data-id=register]');
  await p.fill('input[name=fullName]', name); await p.fill('form[data-form=register] input[name=email]', email); await p.fill('form[data-form=register] input[name=password]', 'Geheim-1234!');
  await p.check('input[name=terms]'); await p.check('input[name=avv]');
  await p.click('form[data-form=register] button.primary'); await p.waitForTimeout(2500);
}
const viewText = (p) => p.locator('#view').innerText();
(async () => {
  const b = await chromium.launch();
  const stamp = Date.now().toString(36);
  const A = await mk(b);
  await A.goto(BASE); await A.waitForTimeout(1500);
  ok('Startseite zeigt Anmeldung', await A.locator('.auth-box').count() > 0);
  await register(A, 'Murat Test', `murat.${stamp}@example.de`);
  require('fs').writeFileSync(out + '/admin.txt', `murat.${stamp}@example.de`);
  ok('Registrierung + Anmeldung', (await A.locator('#foot').innerText()).includes('Murat'), (await A.locator('#foot').innerText()).replace(/\n/g, ' | ').slice(0, 80));
  ok('Erstes Konto ist Admin', (await A.locator('#nav').innerText()).includes('Admin'));
  // Demo laden → wird in echte DB gespeichert
  await A.evaluate(() => document.querySelector('[data-act=loadDemo]')?.click()); await A.waitForTimeout(3000);
  ok('Speichern in Cloud', (await A.locator('#sync').innerText()).includes('gespeichert'), await A.locator('#sync').innerText());
  // Neu laden → Daten kommen aus der Datenbank
  await A.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('hausops-immo-v1')).forEach((k) => localStorage.removeItem(k))); await A.reload(); await A.waitForTimeout(3000);
  await A.goto(BASE + '#/objekte'); await A.waitForTimeout(800);
  ok('Daten nach Neuladen aus Datenbank', (await viewText(A)).includes('Lindenstraße'));
  // Beleg hochladen (Storage)
  await A.goto(BASE + '#/dokumente'); await A.waitForTimeout(600);
  const fs = require('fs'); fs.writeFileSync(out + '/beleg.pdf', Buffer.from('%PDF-1.3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF'));
  const inp = await A.$('input[type=file][data-change=docUpload]');
  if (inp) { await inp.setInputFiles(out + '/beleg.pdf'); await A.waitForTimeout(2500); }
  ok('Beleg-Upload in Storage', !!inp && !A.errs.some((e) => /upload|storage/i.test(e)), inp ? '' : 'kein Upload-Feld');
  // Team: Einladung
  await A.goto(BASE + '#/konto'); await A.waitForTimeout(1500);
await A.click('button[data-act=teamInvite]'); await A.fill('#modal input[name=email]', `partnerin.${stamp}@example.de`); await A.click('#modal button[type=submit]'); await A.waitForTimeout(1500);
  const link = await A.inputValue('#modal input[readonly]').catch(() => '');
  ok('Einladungslink erstellt (echte DB)', /einladung\//.test(link));
  await A.click('#modal [data-dlg=cancel]').catch(() => {});
  const B = await mk(b);
  await B.goto(link.replace('http://localhost:8888', 'http://localhost:8888')); await B.waitForTimeout(1500);
  await register(B, 'Ayse Test', `partnerin.${stamp}@example.de`); await B.waitForTimeout(1500);
  await B.goto(BASE + '#/objekte'); await B.waitForTimeout(800);
  ok('Partnerin sieht gemeinsamen Bestand', (await viewText(B)).includes('Lindenstraße'));
  // Gleichzeitig ändern
  await B.click('button[data-act=newObject]'); await B.fill('#modal input[name=name]', 'Garage Ayse'); await B.click('#modal button[type=submit]'); await B.waitForTimeout(2500);
  await A.goto(BASE + '#/objekte'); await A.waitForTimeout(400);
  await A.click('button[data-act=newObject]'); await A.fill('#modal input[name=name]', 'Haus Murat'); await A.click('#modal button[type=submit]'); await A.waitForTimeout(4000);
  await A.reload(); await A.waitForTimeout(2500); await A.goto(BASE + '#/objekte'); await A.waitForTimeout(600);
  const t = await viewText(A);
  ok('Gleichzeitige Änderungen zusammengeführt', t.includes('Garage Ayse') && t.includes('Haus Murat'));
  // Beleg für Partnerin abrufbar (Storage-RLS für Mitglieder)
  const docOk = await B.evaluate(async () => { const st = JSON.parse(Object.entries(localStorage).find(([k]) => k.startsWith('hausops-immo-v1:'))[1]); return st.documents.length; });
  ok('Partnerin sieht Dokumente', docOk > 0, String(docOk));
  // Nur lesen
  await A.goto(BASE + '#/konto'); await A.waitForTimeout(1500);
  await A.selectOption('select[data-change=teamRole]', 'viewer'); await A.waitForTimeout(1000);
  await B.reload(); await B.waitForTimeout(2500); await B.goto(BASE + '#/objekte'); await B.waitForTimeout(500);
  await B.click('button[data-act=newObject]'); await B.fill('#modal input[name=name]', 'Darf nicht'); await B.click('#modal button[type=submit]'); await B.waitForTimeout(1500);
  await A.reload(); await A.waitForTimeout(2500); await A.goto(BASE + '#/objekte'); await A.waitForTimeout(500);
  ok('Nur-Lesen wird von der Datenbank durchgesetzt', !(await viewText(A)).includes('Darf nicht'));
  // Admin
  await A.goto(BASE + '#/admin'); await A.waitForTimeout(2000);
  ok('Admin-Übersicht lädt', (await viewText(A)).includes('Nutzer gesamt'));
  // Kündigungsbutton (Funktion mit echter DB)
  const C = await mk(b); await C.goto(BASE + '#/kuendigen'); await C.waitForTimeout(1200);
  await C.fill('form[data-form=cancel] input[name=name]', 'Test Kunde'); await C.fill('form[data-form=cancel] input[name=email]', `kunde.${stamp}@example.de`);
  await C.click('form[data-form=cancel] button'); await C.waitForTimeout(2000);
  ok('Kündigung ohne Anmeldung gespeichert', (await C.locator('#view').innerText()).includes('eingegangen'));
  // iCal-Export-Feed (Funktion liest echte DB)
  // Konto löschen (Partnerin) über immo-admin
  B.promptAnswer = 'LÖSCHEN';
  await B.goto(BASE + '#/konto'); await B.waitForTimeout(1500);
  await B.click('button[data-act=deleteSelf]'); await B.waitForTimeout(3000);
  ok('Konto löschen (Funktion + Kaskade)', B.errs.some((e) => e.includes('wurde gelöscht')), B.errs.filter((e) => e.startsWith('dialog')).slice(-1)[0] || '');
  await A.screenshot({ path: out + '/160-real-admin.png' });
  console.log(R.join('\n'));
  console.log('A errs', JSON.stringify(A.errs.filter((e) => !e.startsWith('dialog'))));
  console.log('B errs', JSON.stringify(B.errs));

  const failed = R.filter((x) => x.startsWith('❌')).length; console.log(failed ? `${failed} FEHLGESCHLAGEN` : 'ALLE BESTANDEN'); await b.close(); process.exit(failed ? 1 : 0);
})();
