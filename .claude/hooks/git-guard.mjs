// PreToolUse hook (Bash, PowerShell): blocks destructive git commands.
// Plain git push stays allowed (push gate: npm run check green first).
let input = '';
process.stdin.on('data', d => {
  input += d;
});
process.stdin.on('end', () => {
  let command = '';
  try {
    command = JSON.parse(input).tool_input?.command || '';
  } catch {
    process.exit(0);
  }
  // [^\n;&|]* stays within one sub-command, so text in heredocs or following commands does not count
  const forbidden = [
    /git\s+push\b[^\n;&|]*(--force\b|--force-with-lease\b|\s-f\b|\s\+\S)/,
    /git\s+reset\s+[^\n;&|]*--hard\b/,
    /git\s+clean\s+[^\n;&|]*-\w*f/,
    /git\s+branch\s+[^\n;&|]*-D\b/,
    /git\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/,
    /git\s+stash\s+(drop|clear)\b/,
  ];
  const hit = forbidden.find(pattern => pattern.test(command));
  if (hit) {
    console.error(
      `BLOCKED: '${command}' matches ${hit}. Destructive git commands only after approval by the user, who runs them personally.`,
    );
    process.exit(2);
  }
});
