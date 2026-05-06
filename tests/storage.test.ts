import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, loadRecentEvents, loadSessions, makeStoragePaths } from '../src/main/storage';

let appData: string;

beforeEach(async () => {
  appData = await mkdtemp(join(tmpdir(), 'vibe-island-storage-'));
});

afterEach(async () => {
  await rm(appData, { recursive: true, force: true });
});

describe('config storage migration', () => {
  it('migrates boolean sound config to the structured sound object', async () => {
    const paths = makeStoragePaths(appData);
    await mkdir(dirname(paths.config), { recursive: true });
    await writeFile(paths.config, JSON.stringify({ sound: true }), 'utf8');

    const config = await loadConfig(paths);

    expect(config.sound).toEqual({
      enabled: true,
      name: 'asterisk',
      volume: 0.8
    });
  });

  it('fills defaults for partial structured sound config', async () => {
    const paths = makeStoragePaths(appData);
    await mkdir(dirname(paths.config), { recursive: true });
    await writeFile(paths.config, JSON.stringify({ sound: { enabled: true, name: 'question' } }), 'utf8');

    const config = await loadConfig(paths);

    expect(config.sound).toEqual({
      enabled: true,
      name: 'question',
      volume: 0.8
    });
  });

  it('filters noisy stored sessions and status line events on load', async () => {
    const paths = makeStoragePaths(appData);
    await mkdir(dirname(paths.sessions), { recursive: true });
    await writeFile(
      paths.sessions,
      JSON.stringify(
        [
          {
            id: 'jump-session',
            agent: 'unknown',
            workspace: 'M:\\island\\Island_Win',
            title: 'Island_Win',
            status: 'notification',
            lastMessage: 'Opened M:\\island\\Island_Win',
            lastSeenAt: new Date().toISOString(),
            eventCount: 1,
            metadata: { discoverySource: 'jump' }
          },
          {
            id: 'live-claude',
            agent: 'claude',
            workspace: 'M:\\island\\Island_Win',
            title: 'Island_Win',
            status: 'user',
            lastMessage: '回复OK',
            lastSeenAt: new Date().toISOString(),
            eventCount: 3,
            metadata: { terminal: { parentPid: 1234 } }
          }
        ],
        null,
        2
      ),
      'utf8'
    );
    await writeFile(
      paths.events,
      [
        JSON.stringify({
          schemaVersion: 1,
          id: 'statusline',
          timestamp: new Date().toISOString(),
          agent: 'claude',
          eventType: 'status',
          title: 'Claude 状态更新',
          severity: 'info',
          metadata: { hook_event_name: 'StatusLine' }
        }),
        JSON.stringify({
          schemaVersion: 1,
          id: 'tool-start',
          timestamp: new Date().toISOString(),
          agent: 'claude',
          eventType: 'tool-start',
          title: 'Claude 正在使用 Bash',
          severity: 'info'
        }),
        ''
      ].join('\n'),
      'utf8'
    );

    const sessions = await loadSessions(paths);
    const events = await loadRecentEvents(paths);

    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('live-claude');
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('tool-start');
  });
});
