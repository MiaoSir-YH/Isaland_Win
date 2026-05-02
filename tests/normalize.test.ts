import { describe, expect, it } from 'vitest';
import { normalizeEvent, normalizePermissionRequest } from '../src/shared/normalize';

describe('normalizeEvent', () => {
  it('normalizes Claude tool events', () => {
    const event = normalizeEvent(
      {
        hook_event_name: 'PreToolUse',
        session_id: 'abc',
        cwd: 'O:\\w_Isaland',
        tool_name: 'Bash',
        tool_input: {
          command: 'npm test'
        }
      },
      'claude'
    );

    expect(event.agent).toBe('claude');
    expect(event.eventType).toBe('tool-start');
    expect(event.sessionId).toBe('abc');
    expect(event.workspace).toBe('O:\\w_Isaland');
    expect(event.toolName).toBe('Bash');
    expect(event.command).toBe('npm test');
  });

  it('normalizes OpenCode failures as errors', () => {
    const event = normalizeEvent({
      agent: 'opencode',
      type: 'tool_failure',
      severity: 'error',
      message: 'command failed'
    });

    expect(event.agent).toBe('opencode');
    expect(event.severity).toBe('error');
    expect(event.message).toBe('command failed');
  });
});

describe('normalizePermissionRequest', () => {
  it('detects destructive commands as high risk', () => {
    const permission = normalizePermissionRequest(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Shell',
        tool_input: {
          command: 'Remove-Item -Recurse C:\\temp\\demo'
        }
      },
      'codex'
    );

    expect(permission.agent).toBe('codex');
    expect(permission.risk).toBe('high');
    expect(permission.timeoutMs).toBe(120000);
  });
});

