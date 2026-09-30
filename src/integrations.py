"""Install Windows hooks, preserving unrelated settings and backing up changes."""
import base64
import copy
import json
import os
from pathlib import Path
import shutil
import sys
import uuid

from .storage import read_json, write_text

ROOT = Path(__file__).resolve().parent.parent
MARKER = '--sloppytyper-hook'
SKILL_MARKER = '<!-- sloppytyper-managed -->'


def hook_command(source):
    # An encoded PowerShell command safely handles spaces and apostrophes in
    # both paths, pins the installed interpreter, and works with either host's
    # command shell. Python inherits hook stdin directly.
    quote = lambda path: "'" + str(path).replace("'", "''") + "'"
    command = f"& {quote(Path(sys.executable).resolve())} {quote(ROOT / 'sloppytyper.py')} hook --source {source} {MARKER}"
    encoded = base64.b64encode(command.encode('utf-16-le')).decode('ascii')
    return f'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand {encoded}'


def merge_hooks(config, source, *, remove=False):
    result = copy.deepcopy(config)
    hooks = result.setdefault('hooks', {})
    for event in ('UserPromptSubmit', 'Stop'):
        groups = []
        for group in hooks.get(event, []):
            keep = []
            for hook in group['hooks']:
                command = hook.get('command', '')
                owned = MARKER in command
                if not owned and '-EncodedCommand ' in command:
                    try:
                        decoded = base64.b64decode(command.split('-EncodedCommand ', 1)[1]).decode('utf-16-le')
                        owned = MARKER in decoded
                    except (ValueError, UnicodeError):
                        pass
                if not owned:
                    keep.append(hook)
            if keep:
                groups.append({**group, 'hooks': keep})
        if not remove:
            groups.append(dict(hooks=[dict(type='command', command=hook_command(source), timeout=30)]))
        if groups:
            hooks[event] = groups
        else:
            hooks.pop(event, None)
    return result


def install(target='both', *, remove=False, home=None, codex_home=None):
    if target not in ('codex', 'claude', 'both'):
        raise ValueError('--target must be codex, claude, or both.')
    home = Path(home or Path.home())
    codex_home = Path(codex_home or os.environ.get('CODEX_HOME', home / '.codex'))
    template = (ROOT / 'skills/sloppytyper/SKILL.md').read_text(encoding='utf-8')
    template = template.replace('__SLOPPYTYPER_CLI__', (ROOT / 'sloppytyper.py').as_posix())
    template = template.replace('__SLOPPYTYPER_PYTHON__', Path(sys.executable).resolve().as_posix())
    outputs = []
    for source in ('codex', 'claude') if target == 'both' else (target,):
        directory = codex_home if source == 'codex' else home / '.claude'
        config_path = directory / ('hooks.json' if source == 'codex' else 'settings.json')
        skill_path = directory / 'skills/sloppytyper/SKILL.md'
        existing_skill = skill_path.read_text(encoding='utf-8') if skill_path.exists() else None
        if existing_skill is not None and SKILL_MARKER not in existing_skill:
            raise ValueError(f'An unrelated skill already exists at {skill_path}; leaving it unchanged.')
        existing = read_json(config_path)
        if existing is not None or not remove:
            updated = merge_hooks(existing if existing is not None else {}, source, remove=remove)
            if updated != existing:
                if existing is not None:
                    shutil.copy2(config_path, f'{config_path}.sloppytyper-{uuid.uuid4()}.bak')
                write_text(config_path, json.dumps(updated, indent=2, ensure_ascii=True) + '\n')
            outputs.append(str(config_path))
        if remove:
            if existing_skill is not None:
                skill_path.unlink()  # Only our file; never recursively delete skill folders.
        else:
            if existing_skill != template:
                write_text(skill_path, template)
            outputs.append(str(skill_path))
    return outputs
