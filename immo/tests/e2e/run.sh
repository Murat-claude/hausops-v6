#!/usr/bin/env bash
# Komplett-Test: echte Supabase (lokal in Docker) + Netlify-Funktionen + Browser (Playwright)
# Voraussetzungen: Docker läuft, Node 20+, Playwright mit Chromium. Aufruf: npm run test:e2e
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=${E2E_OUT:-$(mktemp -d)}
SB="npx -y supabase@2"
echo "▶ Supabase starten (erstes Mal dauert einige Minuten) …"
$SB start -x studio,realtime,imgproxy,mailpit,edge-runtime,logflare,vector,postgres-meta,supavisor >/dev/null
$SB db reset >/dev/null 2>&1
eval "$($SB status -o env 2>/dev/null | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY)=')"
export ANON="$ANON_KEY" SERVICE="$SERVICE_ROLE_KEY" E2E_OUT="$OUT" BASE="http://localhost:${PORT:-8888}/immo/"
node tests/e2e/server.cjs & SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
sleep 1
fail=0
for t in konto-team admin-gruppen mieterportal rechnungen-lokal reparaturen-lokal rundgang-lokal; do
  echo; echo "══ $t"; node "tests/e2e/$t.cjs" || fail=1
done
echo; echo "Screenshots & PDFs: $OUT"
[ "$fail" = 0 ] && echo "✅ ALLE END-TO-END-TESTS BESTANDEN" || echo "❌ Es gab Fehler (siehe oben)"
exit $fail
