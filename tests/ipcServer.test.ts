import { afterEach, describe, expect, it } from 'vitest';
import type { NormalizedEvent, PermissionRequest, PermissionResponse } from '../src/shared/types';
import { startIpcServer, type IpcServerHandle } from '../src/main/ipcServer';

let server: IpcServerHandle | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

describe('IPC server', () => {
  it('accepts normalized event posts with bearer auth', async () => {
    const events: NormalizedEvent[] = [];
    server = await startIpcServer({
      onEvent: async (event) => {
        events.push(event);
      },
      onPermissionRequest: async (request) => ({
        id: request.id,
        decision: 'deny',
        decidedAt: new Date().toISOString()
      }),
      onPermissionResponse: async () => undefined
    });

    const response = await fetch(`http://${server.runtime.host}:${server.runtime.port}/v1/events?agent=gemini`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${server.runtime.token}`
      },
      body: JSON.stringify({
        type: 'PostToolUse',
        session_id: 'session-1',
        cwd: 'O:\\w_Isaland',
        tool_name: 'Shell',
        tool_input: {
          command: 'npm test'
        }
      })
    });

    expect(response.status).toBe(202);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      agent: 'gemini',
      eventType: 'tool-end',
      sessionId: 'session-1',
      command: 'npm test'
    });
  });

  it('returns explicit permission decisions without auto-approval', async () => {
    const requests: PermissionRequest[] = [];
    server = await startIpcServer({
      onEvent: async () => undefined,
      onPermissionRequest: async (request): Promise<PermissionResponse> => {
        requests.push(request);
        return {
          id: request.id,
          decision: 'deny',
          decidedAt: '2026-05-02T00:00:00.000Z'
        };
      },
      onPermissionResponse: async () => undefined
    });

    const response = await fetch(`http://${server.runtime.host}:${server.runtime.port}/v1/permission/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${server.runtime.token}`
      },
      body: JSON.stringify({
        agent: 'codex',
        eventType: 'PreToolUse',
        toolName: 'Shell',
        command: 'Remove-Item -Recurse C:\\temp\\demo'
      })
    });

    const body = (await response.json()) as { permission: PermissionResponse };

    expect(response.status).toBe(200);
    expect(requests[0].risk).toBe('high');
    expect(body.permission.decision).toBe('deny');
  });
});

