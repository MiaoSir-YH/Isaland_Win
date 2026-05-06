import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

  it('spools unavailable Claude tool hooks as events without approval output', async () => {
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
    expect(result.stdout.trim()).toBe('');
    expect(spool).toContain('PreToolUse');
    expect(spool).not.toContain('approve');
  });

  it('spools unavailable Claude AskUserQuestion pre-tool hooks without actionable stdout', async () => {
    const result = await runHook(
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'AskUserQuestion',
        tool_input: {
          questions: [
            {
              question: '是否执行这次模拟权限审批请求？',
              options: [{ label: '执行' }, { label: '不执行' }]
            }
          ]
        }
      }),
      ['--agent', 'claude', '--event', 'PreToolUse']
    );

    const spool = await readFile(join(appData, 'Vibe Island', 'spool.jsonl'), 'utf8');

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('');
    expect(spool).toContain('AskUserQuestion');
  });

  it('emits Claude-compatible actionable output for AskUserQuestion permission requests', async () => {
    await withRuntimeServer(
      {
        permission: {
          id: 'question-1',
          decision: 'answer',
          answer: '执行'
        }
      },
      async () => {
      const result = await runHook(
        JSON.stringify({
          hook_event_name: 'PermissionRequest',
          tool_name: 'AskUserQuestion',
          tool_input: {
            questions: [
              {
                question: '是否执行这次模拟权限审批请求？',
                options: [{ label: '执行' }, { label: '不执行' }]
              }
            ]
          }
        }),
        ['--agent', 'claude', '--event', 'PermissionRequest']
      );

      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout.trim().length).toBeGreaterThan(0);
      expect(JSON.parse(result.stdout)).toEqual({
        continue: true,
        suppressOutput: true,
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: {
            behavior: 'allow',
            updatedInput: {
              questions: [
                {
                  question: '是否执行这次模拟权限审批请求？',
                  options: [{ label: '执行' }, { label: '不执行' }]
                }
              ],
              answers: {
                '是否执行这次模拟权限审批请求？': '执行'
              }
            }
          }
        }
      });
      }
    );
  });

  it('emits Claude-compatible actionable output for PermissionRequest responses', async () => {
    await withRuntimeServer(
      {
        permission: {
          id: 'permission-1',
          decision: 'allow'
        }
      },
      async () => {
      const result = await runHook(
        JSON.stringify({
          hook_event_name: 'PermissionRequest',
          tool_name: 'Bash',
          tool_input: {
            command: 'npm test'
          }
        }),
        ['--agent', 'claude', '--event', 'PermissionRequest']
      );

      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        continue: true,
        suppressOutput: true,
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: {
            behavior: 'allow',
            updatedInput: {
              command: 'npm test'
            }
          }
        }
      });
      }
    );
  });

  it('status line helper returns a stable status string without spooling app events', async () => {
    const result = await runScript(
      'scripts/vibe-island-statusline.mjs',
      JSON.stringify({
        cwd: 'M:\\ai-harness\\island',
        model: {
          display_name: 'Sonnet'
        }
      }),
      []
    );

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('Vibe Island | island | Sonnet');
    await expect(readFile(join(appData, 'Vibe Island', 'spool.jsonl'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    });
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
  return runScript('scripts/vibe-island-hook.mjs', input, args);
}

function runScript(
  script: string,
  input: string,
  args: string[]
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [script, ...args],
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

async function withRuntimeServer(
  responseBody: Record<string, unknown>,
  run: () => Promise<void>
): Promise<void> {
  const token = 'test-token';
  const server = createServer(async (request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: false }));
      return;
    }

    for await (const _chunk of request) {
      // Consume the body so the client request can finish cleanly.
    }

    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(responseBody));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    throw new Error('Failed to resolve mock runtime server address.');
  }

  const runtimeDir = join(appData, 'Vibe Island');
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(
    join(runtimeDir, 'runtime.json'),
    JSON.stringify({
      host: '127.0.0.1',
      port: address.port,
      token
    }),
    'utf8'
  );

  try {
    await run();
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
