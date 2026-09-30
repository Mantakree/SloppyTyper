import { diffChars, diffLines } from 'diff';
import { randomUUID } from 'node:crypto';

export function makeSession(before, after, source = 'manual') {
  if (before.root !== after.root) throw new Error('Snapshots belong to different repositories.');
  const skipped = new Set([...before.skipped, ...after.skipped]);
  const files = [];
  for (const name of [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].sort()) {
    if (skipped.has(name)) continue;
    const oldText = before.files[name] ?? '';
    const newText = after.files[name] ?? '';
    const existed = Object.hasOwn(before.files, name);
    const exists = Object.hasOwn(after.files, name);
    if (oldText === newText && existed === exists) continue;
    // Bound character diff work; large rewrites fall back to a line diff.
    const changes = diffChars(oldText, newText, { timeout: 60 }) ?? diffLines(oldText, newText, { timeout: 60 })
      ?? [{ removed: true, value: oldText }, { added: true, value: newText }];
    const parts = changes.filter(p => p.value).map(p => ({ type: p.added ? 'add' : p.removed ? 'remove' : 'equal', text: p.value }));
    const added = parts.filter(p => p.type === 'add').reduce((n, p) => n + [...p.text].length, 0);
    const removed = parts.filter(p => p.type === 'remove').reduce((n, p) => n + [...p.text].length, 0);
    files.push({ path: name, kind: !existed ? 'added' : !exists ? 'deleted' : 'modified', before: oldText, after: newText, parts, added, removed, total: Math.max(1, added + removed) });
  }
  return { id: randomUUID(), repo: after.name, branch: after.branch, source, createdAt: new Date().toISOString(), files, skipped: [...skipped], total: files.reduce((n, f) => n + f.total, 0) };
}
