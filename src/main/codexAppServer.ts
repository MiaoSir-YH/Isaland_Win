import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { NormalizedEvent } from '@shared/types';

export interface CodexAppServerCoordinator {
  close: () => void;
}

export function startCodexAppServer(options: {
  enabled: boolean;
  onEvent: (event: NormalizedEvent) => void;
  onError: (message: string) => void;
}): CodexAppServerCoordinator | null {
  if (!options.enabled) return null;
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn('codex', ['app-server'], { windowsHide: true });
  } catch (error) {
    options.onError(error instanceof Error ? error.message : String(error));
    return null;
  }

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
      const event = eventFromJsonRpcLine(line);
      if (event) options.onEvent(event);
    }
  });
  child.on('error', (error) => options.onError(error.message));
  child.unref();

  return {
    close: () => child.kill()
  };
}

function eventFromJsonRpcLine(line: string): NormalizedEvent | null {
  try {
    const payload = JSON.parse(line) as Record<string, unknown>;
    const method = typeof payload.method === 'string' ? payload.method : 'codex.app';
    const params = payload.params && typeof payload.params === 'object' ? (payload.params as Record<string, unknown>) : {};
    const threadId = stringValue(params.threadId, params.thread_id, params.id);
    return {
      schemaVersion: 1,
      id: `codex_app_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      agent: 'codex',
      eventType: method.includes('completed') || method.includes('closed') ? 'session-stop' : 'status',
      sessionId: threadId,
      title: method,
      message: threadId ? `Codex Desktop ${threadId}` : 'Codex Desktop event',
      severity: method.includes('error') ? 'error' : 'info',
      metadata: {
        ...payload,
        source: 'codex-app-server',
        threadId,
        discoverySource: 'codex-app-server'
      }
    };
  } catch {
    return null;
  }
}

function stringValue(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}
