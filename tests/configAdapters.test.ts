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

    const first = await installHook('claude', 'O:\\w_Isaland\\scripts\\vibe-island-hook.mjs', home);
    const second = await installHook('claude', 'O:\\w_Isaland\\scripts\\vibe-island-hook.mjs', home);
    const installed = JSON.parse(await readFile(settingsPath, 'utf8'));

    expect(first.installed).toBe(true);
    expect(second.changed).toBe(false);
    expect(installed.model).toBe('sonnet');
    expect(JSON.stringify(installed)).toContain('echo keep');
    expect(JSON.stringify(installed).match(/vibe-island-hook/g)?.length).toBe(5);
  });

  it('uninstalls only managed hooks', async () => {
    const settingsPath = join(home, '.claude', 'settings.json');
    await installHook('claude', 'O:\\w_Isaland\\scripts\\vibe-island-hook.mjs', home);
    await uninstallHook('claude', home);
    const uninstalled = JSON.parse(await readFile(settingsPath, 'utf8'));

    expect(JSON.stringify(uninstalled)).not.toContain('vibe-island-hook');
    expect(uninstalled.hooks).toEqual({});
  });
});
