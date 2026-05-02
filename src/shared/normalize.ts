import type { AgentId, EventType, NormalizedEvent, PermissionRequest, Severity } from './types';

const KNOWN_AGENTS = new Set<AgentId>(['codex', 'claude', 'gemini', 'opencode', 'unknown']);

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
  const sessionId = stringValue(payload.sessionId, payload.session_id, payload.conversationId);
  const workspace = stringValue(payload.workspace, payload.cwd, payload.project, payload.projectDir);
  const toolName = stringValue(payload.toolName, payload.tool_name, payload.tool);
  const command = extractCommand(payload);
  const severity = mapSeverity(payload.severity, eventType);
  const title = stringValue(payload.title) ?? defaultTitle(agent, eventType, toolName);
  const message = stringValue(payload.message, payload.text, payload.summary) ?? command;

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
  const action =
    stringValue(payload.action, payload.reason, payload.description) ??
    (toolName ? `请求执行 ${toolName}` : '请求权限确认');

  return {
    schemaVersion: 1,
    id: stringValue(payload.id, payload.requestId, payload.request_id) ?? makeId('perm'),
    timestamp: stringValue(payload.timestamp, payload.time) ?? new Date().toISOString(),
    agent,
    sessionId: stringValue(payload.sessionId, payload.session_id, payload.conversationId),
    workspace: stringValue(payload.workspace, payload.cwd, payload.project, payload.projectDir),
    toolName,
    action,
    command,
    risk: mapRisk(payload.risk, command),
    timeoutMs: numberValue(payload.timeoutMs, payload.timeout_ms) ?? 120000,
    metadata: payload
  };
}

export function isPermissionLike(raw: unknown): boolean {
  const payload = asRecord(raw);
  const name = stringValue(payload.eventType, payload.event_type, payload.hook_event_name, payload.type, payload.name);
  if (!name) return false;
  return /permission|approval|pretooluse|pre-tool-use|before_tool/i.test(name);
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

function defaultTitle(agent: AgentId, eventType: EventType, toolName?: string): string {
  const agentName = agent === 'unknown' ? 'Agent' : agent.charAt(0).toUpperCase() + agent.slice(1);
  if (eventType === 'tool-start' && toolName) return `${agentName} 正在使用 ${toolName}`;
  if (eventType === 'tool-end' && toolName) return `${agentName} 完成 ${toolName}`;
  if (eventType === 'permission') return `${agentName} 请求权限`;
  if (eventType === 'session-start') return `${agentName} 会话开始`;
  if (eventType === 'session-stop') return `${agentName} 会话结束`;
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
