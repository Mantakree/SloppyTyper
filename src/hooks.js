import { snapshot, repoRoot } from './snapshot.js';
import { makeSession } from './session.js';
import { stateKey, statePath, readJSON, writeJSON, prune } from './storage.js';
import { launch } from './launch.js';

export async function begin(cwd, source, id, { preserve = false } = {}) {
  const root = await repoRoot(cwd);
  const file = statePath(stateKey(root, source, id));
  if (preserve && await readJSON(file)) return;
  await writeJSON(file, await snapshot(root));
}

export async function finish(cwd, source, id, { open = true, launchViewer = launch } = {}) {
  const root = await repoRoot(cwd);
  const file = statePath(stateKey(root, source, id));
  const before = await readJSON(file);
  if (!before) return { reason: 'No start snapshot. Start a new turn, or use begin before editing.' };
  const after = await snapshot(root);
  const session = makeSession(before, after, source);
  if (!session.files.length) { await writeJSON(file, after); return { reason: 'No source changes in this turn.' }; }
  const url = await launchViewer(session, { open });
  // Advancing the baseline makes duplicate Stop events quiet.
  await writeJSON(file, after);
  return { url, files: session.files.length, skipped: session.skipped.length };
}

export async function handleHook(payload, source, options = {}) {
  if (!['codex', 'claude'].includes(source)) throw new Error('Unknown hook source.');
  if (!payload.session_id || !payload.cwd || payload.agent_id) return;
  const id = payload.turn_id ? `${payload.session_id}:${payload.turn_id}` : payload.session_id;
  if (payload.hook_event_name === 'UserPromptSubmit') {
    await prune();
    await begin(payload.cwd, source, id, { preserve: Boolean(payload.turn_id) });
  } else if (payload.hook_event_name === 'Stop') {
    // Never block a turn, ask the model to continue, or react to child agents.
    return finish(payload.cwd, source, id, { open: process.env.SLOPPYTYPER_NO_OPEN !== '1', ...options });
  }
}
