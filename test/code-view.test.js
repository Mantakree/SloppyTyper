import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { CodeView, charactersIn } from '../web/code-view.js';
import { Replay } from '../web/replay.js';
import { RainTimeline } from '../web/rain.js';

function setup(parts) {
  const { document, MutationObserver } = parseHTML('<html><body><pre id="code"></pre></body></html>');
  const code = document.getElementById('code');
  const view = new CodeView(code);
  const replay = new Replay({ parts, total: parts.filter(p => p.type !== 'equal').reduce((sum, p) => sum + [...p.text].length, 0) });
  const rain = new RainTimeline(() => .5);
  const text = () => [...code.querySelectorAll('.line-content')].map(node => node.textContent).join('\n');
  const render = now => { rain.state(now); return view.render(replay, rain.drops, now); };
  const step = (count, now) => { rain.add(replay.step(count).inserted, now); render(now); };
  render(0);
  return { document, MutationObserver, code, view, replay, rain, text, render, step };
}

for (const speed of [10, 20, 50]) {
  test(`${speed}-character bursts render source in runs without per-character animated elements`, () => {
    const state = setup([{ type: 'add', text: 'const answer = "🦊<script>literal</script>";\n'.repeat(12) }]);
    const { code, step, text, replay, render, rain } = state;
    step(speed, 0);
    for (let i = 1; i <= 5; i++) {
      step(speed, i * 30);
      assert.equal(text(), replay.view().text);
    }
    assert.equal(code.querySelectorAll('.rain-char').length, 0);
    assert.ok(code.querySelectorAll('.rain-pending').length < rain.drops.size / 2, 'pending characters share spans');
    assert.equal(code.querySelector('[style]'), null, 'the source has no per-character animation styles');
    assert.equal(code.querySelector('script'), null, 'source remains text');
    render(rain.lastLanding() + 1);
    assert.equal(code.querySelectorAll('.rain-pending').length, 0);
    assert.equal([...code.querySelectorAll('.code-added')].map(node => node.textContent).join(''), text().replaceAll('\n', ''));
    assert.equal(text(), replay.view().text);
  });
}

test('edits near the top of a long file retain the unchanged suffix and only allocate changed rows', () => {
  const suffix = Array.from({ length: 800 }, (_, i) => `const line${i} = ${i};`).join('\n');
  const state = setup([{ type: 'equal', text: '// header\n' }, { type: 'add', text: 'x'.repeat(49) + '\n' }, { type: 'equal', text: suffix }]);
  const oldRows = [...state.code.children];
  const oldSyntax = oldRows.at(-1).querySelector('.syntax-keyword');
  const create = state.document.createElement.bind(state.document);
  let allocated = 0;
  state.document.createElement = (...args) => { allocated++; return create(...args); };
  state.step(50, 10);
  assert.equal(state.text(), state.replay.view().text);
  assert.equal(state.code.firstChild, oldRows[0]);
  assert.equal(state.code.lastChild, oldRows.at(-1));
  assert.equal(state.code.lastChild.querySelector('.syntax-keyword'), oldSyntax);
  assert.equal(state.code.lastChild.firstChild.textContent, '802');
  assert.ok(allocated < 12, `only changed rows and whole runs allocate elements (got ${allocated})`);
  allocated = 0;
  state.render(20);
  assert.equal(allocated, 0, 'an unchanged frame allocates no elements');
});

test('mixed edits preserve exact source, caret, line numbers, and empty lines across batches', () => {
  const state = setup([
    { type: 'equal', text: 'const old = ' }, { type: 'remove', text: '"old";\n\n// removed\n' },
    { type: 'add', text: '"new 🦊";\n\n// added\n' }, { type: 'equal', text: 'return ' },
    { type: 'remove', text: 'false' }, { type: 'add', text: 'true' }, { type: 'equal', text: ';\n' },
  ]);
  let now = 0;
  while (!state.replay.done) {
    state.step(5, now += 50);
    assert.equal(state.text(), state.replay.view().text);
    assert.deepEqual([...state.code.querySelectorAll('.line-number')].map(n => n.textContent), state.text().split('\n').map((_, i) => String(i + 1)));
    assert.equal(state.code.querySelectorAll('.caret').length, state.replay.done ? 0 : 1);
  }
  state.render(5000);
  assert.equal(state.text(), 'const old = "new 🦊";\n\n// added\nreturn true;\n');
});

test('large-file windows, reset, and switching files discard stale rows and drops', () => {
  const state = setup([{ type: 'add', text: 'x\n'.repeat(1500) }]);
  state.step(2200, 0);
  assert.ok(state.code.children.length <= 250);
  assert.equal(state.code.lastChild.firstChild.textContent, '1101');
  assert.equal(state.code.querySelectorAll('.caret').length, 1);
  const retained = [...state.code.children].slice(10, -1);
  const animations = retained.map(row => row.querySelector('.rain-pending'));
  state.step(20, 50);
  for (const [i, row] of retained.entries()) {
    assert.ok(state.code.contains(row), 'overlapping window rows stay attached');
    assert.equal(row.querySelector('.rain-pending'), animations[i], 'window scrolling keeps unchanged source in the same row');
  }
  const next = new Replay({ parts: [{ type: 'add', text: 'fresh' }], total: 5 });
  state.view.render(next, new Map(), 100);
  assert.equal(state.text(), '');
  assert.equal(state.code.querySelectorAll('.rain-pending').length, 0);
  next.step(5);
  state.view.render(next, new Map(), 200);
  assert.equal(state.text(), 'fresh');
  assert.equal(state.code.querySelectorAll('.caret').length, 0);
});

test('written code stays highlighted and untouched source keeps its original styling', () => {
  const state = setup([{ type: 'equal', text: 'const value = ' }, { type: 'remove', text: '0' }, { type: 'add', text: '123' }, { type: 'equal', text: '; // unchanged' }]);
  state.step(10, 0);
  state.render(5000);
  assert.equal(state.code.querySelector('.code-added').textContent, '123');
  assert.equal(state.code.querySelector('.syntax-comment').textContent, '// unchanged');
  assert.equal(state.text(), 'const value = 123; // unchanged');
  assert.deepEqual(charactersIn([{ offset: 3, text: ' 🦊\nA' }]), [{ offset: 4, char: '🦊' }, { offset: 7, char: 'A' }]);
});

test('upcoming text dims before edits and yields to the existing green rain and glow', () => {
  const state = setup([
    { type: 'equal', text: 'const value = (' }, { type: 'remove', text: 'old' },
    { type: 'add', text: 'fresh' }, { type: 'equal', text: ');\nkeep🦊' },
    { type: 'add', text: 'later' }, { type: 'equal', text: '🦄safe' },
  ]);
  const dimmed = () => [...state.code.querySelectorAll('.code-upcoming')].map(node => node.textContent).join('');
  assert.equal(dimmed(), '(old)🦊🦄');
  state.step(3, 0);
  assert.equal(dimmed(), '()🦊🦄');
  state.step(1, 20);
  assert.equal(dimmed(), '🦊🦄');
  assert.equal(state.code.querySelector('.rain-pending').textContent, 'f');
  state.render(5000);
  assert.equal(state.code.querySelector('.code-added').textContent, 'f');
  assert.equal(dimmed(), '🦊🦄');
  state.step(50, 5010);
  state.render(10000);
  assert.equal(dimmed(), '');
  assert.equal(state.text(), 'const value = (fresh);\nkeep🦊later🦄safe');
  const restarted = new Replay(state.replay.file);
  state.view.render(restarted, new Map());
  assert.equal(dimmed(), '(old)🦊🦄', 'restart restores all upcoming hints');
});

test('large pending deletions use one hint span per visible line and retain untouched rows', () => {
  const state = setup([
    { type: 'equal', text: '// keep\n' },
    { type: 'remove', text: ('x'.repeat(200) + '\n').repeat(1200) },
    { type: 'equal', text: '// end' },
  ]);
  const untouchedRow = state.code.children[100];
  const untouchedHint = untouchedRow.querySelector('.code-upcoming');
  assert.ok(state.code.querySelectorAll('.code-upcoming').length <= 170, 'windowed ranges, not individual characters');
  state.step(20, 0);
  assert.equal(state.code.children[100], untouchedRow);
  assert.equal(untouchedRow.querySelector('.code-upcoming'), untouchedHint);
  assert.ok(state.code.querySelectorAll('.code-upcoming').length <= 170);
});
