// Stop hook: runs npm run check if relevant files changed since the last green run.
// Red = exit 2, the error output goes to Claude and the turn continues. After 3 red runs
// with the same state the hook gives up (no endless loop), but keeps reporting the error.
import { checkStand } from './check-state.mjs';

const { green, output, attempts } = checkStand();
if (green) process.exit(0);
console.error(output);
if (attempts > 3) {
  console.error(
    'Stop hook: red three times with the same state, ending the turn anyway. Report the error to the user.',
  );
  process.exit(0);
}
process.exit(2);
