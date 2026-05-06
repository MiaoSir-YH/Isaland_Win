import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installHook, uninstallHook } from '../src/shared/configAdapters';

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
    expect(JSON.stringify(installed).match(/vibe-island-hook/g)?.length).toBe(5);
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
    expect(JSON.stringify(installed).match(/vibe-island-hook/g)?.length).toBe(5);
    expect(existsSync(legacySettingsPath)).toBe(false);
  });
});
