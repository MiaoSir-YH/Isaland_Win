import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
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
    name: 'Claude Desktop / Code',
    configPath: resolveClaudeConfigPath,
    commandCandidates: ['claude'],
    events: ['PreToolUse', 'PermissionRequest', 'PostToolUse', 'Notification', 'Stop', 'UserPromptSubmit'],
    note: 'Claude Desktop 3p config is preferred when AppData\\Local\\Claude-3p is present; otherwise Vibe Island falls back to ~/.claude/settings.json.'
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
    configPath: (home) => join(home, '.config', 'opencode', 'plugins', 'vibe-island.js'),
    commandCandidates: ['opencode'],
    events: ['permission', 'question', 'tool_start', 'tool_end', 'session_start', 'session_stop'],
    note: 'OpenCode uses a managed JS plugin so permissions and questions can be routed back through Vibe Island.'
  },
  {
    agent: 'cursor',
    name: 'Cursor',
    configPath: (home) => join(home, '.cursor', 'hooks.json'),
    commandCandidates: ['cursor', 'cursor.cmd'],
    events: ['beforeSubmitPrompt', 'beforeShellExecution', 'beforeMCPExecution', 'beforeReadFile', 'afterFileEdit', 'stop']
  },
  {
    agent: 'kimi',
    name: 'Kimi CLI',
    configPath: (home) => join(home, '.kimi', 'config.toml'),
    commandCandidates: ['kimi', 'kimi.cmd'],
    events: ['SessionStart', 'UserPromptSubmit', 'Stop', 'Notification', 'PreToolUse', 'PostToolUse']
  },
  {
    agent: 'qoder',
    name: 'Qoder',
    configPath: (home) => join(home, '.qoder', 'settings.json'),
    commandCandidates: ['qoder', 'qoder.cmd'],
    events: ['PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'UserPromptSubmit']
  },
  {
    agent: 'qwen',
    name: 'Qwen Code',
    configPath: (home) => join(home, '.qwen', 'settings.json'),
    commandCandidates: ['qwen', 'qwen.cmd'],
    events: ['PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'UserPromptSubmit']
  },
  {
    agent: 'factory',
    name: 'Factory',
    configPath: (home) => join(home, '.factory', 'settings.json'),
    commandCandidates: ['factory', 'factory.cmd'],
    events: ['PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'UserPromptSubmit']
  },
  {
    agent: 'codebuddy',
    name: 'CodeBuddy',
    configPath: (home) => join(home, '.codebuddy', 'settings.json'),
    commandCandidates: ['codebuddy', 'codebuddy.cmd'],
    events: ['PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'UserPromptSubmit']
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
      health: installed ? 'installed' : existsSync(configPath) ? 'missing' : 'unknown',
      pluginPath: adapter.agent === 'opencode' ? configPath : undefined,
      experimental: adapter.experimental,
      note: adapter.note
    };
  });
}

export async function installHook(agent: AgentId, helperCommand: string, home = homedir()): Promise<HookInstallResult> {
  const adapter = requireAdapter(agent);
  const configPath = adapter.configPath(home);
  if (adapter.agent === 'kimi') return installKimiHook(adapter, helperCommand, home);
  if (adapter.agent === 'opencode') return installOpenCodePlugin(adapter, helperCommand, home);
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
  if (adapter.agent === 'kimi') return uninstallKimiHook(adapter, home);
  if (adapter.agent === 'opencode') return uninstallOpenCodePlugin(adapter, home);
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

export async function installClaudeStatusLine(
  statusLineCommand: string,
  home = homedir()
): Promise<HookInstallResult> {
  const configPath = join(home, '.claude', 'settings.json');
  const existing = await readJsonFile(configPath);
  const currentStatusLine = existing.statusLine;
  if (currentStatusLine && !isManagedHook(currentStatusLine)) {
    return {
      agent: 'claude',
      configPath,
      installed: false,
      changed: false,
      message: 'Claude already has a custom statusLine. Vibe Island did not overwrite it.'
    };
  }

  const next = {
    ...existing,
    statusLine: {
      type: 'command',
      command: statusLineCommand,
      marker: MANAGED_MARKER
    }
  };
  const changed = JSON.stringify(existing) !== JSON.stringify(next);
  const backupPath = changed ? await backupFile(configPath) : undefined;
  if (changed) await writeJsonFile(configPath, next);
  return {
    agent: 'claude',
    configPath,
    backupPath,
    installed: true,
    changed,
    message: changed ? 'Claude statusLine bridge installed.' : 'Claude statusLine bridge already installed.'
  };
}

export async function uninstallClaudeStatusLine(home = homedir()): Promise<HookInstallResult> {
  const configPath = join(home, '.claude', 'settings.json');
  const existing = await readJsonFile(configPath);
  if (!existing.statusLine || !isManagedHook(existing.statusLine)) {
    return {
      agent: 'claude',
      configPath,
      installed: false,
      changed: false,
      message: 'Claude statusLine bridge was not installed.'
    };
  }

  const next = { ...existing };
  delete next.statusLine;
  const backupPath = await backupFile(configPath);
  await writeJsonFile(configPath, next);
  return {
    agent: 'claude',
    configPath,
    backupPath,
    installed: false,
    changed: true,
    message: 'Claude statusLine bridge removed.'
  };
}

export function buildHelperCommand(helperPath: string, agent: AgentId, event: string): string {
  const escapedPath = helperPath.replace(/"/g, '\\"');
  return `node "${escapedPath}" --agent ${agent} --event ${event} --managed-by ${MANAGED_MARKER}`;
}

function resolveClaudeConfigPath(home: string): string {
  const desktopDir = join(home, 'AppData', 'Local', 'Claude-3p');
  if (existsSync(desktopDir)) return join(desktopDir, 'claude_desktop_config.json');
  return join(home, '.claude', 'settings.json');
}

function makeClaudeStyleHook(helperCommand: string, agent: AgentId, event: string): Record<string, unknown> {
  return {
    matcher: '',
    hooks: [
      {
        type: 'command',
        command: buildHelperCommand(helperCommand, agent, event),
        timeout: event === 'PreToolUse' || event === 'PermissionRequest' ? 130 : 10
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

async function installOpenCodePlugin(
  adapter: AdapterSpec,
  helperCommand: string,
  home: string
): Promise<HookInstallResult> {
  const configPath = adapter.configPath(home);
  const existing = existsSync(configPath) ? await readFile(configPath, 'utf8') : '';
  const next = makeOpenCodePlugin(helperCommand);
  const changed = existing !== next;
  const backupPath = changed ? await backupFile(configPath) : undefined;
  if (changed) {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, next, 'utf8');
  }
  return {
    agent: adapter.agent,
    configPath,
    backupPath,
    installed: true,
    changed,
    message: changed ? `${adapter.name} plugin installed.` : `${adapter.name} plugin already installed.`
  };
}

async function uninstallOpenCodePlugin(adapter: AdapterSpec, home: string): Promise<HookInstallResult> {
  const configPath = adapter.configPath(home);
  const existing = existsSync(configPath) ? await readFile(configPath, 'utf8') : '';
  if (!existing.includes(MANAGED_MARKER)) {
    return {
      agent: adapter.agent,
      configPath,
      installed: false,
      changed: false,
      message: `${adapter.name} plugin was not installed.`
    };
  }
  const backupPath = await backupFile(configPath);
  await writeFile(configPath, '', 'utf8');
  return {
    agent: adapter.agent,
    configPath,
    backupPath,
    installed: false,
    changed: true,
    message: `${adapter.name} plugin removed.`
  };
}

async function installKimiHook(adapter: AdapterSpec, helperCommand: string, home: string): Promise<HookInstallResult> {
  const configPath = adapter.configPath(home);
  const existing = existsSync(configPath) ? await readFile(configPath, 'utf8') : '';
  const cleaned = removeManagedTomlHooks(existing);
  const entries = adapter.events.map((event) => makeKimiHookToml(helperCommand, adapter.agent, event)).join('\n');
  const next = `${cleaned.trimEnd()}${cleaned.trim().length > 0 ? '\n\n' : ''}${entries}\n`;
  const changed = existing !== next;
  const backupPath = changed ? await backupFile(configPath) : undefined;
  if (changed) {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, next, 'utf8');
  }
  return {
    agent: adapter.agent,
    configPath,
    backupPath,
    installed: true,
    changed,
    message: changed ? `${adapter.name} hook installed.` : `${adapter.name} hook already installed.`
  };
}

async function uninstallKimiHook(adapter: AdapterSpec, home: string): Promise<HookInstallResult> {
  const configPath = adapter.configPath(home);
  const existing = existsSync(configPath) ? await readFile(configPath, 'utf8') : '';
  const next = removeManagedTomlHooks(existing).trimEnd() + (existing.trim().length > 0 ? '\n' : '');
  const changed = existing !== next;
  const backupPath = changed ? await backupFile(configPath) : undefined;
  if (changed) await writeFile(configPath, next, 'utf8');
  return {
    agent: adapter.agent,
    configPath,
    backupPath,
    installed: false,
    changed,
    message: changed ? `${adapter.name} hook removed.` : `${adapter.name} hook was not installed.`
  };
}

function makeOpenCodePlugin(helperCommand: string): string {
  const escaped = helperCommand.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
  return `// ${MANAGED_MARKER}\nexport const VibeIslandPlugin = async ({ event }) => {\n  const command = \`${escaped} --agent opencode --event \${event?.type ?? 'status'}\`;\n  return { command };\n};\nexport default VibeIslandPlugin;\n`;
}

function makeKimiHookToml(helperCommand: string, agent: AgentId, event: string): string {
  const command = buildHelperCommand(helperCommand, agent, event).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `[[hooks]]\n# ${MANAGED_MARKER}\nevent = "${event}"\ncommand = "${command}"\ntimeout = 10\n`;
}

function removeManagedTomlHooks(text: string): string {
  const blocks = text.split(/(?=\[\[hooks\]\])/g);
  return blocks.filter((block) => !block.includes(MANAGED_MARKER)).join('').trimEnd();
}

function requireAdapter(agent: AgentId): AdapterSpec {
  const adapter = ADAPTERS.find((candidate) => candidate.agent === agent);
  if (!adapter) throw new Error(`Unsupported agent: ${agent}`);
  return adapter;
}

function findCommand(candidates: string[]): string | undefined {
  const pathEnv = process.env.PATH ?? '';
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.ps1', '.bat', ''] : [''];
  for (const candidate of candidates) {
    if (isAbsolute(candidate) && existsSync(candidate)) return candidate;
  }
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
