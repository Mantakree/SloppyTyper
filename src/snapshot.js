import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile);
const extensions = new Set('js jsx mjs cjs ts tsx mts cts py rs go c h cpp hpp cc cs fs fsx java kt kts swift rb php lua sh bash zsh ps1 psm1 sql html htm css scss sass less vue svelte astro json jsonc yaml yml toml xml graphql gql proto ex exs erl hrl clj cljs dart r scala rkt zig nix ml mli tf hcl tex md mdx'.split(' '));
const names = new Set(['Dockerfile', 'Containerfile', 'Makefile', 'CMakeLists.txt', 'Justfile', '.gitignore', '.gitattributes', '.editorconfig']);
const ignoredDirs = /(^|\/)(node_modules|vendor|dist|build|coverage|\.git|\.next|\.nuxt|\.venv|venv|__pycache__|\.codex|\.claude|\.agents)(\/|$)/;
const sensitive = /(^|[\/._-])(secrets?|credentials?|tokens?|id_rsa|id_ed25519)([\/._-]|$)|(^|\/)\.env($|\.)/i;
const lockfiles = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Cargo\.lock|poetry\.lock|uv\.lock)$/;

export function isSource(file) {
  return !ignoredDirs.test(file) && !sensitive.test(file) && !lockfiles.test(file)
    && (names.has(path.posix.basename(file)) || extensions.has(path.posix.extname(file).slice(1).toLowerCase()));
}

async function git(cwd, args, encoding = 'utf8') {
  return (await exec('git', ['-C', cwd, ...args], {
    encoding, maxBuffer: 16 * 1024 * 1024, timeout: 15000,
    windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  })).stdout;
}

export async function repoRoot(cwd) {
  return realpath((await git(cwd, ['rev-parse', '--show-toplevel'])).trim());
}

export async function snapshot(cwd, { ref, maxFileBytes = 256 * 1024, maxTotalBytes = 16 * 1024 * 1024 } = {}) {
  const root = await repoRoot(cwd);
  let revision;
  if (ref) revision = (await git(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).trim();
  const listing = revision
    ? await git(root, ['ls-tree', '-r', '-z', '--name-only', revision])
    : await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  const files = Object.create(null);
  const skipped = [];
  let bytes = 0;
  for (const file of [...new Set(listing.split('\0').filter(isSource))].sort()) {
    if (!file) continue;
    try {
      let buffer;
      if (revision) {
        // Ref is resolved to a commit hash first, so filenames cannot become options.
        const mode = await git(root, ['ls-tree', revision, '--', file]);
        if (!mode.startsWith('100')) { skipped.push(file); continue; }
        const size = Number((await git(root, ['cat-file', '-s', `${revision}:${file}`])).trim());
        if (size > maxFileBytes || bytes + size > maxTotalBytes) { skipped.push(file); continue; }
        buffer = await git(root, ['show', `${revision}:${file}`], 'buffer');
      } else {
        const absolute = path.resolve(root, file);
        const stat = await lstat(absolute);
        if (!stat.isFile() || stat.isSymbolicLink()) { skipped.push(file); continue; }
        const resolved = await realpath(absolute);
        const relative = path.relative(root, resolved);
        if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) { skipped.push(file); continue; }
        if (stat.size > maxFileBytes || bytes + stat.size > maxTotalBytes) { skipped.push(file); continue; }
        buffer = await readFile(absolute);
      }
      if (buffer.length > maxFileBytes || bytes + buffer.length > maxTotalBytes || buffer.includes(0)) { skipped.push(file); continue; }
      const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      files[file] = content;
      bytes += buffer.length;
    } catch (error) {
      if (error.code !== 'ENOENT') skipped.push(file);
    }
  }
  let branch = 'detached';
  try { branch = (await git(root, ['symbolic-ref', '--short', 'HEAD'])).trim(); } catch { /* detached HEAD */ }
  return { root, name: path.basename(root), branch, files, skipped, capturedAt: new Date().toISOString() };
}
