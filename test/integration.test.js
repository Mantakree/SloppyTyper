import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { snapshot, isSource } from '../src/snapshot.js';
import { makeSession } from '../src/session.js';
import { createViewer } from '../src/server.js';
import { demoSession } from '../src/demo.js';
import { Replay } from '../web/replay.js';
import { begin, finish, handleHook } from '../src/hooks.js';
import { install } from '../src/integrations.js';

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sloppytyper-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'repo with spaces');
  await mkdir(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-b', 'main'); git('config', 'user.name', 'SloppyTyper Test'); git('config', 'user.email', 'test@example.invalid');
  await writeFile(path.join(repo, 'app.js'), 'const answer = 1;\n');
  await writeFile(path.join(repo, '.gitignore'), 'ignored.js\n');
  git('add', '.'); git('commit', '-m', 'fixture');
  return { dir, repo, git };
}

test('captures staged, unstaged, untracked, deleted, renamed files and preserves repository bytes/index', async t => {
  const { repo, git } = await fixture(t);
  await writeFile(path.join(repo, 'app.js'), 'const answer = 2;\n');
  git('add', 'app.js');
  await writeFile(path.join(repo, 'app.js'), 'const answer = 3;\n');
  await writeFile(path.join(repo, 'new file 🦊.ts'), 'export const fox = "🦊";\n');
  await writeFile(path.join(repo, 'ignored.js'), 'ignored');
  await writeFile(path.join(repo, 'credentials.json'), '{"password":"excluded"}');
  await writeFile(path.join(repo, 'binary.js'), Buffer.from([0, 42, 1]));
  await writeFile(path.join(repo, 'invalid.js'), Buffer.from([0xff, 0xfe, 0xfd]));
  const statusBefore = git('status', '--porcelain=v1');
  const indexBefore = await readFile(path.join(repo, '.git', 'index'));
  const before = await snapshot(repo, { ref: 'HEAD' });
  const after = await snapshot(repo);
  assert.equal(after.files['app.js'], 'const answer = 3;\n');
  assert.equal(after.files['ignored.js'], undefined);
  assert.equal(after.files['credentials.json'], undefined);
  assert.ok(after.skipped.includes('binary.js'));
  assert.ok(after.skipped.includes('invalid.js'));
  const session = makeSession(before, after);
  for (const file of session.files) { const replay = new Replay(file); replay.step(file.total); assert.equal(replay.view().text, file.after); }
  assert.deepEqual(await readFile(path.join(repo, '.git', 'index')), indexBefore);
  assert.equal(git('status', '--porcelain=v1'), statusBefore);
  assert.equal(await readFile(path.join(repo, 'app.js'), 'utf8'), 'const answer = 3;\n');
  git('mv', 'app.js', 'renamed.js');
  const renamed = makeSession(after, await snapshot(repo));
  assert.equal(renamed.files.find(f => f.path === 'app.js').kind, 'deleted');
  assert.equal(renamed.files.find(f => f.path === 'renamed.js').kind, 'added');
});

test('turn hooks respect dirty baseline, commits, sessions, no-op and duplicate stops', async t => {
  const { repo, dir, git } = await fixture(t);
  const previous = process.env.SLOPPYTYPER_HOME;
  process.env.SLOPPYTYPER_HOME = path.join(dir, 'state');
  t.after(() => { if (previous === undefined) delete process.env.SLOPPYTYPER_HOME; else process.env.SLOPPYTYPER_HOME = previous; });
  let launches = 0, replaySession;
  const launchViewer = async session => { launches++; replaySession = session; return 'http://127.0.0.1/test/'; };
  await writeFile(path.join(repo, 'app.js'), 'existing user work\n');
  for (const source of ['codex', 'claude']) {
    const payload = { session_id: `${source}-session`, cwd: repo, ...(source === 'codex' ? { turn_id: 'turn-1' } : {}) };
    await handleHook({ ...payload, hook_event_name: 'UserPromptSubmit' }, source);
    assert.equal((await handleHook({ ...payload, hook_event_name: 'Stop' }, source, { launchViewer })).reason, 'No source changes in this turn.');
    const old = await readFile(path.join(repo, 'app.js'), 'utf8');
    await writeFile(path.join(repo, 'app.js'), `${source} changed this\n`);
    git('add', '.'); git('commit', '-m', source);
    const result = await handleHook({ ...payload, hook_event_name: 'Stop' }, source, { launchViewer });
    assert.equal(result.files, 1); assert.equal(replaySession.files[0].before, old);
    const count = launches;
    await handleHook({ ...payload, hook_event_name: 'Stop' }, source, { launchViewer });
    assert.equal(launches, count);
    assert.equal((await finish(repo, source, 'missing', { launchViewer })).url, undefined);
  }
  assert.equal(launches, 2);
  await begin(repo, 'manual', 'manual-session');
  await writeFile(path.join(repo, 'new.js'), 'new code');
  await finish(repo, 'manual', 'manual-session', { launchViewer });
  assert.equal(replaySession.files[0].kind, 'added');
});

test('source filtering and limits skip unsupported and sensitive files', async t => {
  for (const file of ['.env', '.env.local', 'secrets.json', 'foo/credentials.yml', 'node_modules/a.js', 'dist/a.js', 'package-lock.json', 'private.pem', 'photo.png']) assert.equal(isSource(file), false, file);
  for (const file of ['main.ts', 'src/my-file.cs', 'script.ps1', 'Makefile', 'config.toml']) assert.equal(isSource(file), true, file);
  const { repo } = await fixture(t);
  await writeFile(path.join(repo, 'huge.js'), 'x'.repeat(500));
  const result = await snapshot(repo, { maxFileBytes: 100 });
  assert.ok(result.skipped.includes('huge.js')); assert.equal(result.files['huge.js'], undefined);
});

test('viewer serves only immutable session and bundled assets on tokenized loopback URL', async t => {
  const session = demoSession();
  session.files[0].before = '<script>alert("source is text")</script>';
  const { server, url } = await createViewer(session);
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await (await fetch(`${url}session.json`)).json(), session);
  assert.equal((await fetch(new URL('/', url))).status, 404);
  assert.equal((await fetch(`${url}session.json`, { method: 'POST', body: 'change files' })).status, 405);
  assert.equal((await fetch(`${url}session.json`, { headers: { Origin: 'https://example.com' } })).status, 403);
  assert.equal((await fetch(`${url}../../package.json`)).status, 404);
  assert.equal((await fetch(`${url}app.js`)).status, 200);
  assert.equal((await fetch(`${url}code-view.js`)).status, 200);
  assert.deepEqual(await (await fetch(`${url}session.json`)).json(), session);
});

test('installer is idempotent, preserves unrelated config, and uninstall removes only owned hooks/skill', async t => {
  const { dir } = await fixture(t);
  const home = path.join(dir, 'home');
  await mkdir(path.join(home, '.claude'), { recursive: true });
  const existing = { permissions: { allow: ['Bash(git status)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo existing' }] }] } };
  const claudeFile = path.join(home, '.claude', 'settings.json');
  await writeFile(claudeFile, JSON.stringify(existing));
  const options = { home, codexHome: path.join(home, '.codex') };
  await install(options); await install(options);
  const result = JSON.parse(await readFile(claudeFile));
  assert.deepEqual(result.permissions, existing.permissions);
  assert.equal(result.hooks.Stop.length, 2);
  assert.equal(result.hooks.UserPromptSubmit.length, 1);
  assert.equal(result.hooks.Stop[0].hooks[0].command, 'echo existing');
  const skill = await readFile(path.join(home, '.codex', 'skills', 'sloppytyper', 'SKILL.md'), 'utf8');
  assert.ok(!skill.includes('__SLOPPYTYPER_CLI__'));
  await install({ ...options, remove: true });
  assert.deepEqual(JSON.parse(await readFile(claudeFile)), existing);
  assert.ok((await readdir(path.join(home, '.claude'))).some(f => f.endsWith('.bak')));
});
