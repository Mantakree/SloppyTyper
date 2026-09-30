import test from 'node:test';
import assert from 'node:assert/strict';
import { RainTimeline } from '../web/rain.js';
import { Replay } from '../web/replay.js';

function seededRandom() {
  let seed = 2026;
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
}

for (const count of [5, 20, 50]) {
  test(`${count}-character batches fall at distinct times in shuffled source order`, () => {
    const rain = new RainTimeline(seededRandom());
    rain.add([{ offset: 0, text: 'x'.repeat(count) }], 100);
    const byDeparture = [...rain.drops].sort((a, b) => a[1].start - b[1].start);
    const byArrival = [...rain.drops].sort((a, b) => a[1].start + a[1].duration - b[1].start - b[1].duration);
    assert.equal(rain.drops.size, count);
    assert.equal(new Set(byDeparture.map(([, drop]) => drop.start)).size, count);
    assert.notDeepEqual(byDeparture.map(([offset]) => offset), Array.from({ length: count }, (_, i) => i));
    assert.notDeepEqual(byArrival.map(([offset]) => offset), Array.from({ length: count }, (_, i) => i));
    assert.ok(byDeparture.at(-1)[1].start - byDeparture[0][1].start >= 200);
  });
}

test('shuffled drops preserve Unicode offsets and single characters start immediately', () => {
  const rain = new RainTimeline(seededRandom());
  rain.add([{ offset: 7, text: '🦊 a\né' }], 100);
  assert.deepEqual([...rain.drops.keys()].sort((a, b) => a - b), [7, 10, 12]);
  assert.equal(rain.drops.get(7).char, '🦊');
  const single = new RainTimeline(seededRandom());
  single.add([{ offset: 0, text: 'x' }], 200);
  assert.equal(single.drops.get(0).start, 200);
});

test('file completion waits for overlapping batches to land, then a full second', () => {
  const rain = new RainTimeline(seededRandom());
  rain.add([], 100); // Earlier deletions started this file before the final bursts.
  rain.add([{ offset: 0, text: 'abcdef' }], 3000);
  rain.add([{ offset: 6, text: 'ghijklmnopqrstuvwxyz' }], 3150);
  const lastLanding = rain.lastLanding();
  rain.markComplete(3150);
  rain.markComplete(3900); // Extra input cannot extend or bypass the pause.
  assert.equal(rain.advanceAt, lastLanding + 1000);
  assert.equal(rain.nextWake(3150), lastLanding);
  assert.ok(rain.state(lastLanding - 1).pending > 0);
  assert.deepEqual(rain.state(lastLanding), { pending: 0, completing: true, ready: false });
  assert.equal(rain.nextWake(lastLanding), lastLanding + 1000);
  assert.equal(rain.state(lastLanding + 999).ready, false);
  assert.equal(rain.state(lastLanding + 1000).ready, true);
  assert.equal(rain.nextWake(lastLanding + 1000), null);
});

test('tiny deletions, whitespace, and reduced motion stay visible for three seconds', () => {
  const rain = new RainTimeline(seededRandom());
  rain.add([{ offset: 0, text: 'plain text' }], 100, true);
  assert.equal(rain.drops.size, 0);
  rain.markComplete(100);
  assert.equal(rain.state(3099).ready, false);
  assert.equal(rain.state(3100).ready, true);
  rain.clear();
  rain.add([], 4000);
  rain.markComplete(4000);
  assert.equal(rain.state(6999).ready, false);
  assert.equal(rain.state(7000).ready, true);
  rain.clear();
  rain.add([{ offset: 0, text: ' \n\t' }], 8000);
  rain.markComplete(8000);
  assert.equal(rain.state(10999).ready, false);
  assert.equal(rain.state(11000).ready, true);
});

for (const length of [1, 5, 20, 49, 50]) {
  test(`a ${length}-character file completed by one 50-character keypress stays visible`, () => {
    const replay = new Replay({ parts: [{ type: 'add', text: 'x'.repeat(length) }], total: length });
    const rain = new RainTimeline(seededRandom());
    rain.add(replay.step(50).inserted, 100);
    assert.equal(replay.done, true);
    const landing = rain.lastLanding();
    rain.markComplete(100);
    const deadline = rain.advanceAt;
    assert.ok(deadline >= 3100);
    assert.ok(deadline >= landing + 1000);
    assert.equal(rain.nextWake(100), landing);
    assert.equal(rain.state(landing).pending, 0);
    assert.equal(rain.nextWake(landing), deadline);
    rain.markComplete(deadline - 1);
    assert.equal(rain.advanceAt, deadline, 'extra keys do not change the deadline');
    assert.equal(rain.state(deadline - 1).ready, false);
    assert.equal(rain.state(deadline).ready, true);
    // A following tiny file gets its own full viewing time.
    rain.clear();
    rain.add([{ offset: 0, text: 'y' }], deadline + 100);
    rain.markComplete(deadline + 100);
    assert.equal(rain.state(deadline + 3099).ready, false);
    assert.equal(rain.state(deadline + 3100).ready, true);
  });
}

test('explicitly skipping an untouched file keeps the usual one-second pause', () => {
  const rain = new RainTimeline(seededRandom());
  rain.markComplete(100);
  assert.equal(rain.state(1099).ready, false);
  assert.equal(rain.state(1100).ready, true);
});

test('reset cancels the previous deadline and reduced motion settles pending drops', () => {
  const rain = new RainTimeline(seededRandom());
  rain.add([{ offset: 0, text: 'abcdef' }], 0);
  rain.markComplete(0);
  rain.clear();
  assert.deepEqual(rain.state(5000), { pending: 0, completing: false, ready: false });
  assert.equal(rain.nextWake(5000), null);
  rain.add([{ offset: 0, text: 'abcdef' }], 6000);
  rain.markComplete(6000);
  rain.settle(6100);
  assert.equal(rain.drops.size, 0);
  assert.equal(rain.advanceAt, 9000);
});
