import { readFile, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readJSON } from './storage.js';

const cli = fileURLToPath(new URL('../bin/sloppytyper.js', import.meta.url));
const marker = '--sloppytyper-hook';
export function mergeHooks(config, source, { remove = false } = {}) {
  const result = structuredClone(config);
  result.hooks ??= {};
  // A simple quoted path works in PowerShell, cmd, and POSIX shells. Refuse
  // unusual shell metacharacters instead of accidentally executing a path.
  const portablePath = cli.replaceAll('\\', '/');
  if (/["$`%&|<>^!\r\n]/.test(portablePath)) throw new Error('Install SloppyTyper in a path without shell metacharacters.');
  for (const event of ['UserPromptSubmit', 'Stop']) {
    const groups = (result.hooks[event] ?? []).map(group => ({ ...group, hooks: group.hooks.filter(h => !h.command?.includes(marker)) })).filter(group => group.hooks.length);
    if (!remove) groups.push({ hooks: [{ type: 'command', command: `node "${portablePath}" hook --source ${source} ${marker}`, timeout: 30 }] });
    if (groups.length) result.hooks[event] = groups; else delete result.hooks[event];
  }
  return result;
}

export async function install({ target = 'both', remove = false, home = homedir(), codexHome = process.env.CODEX_HOME || path.join(home, '.codex') } = {}) {
  if (!['both', 'codex', 'claude'].includes(target)) throw new Error('--target must be codex, claude, or both.');
  const template = await readFile(new URL('../skills/sloppytyper/SKILL.md', import.meta.url), 'utf8');
  const outputs = [];
  for (const source of target === 'both' ? ['codex', 'claude'] : [target]) {
    const dir = source === 'codex' ? codexHome : path.join(home, '.claude');
    const configPath = path.join(dir, source === 'codex' ? 'hooks.json' : 'settings.json');
    const skillDir = path.join(dir, 'skills', 'sloppytyper');
    const skillPath = path.join(skillDir, 'SKILL.md');
    let existingSkill;
    try { existingSkill = await readFile(skillPath, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (existingSkill && !existingSkill.includes('<!-- sloppytyper-managed -->')) throw new Error(`An unrelated skill already exists at ${skillPath}; leaving it unchanged.`);
    const existing = await readJSON(configPath);
    if (existing || !remove) {
      const updated = mergeHooks(existing ?? {}, source, { remove });
      await mkdir(dir, { recursive: true });
      if (existing) await copyFile(configPath, `${configPath}.sloppytyper-${Date.now()}.bak`);
      await writeFile(configPath, JSON.stringify(updated, null, 2) + '\n', 'utf8');
      outputs.push(configPath);
    }
    if (remove) {
      // Only our one owned file; never recursively remove an agent skill folder.
      if (existingSkill) await rm(skillPath);
    } else {
      await mkdir(skillDir, { recursive: true });
      await writeFile(skillPath, template.replaceAll('__SLOPPYTYPER_CLI__', cli.replaceAll('\\', '/')), 'utf8');
      outputs.push(skillPath);
    }
  }
  return outputs;
}
