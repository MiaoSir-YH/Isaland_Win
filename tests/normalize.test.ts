import { describe, expect, it } from 'vitest';
import {
  isPermissionLike,
  isQuestionLike,
  normalizeAgent,
  normalizeEvent,
  normalizePermissionRequest
} from '../src/shared/normalize';
import type { AgentId } from '../src/shared/types';

describe('normalizeAgent', () => {
  it('normalizes expanded agent identifiers case-insensitively', () => {
    const cases: Array<[unknown, AgentId]> = [
      ['CODEX', 'codex'],
      ['Claude', 'claude'],
      ['Gemini', 'gemini'],
      ['OpenCode', 'opencode'],
      ['Cursor', 'cursor'],
      ['KIMI', 'kimi'],
      ['Qoder', 'qoder'],
      ['QWEN', 'qwen'],
      ['Factory', 'factory'],
      ['CodeBuddy', 'codebuddy']
    ];

    for (const [input, expected] of cases) {
      expect(normalizeAgent(input)).toBe(expected);
    }
  });

  it('falls back for unknown or non-string agent identifiers', () => {
    expect(normalizeAgent('not-an-agent', 'codex')).toBe('codex');
    expect(normalizeAgent(undefined, 'cursor')).toBe('cursor');
  });
});

describe('normalizeEvent', () => {
  it('normalizes Claude tool events', () => {
    const event = normalizeEvent(
      {
        hook_event_name: 'PreToolUse',
        session_id: 'abc',
        cwd: 'O:\\w_Island',
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
    expect(event.workspace).toBe('O:\\w_Island');
    expect(event.toolName).toBe('Bash');
    expect(event.command).toBe('npm test');
  });

  it('uses submitted prompt text for user events', () => {
    const event = normalizeEvent(
      {
        hook_event_name: 'UserPromptSubmit',
        session_id: 'abc',
        prompt: '回复OK'
      },
      'claude'
    );

    expect(event.eventType).toBe('user');
    expect(event.title).toBe('Claude 收到输入');
    expect(event.message).toBe('回复OK');
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

  it('maps Claude mirrored permission prompts to a permission-style title', () => {
    const event = normalizeEvent(
      {
        hook_event_name: 'Notification',
        session_id: 'abc',
        notification_type: 'permission_prompt',
        message: 'Claude needs your permission to use PowerShell'
      },
      'claude'
    );

    expect(event.eventType).toBe('notification');
    expect(event.title).toBe('Claude 请求权限');
    expect(event.message).toBe('Claude needs your permission to use PowerShell');
  });

  it('maps Claude idle prompts to a waiting-input title', () => {
    const event = normalizeEvent(
      {
        hook_event_name: 'Notification',
        session_id: 'abc',
        notification_type: 'idle_prompt',
        message: 'Claude is waiting for your input'
      },
      'claude'
    );

    expect(event.eventType).toBe('notification');
    expect(event.title).toBe('Claude 等待输入');
    expect(event.message).toBe('Claude is waiting for your input');
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

  it('normalizes questions as actionable requests', () => {
    const permission = normalizePermissionRequest(
      {
        agent: 'Cursor',
        type: 'needs_input',
        request_id: 'question-1',
        conversationId: 'thread-1',
        projectDir: 'M:\\ai-harness\\island',
        question: 'Which branch should I use?',
        options: ['main', 'release'],
        timeout_ms: '45000'
      },
      'codex'
    );

    expect(permission).toMatchObject({
      id: 'question-1',
      kind: 'question',
      agent: 'cursor',
      sessionId: 'thread-1',
      workspace: 'M:\\ai-harness\\island',
      action: '需要回答',
      prompt: 'Which branch should I use?',
      choices: ['main', 'release'],
      risk: 'medium',
      timeoutMs: 45000,
      sourceRequestId: 'question-1'
    });
  });

  it('preserves actionable request details for non-question permission prompts', () => {
    const permission = normalizePermissionRequest(
      {
        agent: 'kimi',
        event_type: 'approval_requested',
        requestId: 'approval-1',
        action: 'Install npm dependencies',
        message: 'Run npm install?',
        command: 'npm install'
      },
      'codex'
    );

    expect(permission).toMatchObject({
      id: 'approval-1',
      kind: 'permission',
      agent: 'kimi',
      action: 'Install npm dependencies',
      prompt: 'Run npm install?',
      command: 'npm install',
      risk: 'medium',
      sourceRequestId: 'approval-1'
    });
  });
});

describe('actionable request detection', () => {
  it('does not classify Claude-style tool hooks as permission requests', () => {
    expect(
      isPermissionLike({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash'
      })
    ).toBe(false);
  });

  it('does not classify normal submitted prompts as questions', () => {
    expect(
      isQuestionLike({
        hook_event_name: 'UserPromptSubmit',
        prompt: '回复OK'
      })
    ).toBe(false);
  });

  it('still classifies explicit approval and question payloads as actionable', () => {
    expect(
      isPermissionLike({
        event_type: 'approval_requested'
      })
    ).toBe(true);
    expect(
      isQuestionLike({
        type: 'needs_input',
        prompt: 'Which branch?'
      })
    ).toBe(true);
  });
});
