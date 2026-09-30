#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { snapshot } from '../src/snapshot.js';
import { makeSession } from '../src/session.js';
import { demoSession } from '../src/demo.js';
import { launch } from '../src/launch.js';
import { createViewer } from '../src/server.js';
import { readJSON, prune } from '../src/storage.js';
import { begin, finish, handleHook } from '../src/hooks.js';
import { install } from '../src/integrations.js';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  repo: { type: 'string' }, base: { type: 'string' }, session: { type: 'string' },
  source: { type: 'string' }, target: { type: 'string' }, file: { type: 'string' },
  'no-open': { type: 'boolean' }, 'sloppytyper-hook': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
} });
const [command = 'help'] = positionals;
const cwd = values.repo || process.cwd();
const open = !values['no-open'] && process.env.SLOPPYTYPER_NO_OPEN !== '1';

try {
  if (command === 'hook') {
    let input = '';
    for await (const chunk of process.stdin) { input += chunk; if (input.length > 4 * 1024 * 1024) throw new Error('Hook payload too large.'); }
    const result = await handleHook(JSON.parse(input), values.source);
    // Both hosts accept JSON; Stop in Codex requires it. No blocking decisions.
    console.log(JSON.stringify(result?.url ? { systemMessage: `SloppyTyper replay: ${result.url}` } : {}));
  } else if (command === 'serve-session') {
    if (!values.file) throw new Error('--file is required.');
    const session = await readJSON(values.file);
    if (!session) throw new Error('Session not found.');
    const { url } = await createViewer(session);
    if (process.send) process.send({ url }); else console.log(url);
  } else if (values.help || command === 'help') {
    console.log(`SloppyTyper — code already written. Glory still available.\n\n  demo                         Open the sample victory lap\n  replay [--repo PATH]          Replay working-tree changes against HEAD\n         [--base REF]           Compare against another commit\n  begin --session ID            Capture the current source before editing\n  end --session ID              Replay only changes since begin\n  install [--target both]       Install Codex + Claude hooks and skill\n  uninstall [--target both]     Remove only SloppyTyper integrations\n  prune                        Delete cached snapshots older than 7 days\n\nOptions: --no-open, --repo PATH, --target codex|claude|both\nRequires Node 22+ and Git. Replay never writes to your repository.\n`);
  } else if (command === 'install' || command === 'uninstall') {
    console.log((await install({ target: values.target, remove: command === 'uninstall' })).join('\n'));
    if (command === 'install') console.log('\nRestart your coding sessions. In Codex, review and trust these hooks using /hooks before they can run.');
  } else if (command === 'prune') {
    await prune(); console.log('Expired snapshots removed.');
  } else if (command === 'begin' || command === 'end') {
    if (!values.session) throw new Error('--session ID is required. Use the same unique ID for begin and end.');
    if (command === 'begin') { await prune(); await begin(cwd, 'manual', values.session); console.log('Source snapshot captured.'); }
    else console.log(JSON.stringify(await finish(cwd, 'manual', values.session, { open })));
  } else if (command === 'demo' || command === 'replay') {
    await prune();
    const session = command === 'demo' ? demoSession() : makeSession(await snapshot(cwd, { ref: values.base || 'HEAD' }), await snapshot(cwd));
    if (session.files.length) console.log(await launch(session, { open }));
    else console.log('No source changes to replay. Try demo, or begin/end for a new repository.');
  } else throw new Error(`Unknown command: ${command}. Run with --help.`);
} catch (error) {
  if (command === 'hook') {
    // Entertainment must never interrupt actual work; diagnostics stay on stderr.
    process.stderr.write(`SloppyTyper skipped: ${error.message}\n`);
    console.log('{}');
  } else { process.stderr.write(`SloppyTyper: ${error.message}\n`); process.exitCode = 1; }
}
