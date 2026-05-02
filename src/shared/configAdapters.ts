import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AgentDescriptor, AgentId, HookInstallResult } from './types';

const MANAGED_MARKER = 'managed-by-vibe-island';

interface AdapterSpec {
  agent: Exclude<AgentId, 'unknown'>;
  name: string;
  configPath: (home: string) => string;
  commandCandidates: string[];
  events: string[];
  experimental?: boolean;
  note?: string;
}

const ADAPTERS: AdapterSpec[] = [
  {
    agent: 'codex',
    name: 'Codex',
    configPath: (home) => join(home, '.codex', 'hooks.json'),
    commandCandidates: ['codex'],
    events: ['SessionStart', 'UserPromptSubmit', 'Stop', 'Notification'],
    experimental: true,
    note: 'Codex hooks are experimental on Windows; tool-level events may depend on the installed CLI version.'
  },
  {
    agent: 'claude',
    name: 'Claude Code',
    configPath: (home) => join(home, '.claude', 'settings.json'),
    commandCandidates: ['claude'],
    events: ['PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'UserPromptSubmit']
  },
  {
    agent: 'gemini',
    name: 'Gemini CLI',
    configPath: (home) => join(home, '.gemini', 'settings.json'),
    commandCandidates: ['gemini', 'gemini.ps1'],
    events: ['PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'UserPromptSubmit']
  },
  {
    agent: 'opencode',
    name: 'OpenCode',
    configPath: (home) => join(home, '.config', 'opencode', 'opencode.json'),
    commandCandidates: ['opencode'],
    events: ['permission', 'tool_start', 'tool_end', 'session_start', 'session_stop']
  }
];

export function getAdapterSpecs(): AdapterSpec[] {
  return ADAPTERS;
}

export async function detectAgents(home = homedir(), helperCommand?: string): Promise<AgentDescriptor[]> {
  return ADAPTERS.map((adapter) => {
    const configPath = adapter.configPath(home);
    const command = findCommand(adapter.commandCandidates);
    const installed = configHasManagedHook(configPath);
    return {
      id: adapter.agent,
      name: adapter.name,
      command,
      detected: Boolean(command) || existsSync(dirname(configPath)),
      configPath,
      hookInstalled: installed || (helperCommand ? false : installed),
      experimental: adapter.experimental,
      note: adapter.note
    };
  });
}

export async function installHook(agent: AgentId, helperCommand: string, home = homedir()): Promise<HookInstallResult> {
  const adapter = requireAdapter(agent);
  const configPath = adapter.configPath(home);
  const existing = await readJsonFile(configPath);
  const next = removeManagedHooks(existing);

  if (adapter.agent === 'codex') {
    next.version = typeof next.version === 'number' ? next.version : 1;
    next.hooks = typeof next.hooks === 'object' && next.hooks !== null && !Array.isArray(next.hooks) ? next.hooks : {};
    for (const event of adapter.events) {
      const hooks = arrayValue((next.hooks as Record<string, unknown>)[event]).filter((hook) => !isManagedHook(hook));
      hooks.push(makeCodexHook(helperCommand, adapter.agent, event));
      (next.hooks as Record<string, unknown>)[event] = hooks;
    }
  } else {
    next.hooks = typeof next.hooks === 'object' && next.hooks !== null && !Array.isArray(next.hooks) ? next.hooks : {};
    for (const event of adapter.events) {
      const hooks = arrayValue((next.hooks as Record<string, unknown>)[event]).filter((hook) => !isManagedHook(hook));
      hooks.push(makeClaudeStyleHook(helperCommand, adapter.agent, event));
      (next.hooks as Record<string, unknown>)[event] = hooks;
    }
  }

  const changed = JSON.stringify(existing) !== JSON.stringify(next);
  const backupPath = changed ? await backupFile(configPath) : undefined;
  if (changed) await writeJsonFile(configPath, next);

  return {
    agent,
    configPath,
    backupPath,
    installed: true,
    changed,
    message: changed ? `${adapter.name} hook installed.` : `${adapter.name} hook already installed.`
  };
}

export async function uninstallHook(agent: AgentId, home = homedir()): Promise<HookInstallResult> {
  const adapter = requireAdapter(agent);
  const configPath = adapter.configPath(home);
  const existing = await readJsonFile(configPath);
  const next = removeManagedHooks(existing);
  const changed = JSON.stringify(existing) !== JSON.stringify(next);
  const backupPath = changed ? await backupFile(configPath) : undefined;
  if (changed) await writeJsonFile(configPath, next);

  return {
    agent,
    configPath,
    backupPath,
    installed: false,
    changed,
    message: changed ? `${adapter.name} hook removed.` : `${adapter.name} hook was not installed.`
  };
}

export function buildHelperCommand(helperPath: string, agent: AgentId, event: string): string {
  const escapedPath = helperPath.replace(/"/g, '\\"');
  return `node "${escapedPath}" --agent ${agent} --event ${event} --managed-by ${MANAGED_MARKER}`;
}

function makeClaudeStyleHook(helperCommand: string, agent: AgentId, event: string): Record<string, unknown> {
  return {
    matcher: '',
    hooks: [
      {
        type: 'command',
        command: buildHelperCommand(helperCommand, agent, event),
        timeout: 10
      }
    ]
  };
}

function makeCodexHook(helperCommand: string, agent: AgentId, event: string): Record<string, unknown> {
  return {
    command: buildHelperCommand(helperCommand, agent, event),
    timeout_ms: 10000
  };
}

function removeManagedHooks(value: Record<string, unknown>): Record<string, unknown> {
  const next = structuredClone(value);
  if (!next.hooks || typeof next.hooks !== 'object' || Array.isArray(next.hooks)) return next;

  for (const [event, rawHooks] of Object.entries(next.hooks as Record<string, unknown>)) {
    const filtered = arrayValue(rawHooks).filter((hook) => !isManagedHook(hook));
    if (filtered.length === 0) {
      delete (next.hooks as Record<string, unknown>)[event];
    } else {
      (next.hooks as Record<string, unknown>)[event] = filtered;
    }
  }
  return next;
}

function configHasManagedHook(configPath: string): boolean {
  if (!existsSync(configPath)) return false;
  try {
    const text = readFileSync(configPath, 'utf8');
    return text.includes(MANAGED_MARKER);
  } catch {
    return false;
  }
}

function isManagedHook(value: unknown): boolean {
  return JSON.stringify(value).includes(MANAGED_MARKER);
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  try {
    const text = await readFile(filePath, 'utf8');
    return JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

async function writeJsonFile(filePath: string, value: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function backupFile(filePath: string): Promise<string | undefined> {
  if (!existsSync(filePath)) return undefined;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.vibe-island.${stamp}.bak`;
  await copyFile(filePath, backupPath);
  return backupPath;
}

function requireAdapter(agent: AgentId): AdapterSpec {
  const adapter = ADAPTERS.find((candidate) => candidate.agent === agent);
  if (!adapter) throw new Error(`Unsupported agent: ${agent}`);
  return adapter;
}

function findCommand(candidates: string[]): string | undefined {
  const pathEnv = process.env.PATH ?? '';
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.ps1', '.bat', ''] : [''];
  for (const directory of pathEnv.split(process.platform === 'win32' ? ';' : ':')) {
    for (const candidate of candidates) {
      for (const ext of extensions) {
        const file = join(directory, candidate.endsWith(ext) ? candidate : `${candidate}${ext}`);
        if (existsSync(file)) return file;
      }
    }
  }
  return undefined;
}
