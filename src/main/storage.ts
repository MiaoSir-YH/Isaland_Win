import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AppConfig, AgentSession, NormalizedEvent, RuntimeInfo } from '@shared/types';
import { DEFAULT_CONFIG } from '@shared/types';

export interface StoragePaths {
  dir: string;
  config: string;
  sessions: string;
  events: string;
  runtime: string;
}

export function makeStoragePaths(appDataDir: string): StoragePaths {
  const dir = join(appDataDir, 'Vibe Island');
  return {
    dir,
    config: join(dir, 'config.json'),
    sessions: join(dir, 'sessions.json'),
    events: join(dir, 'events.jsonl'),
    runtime: join(dir, 'runtime.json')
  };
}

export async function ensureStorage(paths: StoragePaths): Promise<void> {
  await mkdir(paths.dir, { recursive: true });
}

export async function loadConfig(paths: StoragePaths): Promise<AppConfig> {
  const stored = await readJson<Partial<AppConfig>>(paths.config, {});
  return normalizeConfig(stored);
}

export async function saveConfig(paths: StoragePaths, config: AppConfig): Promise<void> {
  await writeJson(paths.config, config);
}

export async function loadSessions(paths: StoragePaths): Promise<AgentSession[]> {
  const sessions = await readJson<AgentSession[]>(paths.sessions, []);
  return sessions.filter((session) => !isNoisyStoredSession(session));
}

export async function saveSessions(paths: StoragePaths, sessions: AgentSession[]): Promise<void> {
  await writeJson(paths.sessions, sessions);
}

export async function appendEvent(paths: StoragePaths, event: NormalizedEvent): Promise<void> {
  await mkdir(dirname(paths.events), { recursive: true });
  await appendFile(paths.events, `${JSON.stringify(event)}\n`, 'utf8');
}

export async function loadRecentEvents(paths: StoragePaths, limit = 80): Promise<NormalizedEvent[]> {
  try {
    const text = await readFile(paths.events, 'utf8');
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line) as NormalizedEvent)
      .filter((event) => !isNoisyStoredEvent(event));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function writeRuntime(paths: StoragePaths, runtime: RuntimeInfo): Promise<void> {
  await writeJson(paths.runtime, runtime);
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function isNoisyStoredSession(session: AgentSession): boolean {
  if (session.metadata?.discoverySource === 'jump') return true;
  if (session.metadata?.discoverySource === 'transcript' && session.liveness === 'stale') return true;
  return session.status === 'status' && session.lastMessage === 'Discovered local session' && !session.metadata?.terminal;
}

function isNoisyStoredEvent(event: NormalizedEvent): boolean {
  if (event.metadata?.source === 'jump') return true;
  const name = String(event.metadata?.hook_event_name ?? event.metadata?.eventType ?? event.metadata?.type ?? '');
  return /^StatusLine$/i.test(name);
}

function normalizeConfig(stored: Partial<AppConfig> & Record<string, unknown>): AppConfig {
  const sound =
    typeof stored.sound === 'boolean'
      ? { ...DEFAULT_CONFIG.sound, enabled: stored.sound }
      : {
          ...DEFAULT_CONFIG.sound,
          ...(typeof stored.sound === 'object' && stored.sound !== null ? stored.sound : {})
        };

  return {
    ...DEFAULT_CONFIG,
    ...stored,
    jumpTarget: 'none',
    sound,
    experiments: {
      ...DEFAULT_CONFIG.experiments,
      ...(typeof stored.experiments === 'object' && stored.experiments !== null ? stored.experiments : {})
    },
    update: {
      ...DEFAULT_CONFIG.update,
      ...(typeof stored.update === 'object' && stored.update !== null ? stored.update : {})
    },
    remote: {
      ...DEFAULT_CONFIG.remote,
      ...(typeof stored.remote === 'object' && stored.remote !== null ? stored.remote : {})
    }
  };
}

