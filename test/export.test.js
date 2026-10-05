import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Script, createContext } from 'node:vm';
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

test('standalone typing and Skip scroll to the completed edit with the caret hidden', () => {
  for (const method of ['typing', 'skip']) {
    for (const type of ['add', 'remove']) {
      const parts = [{ type: 'equal', text: '// header\n' }, { type, text: '🦊' },
        { type: 'equal', text: '\nunchanged\n'.repeat(800) }];
      const session = { repo: 'synthetic', total: 1, skipped: [], files: [{ path: 'large.js', kind: 'modified', parts, total: 1 }] };
      const html = execFileSync(process.env.PYTHON || 'python', ['-B', '-c',
        "import json, sys; from src.viewer import render_html; sys.stdout.buffer.write(render_html(json.loads(sys.stdin.buffer.read().decode('utf-8'))).encode('utf-8'))"], {
        cwd: fileURLToPath(new URL('..', import.meta.url)), input: JSON.stringify(session), encoding: 'utf8', windowsHide: true,
      });
      const { document, window } = parseHTML(html);
      const viewport = document.getElementById('code-scroll');
      viewport.scrollTop = 0;
      Object.defineProperty(viewport, 'clientHeight', { value: 600 });
      viewport.getBoundingClientRect = () => ({ top: 0 });
      // linkedom has no layout engine. Supply an offscreen glyph position to
      // verify that the actual app follows the completion target, even on Skip.
      const create = document.createElement.bind(document);
      let measuredCompletion = 0;
      document.createElement = (...args) => {
        const element = create(...args);
        element.getBoundingClientRect = () => {
          if (element.className === 'scroll-anchor') {
            measuredCompletion++;
            return { top: 900 - viewport.scrollTop };
          }
          return { top: 30 };
        };
        return element;
      };
      const select = document.getElementById('files');
      Object.defineProperty(select, 'value', { value: '0', writable: true });
      document.getElementById('code-effects').getContext = () => null;
      const frames = [];
      const context = createContext({ document, window,
        matchMedia: () => ({ matches: true, addEventListener() {} }),
        ResizeObserver: class { observe() {} },
        requestAnimationFrame: callback => frames.push(callback), cancelAnimationFrame() {},
        setTimeout() {}, clearTimeout() {}, performance: { now: () => 1000 },
      });
      const script = [...document.querySelectorAll('script')].at(-1).textContent;
      new Script(script).runInContext(context);
      assert.equal(document.getElementById('error').textContent, '');
      if (method === 'skip') document.getElementById('skip').click();
      else {
        const key = new window.Event('keydown', { bubbles: true, cancelable: true });
        key.key = 'x';
        viewport.dispatchEvent(key);
        while (frames.length) frames.shift()(1000);
      }
      assert.ok(measuredCompletion > 0, `${method}/${type} follows the final edit`);
      assert.equal(viewport.scrollTop, 700);
      assert.equal(document.querySelector('.caret'), null);
      assert.equal(document.querySelector('.line-number').textContent, '1');
      assert.equal(document.querySelector('.scroll-anchor').parentNode.textContent, type === 'add' ? '🦊' : '');
      assert.equal(document.getElementById('percent').textContent, '100%');
    }
  }
});
