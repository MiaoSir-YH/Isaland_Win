import type {
  AgentId,
  AppConfig,
  AppSnapshot,
  DiagnosticsInfo,
  HookInstallResult,
  PermissionResponse,
  UpdateConfig
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
        id: 'claude-desktop',
        name: 'Claude Desktop',
        detected: true,
        hookInstalled: false,
        configPath: '%USERPROFILE%\\AppData\\Local\\Claude-3p\\claude_desktop_config.json'
      },
      {
        id: 'claude-cli',
        name: 'Claude CLI',
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
    usage: [
      {
        agent: 'codex',
        source: '%USERPROFILE%\\.codex\\usage.json',
        available: true,
        fiveHour: { used: 22, limit: 100, resetAt: new Date(Date.now() + 42 * 60 * 1000).toISOString() },
        sevenDay: { used: 140, limit: 500 },
        updatedAt: now
      },
      {
        agent: 'claude',
        source: '%USERPROFILE%\\.claude\\usage.json',
        available: false,
        message: 'Usage cache not found.',
        updatedAt: now
      }
    ],
    diagnostics: {
      runtimePath: '%TEMP%\\vibe-island-runtime.json',
      hookHelperPath: 'M:\\ai-harness\\island\\scripts\\vibe-island-hook.mjs',
      remoteUrl: 'http://127.0.0.1:48931',
      ipcHealthy: true,
      checkedAt: now
    },
    notification: null,
    sessions: [
      {
        id: 'preview-codex',
        agent: 'codex',
        workspace: 'O:\\w_Island',
        title: 'w_Island',
        status: 'tool-end',
        lastMessage: 'layout animation preview',
        lastSeenAt: now,
        eventCount: 3
      }
    ],
    permissions: [
      {
        schemaVersion: 1,
        id: 'preview-permission',
        kind: 'permission',
        timestamp: now,
        agent: 'codex',
        sessionId: 'preview-codex',
        workspace: 'O:\\w_Island',
        toolName: 'Shell',
        action: '运行构建检查',
        command: 'npm run build',
        risk: 'medium',
        timeoutMs: 120000
      },
      {
        schemaVersion: 1,
        id: 'preview-question',
        kind: 'question',
        timestamp: now,
        agent: 'claude',
        sessionId: 'preview-claude',
        workspace: 'O:\\w_Island',
        action: '选择发布通道',
        prompt: '要把更新检查指向哪个通道？',
        choices: ['stable', 'prerelease'],
        risk: 'low',
        timeoutMs: 120000
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
        workspace: 'O:\\w_Island',
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
    onIslandShow: () => {
      return () => undefined;
    },
    onIslandPeeking: () => {
      return () => undefined;
    },
    setExpanded: async (next) => {
      expanded = next;
      emitExpanded();
    },
    setIslandHovered: async () => undefined,
    setIslandPeeking: async () => undefined,
    setIslandLayout: async () => undefined,
    clearActiveNotification: async () => {
      snapshot = {
        ...snapshot,
        notification: null
      };
      emitSnapshot();
    },
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
    refreshAgents: async () => snapshot.agents,
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
    toggleHook: async (agent: AgentId): Promise<HookInstallResult> => {
      const current = snapshot.agents.find((item) => item.id === agent);
      const nextInstalled = !current?.hookInstalled;
      snapshot = {
        ...snapshot,
        agents: snapshot.agents.map((item) =>
          item.id === agent ? { ...item, hookInstalled: nextInstalled } : item
        )
      };
      emitSnapshot();
      return {
        agent,
        configPath: current?.configPath ?? '',
        installed: nextInstalled,
        changed: true,
        message: nextInstalled ? '浏览器预览：已模拟安装 hook。' : '浏览器预览：已模拟卸载 hook。'
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
    installClaudeStatusLine: async (): Promise<HookInstallResult> => ({
      agent: 'claude-cli',
      configPath: '%USERPROFILE%\\.claude\\settings.json',
      installed: true,
      changed: true,
      message: '浏览器预览：已模拟安装 Claude statusLine。'
    }),
    uninstallClaudeStatusLine: async (): Promise<HookInstallResult> => ({
      agent: 'claude-cli',
      configPath: '%USERPROFILE%\\.claude\\settings.json',
      installed: false,
      changed: true,
      message: '浏览器预览：已模拟卸载 Claude statusLine。'
    }),
    respondPermission: async (response: PermissionResponse) => {
      snapshot = {
        ...snapshot,
        permissions: snapshot.permissions.filter((request) => request.id !== response.id)
      };
      emitSnapshot();
    },
    refreshDiagnostics: async (): Promise<DiagnosticsInfo> => {
      snapshot = {
        ...snapshot,
        diagnostics: {
          ...snapshot.diagnostics,
          checkedAt: new Date().toISOString()
        }
      };
      emitSnapshot();
      return snapshot.diagnostics;
    },
    checkForUpdates: async (): Promise<UpdateConfig> => {
      snapshot = {
        ...snapshot,
        config: {
          ...snapshot.config,
          update: {
            ...snapshot.config.update,
            lastCheckedAt: new Date().toISOString(),
            status: 'not-available',
            message: '浏览器预览：当前已是最新版本。'
          }
        }
      };
      emitSnapshot();
      return snapshot.config.update;
    },
    jumpWorkspace: async () => ({
      ok: false,
      message: '跳转功能已取消。'
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
        workspace: 'O:\\w_Island',
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
