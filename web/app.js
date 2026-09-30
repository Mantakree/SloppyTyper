import { Replay } from './replay.js';

const $ = id => document.getElementById(id);
let session, replays, current = 0, keystrokes = 0, speed = 1, started = 0, finished = 0, sound = false, audio;
let rendering = false, followCursor = false;
const rain = new Map();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const rainGlyphs = [...'アイウエオカキクケコサシスセソタチツテトナニヌネノ012345789'];
let rainCleanup;
const number = n => n.toLocaleString();
const keywords = /^(?:import|from|export|class|private|public|async|await|const|let|var|if|else|return|new|function|def|self|for|while|try|catch|throw|interface|type|true|false|null|undefined|None|True|False|fn|pub|use|impl|struct|match|package|func)$/;

function highlighted(text) {
  const fragment = document.createDocumentFragment();
  // Text nodes everywhere: source strings are never interpreted as HTML.
  const tokens = text.match(/\/\/.*|#[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b[a-zA-Z_]\w*\b|\b\d+(?:\.\d+)?\b|[^\w"'`/#]+|./gu) || [];
  for (const token of tokens) {
    const span = document.createElement('span');
    span.textContent = token;
    if (token.startsWith('//') || token.startsWith('#')) span.className = 'syntax-comment';
    else if (/^["'`]/.test(token)) span.className = 'syntax-string';
    else if (keywords.test(token)) span.className = 'syntax-keyword';
    else if (/^\d/.test(token)) span.className = 'syntax-number';
    fragment.append(span.className ? span : document.createTextNode(token));
  }
  return fragment;
}

function clearRain() {
  rain.clear();
  clearTimeout(rainCleanup);
}

function addRain(inserted) {
  if (reducedMotion.matches) return;
  const now = performance.now();
  for (const insertion of inserted) {
    let offset = insertion.offset;
    for (const char of insertion.text) {
      if (!/\s/u.test(char)) rain.set(offset, {
        char, start: now, duration: 460 + Math.random() * 180,
        trail: Array.from({ length: 5 }, () => rainGlyphs[Math.floor(Math.random() * rainGlyphs.length)]).join('\n'),
      });
      offset += char.length;
    }
  }
  // Keep rapid mashing bounded, and settle the final characters before celebrating.
  while (rain.size > 400) rain.delete(rain.keys().next().value);
  clearTimeout(rainCleanup);
  rainCleanup = setTimeout(scheduleRender, 660);
}

function appendSource(parent, text, offset, falling, now) {
  let start = 0;
  for (const [position, drop] of falling) {
    const index = position - offset;
    if (index < 0 || index >= text.length) continue;
    parent.append(highlighted(text.slice(start, index)));
    const char = document.createElement('span');
    char.className = 'rain-char';
    char.textContent = drop.char;
    char.dataset.trail = drop.trail;
    // A negative delay preserves each drop's position across rapid re-renders.
    char.style.setProperty('--rain-duration', `${drop.duration}ms`);
    char.style.setProperty('--rain-delay', `${-(now - drop.start)}ms`);
    parent.append(char);
    start = index + drop.char.length;
  }
  parent.append(highlighted(text.slice(start)));
}

function renderCode(now) {
  const replay = replays[current];
  const { text, cursor } = replay.view();
  const allLines = text.split('\n');
  const cursorLine = text.slice(0, cursor).split('\n').length - 1;
  // Window large files around the cursor; full small files remain scrollable.
  const start = allLines.length > 1000 ? Math.max(0, cursorLine - 80) : 0;
  const end = allLines.length > 1000 ? Math.min(allLines.length, cursorLine + 170) : allLines.length;
  const fragment = document.createDocumentFragment();
  const falling = [...rain].sort((a, b) => a[0] - b[0]);
  let position = allLines.slice(0, start).reduce((sum, line) => sum + line.length + 1, 0);
  let active;
  for (let i = start; i < end; i++) {
    const line = allLines[i];
    const row = document.createElement('span');
    row.className = 'code-line';
    const lineNumber = document.createElement('span');
    lineNumber.className = 'line-number'; lineNumber.textContent = i + 1;
    const content = document.createElement('span');
    content.className = 'line-content';
    row.append(lineNumber, content);
    if (i === cursorLine && !replay.done) {
      row.classList.add('active-line');
      const col = cursor - position;
      appendSource(content, line.slice(0, col), position, falling, now);
      const caret = document.createElement('span'); caret.className = 'caret'; content.append(caret); active = caret;
      appendSource(content, line.slice(col), position + col, falling, now);
    } else appendSource(content, line, position, falling, now);
    fragment.append(row);
    position += line.length + 1;
  }
  $('code').replaceChildren(fragment);
  $('empty-code').hidden = text.length !== 0;
  $('empty-code').textContent = replay.done && replay.file.kind === 'deleted' ? 'File deleted.' : 'New file. Press any key to begin.';
  if (followCursor && active) {
    const viewport = $('code-scroll');
    const top = active.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    if (top < 25 || top > viewport.clientHeight - 50) viewport.scrollTop += top - viewport.clientHeight / 3;
  }
  followCursor = false;
}

function render() {
  rendering = false;
  const now = performance.now();
  for (const [position, drop] of rain) if (now - drop.start >= drop.duration || reducedMotion.matches) rain.delete(position);
  const replay = replays[current];
  const progress = replays.reduce((n, r) => n + r.progress, 0);
  const doneCount = replays.filter(r => r.done).length;
  const complete = doneCount === replays.length;
  const percent = Math.floor(progress / session.total * 100);
  $('files').value = String(current);
  $('file-kind').textContent = replay.file.kind.toUpperCase();
  $('file-progress').textContent = `${number(replay.progress)} / ${number(replay.total)} CHARACTERS`;
  $('phase').textContent = complete ? 'COMPLETE' : replay.done ? 'FILE COMPLETE' : keystrokes ? 'REPLAYING' : 'READY';
  $('percent').textContent = `${percent}%`;
  $('progress').value = percent;
  $('keys').textContent = number(keystrokes);
  $('completed-files').textContent = `${doneCount} / ${replays.length}`;
  $('skip').disabled = replay.done;
  for (const [i, option] of [...$('files').options].entries()) {
    option.textContent = `${replays[i].done ? '✓ ' : ''}${replays[i].file.path}`;
  }
  $('completion').hidden = !complete || rain.size > 0;
  $('mash-title').textContent = complete ? 'REPLAY COMPLETE' : 'MASH ANY KEY';
  $('mash').disabled = complete;
  if (complete) {
    finished ||= Date.now();
    $('end-keys').textContent = number(keystrokes);
    $('end-time').textContent = `${started ? Math.max(1, Math.round((finished - started) / 1000)) : 0}s`;
    $('end-files').textContent = replays.length;
    $('announcement').textContent = 'Replay complete.';
  }
  renderCode(now);
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
  started ||= Date.now();
  if (replays[current].done) { clearRain(); current = replays.findIndex(r => !r.done); }
  keystrokes++;
  addRain(replays[current].step(speed).inserted);
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
  if (!replays) return;
  clearRain();
  replays[current].step(replays[current].total);
  if (!replays.every(r => r.done)) current = replays.findIndex(r => !r.done);
  followCursor = true; render();
});
$('reset').addEventListener('click', reset);
$('again').addEventListener('click', () => { reset(); $('code-scroll').focus(); });
$('files').addEventListener('change', () => {
  clearRain(); current = Number($('files').value); followCursor = true;
  render(); $('code-scroll').focus();
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
  const response = await fetch('session.json');
  if (!response.ok) throw new Error('This local session is unavailable. Launch SloppyTyper again.');
  session = await response.json();
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
  $('phase').textContent = 'CONNECTION LOST';
}
