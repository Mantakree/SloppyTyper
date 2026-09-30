import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { parseHTML } from 'linkedom';
import { Replay } from '../web/replay.js';

test('the generated standalone bundle is valid classic JavaScript and carries playable session data', () => {
  const html = execFileSync(process.env.PYTHON || 'python', ['-B', '-c',
    "import sys; from src.demo import demo_session; from src.viewer import render_html; sys.stdout.buffer.write(render_html(demo_session()).encode('utf-8'))"], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', windowsHide: true,
  });
  const { document } = parseHTML(html);
  const scripts = [...document.querySelectorAll('script')];
  assert.equal(scripts.length, 2);
  assert.doesNotThrow(() => new Script(scripts[1].textContent));
  const session = JSON.parse(document.getElementById('session-data').textContent);
  for (const file of session.files) {
    const replay = new Replay(file);
    assert.equal(replay.view().text, file.before);
    while (!replay.done) replay.step(50);
    assert.equal(replay.view().text, file.after);
  }
  assert.equal(document.querySelectorAll('script[src], link[rel="stylesheet"]').length, 0);
});
