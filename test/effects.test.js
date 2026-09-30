import test from 'node:test';
import assert from 'node:assert/strict';
import { particlePose, CodeEffects } from '../web/effects.js';

test('green rain drops downward and lands at its exact source position', () => {
  const particle = { start: 100, duration: 600, height: 180 };
  assert.equal(particlePose(particle, 99).alpha, 0);
  const first = particlePose(particle, 250), later = particlePose(particle, 600);
  assert.ok(first.y < later.y && later.y < 0);
  assert.deepEqual(particlePose(particle, 700), { x: 0, y: -0, alpha: 1, progress: 1 });
});

test('red removals lift from their original position, drift outward, and burn away', () => {
  const particle = { start: 100, duration: 600, height: 180, drift: 60 };
  assert.deepEqual(particlePose(particle, 100, true), { x: 0, y: -0, alpha: 1, progress: 0 });
  const first = particlePose(particle, 250, true), later = particlePose(particle, 600, true);
  assert.ok(first.y > later.y && first.y < 0);
  assert.ok(later.x > first.x && later.alpha < first.alpha);
  assert.equal(particlePose(particle, 700, true).alpha, 0);
});

test('red particles stay bright through most of their higher flight', () => {
  const particle = { start: 100, duration: 1400, height: 320, drift: 70 };
  const mid = particlePose(particle, 800, true);
  assert.ok(mid.y < -160, 'the character has already risen more than halfway');
  assert.ok(mid.x > 35, 'outward travel separates it from incoming rain');
  assert.ok(mid.alpha > .8, 'the red head remains clearly visible at mid-flight');
  assert.equal(particlePose(particle, 1500, true).alpha, 0);
});

test('dense red effects use two draws per particle and reuse sprites across frames', () => {
  const burns = new Set(Array.from({ length: 300 }, (_, i) => ({
    char: String(i % 10), trail: 'ア\nイ\nウ', position: { x: 100 + i % 20 * 10, y: 450 },
    start: 100, duration: 1400, height: 320, drift: 70,
  })));
  let drawings = 0, lookups = 0;
  const effects = Object.assign(Object.create(CodeEffects.prototype), {
    ctx: { clearRect() {}, drawImage() { drawings++; } }, width: 800, height: 600, viewport: { scrollTop: 0 },
    sprites: { size: 14, get() { lookups++; return { canvas: {}, padding: 8, inset: 12, width: 45, height: 90 }; } },
    timeline: { drops: new Map(), burns }, wake() {},
  });
  effects.draw(800);
  assert.equal(drawings, 600, 'heads, trails and embers need only two stamps per particle');
  assert.equal(lookups, 600);
  drawings = 0;
  effects.draw(900);
  assert.equal(drawings, 600);
  assert.equal(lookups, 600, 'there are no repeated sprite lookups or mid-flight color variants');
  effects.viewport.scrollTop = 1000;
  drawings = 0;
  effects.draw(950);
  assert.equal(drawings, 0, 'offscreen burns cost no canvas draws');
});

test('new text remeasures falling targets that may wrap, while earlier lines keep cached coordinates', t => {
  const previousRatio = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio');
  Object.defineProperty(globalThis, 'devicePixelRatio', { value: 1, configurable: true });
  t.after(() => { if (previousRatio) Object.defineProperty(globalThis, 'devicePixelRatio', previousRatio); else delete globalThis.devicePixelRatio; });
  const earlier = { char: 'a', position: { x: 1, y: 2 } };
  const rewrapped = { char: 'b', position: { x: 300, y: 2 } };
  const fresh = { char: 'c' };
  const effects = Object.assign(Object.create(CodeEffects.prototype), {
    ctx: {}, viewport: { clientWidth: 400, clientHeight: 600 }, width: 400, height: 600, ratio: 1,
    version: 1, frame: null, draw() {}, timeline: { drops: new Map([[0, earlier], [100, rewrapped], [101, fresh]]) },
  });
  let measured;
  effects.sync({
    layoutVersion: 1, reflowFrom: 100,
    positions(characters) { measured = characters; return new Map(characters.map(({ offset }) => [offset, { x: offset - 100, y: 30 }])); },
  });
  assert.deepEqual(measured.map(({ offset }) => offset), [100, 101]);
  assert.deepEqual(earlier.position, { x: 1, y: 2 });
  assert.deepEqual(rewrapped.position, { x: 0, y: 30 });
  effects.sync({ layoutVersion: 1, reflowFrom: Infinity, positions() { assert.fail('unchanged frames must not remeasure characters'); } });
});
