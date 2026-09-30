import { Replay } from './replay.js';

const $ = id => document.getElementById(id);
let session, replays, current = 0, keystrokes = 0, speed = 1, started = 0, sound = false, audio;
let rendering = false, followCursor = false;
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

function renderCode() {
  const replay = replays[current];
  const { text, cursor } = replay.view();
  const allLines = text.split('\n');
  const cursorLine = text.slice(0, cursor).split('\n').length - 1;
  // Window large files around the cursor; full small files remain scrollable.
  const start = allLines.length > 1000 ? Math.max(0, cursorLine - 80) : 0;
  const end = allLines.length > 1000 ? Math.min(allLines.length, cursorLine + 170) : allLines.length;
  const fragment = document.createDocumentFragment();
  let position = allLines.slice(0, start).reduce((sum, line) => sum + line.length + 1, 0);
  let active;
  for (let i = start; i < end; i++) {
    const line = allLines[i];
    const row = document.createElement('span');
    row.className = 'code-line';
    const lineNumber = document.createElement('span');
    lineNumber.className = 'line-number'; lineNumber.textContent = i + 1;
    row.append(lineNumber);
    if (i === cursorLine && !replay.done) {
      row.classList.add('active-line'); active = row;
      const col = cursor - position;
      row.append(highlighted(line.slice(0, col)));
      const caret = document.createElement('span'); caret.className = 'caret'; row.append(caret);
      row.append(highlighted(line.slice(col)));
    } else row.append(highlighted(line || ' '));
    fragment.append(row);
    position += line.length + 1;
  }
  $('code').replaceChildren(fragment);
  $('empty-code').hidden = text.length !== 0;
  $('empty-code').textContent = replay.done && replay.file.kind === 'deleted' ? 'File deleted. Very productive of you.' : 'New file. A blank canvas for your borrowed brilliance.';
  if (followCursor && active) {
    const viewport = $('code-scroll');
    const top = active.offsetTop - $('code').offsetTop;
    if (top < viewport.scrollTop + 25 || top > viewport.scrollTop + viewport.clientHeight - 50) viewport.scrollTop = Math.max(0, top - viewport.clientHeight / 3);
  }
  followCursor = false;
}

function render() {
  rendering = false;
  const replay = replays[current];
  const progress = replays.reduce((n, r) => n + r.progress, 0);
  const doneCount = replays.filter(r => r.done).length;
  const complete = doneCount === replays.length;
  const percent = Math.floor(progress / session.total * 100);
  $('file-name').textContent = replay.file.path;
  $('file-kind').textContent = replay.file.kind.toUpperCase();
  $('file-progress').textContent = `${number(replay.progress)} / ${number(replay.total)} CHARACTERS`;
  $('phase').textContent = complete ? 'ACCOMPLISHMENT UNLOCKED' : replay.done ? 'FILE COMPLETE' : keystrokes ? 'HIGHLY SKILLED TYPING IN PROGRESS' : 'AWAITING YOUR GENIUS';
  $('operation').textContent = replay.done ? 'LOOKS LIKE YOU WROTE IT' : !keystrokes ? 'READY WHEN YOU ARE ▌' : replay.view().operation === 'remove' ? 'REMOVING CODE. STILL COUNTS AS WORK.' : 'GENERATING PLAUSIBLE DENIABILITY ▌';
  $('percent').textContent = `${percent}%`;
  $('progress').value = percent;
  $('keys').textContent = number(keystrokes);
  $('completed-files').textContent = `${doneCount} / ${replays.length}`;
  $('skip').disabled = replay.done;
  for (const [i, button] of [...$('files').children].entries()) {
    button.classList.toggle('active', i === current);
    button.classList.toggle('done', replays[i].done);
    button.setAttribute('aria-current', i === current ? 'true' : 'false');
    button.lastChild.textContent = replays[i].done ? '✓' : ({ added: 'A', deleted: 'D', modified: 'M' })[replays[i].file.kind];
  }
  $('completion').hidden = !complete;
  $('mash-title').textContent = complete ? 'GLORY SUCCESSFULLY CLAIMED' : 'MASH ANY KEY';
  $('mash-description').textContent = complete ? 'Your keyboard has earned a break.' : 'Go on. You definitely wrote this.';
  $('mash').disabled = complete;
  if (complete) {
    $('end-keys').textContent = number(keystrokes);
    $('end-time').textContent = `${started ? Math.max(1, Math.round((Date.now() - started) / 1000)) : 0}s`;
    $('announcement').textContent = 'Replay complete. Pride and accomplishment unlocked. No files were changed.';
  }
  renderCode();
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
  if (replays[current].done) current = replays.findIndex(r => !r.done);
  keystrokes++;
  replays[current].step(speed);
  followCursor = true;
  blip(); scheduleRender();
}
function reset() {
  if (!session) return;
  replays = session.files.map(file => new Replay(file));
  current = 0; keystrokes = 0; started = 0;
  $('announcement').textContent = 'Replay restarted.';
  $('code-scroll').scrollTop = 0;
  render();
}

$('mash').addEventListener('click', mash);
$('skip').addEventListener('click', () => {
  if (!replays) return;
  replays[current].step(replays[current].total);
  if (!replays.every(r => r.done)) current = replays.findIndex(r => !r.done);
  followCursor = true; render();
});
$('reset').addEventListener('click', reset);
$('again').addEventListener('click', () => { reset(); $('code-scroll').focus(); });
$('focus').addEventListener('click', () => document.body.classList.toggle('focus-mode'));
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
  if (event.key === 'Escape') { document.body.classList.remove('focus-mode'); return; }
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
  $('repo').textContent = session.repo;
  $('branch').textContent = `⑂ ${session.branch}`;
  $('source').textContent = session.source === 'demo' ? 'DEMO SESSION' : `${session.source.toUpperCase()} SESSION`;
  $('file-count').textContent = `${String(session.files.length).padStart(2, '0')} FILES`;
  if (session.skipped.length) $('skipped').textContent = `${session.skipped.length} unsupported file(s) skipped`;
  session.files.forEach((file, i) => {
    const button = document.createElement('button'); button.className = 'file-button'; button.title = file.path;
    const icon = document.createElement('span'); icon.className = 'file-icon'; icon.textContent = '⌘';
    const label = document.createElement('span'); label.className = 'file-label'; label.textContent = file.path.split('/').pop();
    const badge = document.createElement('span'); badge.className = 'file-badge';
    button.append(icon, label, badge); button.setAttribute('aria-label', file.path);
    button.addEventListener('click', () => { current = i; followCursor = true; render(); $('code-scroll').focus(); });
    $('files').append(button);
  });
  reset();
} catch (error) {
  $('error').hidden = false; $('error').textContent = error.message;
  $('repo').textContent = 'Session unavailable'; $('mash').disabled = true;
  $('phase').textContent = 'CONNECTION LOST';
}
