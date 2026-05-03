import type {
  AgentId,
  AppConfig,
  AppSnapshot,
  HookInstallResult,
  PermissionResponse
} from '@shared/types';
import { DEFAULT_CONFIG } from '@shared/types';
import type { VibeIslandApi } from '../../preload';

const now = new Date().toISOString();

export function createBrowserPreviewApi(): VibeIslandApi {
  let expanded = false;
  let sampleCount = 0;
  let settingsMaximized = false;
  let snapshot: AppSnapshot = {
    config: DEFAULT_CONFIG,
    runtime: null,
    permissions: [],
    agents: [
      {
        id: 'codex',
        name: 'Codex',
        detected: true,
        hookInstalled: false,
        configPath: '%USERPROFILE%\\.codex\\hooks.json',
        experimental: true,
        note: '浏览器预览模式使用模拟数据。'
      },
      {
        id: 'claude',
        name: 'Claude Code',
        detected: true,
        hookInstalled: true,
        configPath: '%USERPROFILE%\\.claude\\settings.json'
      },
      {
        id: 'gemini',
        name: 'Gemini CLI',
        detected: true,
        hookInstalled: false,
        configPath: '%USERPROFILE%\\.gemini\\settings.json'
      },
      {
        id: 'opencode',
        name: 'OpenCode',
        detected: false,
        hookInstalled: false,
        configPath: '%USERPROFILE%\\.config\\opencode\\opencode.json'
      }
    ],
    notification: null,
    sessions: [
      {
        id: 'preview-codex',
        agent: 'codex',
        workspace: 'O:\\w_Isaland',
        title: 'w_Isaland',
        status: 'tool-end',
        lastMessage: 'layout animation preview',
        lastSeenAt: now,
        eventCount: 3
      }
    ],
    events: [
      {
        schemaVersion: 1,
        id: 'preview-event-1',
        timestamp: now,
        agent: 'codex',
        eventType: 'tool-end',
        sessionId: 'preview-codex',
        workspace: 'O:\\w_Isaland',
        title: 'Codex 完成 Shell',
        message: 'layout animation preview',
        severity: 'success',
        toolName: 'Shell',
        command: 'npm run dev'
      }
    ]
  };

  const snapshotListeners = new Set<(next: AppSnapshot) => void>();
  const expandedListeners = new Set<(next: boolean) => void>();
  const settingsStateListeners = new Set<(next: { maximized: boolean }) => void>();

  function emitSnapshot(): void {
    for (const listener of snapshotListeners) listener(snapshot);
  }

  function emitExpanded(): void {
    for (const listener of expandedListeners) listener(expanded);
  }

  function emitSettingsState(): void {
    for (const listener of settingsStateListeners) listener({ maximized: settingsMaximized });
  }

  return {
    getSnapshot: async () => snapshot,
    onSnapshot: (callback) => {
      snapshotListeners.add(callback);
      return () => snapshotListeners.delete(callback);
    },
    onExpanded: (callback) => {
      expandedListeners.add(callback);
      return () => expandedListeners.delete(callback);
    },
    setExpanded: async (next) => {
      expanded = next;
      emitExpanded();
    },
    setIslandHovered: async () => undefined,
    setIslandLayout: async () => undefined,
    openSettings: async () => {
      window.location.search = '?view=settings';
    },
    getSettingsWindowState: async () => ({ maximized: settingsMaximized }),
    onSettingsWindowState: (callback) => {
      settingsStateListeners.add(callback);
      return () => settingsStateListeners.delete(callback);
    },
    controlSettingsWindow: async (action) => {
      if (action === 'zoom') {
        settingsMaximized = !settingsMaximized;
        emitSettingsState();
      }
      return { maximized: settingsMaximized };
    },
    beginSettingsWindowDrag: async () => {
      settingsMaximized = false;
      emitSettingsState();
      return { maximized: settingsMaximized };
    },
    moveSettingsWindowDrag: async () => undefined,
    endSettingsWindowDrag: async () => undefined,
    updateConfig: async (partial: Partial<AppConfig>) => {
      snapshot = {
        ...snapshot,
        config: {
          ...snapshot.config,
          ...partial
        }
      };
      emitSnapshot();
      return snapshot.config;
    },
    installHook: async (agent: AgentId): Promise<HookInstallResult> => {
      snapshot = {
        ...snapshot,
        agents: snapshot.agents.map((item) => (item.id === agent ? { ...item, hookInstalled: true } : item))
      };
      emitSnapshot();
      return {
        agent,
        configPath: snapshot.agents.find((item) => item.id === agent)?.configPath ?? '',
        installed: true,
        changed: true,
        message: '浏览器预览：已模拟安装 hook。'
      };
    },
    uninstallHook: async (agent: AgentId): Promise<HookInstallResult> => {
      snapshot = {
        ...snapshot,
        agents: snapshot.agents.map((item) => (item.id === agent ? { ...item, hookInstalled: false } : item))
      };
      emitSnapshot();
      return {
        agent,
        configPath: snapshot.agents.find((item) => item.id === agent)?.configPath ?? '',
        installed: false,
        changed: true,
        message: '浏览器预览：已模拟卸载 hook。'
      };
    },
    respondPermission: async (_response: PermissionResponse) => undefined,
    jumpWorkspace: async () => ({
      ok: true,
      message: '浏览器预览：已模拟跳转。'
    }),
    sendSampleEvent: async (agent: AgentId) => {
      sampleCount += 1;
      const message =
        sampleCount % 2 === 0
          ? 'npm test'
          : 'agent returned a much longer status message for width testing';
      const event = {
        schemaVersion: 1 as const,
        id: `preview-${Date.now()}`,
        timestamp: new Date().toISOString(),
        agent,
        eventType: 'tool-end' as const,
        sessionId: `preview-${agent}`,
        workspace: 'O:\\w_Isaland',
        title: `${agent} 示例事件 ${message}`,
        message,
        severity: 'success' as const,
        toolName: 'Shell',
        command: message
      };
      snapshot = {
        ...snapshot,
        events: [event, ...snapshot.events].slice(0, 8),
        notification: sampleCount % 2 === 0 ? event : null
      };
      emitSnapshot();
    },
    openPath: async () => ''
  };
}
