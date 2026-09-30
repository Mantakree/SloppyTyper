import copy
import hashlib
import json
import os
from pathlib import Path
import random
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from src.hooks import begin, finish, handle_hook
from src.integrations import hook_command, install
from src.session import diff_parts, make_session
from src.snapshot import is_source, repo_root, snapshot
from src.storage import data_dir, prune, read_json, state_path, write_json
from src.viewer import launch

ROOT = Path(__file__).resolve().parent.parent
CLI = ROOT / 'sloppytyper.py'


class RepositoryTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='sloppytyper-test-')
        self.addCleanup(temp.cleanup)
        self.directory = Path(temp.name)
        self.repo = self.directory / 'repo with spaces café'
        self.repo.mkdir()
        self.cache = self.directory / 'cache'
        env = patch.dict(os.environ, SLOPPYTYPER_HOME=str(self.cache), SLOPPYTYPER_NO_OPEN='1')
        env.start()
        self.addCleanup(env.stop)
        self.git('init', '-b', 'main')
        self.git('config', 'user.name', 'SloppyTyper Test')
        self.git('config', 'user.email', 'test@example.invalid')
        self.git('config', 'core.autocrlf', 'false')
        self.write('app.js', 'const answer = 1;\n')
        self.write('.gitignore', 'ignored.js\n')
        self.git('add', '.')
        self.git('commit', '-m', 'fixture')

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], stderr=subprocess.PIPE,
                                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))

    def write(self, name, content):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content.encode('utf-8') if isinstance(content, str) else content)

    def cli(self, *args, payload=None):
        return subprocess.run([sys.executable, '-B', str(CLI), *args], input=payload, capture_output=True,
                              cwd=self.repo, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))

    def tree_bytes(self):
        return {str(p.relative_to(self.repo)): p.read_bytes() for p in self.repo.rglob('*') if p.is_file()}

    def test_capture_and_launch_leave_every_repository_byte_unchanged(self):
        self.write('app.js', 'staged();\n')
        self.git('add', 'app.js')
        self.write('app.js', 'unstaged();\r\n')
        self.write('new file 🦊.ts', 'export const fox = "🦊";\r\n')
        self.write('ignored.js', 'ignored')
        self.write('credentials.json', '{"password":"excluded"}')
        self.write('binary.js', b'\0hello')
        self.write('invalid.js', b'\xff\xfe')
        initial = self.tree_bytes()
        before, after = snapshot(self.repo, ref='HEAD'), snapshot(self.repo)
        self.assertEqual(after['files']['app.js'], 'unstaged();\r\n')
        self.assertNotIn('ignored.js', after['files'])
        self.assertNotIn('credentials.json', after['files'])
        self.assertIn('binary.js', after['skipped'])
        self.assertIn('invalid.js', after['skipped'])
        html = launch(make_session(before, after), open_browser=False, root=self.repo)
        self.assertTrue(Path(html).is_file())
        self.assertEqual(self.tree_bytes(), initial)
        self.git('mv', 'app.js', 'renamed.js')
        changed = make_session(after, snapshot(self.repo))
        self.assertEqual({f['path']: f['kind'] for f in changed['files']}, {'app.js': 'deleted', 'renamed.js': 'added'})

    def test_dirty_baselines_commits_duplicate_stops_and_child_agents(self):
        self.write('app.js', 'existing user work\n')
        sessions = []

        def launcher(session, **options):
            sessions.append(session)
            return 'C:/saved/replay.html'

        for source in ('codex', 'claude'):
            payload = dict(session_id=source, cwd=str(self.repo))
            if source == 'codex':
                payload['turn_id'] = 'turn-1'
            handle_hook(dict(payload, hook_event_name='UserPromptSubmit'), source)
            result = handle_hook(dict(payload, hook_event_name='Stop'), source, launch_viewer=launcher)
            self.assertIn('No source changes', result['reason'])
            old = (self.repo / 'app.js').read_text()
            self.write('app.js', source + ' changed this\n')
            if source == 'codex':
                handle_hook(dict(payload, hook_event_name='UserPromptSubmit'), source)
            self.git('add', '.')
            self.git('commit', '-m', source)
            result = handle_hook(dict(payload, hook_event_name='Stop'), source, launch_viewer=launcher)
            self.assertEqual(result['files'], 1)
            self.assertEqual(sessions[-1]['files'][0]['before'], old)
            count = len(sessions)
            handle_hook(dict(payload, hook_event_name='Stop'), source, launch_viewer=launcher)
            handle_hook(dict(payload, agent_id='child', hook_event_name='Stop'), source, launch_viewer=launcher)
            self.assertEqual(len(sessions), count)
        self.assertEqual(len(sessions), 2)
        self.assertIn('No start snapshot', finish(self.repo, 'manual', 'missing')['reason'])

    def test_begin_end_without_commits_and_no_bytecode_written(self):
        unborn = self.directory / 'unborn'
        unborn.mkdir()
        subprocess.run(['git', '-C', str(unborn), 'init', '-b', 'main'], check=True, capture_output=True)
        begin(unborn, 'manual', 'turn')
        (unborn / 'new.py').write_text('print("hello")\n')
        result = finish(unborn, 'manual', 'turn', open_browser=False)
        self.assertEqual(result['files'], 1)
        bytecode_before = list(ROOT.rglob('*.pyc'))
        completed = self.cli('demo', '--no-open')
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(list(ROOT.rglob('*.pyc')), bytecode_before)

    def test_committed_range_excludes_dirty_work(self):
        self.write('app.js', 'committed();\n')
        self.git('add', '.')
        self.git('commit', '-m', 'second')
        self.write('app.js', 'dirty();\n')
        result = self.cli('replay', '--base', 'HEAD~1', '--to', 'HEAD', '--no-open')
        self.assertEqual(result.returncode, 0, result.stderr)
        html = Path(result.stdout.decode('utf-8').strip()).read_text(encoding='utf-8')
        self.assertIn('committed();', html)
        self.assertNotIn('dirty();', html)

    def test_limits_never_make_skipped_files_look_deleted(self):
        before = snapshot(self.repo)
        self.write('app.js', 'x' * 500)
        after = snapshot(self.repo, max_file_bytes=100)
        self.assertIn('app.js', after['skipped'])
        self.assertEqual(make_session(before, after)['files'], [])
        self.assertIn('app.js', snapshot(self.repo, max_total_bytes=50)['skipped'])

    def test_symlinks_are_not_followed_in_worktree_or_git(self):
        self.git('config', 'core.symlinks', 'true')
        try:
            (self.repo / 'link.js').symlink_to(self.repo / 'app.js')
        except OSError:
            self.skipTest('Windows account cannot create symlinks')
        self.git('add', 'link.js')
        self.git('commit', '-m', 'symlink')
        self.assertIn('link.js', snapshot(self.repo)['skipped'])
        self.assertIn('link.js', snapshot(self.repo, ref='HEAD')['skipped'])

    def test_cache_inside_checkout_is_rejected_before_any_write(self):
        with patch.dict(os.environ, SLOPPYTYPER_HOME=str(self.repo / 'cache')):
            with self.assertRaisesRegex(ValueError, 'outside'):
                begin(self.repo, 'manual', 'turn')
            with self.assertRaisesRegex(ValueError, 'outside'):
                prune(self.repo)
            self.assertFalse((self.repo / 'cache').exists())

    def test_hook_cli_invalid_payload_is_nonblocking(self):
        for payload in (b'{broken', b'{}', b'[]', b'x' * (4 * 1024 * 1024 + 1)):
            result = self.cli('hook', '--source', 'codex', payload=payload)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(json.loads(result.stdout), {})

    @unittest.skipUnless(os.name == 'nt', 'Windows hook launcher')
    def test_installed_powershell_command_passes_real_utf8_hook_stdin(self):
        command = hook_command('codex')
        encoded = command.split('-EncodedCommand ', 1)[1]
        args = ['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded]
        payload = dict(session_id='real-hook', turn_id='one', cwd=str(self.repo), hook_event_name='UserPromptSubmit')
        result = subprocess.run(args, input=json.dumps(payload, ensure_ascii=False).encode('utf-8'), capture_output=True,
                                timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {})
        self.assertIsNotNone(read_json(state_path(repo_root(self.repo), 'codex', 'real-hook:one')))
        self.write('app.js', 'from_hook();\n')
        payload['hook_event_name'] = 'Stop'
        result = subprocess.run(args, input=json.dumps(payload, ensure_ascii=False).encode('utf-8'), capture_output=True,
                                timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
        output = json.loads(result.stdout)
        self.assertIn('.html', output['systemMessage'])
        self.assertEqual(len(list(self.cache.glob('session-*.html'))), 1)


class DiffTests(unittest.TestCase):
    def test_exact_unicode_and_line_endings_across_random_edits(self):
        randomizer = random.Random(48721)
        alphabet = list('abc\n \ré') + ['🦊', '\ufeff', '\u2028']
        pairs = [('a\r\nb\r\n', 'a\nb\nc\n'), ('🦊', '🦄'), ('', 'new'), ('gone', '')]
        for _ in range(150):
            pairs.append(tuple(''.join(randomizer.choices(alphabet, k=randomizer.randrange(100))) for _ in range(2)))
        for before, after in pairs:
            parts = diff_parts(before, after)
            self.assertEqual(''.join(p['text'] for p in parts if p['type'] != 'add'), before)
            self.assertEqual(''.join(p['text'] for p in parts if p['type'] != 'remove'), after)

    def test_large_repetitive_rewrite_is_bounded_and_exact(self):
        before, after = 'ab' * 120000, 'ba' * 120000
        start = time.monotonic()
        parts = diff_parts(before, after)
        self.assertLess(time.monotonic() - start, 2)
        self.assertEqual(parts, [dict(type='remove', text=before), dict(type='add', text=after)])

    def test_small_edit_in_large_file_preserves_surrounding_code(self):
        before = 'x\n' * 50000 + 'const n = 1;\n' + 'y\n' * 50000
        after = before.replace('n = 1', 'n = 20')
        changes = [p for p in diff_parts(before, after) if p['type'] != 'equal']
        self.assertEqual(changes, [dict(type='remove', text='1'), dict(type='add', text='20')])

    def test_empty_files_require_one_key_and_snapshots_are_unchanged(self):
        meta = dict(root='test', name='test', branch='main', skipped=[])
        before, after = dict(meta, files={}), dict(meta, files={'empty.ts': ''})
        original = copy.deepcopy((before, after))
        for a, b, kind in ((before, after, 'added'), (after, before, 'deleted')):
            result = make_session(a, b)
            self.assertEqual(result['files'][0]['total'], 1)
            self.assertEqual(result['files'][0]['kind'], kind)
        self.assertEqual((before, after), original)

    def test_source_filters(self):
        for name in ('.env', '.env.local', 'secrets.json', 'foo/credentials.yml', 'node_modules/a.js', 'dist/a.js', 'package-lock.json', 'private.pem', 'photo.png'):
            self.assertFalse(is_source(name), name)
        for name in ('main.ts', 'src/my-file.cs', 'script.ps1', 'Makefile', 'config.toml'):
            self.assertTrue(is_source(name), name)


class StorageAndInstallTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='sloppytyper-config-')
        self.addCleanup(temp.cleanup)
        self.home = Path(temp.name)
        environment = patch.dict(os.environ, SLOPPYTYPER_HOME=str(self.home / 'cache'))
        environment.start()
        self.addCleanup(environment.stop)

    def test_migrate_node_hooks_idempotently_and_preserve_other_settings(self):
        old_hook = dict(type='command', command='node "C:/old/sloppytyper.js" hook --sloppytyper-hook')
        existing = dict(permissions={'defaultMode': 'acceptEdits'}, hooks={'Stop': [dict(matcher='', hooks=[dict(type='command', command='echo existing'), old_hook])]})
        config = self.home / '.claude/settings.json'
        write_json(config, existing)
        options = dict(home=self.home, codex_home=self.home / '.codex')
        install(**options)
        migrated = read_json(config)
        backups = list(config.parent.glob('*.bak'))
        install(**options)
        self.assertEqual(read_json(config), migrated)
        self.assertEqual(list(config.parent.glob('*.bak')), backups)
        self.assertEqual(migrated['permissions'], existing['permissions'])
        self.assertEqual(len(migrated['hooks']['Stop']), 2)
        self.assertEqual(migrated['hooks']['Stop'][0]['hooks'], [dict(type='command', command='echo existing')])
        self.assertNotIn('node ', migrated['hooks']['Stop'][1]['hooks'][0]['command'])
        skill = (self.home / '.codex/skills/sloppytyper/SKILL.md').read_text(encoding='utf-8')
        self.assertNotIn('__SLOPPYTYPER_', skill)
        self.assertIn('sloppytyper.py', skill)
        install(remove=True, **options)
        self.assertEqual(read_json(config), dict(permissions=existing['permissions'], hooks={'Stop': [dict(matcher='', hooks=[dict(type='command', command='echo existing')])]}))
        self.assertFalse((self.home / '.codex/skills/sloppytyper/SKILL.md').exists())

    def test_unrelated_skill_is_not_overwritten(self):
        path = self.home / '.codex/skills/sloppytyper/SKILL.md'
        path.parent.mkdir(parents=True)
        path.write_text('User-owned skill')
        with self.assertRaisesRegex(ValueError, 'unrelated skill'):
            install('codex', home=self.home, codex_home=self.home / '.codex')
        self.assertEqual(path.read_text(), 'User-owned skill')
        self.assertFalse((self.home / '.codex/hooks.json').exists())

    def test_prune_only_owned_expired_cache_files(self):
        cache = data_dir()
        cache.mkdir()
        for name in ('session-abcd.html', 'baseline-abcd.json', 'session-abcd.json', 'notes.html'):
            path = cache / name
            path.write_text('copy')
            os.utime(path, (0, 0))
        fresh = cache / 'session-abcd-1234.html'
        fresh.write_text('new')
        prune()
        self.assertEqual({p.name for p in cache.iterdir()}, {'notes.html', fresh.name})

    def test_state_key_matches_existing_node_snapshots(self):
        root = 'C:\\Projects\\My Repo'
        serialized = '["C:\\\\Projects\\\\My Repo","manual","turn"]'
        expected = hashlib.sha256(serialized.encode()).hexdigest()
        self.assertEqual(state_path(root, 'manual', 'turn').name, f'baseline-{expected}.json')


if __name__ == '__main__':
    unittest.main()
