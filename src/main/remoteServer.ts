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

export async function startRemoteServer(options: {
  token?: string;
  onResolution: (response: PermissionResponse) => void;
}): Promise<RemoteServerHandle> {
  const token = options.token ?? randomBytes(24).toString('hex');
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
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        options.onResolution(JSON.parse(body || '{}') as PermissionResponse);
        response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
      });
      return;
    }
    response.writeHead(404).end('not found');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    token,
    pushEvent: (event) => {
      const line = `data: ${JSON.stringify(event)}\n\n`;
      for (const client of clients) client.write(line);
    },
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}
