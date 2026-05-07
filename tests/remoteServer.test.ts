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
      onResolution: () => undefined
    });

    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});
