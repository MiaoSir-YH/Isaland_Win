import { describe, expect, it } from 'vitest';
import { createPermissionTimeoutResponse } from '../src/shared/permission';

describe('permission timeout', () => {
  it('never auto-approves', () => {
    const response = createPermissionTimeoutResponse('request-1', new Date('2026-05-02T00:00:00.000Z'));

    expect(response).toEqual({
      id: 'request-1',
      decision: 'timeout',
      decidedAt: '2026-05-02T00:00:00.000Z'
    });
  });
});

