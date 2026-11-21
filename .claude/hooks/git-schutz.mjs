// PreToolUse-Hook (Bash, PowerShell): blockiert zerstoererische Git-Befehle.
// Normales git push bleibt erlaubt (Push-Gate: vorher npm run check gruen).
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
  // [^\n;&|]* bleibt innerhalb eines Teilbefehls, damit Text in Heredocs oder Folgebefehlen nicht mitzaehlt
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
      `BLOCKIERT: '${command}' passt auf ${hit}. Zerstoererische Git-Befehle nur nach Freigabe durch den Nutzer, der sie selbst ausfuehrt.`,
    );
    process.exit(2);
  }
});
