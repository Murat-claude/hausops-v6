// Rundgang im lokalen Modus mit Demo-Daten: jede Seite öffnen (Desktop + Handy), keine Skriptfehler, keine Fehlerseite
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8888/immo/';
const ROUTES = ['', 'objekte', 'mieter', 'mieten', 'nebenkosten', 'nkassistent', 'instand', 'portal', 'briefe', 'bank', 'ausgaben', 'dokumente', 'ferien', 'rechnungen', 'erklaerung', 'steuer', 'ki', 'einstellungen', 'suche', 'paket/2026', 'bericht/2026'];
(async () => {
  const b = await chromium.launch(); const R = [];
  for (const [w, h] of [[1300, 900], [390, 844]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    await ctx.route('**/.netlify/functions/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('dialog', (d) => d.accept());
    await p.goto(BASE); await p.waitForTimeout(600);
    await p.click('text=Demo-Daten ansehen'); await p.waitForTimeout(300);
    const st = await p.evaluate(() => JSON.parse(localStorage.getItem('hausops-immo-v1')));
    const extra = [`mieter/${st.tenants[0].id}`, `rechnung/${st.invoices[0]?.id || ''}`];
    for (const r of [...ROUTES, ...extra]) {
      await p.goto(BASE + '#/' + r); await p.waitForTimeout(350);
      const t = await p.locator('#view').innerText();
      const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
      const bad = t.includes('Fehler in dieser Ansicht') || errs.length || (w < 500 && wide && !['steuer', 'bericht/2026', 'paket/2026'].includes(r));
      R.push(`${bad ? '❌' : '✅'} ${w < 500 ? 'Handy' : 'Desktop'} #/${r}${errs.length ? ' – ' + errs.join(' | ') : ''}${wide && w < 500 ? ' (seitlich scrollbar)' : ''}`);
      errs.length = 0;
    }
    await ctx.close();
  }
  console.log(R.filter((x) => x.startsWith('❌')).join('\n') || `alle ${R.length} Seitenaufrufe ohne Fehler`);
  const failed = R.filter((x) => x.startsWith('❌')).length; console.log(failed ? `${failed} FEHLGESCHLAGEN` : 'ALLE BESTANDEN'); await b.close(); process.exit(failed ? 1 : 0);
})();
