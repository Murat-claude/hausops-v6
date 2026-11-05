// Testserver wie Netlify: statische Dateien + Netlify-Funktionen, gegen lokale Supabase (ANON/SERVICE aus der Umgebung)
// Mini-Netlify: statische Dateien + /.netlify/functions/<name> (Handler wie in Netlify)
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');
const ROOT = require('path').resolve(__dirname, '../../..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.pdf': 'application/pdf' };
Object.assign(process.env, {
  IMMO_SUPABASE_URL: 'http://127.0.0.1:54321',
  IMMO_SUPABASE_ANON_KEY: process.env.ANON, IMMO_SUPABASE_SERVICE_ROLE_KEY: process.env.SERVICE,
  IMMO_PUBLIC_URL: 'http://localhost:8888',
});
http.createServer(async (req, res) => {
  const u = url.parse(req.url, true);
  if (u.pathname.startsWith('/.netlify/functions/')) {
    const name = u.pathname.split('/')[3];
    const file = path.join(ROOT, 'netlify/functions', name + '.js');
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('{}'); }
    let body = ''; for await (const c of req) body += c;
    try {
      const h = require(file).handler;
      const out = await h({ httpMethod: req.method, headers: req.headers, body, queryStringParameters: u.query, path: u.pathname, rawUrl: 'http://localhost:8888' + req.url });
      res.writeHead(out.statusCode || 200, out.headers || {}); res.end(out.isBase64Encoded ? Buffer.from(out.body, 'base64') : out.body);
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ success: false, error: 'shim: ' + e.message })); }
    return;
  }
  let p = path.join(ROOT, decodeURIComponent(u.pathname));
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
}).listen(Number(process.env.PORT || 8888), () => console.log('Testserver läuft auf ' + (process.env.PORT || 8888)));
