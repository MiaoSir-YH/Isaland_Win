import { describe, expect, it } from 'vitest';
import { EventDeduper, eventFingerprint } from '../src/shared/dedupe';
import { normalizeEvent } from '../src/shared/normalize';

describe('event dedupe', () => {
  it('drops identical events inside the dedupe window', () => {
    const event = normalizeEvent(
      {
        agent: 'codex',
        eventType: 'PostToolUse',
        session_id: 's1',
        title: 'Codex 完成 Shell',
        message: 'npm test'
      },
      'codex'
    );
    const deduper = new EventDeduper(2500);

    expect(deduper.shouldDrop(event, 1000)).toBe(false);
    expect(deduper.shouldDrop({ ...event, id: 'other' }, 2000)).toBe(true);
    expect(deduper.shouldDrop({ ...event, id: 'later' }, 4600)).toBe(false);
  });

  it('keeps events with different messages separate', () => {
    const first = normalizeEvent({ agent: 'codex', eventType: 'PostToolUse', title: '短标题' }, 'codex');
    const second = normalizeEvent({ agent: 'codex', eventType: 'PostToolUse', title: '长标题' }, 'codex');

    expect(eventFingerprint(first)).not.toBe(eventFingerprint(second));
  });
});
