# SloppyTyper

This is a Windows Python 3.9+ app with a vanilla browser client. Runtime uses only Python's standard library and Git. Run `python -B -m unittest discover -s test -p "test_*.py"` after capture, export, or integration changes. `npm test` and `npm run check` are optional developer tools for the browser JavaScript tests; Node is never required to use or install SloppyTyper. Use `python sloppytyper.py demo` for browser checks; it contains synthetic source.

The core invariant is read-only replay: capture may read a Git checkout, but must never write source files, Git metadata, or the index. Keep snapshot/cache writes outside the target repository. The integration installer is the only component that changes agent configuration; preserve unrelated settings and back up existing configuration.

Hook errors must not block prompts, continue agent turns, or require the user to finish a replay. Browser source must be rendered as text, never HTML or executable script. Export self-contained HTML with inert, safely escaped session data; no server, network requests, local module imports, or external assets. Keep all effects and controls working under file://. Do not create Python bytecode caches in the checkout during normal use.

The shared skill is in `skills/sloppytyper/SKILL.md`; installation substitutes the local CLI path. Both integrations use UserPromptSubmit and Stop. A skill alone is a manual fallback, not a guaranteed lifecycle trigger.
