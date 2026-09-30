"""Local snapshots and standalone replays; never stored inside the target repo."""
import hashlib
import json
import os
from pathlib import Path
import re
import time
import uuid


def data_dir(root=None):
    directory = Path(os.environ.get('SLOPPYTYPER_HOME', Path.home() / '.sloppytyper')).resolve()
    if root and directory.is_relative_to(Path(root).resolve()):
        raise ValueError('SLOPPYTYPER_HOME must be outside the replayed repository.')
    return directory


def state_path(root, source, session_id):
    # Preserve the existing baseline filenames when upgrading from Node.
    key = json.dumps([str(root), source, session_id], ensure_ascii=False, separators=(',', ':'))
    digest = hashlib.sha256(key.encode('utf-8')).hexdigest()
    return data_dir(root) / f'baseline-{digest}.json'


def read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8-sig'))
    except FileNotFoundError:
        return None


def write_text(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f'{path.name}.{uuid.uuid4()}.tmp')
    try:
        with temp.open('w', encoding='utf-8', newline='\n') as output:
            output.write(text)
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def write_json(path, value):
    write_text(path, json.dumps(value, ensure_ascii=True, separators=(',', ':')))


def prune(root=None):
    directory = data_dir(root)
    if not directory.exists():
        return
    pattern = r'^(?:baseline-|session-)[a-f0-9-]+\.(?:json|html)(?:\.[a-f0-9-]+\.tmp)?$'
    for path in directory.iterdir():
        if re.fullmatch(pattern, path.name) and not path.is_symlink() and path.is_file():
            try:
                if time.time() - path.stat().st_mtime > 7 * 86400:
                    path.unlink()
            except FileNotFoundError:
                pass  # Another hook may have already removed an expired cache file.
