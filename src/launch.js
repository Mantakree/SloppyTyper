import { fork, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { dataDir, writeJSON } from './storage.js';

export async function openBrowser(url) {
  let command, args;
  if (process.platform === 'win32') {
    command = 'powershell.exe';
    args = ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(`Start-Process '${url.replaceAll("'", "''")}'`, 'utf16le').toString('base64')];
  } else { command = process.platform === 'darwin' ? 'open' : 'xdg-open'; args = [url]; }
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Browser opener exited ${code}. Open the printed URL manually.`)));
  });
}

export async function launch(session, { open = true } = {}) {
  const file = path.join(dataDir(), `session-${session.id}.json`);
  await writeJSON(file, session);
  const child = fork(fileURLToPath(new URL('../bin/sloppytyper.js', import.meta.url)), ['serve-session', '--file', file], {
    detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Viewer did not start within 10 seconds.')); }, 10000);
    child.once('message', message => { clearTimeout(timer); resolve(message.url); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Viewer exited (${code}).`)); });
  });
  child.disconnect();
  child.unref();
  if (open) {
    try { await openBrowser(url); } catch (error) { process.stderr.write(`SloppyTyper: ${error.message}\n${url}\n`); }
  }
  return url;
}
