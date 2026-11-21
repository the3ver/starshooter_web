#!/usr/bin/env bash
# First failure block from a Playwright log (line reporter); aborted parallel tests are not a finding.
# Without a block "  1) " (e.g. a test file fails to load): the last 40 lines without progress lines.
block=$(awk '/^  1\) /{p=1} /^  2\) |^Testing stopped early/{p=0} p' "$1" | grep -v '^\[[0-9]*/[0-9]*\]' | head -60)
if [ -n "$block" ]; then
  echo "$block"
else
  grep -v '^\[[0-9]*/[0-9]*\]' "$1" | tail -40
fi
