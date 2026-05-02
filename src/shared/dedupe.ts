import type { NormalizedEvent } from './types';

export class EventDeduper {
  private readonly seen = new Map<string, number>();

  constructor(private readonly windowMs = 2500) {}

  shouldDrop(event: NormalizedEvent, nowMs = Date.now()): boolean {
    this.prune(nowMs);
    const key = eventFingerprint(event);
    const lastSeen = this.seen.get(key);
    this.seen.set(key, nowMs);
    return lastSeen !== undefined && nowMs - lastSeen <= this.windowMs;
  }

  private prune(nowMs: number): void {
    for (const [key, lastSeen] of this.seen) {
      if (nowMs - lastSeen > this.windowMs) this.seen.delete(key);
    }
  }
}

export function eventFingerprint(event: NormalizedEvent): string {
  return [
    event.agent,
    event.eventType,
    event.sessionId ?? '',
    event.workspace ?? '',
    event.toolName ?? '',
    normalizeText(event.command),
    normalizeText(event.title),
    normalizeText(event.message)
  ].join('\u001f');
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}
