import type { PermissionResponse } from './types';

export function createPermissionTimeoutResponse(id: string, now = new Date()): PermissionResponse {
  return {
    id,
    decision: 'timeout',
    decidedAt: now.toISOString()
  };
}

