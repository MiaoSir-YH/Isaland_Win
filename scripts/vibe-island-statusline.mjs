#!/usr/bin/env node
import { basename } from 'node:path';

const STDIN_IDLE_TIMEOUT_MS = 200;

const input = await readStdin();
const payload = parsePayload(input);
payload.agent = 'claude';
payload.eventType = 'StatusLine';
payload.receivedAt = new Date().toISOString();

process.stdout.write(formatStatusLine(payload));

function formatStatusLine(payload) {
  const cwd = stringValue(payload.cwd, payload.workspace, payload.project_dir);
  const model = stringValue(payload.model?.display_name, payload.model?.id, payload.model);
  const workspace = cwd ? basename(cwd.replace(/\\$/, '')) : 'Claude';
  return model ? `Vibe Island | ${workspace} | ${model}` : `Vibe Island | ${workspace}`;
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
    let settled = false;
    let idleTimer;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      if (idleTimer) clearTimeout(idleTimer);
      process.stdin.off('data', onData);
      process.stdin.off('end', onEnd);
      process.stdin.off('error', onError);
      resolve(value);
    };
    const armIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => settle(data), STDIN_IDLE_TIMEOUT_MS);
      idleTimer.unref?.();
    };
    const onData = (chunk) => {
      data += chunk;
      armIdleTimer();
    };
    const onEnd = () => settle(data);
    const onError = (error) => {
      if (settled) return;
      settled = true;
      if (idleTimer) clearTimeout(idleTimer);
      reject(error);
    };

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onError);
    if (process.stdin.isTTY) {
      settle('');
    } else {
      armIdleTimer();
    }
  });
}

function stringValue(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return undefined;
}
