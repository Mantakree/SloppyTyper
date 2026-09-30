"""Windows entry point. Python 3.9+ and Git; no pip install required."""
import sys

# Running SloppyTyper must not create __pycache__ files in this checkout.
sys.dont_write_bytecode = True

import argparse
import json
import os

from src.demo import demo_session
from src.hooks import begin, finish, handle_hook
from src.integrations import install
from src.session import make_session
from src.snapshot import repo_root, snapshot
from src.storage import prune, read_json
from src.viewer import launch


def main(argv=None):
    parser = argparse.ArgumentParser(description='SloppyTyper: read-only code replays in a standalone local HTML file.')
    parser.add_argument('command', nargs='?', default='help', choices=['help', 'demo', 'replay', 'begin', 'end', 'hook', 'install', 'uninstall', 'prune', 'render'])
    parser.add_argument('--repo', default=os.getcwd(), help='Repository to capture (defaults to this directory)')
    parser.add_argument('--base', default='HEAD', help='Starting Git revision for replay')
    parser.add_argument('--to', help='Ending Git revision; omit for the working tree')
    parser.add_argument('--session', help='Unique ID shared by begin and end')
    parser.add_argument('--source', default='manual')
    parser.add_argument('--target', choices=['both', 'codex', 'claude'], default='both')
    parser.add_argument('--file', help='Existing session JSON to convert into HTML (render)')
    parser.add_argument('--no-open', action='store_true', help='Print the HTML path without opening it')
    parser.add_argument('--sloppytyper-hook', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    open_browser = not args.no_open and os.environ.get('SLOPPYTYPER_NO_OPEN') != '1'
    try:
        if args.command == 'hook':
            # Read raw UTF-8 bytes, not the Windows console's legacy code page.
            data = sys.stdin.buffer.read(4 * 1024 * 1024 + 1)
            if len(data) > 4 * 1024 * 1024:
                raise ValueError('Hook payload too large.')
            result = handle_hook(json.loads(data.decode('utf-8-sig')), args.source, open_browser=open_browser)
            print(json.dumps({'systemMessage': f"SloppyTyper replay: {result['path']}"} if result and result.get('path') else {}))
        elif args.command == 'help':
            parser.print_help()
        elif args.command in ('install', 'uninstall'):
            print('\n'.join(install(args.target, remove=args.command == 'uninstall')))
            if args.command == 'install':
                print('Restart coding sessions and review the updated hooks in /hooks.')
        elif args.command == 'prune':
            prune()
            print('Expired snapshots and replays removed.')
        elif args.command in ('begin', 'end'):
            if not args.session:
                raise ValueError('--session ID is required. Use the same unique ID for begin and end.')
            if args.command == 'begin':
                prune(repo_root(args.repo))
                begin(args.repo, 'manual', args.session)
                print('Source snapshot captured.')
            else:
                result = finish(args.repo, 'manual', args.session, open_browser=open_browser)
                print(result.get('path', result.get('reason')))
        else:
            root = repo_root(args.repo) if args.command == 'replay' else None
            prune(root)
            if args.command == 'demo':
                session = demo_session()
            elif args.command == 'render':
                if not args.file:
                    raise ValueError('--file is required for render.')
                session = read_json(args.file)
                if session is None:
                    raise ValueError('Session not found.')
            else:
                session = make_session(snapshot(root, ref=args.base), snapshot(root, ref=args.to))
            if session['files']:
                print(launch(session, open_browser=open_browser, root=root))
            else:
                print('No source changes to replay. Try demo, or begin/end for a new repository.')
        return 0
    except Exception as error:
        print(f'SloppyTyper skipped: {error}', file=sys.stderr)
        if args.command == 'hook':
            print('{}')  # Entertainment must never interrupt real work.
            return 0
        return 1


if __name__ == '__main__':
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8')
    raise SystemExit(main())
