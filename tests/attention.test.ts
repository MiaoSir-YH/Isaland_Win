import { describe, expect, it } from 'vitest';
import {
  getIslandAttentionReason,
  getIslandNotificationPriority,
  shouldAutoClearIslandNotification,
  shouldPromoteToIslandNotification,
  shouldPromoteWithStrategy,
  shouldReplaceIslandNotification
} from '../src/shared/attention';
import { normalizeEvent } from '../src/shared/normalize';

describe('island attention rules', () => {
  it('does not promote ordinary tool events', () => {
    const event = normalizeEvent(
      {
        hook_event_name: 'PostToolUse',
        session_id: 's1',
        title: 'Codex 完成 Shell',
        message: 'npm test'
      },
      'codex'
    );

    expect(shouldPromoteToIslandNotification(event)).toBe(false);
    expect(shouldPromoteWithStrategy(event, 'focused')).toBe(false);
    expect(shouldPromoteWithStrategy(event, 'realtime')).toBe(true);
    expect(shouldPromoteWithStrategy(event, 'silent')).toBe(false);
  });

  it('promotes non-interrupt session completion', () => {
    const event = normalizeEvent(
      {
        hook_event_name: 'Stop',
        session_id: 's1',
        title: 'Codex 会话完成'
      },
      'codex'
    );

    expect(getIslandAttentionReason(event)).toBe('completed');
  });

  it('suppresses interrupt completion', () => {
    const event = normalizeEvent(
      {
        hook_event_name: 'Stop',
        session_id: 's1',
        title: 'Codex 会话结束',
        isInterrupt: true
      },
      'codex'
    );

    expect(shouldPromoteToIslandNotification(event)).toBe(false);
  });

  it('promotes mirrored Codex assistant replies', () => {
    const event = normalizeEvent(
      {
        agent: 'codex',
        eventType: 'assistant',
        title: 'OK',
        source: 'codex-reply-watcher'
      },
      'codex'
    );

    expect(getIslandAttentionReason(event)).toBe('reply');
    expect(shouldAutoClearIslandNotification(event)).toBe(true);
  });

  it('promotes errors while still letting replies take over', () => {
    const error = normalizeEvent(
      {
        agent: 'codex',
        eventType: 'error',
        title: '命令失败',
        message: 'exit 1'
      },
      'codex'
    );
    const reply = normalizeEvent(
      {
        agent: 'codex',
        eventType: 'assistant',
        title: 'OK',
        source: 'codex-reply-watcher'
      },
      'codex'
    );

    expect(getIslandAttentionReason(error)).toBe('error');
    expect(shouldPromoteWithStrategy(error, 'focused')).toBe(true);
    expect(shouldAutoClearIslandNotification(error)).toBe(true);
    expect(getIslandNotificationPriority(reply)).toBeGreaterThan(getIslandNotificationPriority(error));
    expect(shouldReplaceIslandNotification(error, reply)).toBe(true);
  });
});
