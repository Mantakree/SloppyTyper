# SloppyTyper

**The AI did the work. You get the keystrokes.**

A local, neon-green victory lap for AI-written code, inspired by [Hacker Typer](https://hackertyper.net/). Your assistant finishes a turn, SloppyTyper shows the original source, and random keystrokes animate the edits until you have personally achieved an unreasonable amount of pride and accomplishment.

**Replay never writes to your repository.** It animates copies. Closing the page, skipping a file, or never touching a key has no effect on your real work.

## Try it

Requires **Node.js 22+** and **Git** on PATH. Windows, macOS, and Linux are supported.

```sh
git clone https://github.com/Mantakree/SloppyTyper.git
cd SloppyTyper
npm install
npm start
```

This opens a synthetic demo in your default browser. Mash letters, numbers, space, enter, or backspace. The actual key doesn't matter. Each key performs one character insertion or deletion; choose 5 or 20 characters per key for especially productive vibes. File selection, skip, restart, focus mode, optional synthesized sound, and a completion celebration are included. Browser shortcuts and tab navigation keep working. The big green button also works by mouse or touch.

## Codex and Claude Code

From this checkout:

```sh
node bin/sloppytyper.js install
```

This installs `UserPromptSubmit` and `Stop` command hooks plus the shared `sloppytyper` skill for both hosts. Use `--target codex` or `--target claude` to install only one. It merges existing hook configuration and backs up existing files before changes. It does not enable broad shell permissions or change agent approval settings.

- **Codex:** hooks in `$CODEX_HOME/hooks.json` (defaults to `~/.codex/hooks.json`); skill in that directory's `skills/sloppytyper`. Start a new session, then review and trust the two hook definitions in **`/hooks`**. Codex skips untrusted hooks. If hooks are disabled in your settings or by your organization, they will not run.
- **Claude Code:** hooks in `~/.claude/settings.json`; skill in `~/.claude/skills/sloppytyper`. Restart Claude Code after installation; inspect the installed hooks with `/hooks`.

Keep this checkout at its installed path and keep Node on PATH. Moving the checkout requires reinstalling. No MCP server, API key, model call, or always-running daemon is required. These integrations target **local** coding sessions with filesystem access, including Codex desktop/CLI and Claude Code. A cloud session cannot open a browser on your machine using this local hook.

The start hook snapshots the current source, including pre-existing uncommitted work. The stop hook compares the final source with that baseline and opens a page only if it changed. Commits during the turn do not lose the replay. Duplicate stop events are quiet. Hook failures never block a prompt, resume the agent, or prevent the turn from ending.

“Conversation closes” means the assistant **finishes responding to a turn**, not that you close the app. The host cannot know that you will never send another message. Each later turn gets its own baseline. Changes made concurrently by you or another agent in the same checkout can appear too; use separate worktrees for independent sessions. Changing to another repository during a turn requires a new baseline.

Official integration references: [Codex hooks](https://learn.chatgpt.com/docs/hooks) and [Claude Code hooks](https://code.claude.com/docs/en/hooks).

## Manual replays

Replay all source changes currently in a repository against HEAD:

```sh
node bin/sloppytyper.js replay --repo /path/to/repository
node bin/sloppytyper.js replay --repo /path/to/repository --base main
```

These commands include staged, unstaged, and untracked source files. A rename appears as removal of the old path and creation of the new one. HEAD must exist for this mode.

For exact before/after snapshots, including a repository without any commits:

```sh
node bin/sloppytyper.js begin --repo /path/to/repository --session my-unique-turn
# Do the real work with your coding assistant.
node bin/sloppytyper.js end --repo /path/to/repository --session my-unique-turn
```

Choose a different session ID for each independent task. The `end` command prints the replay URL. Add `--no-open` to print it without opening the browser. The shared skill provides this fallback when hooks are unavailable; a skill by itself cannot guarantee automatic invocation at every turn.

## What gets stored

The viewer serves a fixed session from `127.0.0.1` on a randomly assigned port, behind a random URL token. It has no write endpoints, telemetry, remote fonts, or external assets. Source is rendered as text, never evaluated. The server exits after two hours; an already loaded page continues working.

Before/after snapshots are stored locally in `~/.sloppytyper`, outside the replayed repository. Set `SLOPPYTYPER_HOME` to change that location; choose a directory outside your source checkout. Files older than seven days are removed on the next capture/replay, or with `node bin/sloppytyper.js prune`. These are local copies of your source; this is not an encrypted vault. Installation writes agent configuration, and snapshots write the cache; **typing in the viewer writes neither**.

Common code, configuration, and documentation extensions are included. Binary files, invalid UTF-8, symlinks, common generated directories, lockfiles, and conventional credential filenames are excluded. Git-ignored untracked files are excluded. Individual files above 256 KiB or source beyond a 16 MiB snapshot budget are skipped. The page reports unsupported-file skips. These filters are not a secret scanner. Large rewrites use a bounded line diff if a character diff takes too long.

## Uninstall

```sh
node bin/sloppytyper.js uninstall
```

Removes only SloppyTyper's hook entries and its installed skill file. Other hooks and settings stay in place. Cache files and the checkout remain available; existing viewers expire automatically. Restart coding sessions after uninstalling.

## Development

```sh
npm test
npm run check
```

The Node test suite checks exact replay, Unicode/line endings, new/deleted/renamed files, dirty baselines, commits during a turn, duplicate stops, configuration preservation, HTTP restrictions, and repository/index immutability. CI runs on Windows, macOS, and Linux with Node 22 and 24. The browser UI uses plain HTML/CSS/JavaScript; the only runtime dependency is `diff`. Restart the demo after changing assets, because each viewer snapshots its assets at launch.
