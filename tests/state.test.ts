import { describe, expect, it } from 'vitest';
import { IslandState } from '../src/main/state';
import type { AppConfig, PermissionRequest } from '../src/shared/types';
import { DEFAULT_CONFIG } from '../src/shared/types';

describe('IslandState permissions', () => {
  it('keeps all pending permission requests visible', () => {
    const state = new IslandState({
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

    for (let index = 0; index < 25; index += 1) {
      state.addPermission(makePermission(`request-${index}`));
    }

    expect(state.snapshot().permissions).toHaveLength(25);
    expect(state.snapshot().permissions.at(-1)?.id).toBe('request-0');
  });
});

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
