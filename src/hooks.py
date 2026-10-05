"""Nonblocking before/after capture shared by Codex and Claude Code."""
from datetime import datetime, timedelta, timezone
import os

from .snapshot import repo_root, snapshot
from .session import make_session
from .storage import state_path, read_json, write_json, prune
from .viewer import launch


PENDING_MAX_AGE = timedelta(hours=4)


def begin(cwd, source, session_id, *, preserve=False, pending=False):
    root = repo_root(cwd)
    path = state_path(root, source, session_id)
    before = read_json(path) if preserve or pending else None
    if preserve and before:
        return
    if pending and before and before.get('pending') is True:
        try:
            age = datetime.now(timezone.utc) - datetime.fromisoformat(before['capturedAt'])
            if timedelta(0) <= age < PENDING_MAX_AGE:
                return
        except (KeyError, TypeError, ValueError):
            pass  # Missing/invalid timestamps cannot keep a baseline alive forever.
    captured = snapshot(root)
    if pending:
        captured['pending'] = True
    write_json(path, captured)


def finish(cwd, source, session_id, *, open_browser=True, launch_viewer=launch):
    root = repo_root(cwd)
    path = state_path(root, source, session_id)
    before = read_json(path)
    if before is None:
        return dict(reason='No start snapshot. Start a new turn, or use begin before editing.')
    after = snapshot(root)
    # Fresh snapshots have no pending mark. Both Stop paths consume it, while
    # retaining the after state keeps duplicate Stops quiet.
    session = make_session(before, after, source)
    if not session['files']:
        write_json(path, after)
        return dict(reason='No source changes in this turn.')
    html = launch_viewer(session, open_browser=open_browser, root=root)
    # Duplicate Stop events do not open another replay.
    write_json(path, after)
    return dict(path=html, files=len(session['files']), skipped=len(session['skipped']))


def handle_hook(payload, source, **options):
    if source not in ('codex', 'claude'):
        raise ValueError('Unknown hook source.')
    if not payload.get('session_id') or not payload.get('cwd') or payload.get('agent_id'):
        return {}
    session_id = str(payload['session_id'])
    if payload.get('turn_id'):
        session_id += ':' + str(payload['turn_id'])
    if payload.get('hook_event_name') == 'UserPromptSubmit':
        prune(repo_root(payload['cwd']))
        has_turn_id = bool(payload.get('turn_id'))
        begin(payload['cwd'], source, session_id, preserve=has_turn_id, pending=not has_turn_id)
    elif payload.get('hook_event_name') == 'Stop':
        options.setdefault('open_browser', os.environ.get('SLOPPYTYPER_NO_OPEN') != '1')
        return finish(payload['cwd'], source, session_id, **options)
    return {}
