// Test im lokalen Modus: Reparaturen, Kleinreparaturklausel, Wartungsplan, Kosten
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8888/immo/';
const out = process.env.E2E_OUT || require('os').tmpdir();
const R = []; const ok = (n, c, i = '') => R.push(`${c ? '✅' : '❌'} ${n}${i ? ' – ' + i : ''}`);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx.route('**/.netlify/functions/immo-config', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' })); // lokaler Modus
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('dialog', (d) => { errs.push('dialog: ' + d.message().slice(0, 100)); d.accept(); });
  await p.goto(BASE + ''); await p.waitForTimeout(500);
  await p.click('text=Demo-Daten ansehen'); await p.waitForTimeout(300);
  // Kleinreparaturklausel am Vertrag von Anna Schmidt (WE 01)
  const st = await p.evaluate(() => JSON.parse(localStorage.getItem('hausops-immo-v1')));
  const we01 = st.units.find((u) => u.name.startsWith('WE 01')); const c = st.contracts.find((x) => x.unitId === we01.id);
  await p.evaluate(([cid]) => { const s = JSON.parse(localStorage.getItem('hausops-immo-v1')); const c = s.contracts.find((x) => x.id === cid); c.kleinRepCase = 10000; c.kleinRepYear = 40000; localStorage.setItem('hausops-immo-v1', JSON.stringify(s)); }, [c.id]);
  await p.reload(); await p.waitForTimeout(400);
  await p.goto(BASE + '#/instand'); await p.waitForTimeout(400);
  ok('Seite Reparaturen', (await p.locator('#view h1').innerText()).includes('Reparaturen'));
  // Neue Reparatur
  await p.click('.head button[data-act=editRepair]'); await p.waitForTimeout(200);
  await p.fill('#modal input[name=title]', 'Wasserhahn Küche tropft');
  await p.selectOption('#modal select[name=unitId]', we01.id);
  await p.fill('#modal input[name=cname]', 'Sanitär Becker'); await p.fill('#modal input[name=cemail]', 'info@becker.de'); await p.fill('#modal input[name=quote]', '85');
  await p.selectOption('#modal select[name=payer]', 'kleinreparatur');
  await p.click('#modal button[type=submit]'); await p.waitForTimeout(500);
  ok('Auftrag angelegt + Dialog offen', await p.locator('#modal[open]').count() === 1 && (await p.locator('#modal').innerText()).includes('Kleinreparatur'), (await p.locator('#modal .note').first().innerText().catch(() => '')).slice(0, 100));
  await p.screenshot({ path: out + '/170-reparatur.png' });
  // Foto
  require('fs').writeFileSync(out + '/foto.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  await p.setInputFiles('#modal input[data-change=repairUpload][accept="image/*,application/pdf"]', out + '/foto.png'); await p.waitForTimeout(1200);
  ok('Foto am Auftrag', (await p.locator('#modal .att').count()) >= 1);
  // Auftrag an Handwerker
  await p.click('#modal button[data-act=repairOrder]'); await p.waitForTimeout(300);
  const orderText = await p.inputValue('#modal textarea[name=text]');
  ok('Auftragstext mit Adresse und Mieter', orderText.includes('Lindenstraße') && orderText.includes('Anna Schmidt'), orderText.split('\n').slice(4, 8).join(' / '));
  await p.click('#modal button[type=submit]'); await p.waitForTimeout(300);
  // Rechnung erfassen
  await p.click('.todoitem'); await p.waitForTimeout(300);
  await p.click('#modal button[data-act=repairExpense]'); await p.waitForTimeout(300);
  await p.fill('#modal input[name=amount]', '92,50'); await p.click('#modal button[type=submit]'); await p.waitForTimeout(700);
  const st2 = await p.evaluate(() => JSON.parse(localStorage.getItem('hausops-immo-v1')));
  const r = st2.repairs[0];
  ok('Rechnung als Ausgabe verknüpft + erledigt', r.expenseIds.length === 1 && r.status === 'erledigt' && st2.expenses.find((e) => e.id === r.expenseIds[0]).category === 'erhaltung', `Status ${r.status}`);
  ok('Status beauftragt im Verlauf', r.log.some((l) => l.text.includes('Auftrag an')));
  // Wartungsplan
  if (await p.locator('#modal[open]').count()) await p.click('#modal [data-dlg=cancel]');
  await p.click('.tabs button[data-id=wartung]'); await p.waitForTimeout(200);
  await p.click('button[data-act=maintTemplates]'); await p.waitForTimeout(200); await p.click('#modal button[type=submit]'); await p.waitForTimeout(300);
  ok('Wartungen übernommen', (await p.locator('#view tbody tr').count()) === 3);
  await p.click('#view button[data-act=maintDone] >> nth=0'); await p.waitForTimeout(200);
  await p.fill('#modal input[name=amount]', '180'); await p.click('#modal button[type=submit]'); await p.waitForTimeout(400);
  const st3 = await p.evaluate(() => JSON.parse(localStorage.getItem('hausops-immo-v1')));
  const wexp = st3.expenses.find((e) => /Wartung/.test(e.note || ''));
  ok('Wartung erledigt → umlagefähige Ausgabe', !!wexp && !!wexp.betrkv, wexp && wexp.betrkv);
  await p.screenshot({ path: out + '/171-wartung.png', fullPage: true });
  await p.click('.tabs button[data-id=kosten]'); await p.waitForTimeout(200);
  ok('Kosten-Tab', (await p.locator('#view').innerText()).includes('92,50'));
  await p.screenshot({ path: out + '/172-kosten.png', fullPage: true });
  // Mangel aus Mieterakte übernehmen
  const t = st3.tenants.find((x) => x.name.includes('Yilmaz')) || st3.tenants[1];
  await p.goto(BASE + '#/mieter/' + t.id); await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('.tabs button[data-id=vorgaenge]')?.click()); await p.waitForTimeout(300);
  await p.evaluate(() => [...document.querySelectorAll('[data-act=newNote]')].find((x) => x.dataset.id.startsWith('mangel'))?.click()); await p.waitForTimeout(200);
  await p.fill('#modal input[name=title]', 'Schimmel im Bad'); await p.click('#modal button[type=submit]'); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('.tabs button[data-id=vorgaenge]')?.click()); await p.waitForTimeout(200);
  await p.click('.timeline >> nth=0'); await p.waitForTimeout(200);
  await p.click('#modal button[data-act=repairFromNote]'); await p.waitForTimeout(300);
  await p.click('#modal button[type=submit]'); await p.waitForTimeout(500);
  const st4 = await p.evaluate(() => JSON.parse(localStorage.getItem('hausops-immo-v1')));
  ok('Mangel → Reparaturauftrag', st4.repairs.some((x) => x.title === 'Schimmel im Bad' && x.reportedBy === 'mieter'));
  // Start-Seite
  await p.goto(BASE + '#/'); await p.waitForTimeout(400);
  ok('Startseite zeigt Reparatur/Wartung', /Reparatur|Wartung/.test(await p.locator('#view').innerText()));
  const pm = await ctx.newPage(); await pm.setViewportSize({ width: 390, height: 844 }); await pm.goto(BASE + '#/instand'); await pm.waitForTimeout(500); await pm.screenshot({ path: out + '/173-mobil.png' });
  console.log(R.join('\n'));
  const failed = R.filter((x) => x.startsWith('❌')).length; console.log(failed ? `${failed} FEHLGESCHLAGEN` : 'ALLE BESTANDEN'); await b.close(); process.exit(failed ? 1 : 0);
})();
