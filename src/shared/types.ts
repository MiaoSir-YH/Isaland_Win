export type AgentId =
  | 'codex'
  | 'claude'
  | 'gemini'
  | 'opencode'
  | 'cursor'
  | 'kimi'
  | 'qoder'
  | 'qwen'
  | 'factory'
  | 'codebuddy'
  | 'unknown';

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

export type ActionableKind = 'permission' | 'question';
export type PermissionDecision = 'allow' | 'deny' | 'denyForSession' | 'timeout' | 'answer';
export type SoundName = 'asterisk' | 'beep' | 'exclamation' | 'hand' | 'question';
export type NotificationStrategy = 'focused' | 'realtime' | 'silent';
export type AppearanceTheme = 'system' | 'light' | 'dark';
export type AccentTheme = 'classic' | 'teal' | 'blue' | 'violet' | 'orange' | 'graphite';
export type AgentSessionDiscoverySource = 'hook' | 'codex-app-server' | 'codex-reply-watcher' | 'transcript';
export type AgentSessionLiveness = 'live' | 'discovered' | 'stale';

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
  kind: ActionableKind;
  timestamp: string;
  agent: AgentId;
  sessionId?: string;
  workspace?: string;
  toolName?: string;
  action: string;
  prompt?: string;
  choices?: string[];
  command?: string;
  risk: 'low' | 'medium' | 'high';
  timeoutMs: number;
  sourceRequestId?: string;
  metadata?: Record<string, unknown>;
}

export interface PermissionResponse {
  id: string;
  decision: PermissionDecision;
  decidedAt: string;
  answer?: string;
  reason?: string;
  scope?: 'request' | 'session';
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
  liveness?: AgentSessionLiveness;
  metadata?: AgentSessionMetadata;
}

export interface AgentDescriptor {
  id: AgentId;
  name: string;
  command?: string;
  detected: boolean;
  configPath?: string;
  hookInstalled: boolean;
  health?: 'installed' | 'missing' | 'unknown';
  pluginPath?: string;
  experimental?: boolean;
  note?: string;
}

export interface AgentSessionMetadata {
  terminal?: string | Record<string, unknown>;
  threadId?: string;
  transcriptPath?: string;
  discoverySource?: AgentSessionDiscoverySource | string;
  jumpHints?: Record<string, string>;
  [key: string]: unknown;
}

export interface SoundConfig {
  enabled: boolean;
  name: SoundName;
  volume: number;
}

export interface ExperimentalConfig {
  codexAppServer: boolean;
  sessionDiscovery: boolean;
  preciseJump: boolean;
}

export interface UpdateConfig {
  enabled: boolean;
  channel: 'stable' | 'prerelease';
  lastCheckedAt?: string;
  status?: 'idle' | 'checking' | 'available' | 'not-available' | 'error';
  message?: string;
}

export interface RemoteConfig {
  enabled: boolean;
  token?: string;
}

export interface UsageWindow {
  used?: number;
  limit?: number;
  resetAt?: string;
}

export interface AgentUsage {
  agent: AgentId;
  source: string;
  available: boolean;
  fiveHour?: UsageWindow;
  sevenDay?: UsageWindow;
  message?: string;
  updatedAt: string;
}

export interface DiagnosticsInfo {
  runtimePath?: string;
  hookHelperPath?: string;
  remoteUrl?: string;
  ipcHealthy: boolean;
  lastError?: string;
  checkedAt: string;
}

export interface AppConfig {
  theme: AppearanceTheme;
  accentTheme: AccentTheme;
  language: 'zh-CN' | 'en-US';
  startAtLogin: boolean;
  notifications: boolean;
  sound: SoundConfig;
  notificationStrategy: NotificationStrategy;
  showCodexReplies: boolean;
  autoPeekIsland: boolean;
  islandClickThrough: boolean;
  jumpTarget: 'workspace' | 'terminal' | 'precise' | 'none';
  experiments: ExperimentalConfig;
  update: UpdateConfig;
  remote: RemoteConfig;
}

export interface AppSnapshot {
  config: AppConfig;
  agents: AgentDescriptor[];
  sessions: AgentSession[];
  events: NormalizedEvent[];
  permissions: PermissionRequest[];
  notification: NormalizedEvent | null;
  runtime: RuntimeInfo | null;
  usage: AgentUsage[];
  diagnostics: DiagnosticsInfo;
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
  accentTheme: 'classic',
  language: 'zh-CN',
  startAtLogin: false,
  notifications: true,
  sound: {
    enabled: false,
    name: 'asterisk',
    volume: 0.8
  },
  notificationStrategy: 'focused',
  showCodexReplies: true,
  autoPeekIsland: true,
  islandClickThrough: false,
  jumpTarget: 'workspace',
  experiments: {
    codexAppServer: false,
    sessionDiscovery: true,
    preciseJump: false
  },
  update: {
    enabled: false,
    channel: 'stable',
    status: 'idle'
  },
  remote: {
    enabled: false
  }
};
