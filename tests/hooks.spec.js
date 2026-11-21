// Claude hooks (.claude/hooks): behavior on a green and a red check, without running the real suite
const { test, expect } = require('@playwright/test');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOKS = path.join(__dirname, '..', '.claude', 'hooks');

function startHook(name, { check, stand, input = {} }) {
  return spawnSync(process.execPath, [path.join(HOOKS, name)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CHECK_COMMAND: check, CHECK_STATE_FILE: stand },
  });
}

function newStandFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'check-stand-')), 'stand.json');
}

test('Stop hook: green = exit 0, then it skips the same state', () => {
  const stand = newStandFile();
  expect(startHook('stop-check.mjs', { check: 'echo CHECK OK', stand }).status).toBe(0);
  // same state: the (now red) command does not even run
  expect(startHook('stop-check.mjs', { check: 'exit 1', stand }).status).toBe(0);
});

test('Stop hook: red = exit 2 with output, exit 0 after three red runs', () => {
  const stand = newStandFile();
  const check = 'echo CHECK FAILED: tests; exit 1';
  for (let i = 1; i <= 3; i++) {
    const run = startHook('stop-check.mjs', { check, stand });
    expect(run.status, `run ${i}`).toBe(2);
    expect(run.stderr).toContain('CHECK FAILED: tests');
  }
  expect(startHook('stop-check.mjs', { check, stand }).status).toBe(0);
});

test('Commit hook: git commit with a red check = exit 2, other commands pass without a check', () => {
  const stand = newStandFile();
  const check = 'echo CHECK FAILED: tests; exit 1';
  const commit = { tool_input: { command: 'npm run fmt && git commit -m "feat: x"' } };
  const rot = startHook('commit-check.mjs', { check, stand, input: commit });
  expect(rot.status).toBe(2);
  expect(rot.stderr).toContain('CHECK FAILED: tests');
  expect(rot.stderr).toContain('BLOCKED');
  // no commit: the check does not run (the command would report red otherwise)
  const status = startHook('commit-check.mjs', { check, stand, input: { tool_input: { command: 'git status' } } });
  expect(status.status).toBe(0);
});

test('Commit hook: git commit with a green check = exit 0, stop hook afterwards without a new run', () => {
  const stand = newStandFile();
  const commit = { tool_input: { command: 'git -C . commit -qF - <<EOF\nfix: y\nEOF' } };
  expect(startHook('commit-check.mjs', { check: 'echo CHECK OK', stand, input: commit }).status).toBe(0);
  expect(startHook('stop-check.mjs', { check: 'exit 1', stand }).status).toBe(0);
});
