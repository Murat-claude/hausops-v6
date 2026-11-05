// Echt-Test: Mieterportal (Einladung, Schadensmeldung mit Foto, Zählerstand, Dokumente, Antwort, Entzug)
// Mieterportal – Echt-Test gegen lokale Supabase
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:8888/immo/';
const out = process.env.E2E_OUT || require('os').tmpdir();
const R = []; const ok = (n, c, i = '') => R.push(`${c ? '✅' : '❌'} ${n}${i ? ' – ' + i : ''}`);
async function mk(b, w = 1300, h = 900) { const ctx = await b.newContext({ viewport: { width: w, height: h } }); const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', (e) => p.errs.push('pageerror: ' + e.message)); p.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) p.errs.push('HTTP ' + r.status() + ' ' + r.request().method() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 100)); });
  p.on('dialog', (d) => { p.errs.push('dialog: ' + d.message().slice(0, 90)); d.accept(); }); return p; }
(async () => {
  const b = await chromium.launch(); const s = Date.now().toString(36);
  fs.writeFileSync(out + '/heizung.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  fs.writeFileSync(out + '/nk.pdf', Buffer.from('%PDF-1.3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF'));
  // Vermieter
  const V = await mk(b); await V.goto(BASE); await V.waitForTimeout(1200);
  await V.click('.auth-box .tabs button[data-id=register]'); await V.fill('input[name=fullName]', 'Vera Vermieter'); await V.fill('form[data-form=register] input[name=email]', `vera.${s}@example.de`); await V.fill('form[data-form=register] input[name=password]', 'Geheim-1234!'); await V.check('input[name=terms]'); await V.check('input[name=avv]'); await V.click('form[data-form=register] button.primary'); await V.waitForTimeout(2500);
  await V.evaluate(() => document.querySelector('[data-act=loadDemo]')?.click()); await V.waitForTimeout(2500);
  const st = await V.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k.startsWith('hausops-immo-v1:'))[1]));
  const anna = st.tenants.find((t) => t.name.includes('Anna'));
  await V.goto(BASE + '#/mieter/' + anna.id); await V.waitForTimeout(1500);
  ok('Portal-Karte in der Mieterakte', (await V.locator('#view').innerText()).includes('Mieterportal'));
  await V.click('button[data-act=portalInvite]'); await V.waitForTimeout(200);
  await V.fill('#modal input[name=email]', `anna.${s}@example.de`); await V.fill('#modal textarea[name=emergency]', 'Hausmeister Müller 0171 1234567');
  await V.click('#modal button[type=submit]'); await V.waitForTimeout(2500);
  const txt = await V.inputValue('#modal textarea[name=text]').catch(() => '');
  const link = (txt.match(/http\S+mieterportal\/\S+/) || [])[0];
  ok('Einladung mit Link', !!link, link);
  await V.click('#modal [data-dlg=cancel]').catch(() => {});
  // Dokument in die Mieterakte legen und teilen
  await V.evaluate(() => document.querySelector('.tabs button[data-id=dokumente]')?.click()); await V.waitForTimeout(300);
  const up = await V.$('input[data-change=folderUpload]:not([data-scan])');
  await up.setInputFiles(out + '/nk.pdf'); await V.waitForTimeout(2500);
  await V.click('button[data-act=portalShareDoc]'); await V.waitForTimeout(2500);
  ok('Dokument geteilt', (await V.locator('#view').innerText()).includes('geteilt'));
  // Mieterin: Link öffnen, Zugang anlegen (Handy)
  const M = await mk(b, 390, 844);
  await M.goto(link); await M.waitForTimeout(1500);
  ok('Einladungsseite mit Vermietername', (await M.locator('#view').innerText()).includes('Vera Vermieter'));
  await M.screenshot({ path: out + '/180-portal-einladung.png' });
  await M.fill('form[data-form=tenantRegister] input[name=fullName]', 'Anna Schmidt'); await M.fill('form[data-form=tenantRegister] input[name=email]', `anna.${s}@example.de`); await M.fill('form[data-form=tenantRegister] input[name=password]', 'Mieter-1234!'); await M.check('input[name=privacy]');
  await M.click('form[data-form=tenantRegister] button.primary'); await M.waitForTimeout(3500);
  const mt = await M.locator('#view').innerText();
  ok('Mieterin sieht ihr Portal', mt.includes('Hallo Anna') && mt.includes('WE 01'), mt.slice(0, 120).replace(/\n/g, ' | '));
  ok('Miete + Notfallkontakt sichtbar', mt.includes('900,00') && mt.includes('Hausmeister Müller'));
  ok('Geteiltes Dokument sichtbar', mt.includes('nk.pdf'));
  ok('Willkommensnachricht', mt.includes('Willkommen im Mieterportal'));
  ok('Kein Zugriff auf Bestand (kein Menü)', !(await M.locator('#nav').isVisible().catch(() => false)) && !mt.includes('Lindenstraße 12, 10115 Berlin · Mehrfamilienhaus'));
  await M.screenshot({ path: out + '/181-portal-mieter.png', fullPage: true });
  // Schaden melden mit Foto
  await M.click('button[data-act=tpReport]'); await M.waitForTimeout(200);
  await M.fill('#modal input[name=title]', 'Heizung im Bad bleibt kalt'); await M.selectOption('#modal select[name=room]', 'Bad'); await M.fill('#modal textarea[name=body]', 'Seit Montag. Bin ab 17 Uhr zu Hause.'); await M.check('#modal input[name=urgent]');
  await M.setInputFiles('#modal input[name=photos]', out + '/heizung.png');
  await M.click('#modal button[type=submit]'); await M.waitForTimeout(3500);
  ok('Schadensmeldung gesendet', (await M.locator('#view').innerText()).includes('Heizung im Bad bleibt kalt'));
  // Zählerstand
  await M.click('button[data-act=tpMeter]'); await M.waitForTimeout(200);
  await M.fill('#modal input[name=value]', '345,6'); await M.click('#modal button[type=submit]'); await M.waitForTimeout(2500);
  // Dokument öffnen
  const [pop] = await Promise.all([M.context().waitForEvent('page', { timeout: 5000 }).catch(() => null), M.click('button[data-act=tpOpenDoc]')]);
  ok('Mieterin öffnet Dokument', !!pop || !M.errs.some((e) => /Dokument konnte/.test(e)));
  // Vermieter: Postfach
  await V.goto(BASE + '#/'); await V.waitForTimeout(500); await V.reload(); await V.waitForTimeout(3500);
  ok('Startseite meldet neue Portal-Meldungen', (await V.locator('#view').innerText()).includes('Mieterportal'));
  await V.goto(BASE + '#/portal'); await V.waitForTimeout(2500);
  const pt = await V.locator('#view').innerText();
  ok('Postfach zeigt Meldung + Zählerstand', pt.includes('Heizung im Bad bleibt kalt') && pt.includes('345,6'));
  await V.waitForTimeout(1500);
  ok('Foto im Postfach geladen', await V.evaluate(() => !!document.querySelector('img.pphoto')?.src));
  await V.screenshot({ path: out + '/182-portal-postfach.png', fullPage: true });
  await V.click('button[data-act=portalToMeter]'); await V.waitForTimeout(2500);
  const st2 = await V.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k.startsWith('hausops-immo-v1:'))[1]));
  ok('Zählerstand übernommen', st2.meterReadings.some((m) => m.value === 345.6 && m.reason === 'mieter'));
  await V.click('button[data-act=portalToRepair]'); await V.waitForTimeout(4000);
  const st3 = await V.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k.startsWith('hausops-immo-v1:'))[1]));
  const rep = st3.repairs.find((r) => r.title === 'Heizung im Bad bleibt kalt');
  ok('Reparatur mit Foto + dringend angelegt', rep && rep.docIds.length === 1 && rep.priority === 'dringend' && rep.reportedBy === 'mieter');
  // Reparatur erledigt → Mieterin sieht Status
  await V.selectOption('#modal select[name=status]', 'erledigt'); await V.click('#modal button[type=submit]'); await V.waitForTimeout(2500);
  await M.reload(); await M.waitForTimeout(3500);
  const mt2 = await M.locator('#view').innerText();
  ok('Mieterin sieht „erledigt“ + Nachricht', mt2.includes('erledigt') && mt2.includes('Erledigt: Heizung'));
  // Antwort vom Vermieter
  await V.goto(BASE + '#/portal'); await V.waitForTimeout(1500);
  await V.click('.tabs button[data-id=alle]'); await V.waitForTimeout(300);
  await V.click('button[data-act=portalReply] >> nth=0'); await V.fill('#modal textarea[name=body]', 'Danke, Handwerker kommt Donnerstag.'); await V.click('#modal button[type=submit]'); await V.waitForTimeout(2000);
  await M.reload(); await M.waitForTimeout(3000);
  ok('Antwort kommt bei Mieterin an', (await M.locator('#view').innerText()).includes('Handwerker kommt Donnerstag'));
  // Zugang entziehen
  await V.goto(BASE + '#/mieter/' + anna.id); await V.waitForTimeout(1500);
  await V.click('button[data-act=portalRevoke]'); await V.waitForTimeout(2000);
  await M.reload(); await M.waitForTimeout(3000);
  ok('Nach Entzug kein Zugang mehr', (await M.locator('#view').innerText()).includes('Noch kein Zugang'));
  console.log(R.join('\n'));
  console.log('V', JSON.stringify(V.errs.filter((e) => !e.startsWith('dialog')))); console.log('M', JSON.stringify(M.errs));

  const failed = R.filter((x) => x.startsWith('❌')).length; console.log(failed ? `${failed} FEHLGESCHLAGEN` : 'ALLE BESTANDEN'); await b.close(); process.exit(failed ? 1 : 0);
})();
