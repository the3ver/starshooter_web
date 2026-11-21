#!/usr/bin/env bash
# Erster Fehlerblock aus einem Playwright-Log (Reporter line); abgebrochene Parallel-Tests sind kein Befund.
# Ohne Block "  1) " (z. B. eine Testdatei laedt nicht): die letzten 40 Zeilen ohne Fortschrittszeilen.
block=$(awk '/^  1\) /{p=1} /^  2\) |^Testing stopped early/{p=0} p' "$1" | grep -v '^\[[0-9]*/[0-9]*\]' | head -60)
if [ -n "$block" ]; then
  echo "$block"
else
  grep -v '^\[[0-9]*/[0-9]*\]' "$1" | tail -40
fi
