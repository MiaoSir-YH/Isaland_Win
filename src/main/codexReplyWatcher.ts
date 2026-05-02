import { createHash } from 'node:crypto';
import { readdir, stat, open } from 'node:fs/promises';
import { join } from 'node:path';

export interface CodexReply {
  id: string;
  timestamp: string;
  text: string;
  phase?: string;
  sessionFile: string;
}

export interface CodexReplyWatcher {
  close: () => void;
}

interface CodexReplyWatcherOptions {
  codexHome?: string;
  pollMs?: number;
  onReply: (reply: CodexReply) => void | Promise<void>;
}

export function startCodexReplyWatcher(options: CodexReplyWatcherOptions): CodexReplyWatcher {
  const codexHome = options.codexHome;
  if (!codexHome) return { close: () => undefined };

  const sessionsDir = join(codexHome, 'sessions');
  const seen = new Set<string>();
  let activeFile: string | null = null;
  let offset = 0;
  let partial = '';
  let closed = false;
  let busy = false;

  const tick = async (): Promise<void> => {
    if (closed || busy) return;
    busy = true;
    try {
      const latest = await findLatestJsonl(sessionsDir);
      if (!latest) return;
      if (latest !== activeFile) {
        activeFile = latest;
        offset = (await stat(latest)).size;
        partial = '';
        return;
      }

      const info = await stat(latest);
      if (info.size < offset) {
        offset = 0;
        partial = '';
      }
      if (info.size === offset) return;

      const chunk = await readRange(latest, offset, info.size - offset);
      offset = info.size;
      const lines = `${partial}${chunk}`.split(/\r?\n/);
      partial = lines.pop() ?? '';

      for (const line of lines) {
        const reply = parseAssistantReply(line, latest);
        if (!reply || seen.has(reply.id)) continue;
        seen.add(reply.id);
        if (seen.size > 200) seen.delete(seen.values().next().value as string);
        await options.onReply(reply);
      }
    } catch {
      // Codex may rotate or lock files briefly; polling will recover on the next tick.
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(() => void tick(), options.pollMs ?? 800);
  void tick();

  return {
    close: () => {
      closed = true;
      clearInterval(timer);
    }
  };
}

async function findLatestJsonl(root: string): Promise<string | null> {
  const files: Array<{ path: string; mtimeMs: number }> = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
          return;
        }
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) return;
        const info = await stat(fullPath);
        files.push({ path: fullPath, mtimeMs: info.mtimeMs });
      })
    );
  }

  await walk(root);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.path ?? null;
}

async function readRange(filePath: string, start: number, length: number): Promise<string> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

function parseAssistantReply(line: string, sessionFile: string): CodexReply | null {
  if (!line.trim()) return null;
  let record: unknown;
  try {
    record = JSON.parse(line) as unknown;
  } catch {
    return null;
  }

  const outer = asRecord(record);
  if (outer.type !== 'response_item') return null;
  const payload = asRecord(outer.payload);
  if (payload.type !== 'message' || payload.role !== 'assistant') return null;

  const text = extractText(payload.content).trim();
  if (!text) return null;
  const timestamp = typeof outer.timestamp === 'string' ? outer.timestamp : new Date().toISOString();
  const phase = typeof payload.phase === 'string' ? payload.phase : undefined;
  const id = createHash('sha1').update(`${sessionFile}\n${timestamp}\n${phase ?? ''}\n${text}`).digest('hex');
  return { id, timestamp, text, phase, sessionFile };
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      const record = asRecord(item);
      return typeof record.text === 'string' ? record.text : '';
    })
    .filter(Boolean)
    .join('\n');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
