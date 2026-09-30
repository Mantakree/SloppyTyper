import { mkdir, readFile, writeFile, rename, readdir, stat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const dataDir = () => path.resolve(process.env.SLOPPYTYPER_HOME || path.join(homedir(), '.sloppytyper'));
export const stateKey = (root, source, id) => createHash('sha256').update(JSON.stringify([root, source, id])).digest('hex');
export const statePath = key => path.join(dataDir(), `baseline-${key}.json`);
export async function readJSON(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
export async function writeJSON(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  await rename(temp, file);
}
export async function prune() {
  await mkdir(dataDir(), { recursive: true, mode: 0o700 });
  for (const name of await readdir(dataDir())) {
    if (!/^(baseline-|session-)[a-f0-9-]+\.json(?:\.[a-f0-9-]+\.tmp)?$/.test(name)) continue;
    const file = path.join(dataDir(), name);
    if (Date.now() - (await stat(file)).mtimeMs > 7 * 86400000) await unlink(file);
  }
}
