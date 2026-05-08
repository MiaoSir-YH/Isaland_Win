import { contextBridge, ipcRenderer } from 'electron';
import type {
  AgentId,
  AgentDescriptor,
  AppConfig,
  AppSnapshot,
  DiagnosticsInfo,
  HookInstallResult,
  PermissionResponse,
  UpdateConfig
} from '@shared/types';

const api = {
  getSnapshot: (): Promise<AppSnapshot> => ipcRenderer.invoke('app:snapshot'),
  onSnapshot: (callback: (snapshot: AppSnapshot) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot): void => callback(snapshot);
    ipcRenderer.on('app:snapshot', listener);
    return () => ipcRenderer.off('app:snapshot', listener);
  },
  onExpanded: (callback: (expanded: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, expanded: boolean): void => callback(Boolean(expanded));
    ipcRenderer.on('island:expanded', listener);
    return () => ipcRenderer.off('island:expanded', listener);
  },
  onIslandShow: (callback: () => void): (() => void) => {
    const listener = (): void => callback();
    ipcRenderer.on('island:show', listener);
    return () => ipcRenderer.off('island:show', listener);
  },
  onIslandPeeking: (callback: () => void): (() => void) => {
    const listener = (): void => callback();
    ipcRenderer.on('island:peeking', listener);
    return () => ipcRenderer.off('island:peeking', listener);
  },
  setExpanded: (expanded: boolean): Promise<void> => ipcRenderer.invoke('island:set-expanded', expanded),
  setIslandHovered: (hovered: boolean): Promise<void> => ipcRenderer.invoke('island:set-hovered', hovered),
  setIslandPeeking: (peeking: boolean): Promise<void> => ipcRenderer.invoke('island:set-peeking', peeking),
  setIslandLayout: (size: { width: number; height: number }): Promise<void> => ipcRenderer.invoke('island:set-layout', size),
  clearActiveNotification: (): Promise<void> => ipcRenderer.invoke('notification:clear-active'),
  openSettings: (): Promise<void> => ipcRenderer.invoke('window:settings'),
  getSettingsWindowState: (): Promise<{ maximized: boolean }> => ipcRenderer.invoke('window:settings-state'),
  onSettingsWindowState: (callback: (state: { maximized: boolean }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: { maximized: boolean }): void => callback(state);
    ipcRenderer.on('window:settings-state', listener);
    return () => ipcRenderer.off('window:settings-state', listener);
  },
  controlSettingsWindow: (action: 'close' | 'minimize' | 'zoom'): Promise<{ maximized: boolean }> =>
    ipcRenderer.invoke('window:settings-control', action),
  beginSettingsWindowDrag: (point: {
    screenX: number;
    screenY: number;
    clientX: number;
    clientY: number;
  }): Promise<{ maximized: boolean }> => ipcRenderer.invoke('window:settings-drag-start', point),
  moveSettingsWindowDrag: (point: { screenX: number; screenY: number }): Promise<void> =>
    ipcRenderer.invoke('window:settings-drag-move', point),
  endSettingsWindowDrag: (): Promise<void> => ipcRenderer.invoke('window:settings-drag-end'),
  updateConfig: (config: Partial<AppConfig>): Promise<AppConfig> => ipcRenderer.invoke('config:update', config),
  installHook: (agent: AgentId): Promise<HookInstallResult> => ipcRenderer.invoke('agents:install-hook', agent),
  uninstallHook: (agent: AgentId): Promise<HookInstallResult> => ipcRenderer.invoke('agents:uninstall-hook', agent),
  toggleHook: (agent: AgentId): Promise<HookInstallResult> => ipcRenderer.invoke('agents:toggle-hook', agent),
  refreshAgents: (): Promise<AgentDescriptor[]> => ipcRenderer.invoke('agents:refresh'),
  installClaudeStatusLine: (): Promise<HookInstallResult> => ipcRenderer.invoke('agents:install-claude-status-line'),
  uninstallClaudeStatusLine: (): Promise<HookInstallResult> => ipcRenderer.invoke('agents:uninstall-claude-status-line'),
  respondPermission: (response: PermissionResponse): Promise<void> => ipcRenderer.invoke('permission:respond', response),
  jumpWorkspace: (target?: string | { sessionId?: string; workspace?: string }): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('jump:workspace', target),
  refreshDiagnostics: (): Promise<DiagnosticsInfo> => ipcRenderer.invoke('diagnostics:refresh'),
  checkForUpdates: (): Promise<UpdateConfig> => ipcRenderer.invoke('updates:check'),
  sendSampleEvent: (agent: AgentId): Promise<void> => ipcRenderer.invoke('dev:sample-event', agent),
  openPath: (path: string): Promise<string> => ipcRenderer.invoke('shell:open-path', path)
};

contextBridge.exposeInMainWorld('vibeIsland', api);

export type VibeIslandApi = typeof api;
