#!/usr/bin/env bash
# Leiser Gesamtcheck fuer Agenten, Stop-Hook und CI: ESLint, Typen (tsc --checkJs), dann alle Tests.
# Gruen = eine Zeile. Rot = nur die Fehler (Testname + Fehlerblock), Abbruch beim ersten Fehler.
cd "$(dirname "$0")/.." || exit 1
start=$(date +%s)
log=$(mktemp)
trap 'rm -f "$log"' EXIT

if ! npx eslint . > "$log" 2>&1; then
  echo "CHECK ROT: eslint"
  cat "$log"
  exit 1
fi

if ! npx tsc -p jsconfig.json > "$log" 2>&1; then
  echo "CHECK ROT: tsc"
  cat "$log"
  exit 1
fi

if ! npx playwright test --reporter=line --retries=0 --max-failures=1 > "$log" 2>&1; then
  echo "CHECK ROT: Tests"
  # Nur den ersten Fehlerblock ausgeben (abgebrochene Parallel-Tests sind kein Befund)
  awk '/^  1\) /{p=1} /^  2\) |^Testing stopped early/{p=0} p' "$log" | grep -v '^\[[0-9]*/[0-9]*\]' | head -60
  exit 1
fi

anzahl=$(grep -oE '[0-9]+ passed' "$log" | grep -oE '[0-9]+')
echo "CHECK OK: eslint, tsc, ${anzahl:-?} Tests, $(( $(date +%s) - start )) s"
