import type { PermissionResponse } from './types';

export const PERMISSION_NOTICE_MAX_TIMEOUT_MS = 120000;

export function createPermissionTimeoutResponse(id: string, now = new Date()): PermissionResponse {
  return {
    id,
    decision: 'timeout',
    decidedAt: now.toISOString()
  };
}

export function getPermissionNoticeTimeoutMs(timeoutMs: number): number {
  return Math.max(0, Math.min(timeoutMs, PERMISSION_NOTICE_MAX_TIMEOUT_MS));
}
