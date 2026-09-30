import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSession } from '../src/session.js';
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
    while (!replay.done) replay.step([1, 5, 20][random(3)]);
    assert.equal(replay.view().text, after);
  }
});

test('oversized or unsupported files are not mistaken for deletions', () => {
  const result = makeSession({ ...meta, files: { 'big.js': 'old' } }, { ...meta, files: {}, skipped: ['big.js'] });
  assert.deepEqual(result.files, []);
});
