import { contextBridge, ipcRenderer } from 'electron';
import type {
  AgentId,
  AppConfig,
  AppSnapshot,
  HookInstallResult,
  PermissionResponse
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
  setExpanded: (expanded: boolean): Promise<void> => ipcRenderer.invoke('island:set-expanded', expanded),
  setIslandHovered: (hovered: boolean): Promise<void> => ipcRenderer.invoke('island:set-hovered', hovered),
  openSettings: (): Promise<void> => ipcRenderer.invoke('window:settings'),
  updateConfig: (config: Partial<AppConfig>): Promise<AppConfig> => ipcRenderer.invoke('config:update', config),
  installHook: (agent: AgentId): Promise<HookInstallResult> => ipcRenderer.invoke('agents:install-hook', agent),
  uninstallHook: (agent: AgentId): Promise<HookInstallResult> => ipcRenderer.invoke('agents:uninstall-hook', agent),
  respondPermission: (response: PermissionResponse): Promise<void> => ipcRenderer.invoke('permission:respond', response),
  jumpWorkspace: (workspace?: string): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('jump:workspace', workspace),
  sendSampleEvent: (agent: AgentId): Promise<void> => ipcRenderer.invoke('dev:sample-event', agent),
  openPath: (path: string): Promise<string> => ipcRenderer.invoke('shell:open-path', path)
};

contextBridge.exposeInMainWorld('vibeIsland', api);

export type VibeIslandApi = typeof api;
