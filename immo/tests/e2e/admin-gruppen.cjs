// Echt-Test: Admin verwaltet Vermieter-Gruppen (braucht den Admin aus konto-team.cjs)
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8888/immo/';
const out = process.env.E2E_OUT || require('os').tmpdir();
const ADMIN = process.env.ADMIN_EMAIL || require('fs').readFileSync(out + '/admin.txt', 'utf8').trim();
const R = []; const ok = (n, c, i = '') => R.push(`${c ? '✅' : '❌'} ${n}${i ? ' – ' + i : ''}`);
async function mk(b) { const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } }); const p = await ctx.newPage(); p.errs = []; p.prompts = [];
  p.on('pageerror', (e) => p.errs.push(e.message)); p.on('dialog', (d) => { if (d.type() === 'prompt') p.prompts.push(d.defaultValue()); else p.errs.push('dialog: ' + d.message().slice(0, 90)); d.accept(); }); return p; }
async function register(p, name, email) { await p.goto(BASE); await p.waitForTimeout(1200); await p.click('.auth-box .tabs button[data-id=register]'); await p.fill('input[name=fullName]', name); await p.fill('form[data-form=register] input[name=email]', email); await p.fill('form[data-form=register] input[name=password]', 'Geheim-1234!'); await p.check('input[name=terms]'); await p.check('input[name=avv]'); await p.click('form[data-form=register] button.primary'); await p.waitForTimeout(2500); }
(async () => {
  const b = await chromium.launch(); const s = Date.now().toString(36);
  const K = await mk(b); await register(K, 'Erika Vermieterin', `erika.${s}@example.de`);
  const M = await mk(b); await register(M, 'Hans Ehemann', `hans.${s}@example.de`);
  const A = await mk(b); await A.goto(BASE); await A.waitForTimeout(1200);
  await A.fill('form[data-form=login] input[name=email]', ADMIN); await A.fill('form[data-form=login] input[name=password]', 'Geheim-1234!'); await A.click('form[data-form=login] button.primary'); await A.waitForTimeout(2500);
  await A.goto(BASE + '#/admin'); await A.waitForTimeout(2000);
  await A.click('.tabs button[data-id=gruppen]'); await A.waitForTimeout(300);
  const optVal = await A.evaluate((e) => [...document.querySelectorAll('#adminGroupOwner option')].find((o) => o.textContent.includes(e))?.value, `erika.${s}`);
  await A.selectOption('#adminGroupOwner', optVal); await A.click('button[data-act=adminGroupNew]'); await A.waitForTimeout(300);
  await A.fill('#modal input[name=email]', `hans.${s}@example.de`); await A.click('#modal button[type=submit]'); await A.waitForTimeout(2500);
  ok('Admin fügt vorhandenes Konto zur Gruppe hinzu', (await A.locator('#view').innerText()).includes('Hans Ehemann'));
  await A.click('button[data-act=adminGroupAdd]'); await A.fill('#modal input[name=email]', `tochter.${s}@example.de`); await A.selectOption('#modal select[name=role]', 'viewer'); await A.click('#modal button[type=submit]'); await A.waitForTimeout(2500);
  ok('Neue Person → Einladungslink', /einladung\//.test(A.prompts[0] || ''), A.prompts[0]);
  await A.click('button[data-act=adminGroupAdd]'); await A.fill('#modal input[name=email]', ADMIN); await A.click('#modal button[type=submit]'); await A.waitForTimeout(1500);
  ok('Admin-Konto wird abgewiesen (Datenschutz)', A.errs.some((e) => e.includes('Admin-Konten')));
  await A.screenshot({ path: out + '/admin-gruppen.png', fullPage: true });
  // Hans sieht Erikas Bestand nach Neuladen
  await M.reload(); await M.waitForTimeout(2500);
  ok('Mitglied kann Bestand wechseln', await M.locator('#wssel').count() === 1);
  await A.selectOption('select[data-change=adminMemberRole]', 'viewer'); await A.waitForTimeout(1500);
  await A.click('button[data-act=adminGroupRemove]'); await A.waitForTimeout(2000);
  await M.reload(); await M.waitForTimeout(2500);
  ok('Entfernt → kein Zugriff mehr', await M.locator('#wssel').count() === 0);
  await A.click('.tabs button[data-id=protokoll]'); await A.waitForTimeout(300);
  ok('Protokoll', (await A.locator('#view').innerText()).includes('group_add_member'));
  console.log(R.join('\n'));
  const failed = R.filter((x) => x.startsWith('❌')).length; console.log(failed ? `${failed} FEHLGESCHLAGEN` : 'ALLE BESTANDEN'); await b.close(); process.exit(failed ? 1 : 0);
})();
