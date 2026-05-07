import { describe, expect, it } from 'vitest';
import { isFinalCodexReplyPhase } from '../src/main/codexReplyWatcher';

describe('isFinalCodexReplyPhase', () => {
  it('recognizes Codex Desktop final reply phases', () => {
    expect(isFinalCodexReplyPhase('final')).toBe(true);
    expect(isFinalCodexReplyPhase('final_answer')).toBe(true);
  });

  it('ignores non-final phases', () => {
    expect(isFinalCodexReplyPhase(undefined)).toBe(false);
    expect(isFinalCodexReplyPhase('commentary')).toBe(false);
    expect(isFinalCodexReplyPhase('assistant')).toBe(false);
  });
});
