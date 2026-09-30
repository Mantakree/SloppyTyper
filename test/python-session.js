// Developer-only bridge: exercise the actual Python diff with the browser's
// replay engine rather than retaining a second implementation of the backend.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function makeSession(before, after) {
  return JSON.parse(execFileSync(process.env.PYTHON || 'python', ['-B', '-c',
    'import json,sys; from src.session import make_session; print(json.dumps(make_session(*json.load(sys.stdin.buffer))))'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    input: JSON.stringify([before, after]), encoding: 'utf8', windowsHide: true,
  }));
}
