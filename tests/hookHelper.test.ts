import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let appData: string;

beforeEach(() => {
  appData = join(tmpdir(), `vibe-island-hook-${Date.now()}-${Math.random().toString(36).slice(2)}`);
});

afterEach(async () => {
  await rm(appData, { recursive: true, force: true });
});

describe('hook helper fallback', () => {
  it('spools unavailable permission requests and does not approve', async () => {
    const result = await runHook(
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Shell',
        tool_input: {
          command: 'Remove-Item -Recurse C:\\temp\\demo'
        }
      }),
      ['--agent', 'claude', '--event', 'PreToolUse']
    );

    const spool = await readFile(join(appData, 'Vibe Island', 'spool.jsonl'), 'utf8');

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('{}');
    expect(spool).toContain('PreToolUse');
    expect(spool).not.toContain('approve');
  });
});

function runHook(input: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      ['scripts/vibe-island-hook.mjs', ...args],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          APPDATA: appData
        }
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') {
          reject(error);
          return;
        }
        resolve({
          code: typeof error?.code === 'number' ? error.code : 0,
          stdout,
          stderr
        });
      }
    );
    child.stdin?.end(input);
  });
}

