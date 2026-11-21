// Claude-Hooks (.claude/hooks): Verhalten bei gruenem und rotem Check, ohne die echte Suite zu starten
const { test, expect } = require('@playwright/test');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOKS = path.join(__dirname, '..', '.claude', 'hooks');

function starteHook(name, { check, stand, eingabe = {} }) {
  return spawnSync(process.execPath, [path.join(HOOKS, name)], {
    input: JSON.stringify(eingabe),
    encoding: 'utf8',
    env: { ...process.env, CHECK_BEFEHL: check, CHECK_STAND_DATEI: stand },
  });
}

function neueStandDatei() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'check-stand-')), 'stand.json');
}

test('Stop-Hook: gruen = Exit 0, danach ueberspringt er denselben Stand', () => {
  const stand = neueStandDatei();
  expect(starteHook('stop-check.mjs', { check: 'echo CHECK OK', stand }).status).toBe(0);
  // gleicher Stand: der (jetzt rote) Befehl laeuft gar nicht erst
  expect(starteHook('stop-check.mjs', { check: 'exit 1', stand }).status).toBe(0);
});

test('Stop-Hook: rot = Exit 2 mit Ausgabe, nach drei roten Laeufen Exit 0', () => {
  const stand = neueStandDatei();
  const check = 'echo CHECK ROT: Tests; exit 1';
  for (let i = 1; i <= 3; i++) {
    const lauf = starteHook('stop-check.mjs', { check, stand });
    expect(lauf.status, `Lauf ${i}`).toBe(2);
    expect(lauf.stderr).toContain('CHECK ROT: Tests');
  }
  expect(starteHook('stop-check.mjs', { check, stand }).status).toBe(0);
});

test('Commit-Hook: git commit bei rotem Check = Exit 2, andere Befehle laufen ohne Check durch', () => {
  const stand = neueStandDatei();
  const check = 'echo CHECK ROT: Tests; exit 1';
  const commit = { tool_input: { command: 'npm run fmt && git commit -m "feat: x"' } };
  const rot = starteHook('commit-check.mjs', { check, stand, eingabe: commit });
  expect(rot.status).toBe(2);
  expect(rot.stderr).toContain('CHECK ROT: Tests');
  expect(rot.stderr).toContain('BLOCKIERT');
  // kein Commit: Check laeuft nicht (der Befehl wuerde sonst rot melden)
  const status = starteHook('commit-check.mjs', { check, stand, eingabe: { tool_input: { command: 'git status' } } });
  expect(status.status).toBe(0);
});

test('Commit-Hook: git commit bei gruenem Check = Exit 0, Stop-Hook danach ohne neuen Lauf', () => {
  const stand = neueStandDatei();
  const commit = { tool_input: { command: 'git -C . commit -qF - <<EOF\nfix: y\nEOF' } };
  expect(starteHook('commit-check.mjs', { check: 'echo CHECK OK', stand, eingabe: commit }).status).toBe(0);
  expect(starteHook('stop-check.mjs', { check: 'exit 1', stand }).status).toBe(0);
});
