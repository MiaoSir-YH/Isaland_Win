import { createServer, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { NormalizedEvent, PermissionRequest, PermissionResponse } from '@shared/types';

export interface RemoteServerHandle {
  url: string;
  token: string;
  pushEvent: (event: NormalizedEvent | PermissionRequest) => void;
  close: () => Promise<void>;
}

const MAX_RESOLVE_BODY_BYTES = 16 * 1024;
const PERMISSION_DECISIONS = new Set(['allow', 'deny', 'denyForSession', 'timeout', 'answer']);

export type RemotePermissionResponse = PermissionResponse & {
  remoteResolveToken?: string;
};

export async function startRemoteServer(options: {
  token?: string;
  host?: string;
  onResolution: (response: RemotePermissionResponse) => boolean;
}): Promise<RemoteServerHandle> {
  const token = options.token ?? randomBytes(24).toString('hex');
  const host = options.host ?? '127.0.0.1';
  const clients = new Set<ServerResponse>();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.searchParams.get('token') !== token) {
      response.writeHead(401).end('unauthorized');
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/remote/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive'
      });
      clients.add(response);
      request.on('close', () => clients.delete(response));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/remote/resolve') {
      let body = '';
      let bytes = 0;
      let closed = false;
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        bytes += Buffer.byteLength(chunk, 'utf8');
        if (bytes > MAX_RESOLVE_BODY_BYTES) {
          closed = true;
          response.writeHead(413).end('payload too large');
          request.destroy();
          return;
        }
        body += chunk;
      });
      request.on('end', () => {
        if (closed) return;
        const parsed = parseResolveBody(body);
        if (!parsed) {
          response.writeHead(400).end('invalid resolve body');
          return;
        }
        if (!options.onResolution(parsed)) {
          response.writeHead(404).end('unknown permission request');
          return;
        }
        response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
      });
      return;
    }
    response.writeHead(404).end('not found');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    url: `http://${host}:${address.port}`,
    token,
    pushEvent: (event) => {
      const line = `data: ${JSON.stringify(event)}\n\n`;
      for (const client of clients) client.write(line);
    },
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

function parseResolveBody(body: string): RemotePermissionResponse | null {
  try {
    const value = JSON.parse(body || '{}') as Record<string, unknown>;
    if (!value || typeof value !== 'object') return null;
    if (typeof value.id !== 'string' || value.id.length === 0) return null;
    if (typeof value.decision !== 'string' || !PERMISSION_DECISIONS.has(value.decision)) return null;
    if (typeof value.decidedAt !== 'string' || value.decidedAt.length === 0) return null;
    if ('remoteResolveToken' in value && typeof value.remoteResolveToken !== 'string') return null;
    return {
      id: value.id,
      decision: value.decision,
      decidedAt: value.decidedAt,
      ...(typeof value.answer === 'string' ? { answer: value.answer } : {}),
      ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
      ...(value.scope === 'request' || value.scope === 'session' ? { scope: value.scope } : {}),
      ...(typeof value.remoteResolveToken === 'string' ? { remoteResolveToken: value.remoteResolveToken } : {})
    } as RemotePermissionResponse;
  } catch {
    return null;
  }
}
