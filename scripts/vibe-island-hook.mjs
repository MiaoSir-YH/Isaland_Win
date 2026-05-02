#!/usr/bin/env node
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = parseArgs(process.argv.slice(2));
const appData = process.env.APPDATA ?? join(process.env.USERPROFILE ?? process.cwd(), 'AppData', 'Roaming');
const dataDir = join(appData, 'Vibe Island');
const runtimePath = join(dataDir, 'runtime.json');
const spoolPath = join(dataDir, 'spool.jsonl');

const stdin = await readStdin();
const payload = parsePayload(stdin);
payload.agent = payload.agent ?? args.agent ?? 'unknown';
payload.eventType = payload.eventType ?? args.event ?? payload.hook_event_name ?? payload.type ?? 'status';
payload.receivedAt = new Date().toISOString();

const permissionLike = /permission|approval|pretooluse|pre-tool-use|before_tool/i.test(String(payload.eventType));

try {
  const runtime = JSON.parse(await readFile(runtimePath, 'utf8'));
  const endpoint = permissionLike ? '/v1/permission/request' : '/v1/events';
  const response = await fetch(`http://${runtime.host}:${runtime.port}${endpoint}?agent=${encodeURIComponent(payload.agent)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${runtime.token}`
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(permissionLike ? 130000 : 2500)
  });

  if (!response.ok) throw new Error(`Vibe Island IPC returned ${response.status}`);
  const body = await response.json();
  if (permissionLike) emitPermissionDecision(body.permission?.decision);
  process.exit(0);
} catch (error) {
  await spool(payload, error);
  if (permissionLike) {
    process.stdout.write('{}\n');
  }
  process.exit(0);
}

function emitPermissionDecision(decision) {
  if (decision === 'allow') {
    process.stdout.write(`${JSON.stringify({ decision: 'approve' })}\n`);
    return;
  }
  if (decision === 'deny' || decision === 'denyForSession') {
    process.stdout.write(`${JSON.stringify({ decision: 'block', reason: 'Denied by Vibe Island' })}\n`);
    return;
  }
  process.stdout.write('{}\n');
}

async function spool(payload, error) {
  await mkdir(dirname(spoolPath), { recursive: true });
  await appendFile(
    spoolPath,
    `${JSON.stringify({
      payload,
      error: error instanceof Error ? error.message : String(error),
      spooledAt: new Date().toISOString()
    })}\n`,
    'utf8'
  );
}

function parsePayload(text) {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {
      message: text.trim()
    };
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
    if (process.stdin.isTTY) resolve('');
  });
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

