import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  detectAgents,
  installClaudeStatusLine,
  installHook,
  uninstallClaudeStatusLine,
  uninstallHook
} from '../src/shared/configAdapters';

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'vibe-island-test-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('config adapters', () => {
  it('installs hooks idempotently and preserves unrelated settings', async () => {
    const settingsPath = join(home, '.claude', 'settings.json');
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(
      settingsPath,
      JSON.stringify({
        model: 'sonnet',
        hooks: {
          Stop: [{ matcher: 'existing', hooks: [{ type: 'command', command: 'echo keep' }] }]
        }
      }),
      'utf8'
    );

    const first = await installHook('claude', 'O:\\w_Island\\scripts\\vibe-island-hook.mjs', home);
    const second = await installHook('claude', 'O:\\w_Island\\scripts\\vibe-island-hook.mjs', home);
    const installed = JSON.parse(await readFile(settingsPath, 'utf8'));

    expect(first.installed).toBe(true);
    expect(second.changed).toBe(false);
    expect(installed.model).toBe('sonnet');
    expect(JSON.stringify(installed)).toContain('echo keep');
    expect(JSON.stringify(installed).match(/vibe-island-hook/g)?.length).toBe(6);
    expect(installed.hooks.PermissionRequest?.[0]?.hooks?.[0]?.timeout).toBe(130);
    expect(installed.hooks.PreToolUse?.[0]?.hooks?.[0]?.timeout).toBe(130);
  });

  it('refreshes an older managed Claude hook install to the latest events and timeouts', async () => {
    const settingsPath = join(home, '.claude', 'settings.json');
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(
      settingsPath,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: '',
              hooks: [
                {
                  type: 'command',
                  command:
                    'node "M:\\ai-harness\\island\\release\\win-unpacked\\resources\\scripts\\vibe-island-hook.mjs" --agent claude --event PreToolUse --managed-by managed-by-vibe-island',
                  timeout: 10
                }
              ]
            }
          ],
          PostToolUse: [
            {
              matcher: '',
              hooks: [
                {
                  type: 'command',
                  command:
                    'node "M:\\ai-harness\\island\\release\\win-unpacked\\resources\\scripts\\vibe-island-hook.mjs" --agent claude --event PostToolUse --managed-by managed-by-vibe-island',
                  timeout: 10
                }
              ]
            }
          ],
          Notification: [
            {
              matcher: '',
              hooks: [
                {
                  type: 'command',
                  command:
                    'node "M:\\ai-harness\\island\\release\\win-unpacked\\resources\\scripts\\vibe-island-hook.mjs" --agent claude --event Notification --managed-by managed-by-vibe-island',
                  timeout: 10
                }
              ]
            }
          ],
          Stop: [
            {
              matcher: '',
              hooks: [
                {
                  type: 'command',
                  command:
                    'node "M:\\ai-harness\\island\\release\\win-unpacked\\resources\\scripts\\vibe-island-hook.mjs" --agent claude --event Stop --managed-by managed-by-vibe-island',
                  timeout: 10
                }
              ]
            }
          ],
          UserPromptSubmit: [
            {
              matcher: '',
              hooks: [
                {
                  type: 'command',
                  command:
                    'node "M:\\ai-harness\\island\\release\\win-unpacked\\resources\\scripts\\vibe-island-hook.mjs" --agent claude --event UserPromptSubmit --managed-by managed-by-vibe-island',
                  timeout: 10
                }
              ]
            }
          ]
        }
      }),
      'utf8'
    );

    const refreshed = await installHook('claude', 'O:\\w_Island\\scripts\\vibe-island-hook.mjs', home);
    const installed = JSON.parse(await readFile(settingsPath, 'utf8'));

    expect(refreshed.installed).toBe(true);
    expect(refreshed.changed).toBe(true);
    expect(Object.keys(installed.hooks).sort()).toEqual([
      'Notification',
      'PermissionRequest',
      'PostToolUse',
      'PreToolUse',
      'Stop',
      'UserPromptSubmit'
    ]);
    expect(installed.hooks.PreToolUse[0].hooks[0].timeout).toBe(130);
    expect(installed.hooks.PermissionRequest[0].hooks[0].timeout).toBe(130);
  });

  it('uninstalls only managed hooks', async () => {
    const settingsPath = join(home, '.claude', 'settings.json');
    await installHook('claude', 'O:\\w_Island\\scripts\\vibe-island-hook.mjs', home);
    await uninstallHook('claude', home);
    const uninstalled = JSON.parse(await readFile(settingsPath, 'utf8'));

    expect(JSON.stringify(uninstalled)).not.toContain('vibe-island-hook');
    expect(uninstalled.hooks).toEqual({});
  });

  it('prefers Claude Desktop 3p config when present', async () => {
    const desktopConfigPath = join(home, 'AppData', 'Local', 'Claude-3p', 'claude_desktop_config.json');
    const legacySettingsPath = join(home, '.claude', 'settings.json');
    await mkdir(dirname(desktopConfigPath), { recursive: true });
    await writeFile(
      desktopConfigPath,
      JSON.stringify({
        deploymentMode: '3p',
        mcpServers: {
          gbrain: {
            command: 'O:/CCTest/tools/gbrain.cmd',
            args: ['serve']
          }
        }
      }),
      'utf8'
    );

    const result = await installHook('claude', 'O:\\w_Island\\scripts\\vibe-island-hook.mjs', home);
    const installed = JSON.parse(await readFile(desktopConfigPath, 'utf8'));

    expect(result.configPath).toBe(desktopConfigPath);
    expect(installed.deploymentMode).toBe('3p');
    expect(installed.mcpServers.gbrain.command).toBe('O:/CCTest/tools/gbrain.cmd');
    expect(JSON.stringify(installed).match(/vibe-island-hook/g)?.length).toBe(6);
    expect(existsSync(legacySettingsPath)).toBe(false);
  });

  it('installs Cursor hooks without overwriting unrelated hook entries', async () => {
    const settingsPath = join(home, '.cursor', 'hooks.json');
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(
      settingsPath,
      JSON.stringify({
        hooks: {
          beforeSubmitPrompt: [
            {
              matcher: 'keep',
              hooks: [{ type: 'command', command: 'echo cursor-keep' }]
            }
          ]
        },
        theme: 'dark'
      }),
      'utf8'
    );

    const first = await installHook('cursor', 'O:\\w_Island\\scripts\\vibe-island-hook.mjs', home);
    const second = await installHook('cursor', 'O:\\w_Island\\scripts\\vibe-island-hook.mjs', home);
    const installed = JSON.parse(await readFile(settingsPath, 'utf8'));

    expect(first.configPath).toBe(settingsPath);
    expect(first.installed).toBe(true);
    expect(second.changed).toBe(false);
    expect(installed.theme).toBe('dark');
    expect(JSON.stringify(installed)).toContain('echo cursor-keep');
    expect(Object.keys(installed.hooks).sort()).toEqual([
      'afterFileEdit',
      'beforeMCPExecution',
      'beforeReadFile',
      'beforeShellExecution',
      'beforeSubmitPrompt',
      'stop'
    ]);
    expect(JSON.stringify(installed).match(/vibe-island-hook/g)?.length).toBe(6);
  });

  it('installs Kimi hooks in TOML while preserving user config', async () => {
    const configPath = join(home, '.kimi', 'config.toml');
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, 'model = "moonshot"\n\n[[hooks]]\nevent = "UserPromptSubmit"\ncommand = "echo keep"\n', 'utf8');

    const first = await installHook('kimi', 'O:\\w_Island\\scripts\\vibe-island-hook.mjs', home);
    const second = await installHook('kimi', 'O:\\w_Island\\scripts\\vibe-island-hook.mjs', home);
    const installed = await readFile(configPath, 'utf8');

    expect(first.configPath).toBe(configPath);
    expect(first.installed).toBe(true);
    expect(second.changed).toBe(false);
    expect(installed).toContain('model = "moonshot"');
    expect(installed).toContain('command = "echo keep"');
    expect(installed.match(/^# managed-by-vibe-island/gm)?.length).toBe(6);
    expect(installed.match(/vibe-island-hook/g)?.length).toBe(6);
    expect(installed).toContain('event = "PreToolUse"');
    expect(installed).toContain('event = "PostToolUse"');
  });

  it('installs and detects the managed OpenCode plugin', async () => {
    const pluginPath = join(home, '.config', 'opencode', 'plugins', 'vibe-island.js');

    const first = await installHook('opencode', 'O:\\w_Island\\scripts\\vibe-island-hook.mjs', home);
    const second = await installHook('opencode', 'O:\\w_Island\\scripts\\vibe-island-hook.mjs', home);
    const plugin = await readFile(pluginPath, 'utf8');
    const detected = (await detectAgents(home)).find((agent) => agent.id === 'opencode');

    expect(first.configPath).toBe(pluginPath);
    expect(first.installed).toBe(true);
    expect(second.changed).toBe(false);
    expect(plugin).toContain('managed-by-vibe-island');
    expect(plugin).toContain('--agent opencode');
    expect(plugin).toContain("event?.type ?? 'status'");
    expect(detected).toMatchObject({
      id: 'opencode',
      configPath: pluginPath,
      pluginPath,
      hookInstalled: true,
      health: 'installed'
    });
  });

  it('advertises config adapters for supported forks', async () => {
    const detected = await detectAgents(home);
    const byId = Object.fromEntries(detected.map((agent) => [agent.id, agent]));

    expect(byId.qoder.configPath).toBe(join(home, '.qoder', 'settings.json'));
    expect(byId.qwen.configPath).toBe(join(home, '.qwen', 'settings.json'));
    expect(byId.factory.configPath).toBe(join(home, '.factory', 'settings.json'));
    expect(byId.codebuddy.configPath).toBe(join(home, '.codebuddy', 'settings.json'));
  });

  it('installs Claude statusLine without overwriting a user custom status line', async () => {
    const settingsPath = join(home, '.claude', 'settings.json');
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(
      settingsPath,
      JSON.stringify({
        statusLine: {
          type: 'command',
          command: 'node custom-statusline.js'
        }
      }),
      'utf8'
    );

    const blocked = await installClaudeStatusLine('node vibe-island-statusline.mjs', home);
    const preserved = JSON.parse(await readFile(settingsPath, 'utf8'));

    expect(blocked.changed).toBe(false);
    expect(blocked.installed).toBe(false);
    expect(preserved.statusLine.command).toBe('node custom-statusline.js');
  });

  it('removes only the managed Claude statusLine bridge', async () => {
    const settingsPath = join(home, '.claude', 'settings.json');

    const installed = await installClaudeStatusLine('node vibe-island-statusline.mjs', home);
    const removed = await uninstallClaudeStatusLine(home);
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'));

    expect(installed.installed).toBe(true);
    expect(removed.changed).toBe(true);
    expect(settings.statusLine).toBeUndefined();
  });
});
