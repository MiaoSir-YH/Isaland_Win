export type AgentId = 'codex' | 'claude' | 'gemini' | 'opencode' | 'unknown';

export type EventType =
  | 'session-start'
  | 'session-stop'
  | 'status'
  | 'user'
  | 'assistant'
  | 'tool-start'
  | 'tool-end'
  | 'permission'
  | 'notification'
  | 'error'
  | 'idle';

export type Severity = 'info' | 'success' | 'warning' | 'error';

export type PermissionDecision = 'allow' | 'deny' | 'denyForSession' | 'timeout';
export type NotificationStrategy = 'focused' | 'realtime' | 'silent';
export type AppearanceTheme = 'system' | 'light' | 'dark';
export type AccentTheme = 'teal' | 'blue' | 'violet' | 'orange' | 'graphite';

export interface NormalizedEvent {
  schemaVersion: 1;
  id: string;
  timestamp: string;
  agent: AgentId;
  eventType: EventType;
  sessionId?: string;
  workspace?: string;
  title: string;
  message?: string;
  severity: Severity;
  toolName?: string;
  command?: string;
  metadata?: Record<string, unknown>;
}

export interface PermissionRequest {
  schemaVersion: 1;
  id: string;
  timestamp: string;
  agent: AgentId;
  sessionId?: string;
  workspace?: string;
  toolName?: string;
  action: string;
  command?: string;
  risk: 'low' | 'medium' | 'high';
  timeoutMs: number;
  metadata?: Record<string, unknown>;
}

export interface PermissionResponse {
  id: string;
  decision: PermissionDecision;
  decidedAt: string;
}

export interface AgentSession {
  id: string;
  agent: AgentId;
  workspace?: string;
  title: string;
  status: EventType;
  lastMessage?: string;
  lastSeenAt: string;
  eventCount: number;
}

export interface AgentDescriptor {
  id: AgentId;
  name: string;
  command?: string;
  detected: boolean;
  configPath?: string;
  hookInstalled: boolean;
  experimental?: boolean;
  note?: string;
}

export interface AppConfig {
  theme: AppearanceTheme;
  accentTheme: AccentTheme;
  language: 'zh-CN' | 'en-US';
  startAtLogin: boolean;
  notifications: boolean;
  sound: boolean;
  notificationStrategy: NotificationStrategy;
  showCodexReplies: boolean;
  jumpTarget: 'workspace' | 'terminal' | 'none';
}

export interface AppSnapshot {
  config: AppConfig;
  agents: AgentDescriptor[];
  sessions: AgentSession[];
  events: NormalizedEvent[];
  permissions: PermissionRequest[];
  notification: NormalizedEvent | null;
  runtime: RuntimeInfo | null;
}

export interface RuntimeInfo {
  host: string;
  port: number;
  token: string;
  pid: number;
  startedAt: string;
}

export interface HookInstallResult {
  agent: AgentId;
  configPath: string;
  backupPath?: string;
  installed: boolean;
  changed: boolean;
  message: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  theme: 'system',
  accentTheme: 'teal',
  language: 'zh-CN',
  startAtLogin: false,
  notifications: true,
  sound: false,
  notificationStrategy: 'focused',
  showCodexReplies: true,
  jumpTarget: 'workspace'
};
