---
name: sloppytyper
description: Replay completed repository code changes in a local neon-green keyboard-mashing viewer. Use when the user requests SloppyTyper or a typing victory lap, or at the end of code work when SloppyTyper is enabled and automatic hooks are unavailable.
---
<!-- sloppytyper-managed -->

SloppyTyper is entertainment. The real edits are already complete; the browser only animates copies. Never delay delivery, gate a commit, or modify code to prepare a replay.

Installed lifecycle hooks normally capture the source at UserPromptSubmit and open a replay at Stop. If these hooks are active, do not also launch a manual replay.

For a manual fallback, choose a unique session ID and run before editing:

```text
node "__SLOPPYTYPER_CLI__" begin --repo "REPOSITORY" --session "UNIQUE_ID"
```

Once work and verification are complete, run:

```text
node "__SLOPPYTYPER_CLI__" end --repo "REPOSITORY" --session "UNIQUE_ID"
```

Return the local URL if one is printed. Do not wait for the user to finish typing. No changes means no browser window. Snapshots include pre-existing dirty source, so only subsequent changes appear. Concurrent writers in the same checkout may also appear; use separate worktrees when attribution matters.

If there is no start snapshot, `replay --repo "REPOSITORY"` compares the working tree with HEAD and may include earlier changes. Use it only when the user wants that broader replay. `demo` opens synthetic example changes.

The checkout containing SloppyTyper must remain at its installed path, with `npm install` already run. This tool requires local Node 22+ and Git. Source snapshots live in `~/.sloppytyper` (or `SLOPPYTYPER_HOME`); replay never edits the repository. Failures are nonblocking. Do not repair unrelated agent configuration as part of a victory lap.
