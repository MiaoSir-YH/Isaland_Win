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
        cwd: 'O:\\w_Island',
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

  it('routes Claude PreToolUse event posts as events instead of actionable approvals', async () => {
    const events: NormalizedEvent[] = [];
    const requests: PermissionRequest[] = [];
    server = await startIpcServer({
      onEvent: async (event) => {
        events.push(event);
      },
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

    const response = await fetch(`http://${server.runtime.host}:${server.runtime.port}/v1/events?agent=claude`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${server.runtime.token}`
      },
      body: JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: 'session-claude',
        cwd: 'M:\\ai-harness\\island',
        tool_name: 'Bash',
        tool_input: {
          command: 'npm test'
        }
      })
    });

    expect(response.status).toBe(202);
    expect(requests).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      agent: 'claude',
      eventType: 'tool-start',
      sessionId: 'session-claude',
      command: 'npm test'
    });
  });

  it('routes Claude UserPromptSubmit event posts as user events instead of questions', async () => {
    const events: NormalizedEvent[] = [];
    const requests: PermissionRequest[] = [];
    server = await startIpcServer({
      onEvent: async (event) => {
        events.push(event);
      },
      onPermissionRequest: async (request): Promise<PermissionResponse> => {
        requests.push(request);
        return {
          id: request.id,
          decision: 'answer',
          answer: 'OK',
          decidedAt: '2026-05-02T00:00:00.000Z'
        };
      },
      onPermissionResponse: async () => undefined
    });

    const response = await fetch(`http://${server.runtime.host}:${server.runtime.port}/v1/events?agent=claude`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${server.runtime.token}`
      },
      body: JSON.stringify({
        hook_event_name: 'UserPromptSubmit',
        session_id: 'session-claude',
        cwd: 'M:\\ai-harness\\island',
        prompt: '回复OK'
      })
    });

    expect(response.status).toBe(202);
    expect(requests).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      agent: 'claude',
      eventType: 'user',
      sessionId: 'session-claude'
    });
  });

  it('routes Claude AskUserQuestion pre-tool calls as events instead of actionable requests', async () => {
    const events: NormalizedEvent[] = [];
    const requests: PermissionRequest[] = [];
    server = await startIpcServer({
      onEvent: async (event) => {
        events.push(event);
      },
      onPermissionRequest: async (request): Promise<PermissionResponse> => {
        requests.push(request);
        return {
          id: request.id,
          decision: 'answer',
          answer: '执行',
          decidedAt: '2026-05-02T00:00:00.000Z'
        };
      },
      onPermissionResponse: async () => undefined
    });

    const response = await fetch(`http://${server.runtime.host}:${server.runtime.port}/v1/events?agent=claude`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${server.runtime.token}`
      },
      body: JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: 'session-claude',
        cwd: 'M:\\ai-harness\\island',
        tool_name: 'AskUserQuestion',
        tool_input: {
          questions: [
            {
              question: '是否执行这次模拟权限审批请求？',
              options: [
                { label: '执行', description: '发送一次模拟权限审批请求。' },
                { label: '不执行', description: '不发送请求，保持当前状态。' }
              ]
            }
          ]
        }
      })
    });

    expect(response.status).toBe(202);
    expect(requests).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      agent: 'claude',
      eventType: 'tool-start',
      sessionId: 'session-claude',
      toolName: 'AskUserQuestion'
    });
  });

  it('routes Claude PermissionRequest events through the actionable request handler', async () => {
    const requests: PermissionRequest[] = [];
    server = await startIpcServer({
      onEvent: async () => undefined,
      onPermissionRequest: async (request): Promise<PermissionResponse> => {
        requests.push(request);
        return {
          id: request.id,
          decision: 'allow',
          decidedAt: '2026-05-06T00:00:00.000Z'
        };
      },
      onPermissionResponse: async () => undefined
    });

    const response = await fetch(`http://${server.runtime.host}:${server.runtime.port}/v1/events?agent=claude`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${server.runtime.token}`
      },
      body: JSON.stringify({
        hook_event_name: 'PermissionRequest',
        request_id: 'claude-permission-1',
        session_id: 'session-claude',
        cwd: 'M:\\ai-harness\\island',
        tool_name: 'Bash',
        tool_input: {
          command: 'npm run build'
        }
      })
    });

    const body = (await response.json()) as { permission: PermissionResponse };

    expect(response.status).toBe(200);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      id: 'claude-permission-1',
      agent: 'claude',
      kind: 'permission',
      sessionId: 'session-claude',
      toolName: 'Bash',
      command: 'npm run build'
    });
    expect(body.permission).toMatchObject({
      decision: 'allow'
    });
  });

  it('routes question requests through the actionable request handler', async () => {
    const requests: PermissionRequest[] = [];
    server = await startIpcServer({
      onEvent: async () => undefined,
      onPermissionRequest: async (request): Promise<PermissionResponse> => {
        requests.push(request);
        return {
          id: request.id,
          decision: 'answer',
          answer: 'Use the release branch.',
          decidedAt: '2026-05-02T00:00:00.000Z'
        };
      },
      onPermissionResponse: async () => undefined
    });

    const response = await fetch(`http://${server.runtime.host}:${server.runtime.port}/v1/question/request?agent=cursor`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${server.runtime.token}`
      },
      body: JSON.stringify({
        request_id: 'question-1',
        session_id: 'session-1',
        cwd: 'M:\\ai-harness\\island',
        question: 'Which branch should I use?',
        choices: ['main', 'release']
      })
    });

    const body = (await response.json()) as { permission: PermissionResponse };

    expect(response.status).toBe(200);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      id: 'question-1',
      kind: 'question',
      agent: 'cursor',
      sessionId: 'session-1',
      workspace: 'M:\\ai-harness\\island',
      prompt: 'Which branch should I use?',
      choices: ['main', 'release']
    });
    expect(body.permission).toMatchObject({
      id: 'question-1',
      decision: 'answer',
      answer: 'Use the release branch.'
    });
  });
});
