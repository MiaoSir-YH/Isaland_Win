import { afterEach, describe, expect, it } from 'vitest';
import { startRemoteServer, type RemoteServerHandle } from '../src/main/remoteServer';

let server: RemoteServerHandle | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

describe('remote approval server', () => {
  it('binds to localhost by default', async () => {
    server = await startRemoteServer({
      token: 'test-token',
      onResolution: () => true
    });

    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('rejects malformed resolve bodies without invoking the resolver', async () => {
    const resolutions: unknown[] = [];
    server = await startRemoteServer({
      token: 'test-token',
      onResolution: (response) => {
        resolutions.push(response);
        return true;
      }
    });

    const response = await fetch(`${server.url}/v1/remote/resolve?token=test-token`, {
      method: 'POST',
      body: '{bad json'
    });

    expect(response.status).toBe(400);
    expect(resolutions).toHaveLength(0);
  });

  it('rejects oversized resolve bodies before parsing', async () => {
    server = await startRemoteServer({
      token: 'test-token',
      onResolution: () => true
    });

    const response = await fetch(`${server.url}/v1/remote/resolve?token=test-token`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'request-1',
        decision: 'allow',
        decidedAt: new Date().toISOString(),
        padding: 'x'.repeat(20 * 1024)
      })
    });

    expect(response.status).toBe(413);
  });

  it('reports unknown or unverified permission resolutions', async () => {
    server = await startRemoteServer({
      token: 'test-token',
      onResolution: () => false
    });

    const response = await fetch(`${server.url}/v1/remote/resolve?token=test-token`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'request-1',
        decision: 'allow',
        decidedAt: new Date().toISOString(),
        remoteResolveToken: 'wrong-token'
      })
    });

    expect(response.status).toBe(404);
  });

  it('accepts verified permission resolutions', async () => {
    const resolutions: unknown[] = [];
    server = await startRemoteServer({
      token: 'test-token',
      onResolution: (response) => {
        resolutions.push(response);
        return response.remoteResolveToken === 'request-token';
      }
    });

    const response = await fetch(`${server.url}/v1/remote/resolve?token=test-token`, {
      method: 'POST',
      body: JSON.stringify({
        id: 'request-1',
        decision: 'allow',
        decidedAt: new Date().toISOString(),
        remoteResolveToken: 'request-token'
      })
    });

    expect(response.status).toBe(200);
    expect(resolutions).toHaveLength(1);
  });
});
