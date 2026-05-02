import { describe, expect, it } from 'vitest';
import { createPermissionTimeoutResponse, getPermissionNoticeTimeoutMs } from '../src/shared/permission';

describe('permission timeout', () => {
  it('never auto-approves', () => {
    const response = createPermissionTimeoutResponse('request-1', new Date('2026-05-02T00:00:00.000Z'));

    expect(response).toEqual({
      id: 'request-1',
      decision: 'timeout',
      decidedAt: '2026-05-02T00:00:00.000Z'
    });
  });

  it('caps permission notice timeout at 8 seconds', () => {
    expect(getPermissionNoticeTimeoutMs(120000)).toBe(8000);
  });

  it('respects request timeout when shorter than 8 seconds', () => {
    expect(getPermissionNoticeTimeoutMs(3000)).toBe(3000);
  });

  it('does not produce negative notice timeouts', () => {
    expect(getPermissionNoticeTimeoutMs(-1)).toBe(0);
  });
});
