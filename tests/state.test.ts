import { describe, expect, it } from 'vitest';
import { IslandState } from '../src/main/state';
import type { AppConfig, NormalizedEvent, PermissionRequest } from '../src/shared/types';
import { DEFAULT_CONFIG } from '../src/shared/types';

describe('IslandState permissions', () => {
  it('keeps all pending permission requests visible', () => {
    const state = makeState();

    for (let index = 0; index < 25; index += 1) {
      state.addPermission(makePermission(`request-${index}`));
    }

    expect(state.snapshot().permissions).toHaveLength(25);
    expect(state.snapshot().permissions.at(-1)?.id).toBe('request-0');
  });
});

describe('IslandState sessions', () => {
  it('does not let Codex reply watcher events overwrite a session workspace', () => {
    const state = makeState();
    state.applyEvent(makeEvent({ workspace: 'O:\\w_Isaland' }));
    state.applyEvent(
      makeEvent({
        workspace: 'O:\\w_Isaland\\release\\win-unpacked',
        metadata: { source: 'codex-reply-watcher' }
      })
    );

    expect(state.snapshot().sessions[0]).toMatchObject({
      id: 'codex-desktop-replies',
      workspace: 'O:\\w_Isaland',
      title: 'Codex Desktop'
    });
  });
});

function makeState(): IslandState {
  return new IslandState({
    config: DEFAULT_CONFIG as AppConfig,
    agents: [],
    sessions: [],
    events: [],
    runtime: null,
    diagnostics: {
      ipcHealthy: false,
      checkedAt: new Date().toISOString()
    }
  });
}

function makePermission(id: string): PermissionRequest {
  return {
    schemaVersion: 1,
    id,
    kind: 'permission',
    timestamp: new Date().toISOString(),
    agent: 'claude',
    action: 'Approve command',
    risk: 'medium',
    timeoutMs: 120000
  };
}

function makeEvent(input: Partial<NormalizedEvent>): NormalizedEvent {
  return {
    schemaVersion: 1,
    id: `event-${Math.random()}`,
    timestamp: new Date().toISOString(),
    agent: 'codex',
    eventType: 'assistant',
    sessionId: 'codex-desktop-replies',
    title: 'Codex Desktop',
    message: 'Codex 回复',
    severity: 'info',
    ...input
  };
}
