"""Read Git revisions and working trees without refreshing or modifying the index."""
from datetime import datetime, timezone
import os
from pathlib import Path, PurePosixPath
import re
import subprocess

EXTENSIONS = set('js jsx mjs cjs ts tsx mts cts py rs go c h cpp hpp cc cs fs fsx java kt kts swift rb php lua sh bash zsh ps1 psm1 sql html htm css scss sass less vue svelte astro json jsonc yaml yml toml xml graphql gql proto ex exs erl hrl clj cljs dart r scala rkt zig nix ml mli tf hcl tex md mdx'.split())
NAMES = {'Dockerfile', 'Containerfile', 'Makefile', 'CMakeLists.txt', 'Justfile', '.gitignore', '.gitattributes', '.editorconfig'}
IGNORED_DIRS = re.compile(r'(^|/)(node_modules|vendor|dist|build|coverage|\.git|\.next|\.nuxt|\.venv|venv|__pycache__|\.codex|\.claude|\.agents)(/|$)')
SENSITIVE = re.compile(r'(^|[/._-])(secrets?|credentials?|tokens?|id_rsa|id_ed25519)([/._-]|$)|(^|/)\.env($|\.)', re.I)
LOCKFILES = re.compile(r'(^|/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Cargo\.lock|poetry\.lock|uv\.lock)$')


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def is_source(file):
    path = PurePosixPath(file)
    return bool(file and not IGNORED_DIRS.search(file) and not SENSITIVE.search(file)
                and not LOCKFILES.search(file)
                and (path.name in NAMES or path.suffix[1:].lower() in EXTENSIONS))


def git(cwd, *args):
    result = subprocess.run(
        ['git', '-C', str(cwd), *args], capture_output=True, check=True, timeout=15,
        env={**os.environ, 'GIT_OPTIONAL_LOCKS': '0'},
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
    )
    return result.stdout


def repo_root(cwd):
    return Path(git(cwd, 'rev-parse', '--show-toplevel').decode('utf-8').strip()).resolve()


def snapshot(cwd, ref=None, max_file_bytes=256 * 1024, max_total_bytes=16 * 1024 * 1024):
    root = repo_root(cwd)
    entries = {}
    if ref:
        revision = git(root, 'rev-parse', '--verify', '--end-of-options', f'{ref}^{{commit}}').decode().strip()
        for entry in git(root, 'ls-tree', '-r', '-z', '-l', revision).split(b'\0'):
            if not entry:
                continue
            metadata, filename = entry.split(b'\t', 1)
            mode, kind, oid, size = metadata.split()
            entries[filename.decode('utf-8')] = (mode, kind, oid, size)
    else:
        entries = dict.fromkeys(git(root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard').decode('utf-8').split('\0'))
    files, skipped, total = {}, [], 0
    for name in sorted(filter(is_source, entries)):
        try:
            if ref:
                mode, kind, oid, size = entries[name]
                if not mode.startswith(b'100') or kind != b'blob' or int(size) > max_file_bytes or total + int(size) > max_total_bytes:
                    skipped.append(name)
                    continue
                raw = git(root, 'cat-file', 'blob', oid.decode('ascii'))
            else:
                path = root / name
                stat = path.lstat()
                if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root):
                    skipped.append(name)
                    continue
                if stat.st_size > max_file_bytes or total + stat.st_size > max_total_bytes:
                    skipped.append(name)
                    continue
                # Bound reads even if another process grows the file during capture.
                with path.open('rb') as source:
                    raw = source.read(max_file_bytes + 1)
            if len(raw) > max_file_bytes or total + len(raw) > max_total_bytes or b'\0' in raw:
                skipped.append(name)
                continue
            files[name] = raw.decode('utf-8')
            total += len(raw)
        except FileNotFoundError:
            pass  # A tracked file missing from disk is a real deletion.
        except (OSError, UnicodeError, subprocess.SubprocessError):
            skipped.append(name)
    try:
        branch = git(root, 'symbolic-ref', '--short', 'HEAD').decode('utf-8').strip()
    except subprocess.CalledProcessError:
        branch = 'detached'
    return dict(root=str(root), name=root.name, branch=branch, files=files, skipped=skipped, capturedAt=timestamp())
