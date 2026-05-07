import { describe, expect, it } from 'vitest';
import {
  getIslandAttentionReason,
  getIslandNotificationPriority,
  shouldAutoClearIslandNotification,
  shouldPromoteToIslandNotification,
  shouldPromoteWithStrategy,
  shouldShowSystemNotification,
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

  it('does not promote generic Claude notifications as questions', () => {
    const event = normalizeEvent(
      {
        hook_event_name: 'Notification',
        session_id: 's1',
        title: 'Claude 状态更新',
        message: 'Background sync completed',
        notification_type: 'info'
      },
      'claude'
    );

    expect(getIslandAttentionReason(event)).toBe('none');
    expect(shouldPromoteWithStrategy(event, 'focused')).toBe(false);
  });

  it('promotes mirrored Claude permission notifications', () => {
    const event = normalizeEvent(
      {
        hook_event_name: 'Notification',
        session_id: 's1',
        message: 'Claude needs your permission to use Read',
        notification_type: 'permission_prompt'
      },
      'claude'
    );

    expect(getIslandAttentionReason(event)).toBe('question');
    expect(shouldPromoteWithStrategy(event, 'focused')).toBe(true);
    expect(shouldShowSystemNotification(event)).toBe(true);
  });

  it('does not promote Claude idle input notifications', () => {
    const event = normalizeEvent(
      {
        hook_event_name: 'Notification',
        session_id: 's1',
        message: 'Claude is waiting for your input',
        notification_type: 'idle_prompt'
      },
      'claude'
    );

    expect(getIslandAttentionReason(event)).toBe('none');
    expect(shouldPromoteWithStrategy(event, 'focused')).toBe(false);
    expect(shouldAutoClearIslandNotification(event)).toBe(true);
  });

  it('still promotes explicit Claude input waiting notifications', () => {
    const event = normalizeEvent(
      {
        hook_event_name: 'Notification',
        session_id: 's1',
        message: 'Claude is waiting for your input',
        notification_type: 'input_waiting'
      },
      'claude'
    );

    expect(getIslandAttentionReason(event)).toBe('question');
    expect(shouldPromoteWithStrategy(event, 'focused')).toBe(true);
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

  it('does not classify review findings in final replies as questions', () => {
    const event = normalizeEvent(
      {
        agent: 'codex',
        eventType: 'session-stop',
        title: '**Findings** [P1] input_waiting 被整体压掉会吞掉真实问题提示',
        message: '当前把 Claude 的 input_waiting 和 idle_prompt 都视为低信号，会导致灵动岛不显示按钮。',
        source: 'codex-reply-watcher',
        phase: 'final_answer'
      },
      'codex'
    );

    expect(getIslandAttentionReason(event)).toBe('completed');
    expect(shouldAutoClearIslandNotification(event)).toBe(true);
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
