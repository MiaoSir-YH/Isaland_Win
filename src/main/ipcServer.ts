import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { AgentId, NormalizedEvent, PermissionRequest, PermissionResponse, RuntimeInfo } from '@shared/types';
import { isPermissionLike, isQuestionLike, normalizeAgent, normalizeEvent, normalizePermissionRequest } from '@shared/normalize';

interface IpcServerOptions {
  onEvent: (event: NormalizedEvent) => Promise<void>;
  onPermissionRequest: (request: PermissionRequest) => Promise<PermissionResponse>;
  onPermissionResponse: (response: PermissionResponse) => Promise<void>;
}

export interface IpcServerHandle {
  runtime: RuntimeInfo;
  close: () => Promise<void>;
}

export async function startIpcServer(options: IpcServerOptions): Promise<IpcServerHandle> {
  const token = randomBytes(24).toString('hex');
  const server = createServer((request, response) => {
    void routeRequest(request, response, token, options);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    runtime: {
      host: '127.0.0.1',
      port: address.port,
      token,
      pid: process.pid,
      startedAt: new Date().toISOString()
    },
    close: () => closeServer(server)
  };
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  token: string,
  options: IpcServerOptions
): Promise<void> {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/v1/health') {
      sendJson(response, 200, { ok: true, pid: process.pid });
      return;
    }

    if (!isAuthorized(request, token)) {
      sendJson(response, 401, { ok: false, error: 'unauthorized' });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/v1/events') {
      const body = await readBody(request);
      const raw = JSON.parse(body || '{}') as Record<string, unknown>;
      const agent = normalizeAgentParam(url.searchParams.get('agent'), raw.agent);
      if (isActionableEvent(raw, agent)) {
        const permission = normalizePermissionRequest(raw, agent);
        const decision = await options.onPermissionRequest(permission);
        sendJson(response, 200, { ok: true, permission: decision });
      } else {
        const event = normalizeEvent(raw, agent);
        await options.onEvent(event);
        sendJson(response, 202, { ok: true, id: event.id });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/v1/permission/request') {
      const body = await readBody(request);
      const raw = JSON.parse(body || '{}') as Record<string, unknown>;
      const permission = normalizePermissionRequest(raw, normalizeAgentParam(url.searchParams.get('agent'), raw.agent));
      const decision = await options.onPermissionRequest(permission);
      sendJson(response, 200, { ok: true, permission: decision });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/v1/question/request') {
      const body = await readBody(request);
      const raw = JSON.parse(body || '{}') as Record<string, unknown>;
      const permission = normalizePermissionRequest(
        { ...raw, type: raw.type ?? 'question' },
        normalizeAgentParam(url.searchParams.get('agent'), raw.agent)
      );
      const decision = await options.onPermissionRequest(permission);
      sendJson(response, 200, { ok: true, permission: decision });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/v1/permission/respond') {
      const body = await readBody(request);
      const raw = JSON.parse(body || '{}') as PermissionResponse;
      await options.onPermissionResponse(raw);
      sendJson(response, 200, { ok: true });
      return;
    }

    sendJson(response, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function isAuthorized(request: IncomingMessage, token: string): boolean {
  const auth = request.headers.authorization;
  if (auth === `Bearer ${token}`) return true;
  return request.headers['x-vibe-island-token'] === token;
}

function normalizeAgentParam(value: unknown, fallback: unknown): AgentId {
  const candidate = typeof value === 'string' ? value : fallback;
  return normalizeAgent(candidate);
}

function isActionableEvent(raw: Record<string, unknown>, agent: AgentId): boolean {
  if (agent === 'claude' && !isClaudeActionable(raw)) return false;
  return isPermissionLike(raw) || isQuestionLike(raw);
}

function isClaudeActionable(raw: Record<string, unknown>): boolean {
  if (raw.vibeIslandActionable === true) return true;
  const eventName =
    typeof raw.eventType === 'string'
      ? raw.eventType
      : typeof raw.event_type === 'string'
        ? raw.event_type
        : typeof raw.hook_event_name === 'string'
          ? raw.hook_event_name
          : typeof raw.type === 'string'
            ? raw.type
            : typeof raw.name === 'string'
              ? raw.name
              : '';
  return /permissionrequest/i.test(eventName);
}

function isClaudeQuestionTool(raw: Record<string, unknown>): boolean {
  const toolName = typeof raw.tool_name === 'string' ? raw.tool_name : typeof raw.toolName === 'string' ? raw.toolName : typeof raw.tool === 'string' ? raw.tool : undefined;
  if (toolName?.toLowerCase() !== 'askuserquestion') return false;
  const toolInput = raw.tool_input;
  return Boolean(toolInput && typeof toolInput === 'object');
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        request.destroy(new Error('Request body too large.'));
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(body));
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

