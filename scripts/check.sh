#!/usr/bin/env bash
# Quiet full check for agents, the stop hook and CI: Prettier, ESLint, types (tsc --checkJs), then all tests.
# Green = one line. Red = only the errors (test name + failure block), stops at the first failure.
# Prettier and ESLint with a cache in node_modules/.cache (unchanged files ~1 s instead of ~13 s).
# Retries come from playwright.config.js (local 0, CI 2).
cd "$(dirname "$0")/.." || exit 1
start=$(date +%s)
log=$(mktemp)
trap 'rm -f "$log"' EXIT

if ! npx prettier --check --log-level warn --cache --cache-strategy content --cache-location node_modules/.cache/prettier/.cache . > "$log" 2>&1; then
  echo "CHECK FAILED: prettier (npm run fmt formats)"
  cat "$log"
  exit 1
fi

if ! npx eslint --cache --cache-location node_modules/.cache/eslint/ . > "$log" 2>&1; then
  echo "CHECK FAILED: eslint"
  cat "$log"
  exit 1
fi

if ! npx tsc -p jsconfig.json > "$log" 2>&1; then
  echo "CHECK FAILED: tsc"
  cat "$log"
  exit 1
fi

if ! npx playwright test --reporter=line --max-failures=1 > "$log" 2>&1; then
  echo "CHECK FAILED: tests"
  # Print only the first failure block (aborted parallel tests are not a finding)
  bash scripts/failure-block.sh "$log"
  exit 1
fi

count=$(grep -oE '[0-9]+ passed' "$log" | grep -oE '[0-9]+')
echo "CHECK OK: prettier, eslint, tsc, ${count:-?} tests, $(( $(date +%s) - start )) s"
