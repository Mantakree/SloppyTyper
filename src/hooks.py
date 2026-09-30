"""Nonblocking before/after capture shared by Codex and Claude Code."""
import os

from .snapshot import repo_root, snapshot
from .session import make_session
from .storage import state_path, read_json, write_json, prune
from .viewer import launch


def begin(cwd, source, session_id, *, preserve=False):
    root = repo_root(cwd)
    path = state_path(root, source, session_id)
    if preserve and read_json(path):
        return
    write_json(path, snapshot(root))


def finish(cwd, source, session_id, *, open_browser=True, launch_viewer=launch):
    root = repo_root(cwd)
    path = state_path(root, source, session_id)
    before = read_json(path)
    if before is None:
        return dict(reason='No start snapshot. Start a new turn, or use begin before editing.')
    after = snapshot(root)
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
        begin(payload['cwd'], source, session_id, preserve=bool(payload.get('turn_id')))
    elif payload.get('hook_event_name') == 'Stop':
        options.setdefault('open_browser', os.environ.get('SLOPPYTYPER_NO_OPEN') != '1')
        return finish(payload['cwd'], source, session_id, **options)
    return {}
