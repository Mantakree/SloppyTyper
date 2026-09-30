# SloppyTyper

This is a local Node 22+ app with a vanilla browser client. Run `npm test` and `npm run check` after changes to replay, capture, server, or integrations. Use the built-in demo for browser checks; it contains synthetic source.

The core invariant is read-only replay: capture may read a Git checkout, but must never write source files, Git metadata, or the index. Keep snapshot/cache writes outside the target repository. The integration installer is the only component that changes agent configuration; preserve unrelated settings and back up existing configuration.

Hook errors must not block prompts, continue agent turns, or require the user to finish a replay. Browser source must be rendered as text, never HTML or executable script. Keep the server bound to loopback, without mutation endpoints or external assets.

The shared skill is in `skills/sloppytyper/SKILL.md`; installation substitutes the local CLI path. Both integrations use UserPromptSubmit and Stop. A skill alone is a manual fallback, not a guaranteed lifecycle trigger.
