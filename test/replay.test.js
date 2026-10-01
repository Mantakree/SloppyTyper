import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSession } from './python-session.js';
import { Replay } from '../web/replay.js';

const meta = { root: '/test', name: 'test', branch: 'main', skipped: [] };
function session(before, after) { return makeSession({ ...meta, files: before }, { ...meta, files: after }); }

for (const [label, before, after] of [
  ['insertions', 'hello world', 'hello magnificent world!'],
  ['deletions', 'remove this obsolete code', 'remove code'],
  ['replacement', 'const n = 1;\nprint(n);\n', 'const n = 9001;\nconsole.log(n);\n'],
  ['unicode', '🦊 says bonjour\r\n', '🦄 says café 🥐\r\n'],
  ['newlines', 'one\r\ntwo\r\n', 'one\ntwo\nthree\n'],
  ['new file', '', 'hello();\n'],
  ['deleted file', 'hello();\n', ''],
]) {
  test(`replays ${label} exactly without mutating input`, () => {
    const file = session({ 'a.js': before }, { 'a.js': after }).files[0];
    const original = JSON.stringify(file);
    const replay = new Replay(file);
    assert.equal(replay.view().text, before);
    let last = before;
    while (!replay.done) {
      replay.step(1);
      const text = replay.view().text;
      assert.ok(Math.abs([...text].length - [...last].length) <= 1);
      assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text));
      last = text;
    }
    assert.equal(replay.view().text, after);
    assert.equal(JSON.stringify(file), original);
    replay.step(50);
    assert.equal(replay.view().text, after);
  });
}

test('added/deleted empty files each take one key; same files take none', () => {
  for (const result of [session({}, { 'empty.ts': '' }), session({ 'empty.ts': '' }, {})]) {
    const replay = new Replay(result.files[0]);
    assert.equal(replay.total, 1); assert.equal(replay.done, false);
    replay.step(); assert.equal(replay.done, true); assert.equal(replay.view().text, '');
  }
  assert.equal(session({ 'a.js': 'same' }, { 'a.js': 'same' }).files.length, 0);
});

test('random edit sequences finish exactly at all speeds', () => {
  let seed = 48721;
  const random = max => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % max; };
  const alphabet = ['a', 'b', 'c', '\n', ' ', '🦊', 'é', '\r'];
  for (let i = 0; i < 100; i++) {
    const before = Array.from({ length: random(80) }, () => alphabet[random(alphabet.length)]).join('');
    const after = Array.from({ length: random(80) }, () => alphabet[random(alphabet.length)]).join('');
    if (before === after) continue;
    const replay = new Replay(session({ 'a.js': before }, { 'a.js': after }).files[0]);
    while (!replay.done) {
      const beforeStep = replay.view().text;
      const frame = replay.step([1, 5, 10, 20, 50][random(5)]);
      for (const removed of frame.removed) assert.equal(beforeStep.slice(removed.offset, removed.offset + removed.text.length), removed.text);
    }
    assert.equal(replay.view().text, after);
  }
});

test('oversized or unsupported files are not mistaken for deletions', () => {
  const result = makeSession({ ...meta, files: { 'big.js': 'old' } }, { ...meta, files: {}, skipped: ['big.js'] });
  assert.deepEqual(result.files, []);
});

test('rain insertion offsets identify only new characters across edits and Unicode', () => {
  const file = session({ 'a.js': 'const fox = "🦊";\nold();\n' }, { 'a.js': 'const fox = "🦄";\nnewThing();\nfinish();\n' }).files[0];
  for (const speed of [1, 5, 10, 20, 50]) {
    const replay = new Replay(file);
    let added = '';
    while (!replay.done) {
      const frame = replay.step(speed);
      for (const insertion of frame.inserted) {
        assert.equal(frame.text.slice(insertion.offset, insertion.offset + insertion.text.length), insertion.text);
        added += insertion.text;
      }
    }
    assert.equal(added, file.parts.filter(p => p.type === 'add').map(p => p.text).join(''));
    assert.equal(replay.view().text, file.after);
  }
  const deletion = new Replay(session({ 'a.js': 'remove' }, {}).files[0]);
  assert.deepEqual(deletion.step(50).inserted, []);
});

test('added ranges keep only written characters bright after mixed Unicode edits', () => {
  const file = session({ 'a.js': 'old 🦊\nkeep\nlast' }, { 'a.js': 'new 🦄\nkeep\nend' }).files[0];
  const replay = new Replay(file);
  while (!replay.done) replay.step(10);
  const added = replay.added.map(({ start, end }) => file.after.slice(start, end)).join('');
  assert.equal(added, file.parts.filter(p => p.type === 'add').map(p => p.text).join(''));
  assert.ok(replay.added.every((range, i) => range.end > range.start && (!i || range.start > replay.added[i - 1].end)));
});

function replayParts(parts) {
  return new Replay({ parts, total: parts.filter(p => p.type !== 'equal').reduce((n, p) => n + [...p.text].length, 0) });
}
function hints(replay) {
  const { text, upcoming } = replay.view();
  return upcoming.map(({ start, end }) => text.slice(start, end));
}

test('deletion hints shrink with typing and leave later edits dimmed', () => {
  const replay = replayParts([
    { type: 'equal', text: 'keep ' }, { type: 'remove', text: 'old🦊' },
    { type: 'equal', text: ' middle ' }, { type: 'remove', text: 'later' },
    { type: 'equal', text: ' end' },
  ]);
  assert.deepEqual(hints(replay), ['old🦊', 'later']);
  replay.step(2);
  assert.deepEqual(hints(replay), ['d🦊', 'later']);
  replay.step(2);
  assert.deepEqual(hints(replay), ['later']);
  replay.step(50);
  assert.deepEqual(hints(replay), []);
});

test('insertion hints mark whole Unicode neighbors and clear at the first inserted character', () => {
  const replay = replayParts([
    { type: 'equal', text: 'a🦊' }, { type: 'add', text: '123' }, { type: 'equal', text: '🦄z' },
  ]);
  assert.deepEqual(replay.view().upcoming, [{ start: 1, end: 5 }]);
  assert.deepEqual(hints(replay), ['🦊🦄']);
  assert.equal(replay.view(), replay.view(), 'hints are cached between keystrokes');
  replay.step(1);
  assert.deepEqual(hints(replay), []);
  assert.equal(replay.view().text, 'a🦊1🦄z');
  assert.deepEqual(replay.added, [{ start: 3, end: 4 }]);
});

test('replacement hints bracket surviving neighbors while old code burns away', () => {
  const replay = replayParts([
    { type: 'equal', text: '(A' }, { type: 'remove', text: 'old' },
    { type: 'add', text: 'new' }, { type: 'equal', text: 'B)' },
  ]);
  assert.deepEqual(hints(replay), ['AoldB']);
  replay.step(2);
  assert.deepEqual(hints(replay), ['AdB']);
  replay.step(1);
  assert.deepEqual(hints(replay), ['AB']);
  replay.step(1);
  assert.deepEqual(hints(replay), []);
});

test('insertion hints handle file edges, adjacent edits, and empty new files', () => {
  const replay = replayParts([
    { type: 'add', text: 'first' }, { type: 'equal', text: '🦊' },
    { type: 'add', text: 'middle' }, { type: 'equal', text: 'b' }, { type: 'add', text: 'last' },
  ]);
  assert.deepEqual(hints(replay), ['🦊b'], 'overlapping neighbor hints merge');
  replay.step(5);
  assert.deepEqual(hints(replay), ['🦊b']);
  replay.step(6);
  assert.deepEqual(hints(replay), ['b'], 'the final insertion only has a left neighbor');
  replay.step(1);
  assert.deepEqual(hints(replay), []);
  const fresh = replayParts([{ type: 'add', text: 'brand new code' }]);
  assert.deepEqual(hints(fresh), []);
  fresh.step(1);
  assert.deepEqual(hints(fresh), []);
});
