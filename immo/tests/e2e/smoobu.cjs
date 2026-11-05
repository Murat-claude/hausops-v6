// Echt-Test Smoobu-Verbindung: Zugang je Konto, Status, Fremde bekommen nichts, Funktion prüft Rolle
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8888/immo/';
const R = []; const ok = (name, cond, info = '') => { R.push(`${cond ? '✅' : '❌'} ${name}${info ? ' – ' + info : ''}`); };
async function mk(b) {
  const p = await (await b.newContext({ viewport: { width: 1300, height: 900 } })).newPage(); p.errs = [];
  p.on('pageerror', (e) => p.errs.push(e.message)); p.on('dialog', (d) => { p.lastDialog = d.message(); d.accept(); });
  return p;
}
async function register(p, name, email) {
  await p.goto(BASE); await p.waitForTimeout(1500);
  await p.click('.auth-box .tabs button[data-id=register]');
  await p.fill('input[name=fullName]', name); await p.fill('form[data-form=register] input[name=email]', email); await p.fill('form[data-form=register] input[name=password]', 'Geheim-1234!');
  await p.check('input[name=terms]'); await p.check('input[name=avv]');
  await p.click('form[data-form=register] button.primary'); await p.waitForTimeout(2500);
}
const callSmoobu = (p, owner) => p.evaluate(async (owner) => {
  const s = await (await import('./js/cloud.js')).session();
  const res = await fetch('/.netlify/functions/immo-smoobu', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s?.access_token}` }, body: JSON.stringify({ owner }) });
  return { status: res.status, body: await res.json() };
}, owner);
const myId = (p) => p.evaluate(async () => (await (await import('./js/cloud.js')).session())?.user?.id);
(async () => {
  const b = await chromium.launch(); const stamp = Date.now().toString(36);
  const A = await mk(b); await register(A, 'Vera Smoobu', `vera.${stamp}@example.de`);
  await A.goto(BASE + '#/einstellungen'); await A.waitForTimeout(1500);
  ok('Einstellungen zeigen „Smoobu verbinden“', (await A.locator('#view').innerText()).includes('Smoobu verbinden'));
  const aId = await myId(A);
  let r = await callSmoobu(A, aId);
  ok('Ohne Zugang: Hinweis „nicht verbunden“', r.body.code === 'not_connected', r.status + ' ' + r.body.error);
  await A.click('[data-act=smoobuConnect]'); await A.waitForTimeout(400);
  await A.fill('#modal input[name=key]', 'TESTKEY-9876'); await A.fill('#modal input[name=secret]', 'TESTSECRET');
  await A.click('#modal button[type=submit]'); await A.waitForTimeout(6000);
  ok('Verbinden: Fehlermeldung von Smoobu statt Absturz (Testschlüssel)', /Smoobu/.test(A.lastDialog || ''), (A.lastDialog || '').slice(0, 90));
  await A.goto(BASE + '#/einstellungen'); await A.reload(); await A.waitForTimeout(2500);
  ok('Status „verbunden“ mit Schlüssel-Ende', (await A.locator('#view').innerText()).includes('…9876'));
  const leaked = await A.evaluate(() => document.documentElement.innerHTML.includes('TESTSECRET') || JSON.stringify(localStorage).includes('TESTSECRET'));
  ok('Secret nicht in der App sichtbar', !leaked);
  // Fremdes Konto
  const X = await mk(b); await register(X, 'Fremd', `fremd.${stamp}@example.de`);
  r = await callSmoobu(X, aId);
  ok('Fremdes Konto bekommt keinen Zugriff', r.status === 403, String(r.status));
  const st = await X.evaluate(async (owner) => { const m = await import('./js/cloud.js'); return m.smoobuStatus(owner).catch((e) => 'err:' + e.message); }, aId);
  ok('Fremdes Konto sieht keinen Status', st === null, JSON.stringify(st));
  // Trennen
  await A.click('[data-act=smoobuDisconnect]'); await A.waitForTimeout(1500);
  r = await callSmoobu(A, aId);
  ok('Trennen entfernt Zugang', r.body.code === 'not_connected');
  ok('Keine JS-Fehler', !A.errs.length && !X.errs.length, [...A.errs, ...X.errs].join(' | ').slice(0, 200));
  console.log(R.join('\n')); await b.close();
  process.exit(R.some((x) => x.startsWith('❌')) ? 1 : 0);
})();
