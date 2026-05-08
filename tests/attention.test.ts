import { describe, expect, it } from 'vitest';
import {
  getIslandAttentionReason,
  getIslandNotificationPriority,
  shouldAutoClearIslandNotification,
  shouldClearCompletedIslandNotification,
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
    expect(shouldAutoClearIslandNotification(event)).toBe(false);
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

  it('clears completed notifications when a next round user event arrives', () => {
    const completed = normalizeEvent(
      {
        agent: 'codex',
        eventType: 'session-stop',
        sessionId: 's1',
        title: '上一轮已完成'
      },
      'codex'
    );
    const nextRound = normalizeEvent(
      {
        agent: 'codex',
        eventType: 'user',
        sessionId: 's1',
        title: '新的输入',
        message: '继续'
      },
      'codex'
    );

    expect(shouldClearCompletedIslandNotification(completed, nextRound)).toBe(true);
  });

  it('clears completed notifications so lower-priority replies can replace them', () => {
    const completed = normalizeEvent(
      {
        agent: 'codex',
        eventType: 'session-stop',
        sessionId: 's1',
        title: '上一轮已完成'
      },
      'codex'
    );
    const reply = normalizeEvent(
      {
        agent: 'codex',
        eventType: 'assistant',
        sessionId: 's1',
        title: 'OK',
        source: 'codex-reply-watcher'
      },
      'codex'
    );

    expect(getIslandNotificationPriority(reply)).toBeLessThan(getIslandNotificationPriority(completed));
    expect(shouldReplaceIslandNotification(completed, reply)).toBe(false);
    expect(shouldClearCompletedIslandNotification(completed, reply)).toBe(true);
  });

  it('clears completed notifications for Codex app-server turn start status', () => {
    const completed = normalizeEvent(
      {
        agent: 'codex',
        eventType: 'session-stop',
        sessionId: 'thread-1',
        title: '上一轮已完成'
      },
      'codex'
    );
    const turnStart = normalizeEvent(
      {
        agent: 'codex',
        eventType: 'status',
        sessionId: 'thread-1',
        title: 'thread.turn.started',
        message: 'Codex Desktop thread-1',
        source: 'codex-app-server',
        method: 'thread.turn.started'
      },
      'codex'
    );

    expect(shouldClearCompletedIslandNotification(completed, turnStart)).toBe(true);
  });

  it('does not clear completed notifications for idle prompts or another completion', () => {
    const completed = normalizeEvent(
      {
        agent: 'codex',
        eventType: 'session-stop',
        sessionId: 's1',
        title: '上一轮已完成'
      },
      'codex'
    );
    const idlePrompt = normalizeEvent(
      {
        hook_event_name: 'Notification',
        session_id: 's1',
        message: 'Claude is waiting for your input',
        notification_type: 'idle_prompt'
      },
      'claude'
    );
    const nextCompletion = normalizeEvent(
      {
        agent: 'codex',
        eventType: 'session-stop',
        sessionId: 's1',
        title: '另一轮已完成'
      },
      'codex'
    );

    expect(shouldClearCompletedIslandNotification(completed, idlePrompt)).toBe(false);
    expect(shouldClearCompletedIslandNotification(completed, nextCompletion)).toBe(false);
  });
});
