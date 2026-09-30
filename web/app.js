import { Replay } from './replay.js';
import { RainTimeline } from './rain.js';
import { CodeView, charactersIn } from './code-view.js';
import { CodeEffects } from './effects.js';

const $ = id => document.getElementById(id);
let session, replays, current = 0, keystrokes = 0, speed = 1, started = 0, finished = 0, sound = false, audio;
let rendering = false, followCursor = false;
let queuedCharacters = 0;
const rain = new RainTimeline();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let rainCleanup;
const number = n => n.toLocaleString();
const codeView = new CodeView($('code'));
const effects = new CodeEffects($('code-effects'), $('code-scroll'), $('code'), rain, () => { if (replays) scheduleRender(); });

function clearRain() {
  rain.clear();
  effects.clear();
  queuedCharacters = 0;
  clearTimeout(rainCleanup);
}

function scheduleLanding(now) {
  clearTimeout(rainCleanup);
  const deadline = rain.nextWake(now);
  if (deadline !== null) rainCleanup = setTimeout(scheduleRender, Math.max(1, deadline - now + 10));
}

function renderCode(now) {
  const replay = replays[current];
  const { text, active } = codeView.render(replay, rain.drops, now);
  $('empty-code').hidden = text.length !== 0;
  $('empty-code').textContent = replay.done && replay.file.kind === 'deleted' ? 'File deleted.' : 'New file. Press any key to begin.';
  if (followCursor && active) {
    const viewport = $('code-scroll');
    const top = active.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    if (top < 25 || top > viewport.clientHeight - 50) viewport.scrollTop += top - viewport.clientHeight / 3;
  }
  followCursor = false;
  effects.sync(codeView);
}

function render() {
  rendering = false;
  const now = performance.now();
  let rainState = rain.state(now);
  if (queuedCharacters) {
    const replay = replays[current];
    const change = replay.step(queuedCharacters);
    queuedCharacters = 0;
    const motionOff = reducedMotion.matches || !effects.ctx;
    // Read old glyph positions before any DOM writes. Multiple key events in
    // one frame become one edit and one layout pass, including mixed edits.
    const removed = motionOff ? [] : [...codeView.positions(charactersIn(change.removed), $('code-scroll')).values()];
    rain.remove(removed, now, motionOff);
    rain.add(change.inserted, now, motionOff);
    if (replay.done) rain.markComplete(now);
    rainState = rain.state(now);
  }
  if (rainState.ready && replays.some(r => !r.done)) {
    current = replays.findIndex(r => !r.done);
    clearRain();
    rainState = rain.state(now);
    followCursor = false;
    $('code-scroll').scrollTop = 0;
  }
  const replay = replays[current];
  const progress = replays.reduce((n, r) => n + r.progress, 0);
  const doneCount = replays.filter(r => r.done).length;
  const complete = doneCount === replays.length;
  const percent = Math.floor(progress / session.total * 100);
  $('files').value = String(current);
  $('file-kind').textContent = replay.file.kind.toUpperCase();
  $('file-progress').textContent = `${number(replay.progress)} / ${number(replay.total)} CHARACTERS`;
  const holding = rainState.completing && !rainState.ready;
  $('phase').textContent = replay.done && rainState.pending ? 'SETTLING' : holding ? 'FILE COMPLETE' : complete ? 'COMPLETE' : replay.done ? 'FILE COMPLETE' : keystrokes ? 'REPLAYING' : 'READY';
  $('percent').textContent = `${percent}%`;
  $('progress').value = percent;
  $('keys').textContent = number(keystrokes);
  $('completed-files').textContent = `${doneCount} / ${replays.length}`;
  $('skip').disabled = replay.done;
  $('files').disabled = rainState.pending > 0 || holding;
  for (const [i, option] of [...$('files').options].entries()) {
    const label = `${replays[i].done ? '✓ ' : ''}${replays[i].file.path}`;
    if (option.textContent !== label) option.textContent = label;
  }
  $('completion').hidden = !complete || !rainState.ready;
  $('mash-title').textContent = holding ? (rainState.pending ? 'SETTLING' : 'FILE COMPLETE') : complete ? 'REPLAY COMPLETE' : 'MASH ANY KEY';
  $('mash').disabled = complete || holding;
  if (complete) {
    finished ||= Date.now();
    $('end-keys').textContent = number(keystrokes);
    $('end-time').textContent = `${started ? Math.max(1, Math.round((finished - started) / 1000)) : 0}s`;
    $('end-files').textContent = replays.length;
    if (rainState.ready) $('announcement').textContent = 'Replay complete.';
  }
  renderCode(now);
  scheduleLanding(now);
}

function scheduleRender() { if (!rendering) { rendering = true; requestAnimationFrame(render); } }
function blip() {
  if (!sound) return;
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') audio.resume();
    const oscillator = audio.createOscillator(), gain = audio.createGain();
    oscillator.type = 'square'; oscillator.frequency.value = 160 + Math.random() * 130;
    gain.gain.setValueAtTime(0.015, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.025);
    oscillator.connect(gain); gain.connect(audio.destination);
    oscillator.start(); oscillator.stop(audio.currentTime + 0.03);
  } catch { sound = false; $('sound').setAttribute('aria-pressed', 'false'); $('sound').lastElementChild.textContent = 'Sound unavailable'; }
}
function mash() {
  if (!replays || replays.every(r => r.done)) return;
  if (rain.advanceAt !== null) return;
  started ||= Date.now();
  if (replays[current].done) {
    clearRain(); current = replays.findIndex(r => !r.done);
    // A manually revisited completed file can resume another file. Establish
    // its original layout before measuring that first batch of deletions.
    $('code-scroll').scrollTop = 0; render();
  }
  keystrokes++;
  queuedCharacters += speed;
  followCursor = true;
  blip(); scheduleRender();
}
function reset() {
  if (!session) return;
  replays = session.files.map(file => new Replay(file));
  current = 0; keystrokes = 0; started = 0; finished = 0;
  clearRain();
  $('announcement').textContent = 'Replay restarted.';
  $('code-scroll').scrollTop = 0;
  render();
}

$('mash').addEventListener('click', mash);
$('skip').addEventListener('click', () => {
  if (!replays || replays[current].done) return;
  queuedCharacters = 0;
  replays[current].step(replays[current].total);
  rain.markComplete(performance.now());
  followCursor = true; render();
});
$('reset').addEventListener('click', reset);
$('again').addEventListener('click', () => { reset(); $('code-scroll').focus(); });
$('files').addEventListener('change', () => {
  const state = rain.state(performance.now());
  if (queuedCharacters || state.pending || (state.completing && !state.ready)) { $('files').value = String(current); return; }
  clearRain(); current = Number($('files').value); followCursor = true;
  if (replays.every(r => r.done)) rain.advanceAt = performance.now();
  render(); $('code-scroll').focus();
});
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) rain.settle(performance.now());
  if (replays) scheduleRender();
});
$('sound').addEventListener('click', () => {
  sound = !sound; $('sound').setAttribute('aria-pressed', String(sound));
  $('sound').lastElementChild.textContent = sound ? 'Sound on' : 'Sound off'; blip();
});
document.querySelectorAll('[data-speed]').forEach(button => button.addEventListener('click', () => {
  speed = Number(button.dataset.speed);
  document.querySelectorAll('[data-speed]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  button.blur();
}));
window.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  if (event.target.closest('input,select,textarea,[contenteditable="true"]')) return;
  if (event.target.closest('button,a') && ['Enter', ' '].includes(event.key)) return;
  if ([...event.key].length !== 1 && !['Enter', 'Backspace', 'Delete'].includes(event.key)) return;
  event.preventDefault(); mash();
});

try {
  session = JSON.parse($('session-data').textContent);
  if (!session.files?.length) throw new Error('Nothing to replay. Your source files have not changed.');
  document.title = `${session.repo} / SloppyTyper`;
  if (session.skipped.length) $('skipped').textContent = `${session.skipped.length} unsupported file(s) skipped`;
  $('files').replaceChildren();
  session.files.forEach((file, i) => {
    const option = document.createElement('option'); option.value = i; option.textContent = file.path;
    $('files').append(option);
  });
  reset();
} catch (error) {
  $('error').hidden = false; $('error').textContent = error.message;
  $('mash').disabled = true;
  $('phase').textContent = 'REPLAY UNAVAILABLE';
}
