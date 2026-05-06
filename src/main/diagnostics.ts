import { existsSync } from 'node:fs';
import type { DiagnosticsInfo, RuntimeInfo } from '@shared/types';

export function makeDiagnostics(input: {
  runtime: RuntimeInfo | null;
  runtimePath?: string;
  hookHelperPath?: string;
  remoteUrl?: string;
  lastError?: string;
}): DiagnosticsInfo {
  return {
    runtimePath: input.runtimePath,
    hookHelperPath: input.hookHelperPath,
    remoteUrl: input.remoteUrl,
    ipcHealthy: Boolean(input.runtime),
    lastError: input.lastError,
    checkedAt: new Date().toISOString()
  };
}

export function pathStatus(path?: string): string {
  if (!path) return 'not configured';
  return existsSync(path) ? 'present' : 'missing';
}
