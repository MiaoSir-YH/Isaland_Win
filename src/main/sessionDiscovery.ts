import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentId, AgentSession } from '@shared/types';

const DISCOVERY_LIMIT = 24;

export async function discoverSessions(home: string): Promise<AgentSession[]> {
  const roots: Array<{ agent: AgentId; dir: string }> = [
    { agent: 'codex', dir: join(home, '.codex', 'sessions') },
    { agent: 'claude', dir: join(home, '.claude', 'projects') },
    { agent: 'cursor', dir: join(home, '.cursor', 'sessions') },
    { agent: 'kimi', dir: join(home, '.kimi', 'sessions') }
  ];
  const groups = await Promise.all(roots.map((root) => discoverRoot(root.agent, root.dir)));
  return groups.flat().sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt)).slice(0, DISCOVERY_LIMIT);
}

async function discoverRoot(agent: AgentId, dir: string): Promise<AgentSession[]> {
  if (!existsSync(dir)) return [];
  const files = await listFiles(dir);
  const sessions = await Promise.all(
    files
      .filter((file) => /\.(jsonl|json)$/i.test(file))
      .slice(-DISCOVERY_LIMIT)
      .map((file) => sessionFromFile(agent, file))
  );
  return sessions.filter((session): session is AgentSession => Boolean(session));
}

async function sessionFromFile(agent: AgentId, filePath: string): Promise<AgentSession | null> {
  try {
    const info = await stat(filePath);
    const text = await readFile(filePath, 'utf8');
    const lastLine = text.split(/\r?\n/).filter(Boolean).at(-1);
    const parsed = lastLine ? safeJson(lastLine) : {};
    const workspace = stringValue(parsed.cwd, parsed.workspace, parsed.projectDir, parsed.project);
    return {
      id: `${agent}:${filePath}`,
      agent,
      workspace,
      title: workspace ? workspaceName(workspace) : filePath.split(/[\\/]/).at(-1) ?? agent,
      status: 'status',
      lastMessage: stringValue(parsed.message, parsed.text, parsed.summary) ?? 'Discovered local session',
      lastSeenAt: info.mtime.toISOString(),
      eventCount: 1,
      liveness: Date.now() - info.mtimeMs > 30 * 60 * 1000 ? 'stale' : 'discovered',
      metadata: {
        transcriptPath: filePath,
        discoverySource: 'transcript'
      }
    };
  } catch {
    return null;
  }
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) return listFiles(fullPath);
      return [fullPath];
    })
  );
  return nested.flat();
}

function safeJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function stringValue(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function workspaceName(workspace: string): string {
  return workspace.split(/[\\/]/).filter(Boolean).at(-1) ?? workspace;
}
