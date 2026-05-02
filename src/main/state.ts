import type {
  AgentDescriptor,
  AgentSession,
  AppConfig,
  AppSnapshot,
  NormalizedEvent,
  PermissionRequest,
  PermissionResponse,
  RuntimeInfo
} from '@shared/types';

export class IslandState {
  private config: AppConfig;
  private agents: AgentDescriptor[];
  private sessions: AgentSession[];
  private events: NormalizedEvent[];
  private permissions: PermissionRequest[];
  private notification: NormalizedEvent | null;
  private runtime: RuntimeInfo | null;

  constructor(input: {
    config: AppConfig;
    agents: AgentDescriptor[];
    sessions: AgentSession[];
    events: NormalizedEvent[];
    runtime: RuntimeInfo | null;
  }) {
    this.config = input.config;
    this.agents = input.agents;
    this.sessions = input.sessions;
    this.events = input.events;
    this.permissions = [];
    this.notification = null;
    this.runtime = input.runtime;
  }

  snapshot(): AppSnapshot {
    return {
      config: this.config,
      agents: this.agents,
      sessions: this.sessions,
      events: this.events.slice(-80).reverse(),
      permissions: this.permissions,
      notification: this.notification,
      runtime: this.runtime
    };
  }

  setConfig(config: AppConfig): void {
    this.config = config;
  }

  getConfig(): AppConfig {
    return this.config;
  }

  setAgents(agents: AgentDescriptor[]): void {
    this.agents = agents;
  }

  setRuntime(runtime: RuntimeInfo): void {
    this.runtime = runtime;
  }

  applyEvent(event: NormalizedEvent): AgentSession[] {
    this.events.push(event);
    if (this.events.length > 300) this.events = this.events.slice(-300);

    const sessionId = event.sessionId ?? `${event.agent}:${event.workspace ?? 'default'}`;
    const existing = this.sessions.find((session) => session.id === sessionId);
    if (existing) {
      existing.status = event.eventType;
      existing.lastSeenAt = event.timestamp;
      existing.lastMessage = event.message ?? event.title;
      existing.eventCount += 1;
      existing.workspace = event.workspace ?? existing.workspace;
      existing.title = sessionTitle(event, existing.title);
    } else {
      this.sessions.unshift({
        id: sessionId,
        agent: event.agent,
        workspace: event.workspace,
        title: sessionTitle(event),
        status: event.eventType,
        lastMessage: event.message ?? event.title,
        lastSeenAt: event.timestamp,
        eventCount: 1
      });
    }
    this.sessions = this.sessions
      .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))
      .slice(0, 30);
    return this.sessions;
  }

  addPermission(request: PermissionRequest): void {
    this.permissions = [request, ...this.permissions.filter((item) => item.id !== request.id)].slice(0, 20);
  }

  setNotification(event: NormalizedEvent): void {
    this.notification = event;
  }

  getNotification(): NormalizedEvent | null {
    return this.notification;
  }

  clearNotification(id?: string): void {
    if (!id || this.notification?.id === id) {
      this.notification = null;
    }
  }

  resolvePermission(response: PermissionResponse): void {
    this.permissions = this.permissions.filter((request) => request.id !== response.id);
  }
}

function workspaceName(workspace: string): string {
  const parts = workspace.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.at(-1) ?? workspace;
}

function sessionTitle(event: NormalizedEvent, fallback?: string): string {
  if (event.eventType === 'assistant' && event.metadata?.source === 'codex-reply-watcher') {
    return 'Codex Desktop';
  }
  if (event.workspace) return workspaceName(event.workspace);
  return fallback ?? event.title;
}
