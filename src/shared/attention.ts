import type { NormalizedEvent, NotificationStrategy } from './types';

export type IslandAttentionReason = 'none' | 'reply' | 'question' | 'completed' | 'error' | 'realtime';

export function getIslandAttentionReason(event: NormalizedEvent): IslandAttentionReason {
  if (isCodexReplyMirror(event)) return 'reply';
  if (event.severity === 'error' || event.eventType === 'error') return 'error';
  if (isQuestionEvent(event)) return 'question';
  if (event.eventType === 'session-stop' && !isInterruptEvent(event)) return 'completed';
  return 'none';
}

export function shouldPromoteToIslandNotification(event: NormalizedEvent): boolean {
  return getIslandAttentionReason(event) !== 'none';
}

export function shouldPromoteWithStrategy(event: NormalizedEvent, strategy: NotificationStrategy): boolean {
  if (strategy === 'silent') return false;
  if (strategy === 'realtime') return true;
  return shouldPromoteToIslandNotification(event);
}

export function getIslandNotificationPriority(event: NormalizedEvent): number {
  const reason = getIslandAttentionReason(event);
  if (reason === 'question') return 95;
  if (reason === 'reply') return 90;
  if (reason === 'completed') return 80;
  if (reason === 'error') return 70;
  return 10;
}

export function shouldReplaceIslandNotification(
  current: NormalizedEvent | null,
  next: NormalizedEvent
): boolean {
  if (!current) return true;
  return getIslandNotificationPriority(next) >= getIslandNotificationPriority(current);
}

export function shouldAutoClearIslandNotification(event: NormalizedEvent): boolean {
  const reason = getIslandAttentionReason(event);
  return reason === 'completed' || reason === 'reply' || reason === 'error' || isRealtimeOnlyEvent(event);
}

export function shouldShowSystemNotification(event: NormalizedEvent): boolean {
  return event.eventType === 'permission' || event.severity === 'error';
}

function isQuestionEvent(event: NormalizedEvent): boolean {
  if (event.eventType === 'notification') return true;
  const name = metadataString(event, 'eventType', 'event_type', 'hook_event_name', 'type', 'name');
  const text = `${name ?? ''} ${event.title} ${event.message ?? ''}`.toLowerCase();
  return /question|ask|needs[\s_-]*input|input[\s_-]*request/.test(text) || /问题|提问|需要.*输入/.test(text);
}

function isCodexReplyMirror(event: NormalizedEvent): boolean {
  return event.eventType === 'assistant' && metadataString(event, 'source') === 'codex-reply-watcher';
}

function isRealtimeOnlyEvent(event: NormalizedEvent): boolean {
  return getIslandAttentionReason(event) === 'none';
}

function isInterruptEvent(event: NormalizedEvent): boolean {
  if (metadataBoolean(event, 'isInterrupt', 'is_interrupt', 'interrupt')) return true;
  const name = metadataString(event, 'eventType', 'event_type', 'hook_event_name', 'type', 'name');
  return /interrupt/.test((name ?? '').toLowerCase());
}

function metadataString(event: NormalizedEvent, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = event.metadata?.[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return undefined;
}

function metadataBoolean(event: NormalizedEvent, ...keys: string[]): boolean {
  for (const key of keys) {
    const value = event.metadata?.[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string' && /^(true|yes|1)$/i.test(value)) return true;
  }
  return false;
}
