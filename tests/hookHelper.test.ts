import { execFile, spawn } from 'node:child_process';
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
  it('does not wait forever when hook stdin stays open', async () => {
    const result = await runHookWithOpenStdin(['--agent', 'codex', '--event', 'UserPromptSubmit'], 1200);

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
  });

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

function runHookWithOpenStdin(
  args: string[],
  timeoutMs: number
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/vibe-island-hook.mjs', ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APPDATA: appData
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      resolve({ code: null, stdout, stderr, timedOut: true });
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('exit', (code) => {
      if (settled) return;
      clearTimeout(timer);
      settled = true;
      resolve({ code, stdout, stderr, timedOut: false });
    });
  });
}

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
