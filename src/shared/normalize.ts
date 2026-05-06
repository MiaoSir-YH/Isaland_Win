import type { AgentId, EventType, NormalizedEvent, PermissionRequest, Severity } from './types';

const KNOWN_AGENTS = new Set<AgentId>([
  'codex',
  'claude',
  'claude-desktop',
  'claude-cli',
  'gemini',
  'opencode',
  'cursor',
  'kimi',
  'qoder',
  'qwen',
  'factory',
  'codebuddy',
  'unknown'
]);

export function normalizeAgent(value: unknown, fallback: AgentId = 'unknown'): AgentId {
  if (typeof value !== 'string') return fallback;
  const normalized = value.toLowerCase();
  return KNOWN_AGENTS.has(normalized as AgentId) ? (normalized as AgentId) : fallback;
}

export function normalizeEvent(raw: unknown, fallbackAgent: AgentId = 'unknown'): NormalizedEvent {
  const payload = asRecord(raw);
  const eventName = stringValue(
    payload.eventType,
    payload.event_type,
    payload.hook_event_name,
    payload.type,
    payload.name
  );
  const agent = normalizeAgent(payload.agent, fallbackAgent);
  const eventType = mapEventType(eventName, payload);
  const timestamp = stringValue(payload.timestamp, payload.time) ?? new Date().toISOString();
  const sessionId = stringValue(payload.sessionId, payload.session_id, payload.conversationId, payload.threadId);
  const workspace = stringValue(payload.workspace, payload.cwd, payload.project, payload.projectDir);
  const toolName = stringValue(payload.toolName, payload.tool_name, payload.tool);
  const command = extractCommand(payload);
  const severity = mapSeverity(payload.severity, eventType);
  const message = stringValue(payload.message, payload.text, payload.summary, payload.prompt, payload.question) ?? command;
  const title = stringValue(payload.title) ?? defaultTitle(agent, eventType, payload, toolName, message);

  return {
    schemaVersion: 1,
    id: stringValue(payload.id, payload.eventId) ?? makeId('evt'),
    timestamp,
    agent,
    eventType,
    sessionId,
    workspace,
    title,
    message,
    severity,
    toolName,
    command,
    metadata: payload
  };
}

export function normalizePermissionRequest(raw: unknown, fallbackAgent: AgentId = 'unknown'): PermissionRequest {
  const payload = asRecord(raw);
  const agent = normalizeAgent(payload.agent, fallbackAgent);
  const toolName = stringValue(payload.toolName, payload.tool_name, payload.tool);
  const command = extractCommand(payload);
  const kind = isQuestionPayload(payload) ? 'question' : 'permission';
  const toolQuestion = extractToolQuestion(payload);
  const action =
    stringValue(payload.action, payload.reason, payload.description, payload.title) ??
    (kind === 'question'
      ? toolQuestion?.question
        ? '需要回答'
        : '需要回答'
      : toolName
        ? `请求执行 ${toolName}`
        : '请求权限确认');
  const prompt = stringValue(payload.prompt, payload.question, payload.message, payload.text, toolQuestion?.question);

  return {
    schemaVersion: 1,
    id: stringValue(payload.id, payload.requestId, payload.request_id) ?? makeId('perm'),
    kind,
    timestamp: stringValue(payload.timestamp, payload.time) ?? new Date().toISOString(),
    agent,
    sessionId: stringValue(payload.sessionId, payload.session_id, payload.conversationId, payload.threadId),
    workspace: stringValue(payload.workspace, payload.cwd, payload.project, payload.projectDir),
    toolName,
    action,
    prompt,
    choices: stringArrayValue(payload.choices, payload.options, payload.suggestions, toolQuestion?.choices),
    command,
    risk: mapRisk(payload.risk, command),
    timeoutMs: numberValue(payload.timeoutMs, payload.timeout_ms) ?? 120000,
    sourceRequestId: stringValue(payload.sourceRequestId, payload.source_request_id, payload.requestId, payload.request_id),
    metadata: payload
  };
}

export function isPermissionLike(raw: unknown): boolean {
  const payload = asRecord(raw);
  const name = stringValue(payload.eventType, payload.event_type, payload.hook_event_name, payload.type, payload.name);
  if (!name) return false;
  return isPermissionEventName(name);
}

export function isQuestionLike(raw: unknown): boolean {
  return isQuestionPayload(asRecord(raw));
}

function mapEventType(eventName: string | undefined, payload: Record<string, unknown>): EventType {
  const name = eventName?.toLowerCase() ?? '';
  if (/session.*start|start.*session|init/.test(name)) return 'session-start';
  if (/session.*stop|stop|exit|complete|finish/.test(name)) return 'session-stop';
  if (/pretooluse|pre-tool-use|before_tool|tool.*start/.test(name)) return 'tool-start';
  if (/posttooluse|post-tool-use|after_tool|tool.*end/.test(name)) return 'tool-end';
  if (/permission|approval/.test(name)) return 'permission';
  if (/question|ask|needs[\s_-]*input|input[\s_-]*request/.test(name)) return 'notification';
  if (/notification|notify/.test(name)) return 'notification';
  if (/error|failed|failure/.test(name)) return 'error';
  if (/user|prompt/.test(name)) return 'user';
  if (/assistant|message|response/.test(name)) return 'assistant';
  if (payload.toolName || payload.tool_name || payload.tool) return 'tool-start';
  return 'status';
}

function isQuestionPayload(payload: Record<string, unknown>): boolean {
  const name = stringValue(payload.eventType, payload.event_type, payload.hook_event_name, payload.type, payload.name);
  if (isQuestionEventName(name)) return true;
  if (payload.question || payload.choices || payload.options) return true;

  const toolName = stringValue(payload.toolName, payload.tool_name, payload.tool);
  if (toolName?.toLowerCase() === 'askuserquestion') return true;

  const toolInput = asRecord(payload.tool_input);
  if (Array.isArray(toolInput.questions) && toolInput.questions.length > 0) return true;

  return false;
}

function isPermissionEventName(name: string | undefined): boolean {
  return /permission|approval/i.test(name ?? '');
}

function isQuestionEventName(name: string | undefined): boolean {
  return /question|needs[\s_-]*input|input[\s_-]*request|(^|[\s_-])ask($|[\s_-])/i.test(name ?? '');
}

function mapSeverity(value: unknown, eventType: EventType): Severity {
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (normalized === 'success') return 'success';
    if (normalized === 'warn' || normalized === 'warning') return 'warning';
    if (normalized === 'error' || normalized === 'danger') return 'error';
  }
  if (eventType === 'error') return 'error';
  if (eventType === 'session-stop' || eventType === 'tool-end') return 'success';
  if (eventType === 'permission') return 'warning';
  return 'info';
}

function mapRisk(value: unknown, command: string | undefined): PermissionRequest['risk'] {
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (normalized === 'low' || normalized === 'medium' || normalized === 'high') return normalized;
  }
  if (!command) return 'medium';
  if (/\b(rm|del|format|shutdown|restart|reg\s+delete|Remove-Item)\b/i.test(command)) return 'high';
  if (/\b(npm|pnpm|yarn|pip|uv|cargo|dotnet|git)\b/i.test(command)) return 'medium';
  return 'low';
}

function defaultTitle(
  agent: AgentId,
  eventType: EventType,
  payload: Record<string, unknown>,
  toolName?: string,
  message?: string
): string {
  const agentName =
    agent === 'unknown'
      ? 'Agent'
      : agent === 'claude-desktop'
        ? 'Claude Desktop'
        : agent === 'claude-cli'
          ? 'Claude CLI'
          : agent.charAt(0).toUpperCase() + agent.slice(1);
  if (eventType === 'tool-start' && toolName) return `${agentName} 正在使用 ${toolName}`;
  if (eventType === 'tool-end' && toolName) return `${agentName} 完成 ${toolName}`;
  if (eventType === 'permission') return `${agentName} 请求权限`;
  if (eventType === 'session-start') return `${agentName} 会话开始`;
  if (eventType === 'session-stop') return `${agentName} 会话结束`;
  if (eventType === 'user') return `${agentName} 收到输入`;
  if (eventType === 'notification' && agent === 'claude') {
    const notificationType = stringValue(payload.notification_type)?.toLowerCase();
    const text = `${message ?? ''}`.toLowerCase();
    if (notificationType === 'permission_prompt' || /needs your permission|需要.*权限/.test(text)) {
      return 'Claude 请求权限';
    }
    if (
      notificationType === 'idle_prompt' ||
      notificationType === 'input_waiting' ||
      /waiting for your input|等待.*输入/.test(text)
    ) {
      return 'Claude 等待输入';
    }
  }
  if (eventType === 'notification') return `${agentName} 通知`;
  return `${agentName} 状态更新`;
}

function extractCommand(payload: Record<string, unknown>): string | undefined {
  const direct = stringValue(payload.command, payload.cmd);
  if (direct) return direct;
  const input = asRecord(payload.tool_input);
  return stringValue(input.command, input.cmd, input.script, input.query);
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return undefined;
}

function numberValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function stringArrayValue(...values: unknown[]): string[] | undefined {
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    const strings = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    if (strings.length > 0) return strings;
  }
  return undefined;
}

function extractToolQuestion(
  payload: Record<string, unknown>
): { question?: string; choices?: string[] } | undefined {
  const toolInput = asRecord(payload.tool_input);
  const questions = toolInput.questions;
  if (!Array.isArray(questions) || questions.length === 0) return undefined;
  const first = asRecord(questions[0]);
  const options = Array.isArray(first.options) ? first.options : [];
  const choices = options
    .map((option) => {
      if (typeof option === 'string') return option.trim();
      if (option && typeof option === 'object' && typeof (option as Record<string, unknown>).label === 'string') {
        return ((option as Record<string, unknown>).label as string).trim();
      }
      return '';
    })
    .filter((value) => value.length > 0);

  return {
    question: stringValue(first.question, first.prompt, first.header),
    choices: choices.length > 0 ? choices : undefined
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
