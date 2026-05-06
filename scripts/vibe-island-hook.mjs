#!/usr/bin/env node
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = parseArgs(process.argv.slice(2));
const appData = process.env.APPDATA ?? join(process.env.USERPROFILE ?? process.cwd(), 'AppData', 'Roaming');
const dataDir = join(appData, 'Vibe Island');
const runtimePath = join(dataDir, 'runtime.json');
const spoolPath = join(dataDir, 'spool.jsonl');
const STDIN_IDLE_TIMEOUT_MS = 250;

const stdin = await readStdin();
const payload = parsePayload(stdin);
payload.agent = payload.agent ?? args.agent ?? 'unknown';
payload.eventType = payload.eventType ?? args.event ?? payload.hook_event_name ?? payload.type ?? 'status';
payload.receivedAt = new Date().toISOString();
payload.terminal = payload.terminal ?? collectTerminalContext();

const agent = String(payload.agent).toLowerCase();
const eventType = String(payload.eventType);
const actionableBypass = agent === 'claude' && !isClaudeActionable(payload);
const permissionLike = !actionableBypass && /permission|approval/i.test(eventType);
const questionLike =
  !actionableBypass &&
  (/question|ask|needs[\s_-]*input|input[\s_-]*request/i.test(eventType) ||
    Boolean(payload.question || payload.choices || payload.options) ||
    isClaudeQuestionTool(payload));

try {
  const runtime = JSON.parse(await readFile(runtimePath, 'utf8'));
  const endpoint = questionLike ? '/v1/question/request' : permissionLike ? '/v1/permission/request' : '/v1/events';
  const response = await fetch(`http://${runtime.host}:${runtime.port}${endpoint}?agent=${encodeURIComponent(payload.agent)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${runtime.token}`
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(permissionLike || questionLike ? 130000 : 2500)
  });

  if (!response.ok) throw new Error(`Vibe Island IPC returned ${response.status}`);
  const body = await response.json();
  if (permissionLike || questionLike) emitPermissionDecision(body.permission, payload);
  process.exit(0);
} catch (error) {
  await spool(payload, error);
  if (permissionLike || questionLike) {
    process.stdout.write('{}\n');
  }
  process.exit(0);
}

function emitPermissionDecision(permission, payload) {
  if (agent === 'claude') {
    emitClaudeDecision(permission, payload);
    return;
  }

  const decision = permission?.decision;
  if (decision === 'allow') {
    process.stdout.write(`${JSON.stringify({ decision: 'approve' })}\n`);
    return;
  }
  if (decision === 'answer') {
    process.stdout.write(`${JSON.stringify({ decision: 'approve', updatedInput: permission?.answer ?? '' })}\n`);
    return;
  }
  if (decision === 'deny' || decision === 'denyForSession') {
    process.stdout.write(`${JSON.stringify({ decision: 'block', reason: permission?.reason ?? 'Denied by Vibe Island' })}\n`);
    return;
  }
  process.stdout.write('{}\n');
}

function emitClaudeDecision(permission, payload) {
  const decision = permission?.decision;
  const hookEventName = String(payload?.hook_event_name ?? payload?.eventType ?? payload?.type ?? '');
  const questionTool = isClaudeQuestionTool(payload);

  if (/permissionrequest/i.test(hookEventName) && questionTool) {
    if (decision === 'answer') {
      process.stdout.write(
        `${JSON.stringify(
          buildClaudePermissionRequestOutput('allow', payload, {
            ...permission,
            updatedInput: buildClaudeQuestionAnswerInput(payload, permission?.answer ?? '')
          })
        )}\n`
      );
      return;
    }

    if (decision === 'allow') {
      process.stdout.write(
        `${JSON.stringify(
          buildClaudePermissionRequestOutput('allow', payload, {
            ...permission,
            updatedInput: isRecord(payload?.tool_input) ? payload.tool_input : undefined
          })
        )}\n`
      );
      return;
    }

    if (decision === 'deny' || decision === 'denyForSession' || decision === 'timeout') {
      process.stdout.write(`${JSON.stringify(buildClaudePermissionRequestOutput('deny', payload, permission))}\n`);
      return;
    }

    process.stdout.write('{}\n');
    return;
  }

  if (/permissionrequest/i.test(hookEventName)) {
    if (decision === 'allow' || decision === 'answer') {
      process.stdout.write(`${JSON.stringify(buildClaudePermissionRequestOutput('allow', payload, permission))}\n`);
      return;
    }

    if (decision === 'deny' || decision === 'denyForSession' || decision === 'timeout') {
      process.stdout.write(`${JSON.stringify(buildClaudePermissionRequestOutput('deny', payload, permission))}\n`);
      return;
    }

    process.stdout.write('{}\n');
    return;
  }

  if (questionTool) {
    if (decision === 'answer') {
      process.stdout.write(
        `${JSON.stringify(
          {
            continue: true,
            suppressOutput: true,
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'allow',
              permissionDecisionReason: 'Answered by Vibe Island',
              updatedInput: buildClaudeQuestionAnswerInput(payload, permission?.answer ?? '')
            }
          }
        )}\n`
      );
      return;
    }

    if (decision === 'deny' || decision === 'denyForSession' || decision === 'timeout') {
      process.stdout.write(`${JSON.stringify(buildClaudePermissionRequestOutput('deny', payload, permission))}\n`);
      return;
    }

    process.stdout.write('{}\n');
    return;
  }

  if (decision === 'allow') {
    process.stdout.write(
      `${JSON.stringify({
        continue: true,
        suppressOutput: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: 'Approved by Vibe Island',
          ...(isRecord(payload?.tool_input) ? { updatedInput: payload.tool_input } : {})
        }
      })}\n`
    );
    return;
  }

  if (decision === 'deny' || decision === 'denyForSession' || decision === 'timeout') {
    process.stdout.write(
      `${JSON.stringify({
        continue: true,
        suppressOutput: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: permission?.reason ?? 'Denied by Vibe Island'
        }
      })}\n`
    );
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

function collectTerminalContext() {
  return prune({
    hookPid: process.pid,
    parentPid: process.ppid,
    cwd: process.cwd(),
    processTitle: process.title,
    wtSession: process.env.WT_SESSION,
    wtProfileId: process.env.WT_PROFILE_ID,
    termProgram: process.env.TERM_PROGRAM,
    sessionName: process.env.SESSIONNAME,
    comspec: process.env.ComSpec ?? process.env.COMSPEC
  });
}

function prune(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ''));
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

function isClaudeQuestionTool(payload) {
  const toolName =
    typeof payload.tool_name === 'string'
      ? payload.tool_name
      : typeof payload.toolName === 'string'
        ? payload.toolName
        : typeof payload.tool === 'string'
          ? payload.tool
          : undefined;
  if (!toolName || toolName.toLowerCase() !== 'askuserquestion') return false;
  return Array.isArray(payload.tool_input?.questions) && payload.tool_input.questions.length > 0;
}

function isClaudeActionable(payload) {
  if (payload.vibeIslandActionable === true) return true;
  return /permissionrequest/i.test(String(payload.hook_event_name ?? payload.eventType ?? payload.type ?? ''));
}

function buildClaudeQuestionAnswerInput(payload, answer) {
  const toolInput = isRecord(payload?.tool_input) ? payload.tool_input : {};
  const questions = Array.isArray(toolInput.questions) ? toolInput.questions : [];
  const firstQuestion = questions.length > 0 && isRecord(questions[0]) ? questions[0] : {};
  const fallbackQuestion =
    typeof firstQuestion.question === 'string'
      ? firstQuestion.question
      : typeof firstQuestion.prompt === 'string'
        ? firstQuestion.prompt
        : typeof firstQuestion.header === 'string'
          ? firstQuestion.header
          : 'Question';

  return {
    ...toolInput,
    answers: {
      ...(isRecord(toolInput.answers) ? toolInput.answers : {}),
      [fallbackQuestion]: answer
    }
  };
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function buildClaudePermissionRequestOutput(behavior, payload, permission) {
  if (behavior === 'allow') {
    return {
      continue: true,
      suppressOutput: true,
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: 'allow',
          ...(permission?.updatedInput ?? (isRecord(payload?.tool_input) ? payload.tool_input : undefined)
            ? {
                updatedInput:
                  permission?.updatedInput ?? (isRecord(payload?.tool_input) ? payload.tool_input : undefined)
              }
            : {})
        }
      }
    };
  }

  return {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: {
        behavior: 'deny',
        message: permission?.reason ?? 'Denied by Vibe Island'
      }
    }
  };
}
