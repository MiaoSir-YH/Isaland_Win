import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentUsage } from '@shared/types';

export async function collectUsage(home: string): Promise<AgentUsage[]> {
  const updatedAt = new Date().toISOString();
  return Promise.all([
    readUsageFile('codex', join(home, '.codex', 'usage.json'), updatedAt),
    readUsageFile('claude', join(home, '.claude', 'usage.json'), updatedAt)
  ]);
}

async function readUsageFile(agent: AgentUsage['agent'], filePath: string, updatedAt: string): Promise<AgentUsage> {
  if (!existsSync(filePath)) {
    return {
      agent,
      source: filePath,
      available: false,
      message: 'Usage cache not found.',
      updatedAt
    };
  }

  try {
    const raw = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
    return {
      agent,
      source: filePath,
      available: true,
      fiveHour: readWindow(raw.fiveHour, raw.five_hour, raw['5h']),
      sevenDay: readWindow(raw.sevenDay, raw.seven_day, raw['7d']),
      updatedAt
    };
  } catch (error) {
    return {
      agent,
      source: filePath,
      available: false,
      message: error instanceof Error ? error.message : String(error),
      updatedAt
    };
  }
}

function readWindow(...values: unknown[]): AgentUsage['fiveHour'] {
  const value = values.find((item) => item && typeof item === 'object' && !Array.isArray(item)) as
    | Record<string, unknown>
    | undefined;
  if (!value) return undefined;
  return {
    used: numberValue(value.used, value.current),
    limit: numberValue(value.limit, value.max),
    resetAt: stringValue(value.resetAt, value.reset_at)
  };
}

function numberValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

function stringValue(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}
