# SloppyTyper

A neon-green victory lap for finished code changes, inspired by [Hacker Typer](https://hackertyper.net/). Your assistant finishes a turn, SloppyTyper shows the original source, and random keystrokes animate the edits.

**Replay never writes to your repository.** The page animates copies. Closing it, skipping a file, or never touching a key has no effect on your work.

## Try it on Windows

Requires **Python 3.9+**, **Git**, and a browser. No Node, npm, pip packages, server, or background service is needed to use it.

```powershell
git clone https://github.com/Mantakree/SloppyTyper.git
cd SloppyTyper
python sloppytyper.py demo
```

If your Python installation uses the Windows launcher, `py sloppytyper.py demo` works too.

Python generates one self-contained HTML file and opens it in your default browser, then exits. Double-click the file to replay it again, including offline. All code, styling, and animations are embedded. JavaScript runs inside the browser; it doesn't need Node. Some embedded app browsers block local files; use your normal Windows browser to open the HTML.

Mash letters, numbers, space, enter, or backspace. Each key performs 1, 5, 10, 20, or 50 character edits. The full-width code view wraps long lines. Insertions rain down in shuffled order and remain brighter green; deletions glow red, fly upward, and burn away. Red characters get a head start before replacement text falls. Each completed file waits for all effects to finish, then stays visible for at least one second. Tiny files stay on screen for at least three seconds after their first keypress. Extra keys during that pause don't skip ahead. Reduced-motion preferences, file selection, skip, restart, and optional synthesized sound are supported.

## Codex and Claude Code

```powershell
python sloppytyper.py install
```

This installs `UserPromptSubmit` and `Stop` hooks plus the shared `sloppytyper` skill for both hosts. Use `--target codex` or `--target claude` for just one. The installer replaces earlier SloppyTyper Node hooks, preserves unrelated settings, and backs up configuration before changing it. It pins the Python interpreter used during installation, so moving Python or this checkout requires reinstalling.

- **Codex:** hooks in `$CODEX_HOME/hooks.json` (default `~/.codex/hooks.json`); skill in that directory's `skills/sloppytyper`. Start a new session and review/trust the updated definitions in `/hooks`. Disabled or untrusted hooks won't run.
- **Claude Code:** hooks in `~/.claude/settings.json`; skill in `~/.claude/skills/sloppytyper`. Restart the coding session and inspect hooks with `/hooks`.

These integrations run in local Windows coding sessions with filesystem access. They don't change shell approval settings. No MCP server, API key, or model call is involved.

The start hook snapshots current source, including pre-existing dirty files. The stop hook compares the final source with that baseline and generates a replay only if something changed. Commits made during the turn don't lose edits. Duplicate stops are quiet. Hook errors never block a prompt or resume the agent.

“Conversation closes” means the assistant finishes a turn. Each later turn gets a new baseline. Concurrent edits in the same checkout can also appear; separate worktrees avoid mixing unrelated work.

Integration references: [Codex hooks](https://learn.chatgpt.com/docs/hooks), [Claude Code hooks](https://code.claude.com/docs/en/hooks).

## Manual replays

Replay working-tree changes against HEAD, or another commit:

```powershell
python sloppytyper.py replay --repo "C:\path\to\repository"
python sloppytyper.py replay --repo "C:\path\to\repository" --base main
```

These include staged, unstaged, and untracked source. A rename appears as deletion plus creation. For a committed range (for example, the last two commits):

```powershell
python sloppytyper.py replay --base HEAD~2 --to HEAD
```

For exact before/after snapshots, including a repository without commits:

```powershell
python sloppytyper.py begin --repo "C:\path\to\repository" --session my-unique-turn
# Work with your coding assistant.
python sloppytyper.py end --repo "C:\path\to\repository" --session my-unique-turn
```

Use a unique session ID for each independent task. The command prints the absolute HTML path. Add `--no-open` to generate it without opening a browser. The skill provides this fallback when hooks aren't available; a skill alone isn't a lifecycle trigger.

Previously saved Node session JSON can be converted without a server:

```powershell
python sloppytyper.py render --file "C:\path\to\session.json"
```

## Local storage

Before/after snapshots and generated HTML live in `~/.sloppytyper`. `SLOPPYTYPER_HOME` can change the directory, but it must remain outside the replayed repository. Cache files older than seven days are removed on later capture/replay, or by `python sloppytyper.py prune`. Copy an HTML file elsewhere if you want to keep it. Its contents never expire and need no other files.

These files contain local copies of source; they aren't encrypted. There is no telemetry or network access. Source is embedded as escaped, inert JSON and rendered as text, never executed. Typing has no filesystem access.

Common code, configuration, and documentation extensions are included. Binary files, invalid UTF-8, symlinks, generated directories, lockfiles, conventional credential filenames, and Git-ignored untracked files are excluded. Files above 256 KiB or beyond a 16 MiB snapshot budget are skipped. Filters aren't a secret scanner. Diffs preserve Unicode and line endings; large rewrites use coarser edits to keep generation bounded.

## Uninstall

```powershell
python sloppytyper.py uninstall
```

Removes only SloppyTyper's hooks and installed skill file. Other settings, cache files, saved replays, and the checkout remain. Restart coding sessions afterward.

## Development

The backend and exporter tests use only Python and Git:

```powershell
python -B -m unittest discover -s test -p "test_*.py"
```

The existing browser unit tests optionally use Node 22+ and `linkedom` **for development only**:

```powershell
npm ci
npm test
npm run check
```

Tests cover repository/index immutability, dirty baselines, commits during turns, duplicate hooks, config migration/preservation, safe standalone exports, exact replay, Unicode, completion timing, and canvas rendering. CI targets Windows. Generate a new demo after editing browser assets; each HTML file is a frozen copy of the viewer and session.
