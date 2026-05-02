import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  shell,
  Tray
} from 'electron';
import type { AgentId, AppConfig, NormalizedEvent, PermissionRequest, PermissionResponse } from '@shared/types';
import {
  shouldAutoClearIslandNotification,
  shouldPromoteWithStrategy,
  shouldReplaceIslandNotification,
  shouldShowSystemNotification
} from '@shared/attention';
import { EventDeduper } from '@shared/dedupe';
import { normalizeEvent } from '@shared/normalize';
import { detectAgents, installHook, uninstallHook } from '@shared/configAdapters';
import { createPermissionTimeoutResponse, getPermissionNoticeTimeoutMs } from '@shared/permission';
import { startIpcServer, type IpcServerHandle } from './ipcServer';
import { startCodexReplyWatcher, type CodexReplyWatcher } from './codexReplyWatcher';
import { focusWindowsTerminal, jumpToWorkspace } from './jump';
import { IslandState } from './state';
import {
  appendEvent,
  ensureStorage,
  loadConfig,
  loadRecentEvents,
  loadSessions,
  makeStoragePaths,
  saveConfig,
  saveSessions,
  writeRuntime
} from './storage';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);

let islandWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let ipcServer: IpcServerHandle | null = null;
let codexReplyWatcher: CodexReplyWatcher | null = null;
let state: IslandState;
let islandExpanded = false;
let islandHovered = false;
let notificationClearTimer: NodeJS.Timeout | null = null;
const eventDeduper = new EventDeduper();
const ISLAND_COLLAPSED_SIZE = { width: 320, height: 44 };
const ISLAND_EXPANDED_SIZE = { width: 520, height: 360 };
const ISLAND_TOP_OFFSET = 10;

const permissionWaiters = new Map<
  string,
  {
    resolve: (response: PermissionResponse) => void;
    timer: NodeJS.Timeout;
  }
>();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showIsland();
  });

  void bootstrap();
}

async function bootstrap(): Promise<void> {
  await app.whenReady();
  Menu.setApplicationMenu(null);

  const paths = makeStoragePaths(app.getPath('appData'));
  await ensureStorage(paths);
  const config = await loadConfig(paths);
  app.setLoginItemSettings({ openAtLogin: config.startAtLogin });

  ipcServer = await startIpcServer({
    onEvent: async (event) => {
      await recordEvent(event);
    },
    onPermissionRequest: async (request) => {
      return waitForPermission(request);
    },
    onPermissionResponse: async (response) => {
      resolvePermission(response);
    }
  });
  await writeRuntime(paths, ipcServer.runtime);

  const agents = await detectAgents(process.env.USERPROFILE, helperPath());
  state = new IslandState({
    config,
    agents,
    sessions: await loadSessions(paths),
    events: await loadRecentEvents(paths),
    runtime: ipcServer.runtime
  });
  codexReplyWatcher = startCodexReplyWatcher({
    codexHome: join(app.getPath('home'), '.codex'),
    onReply: async (reply) => {
      if (!state.getConfig().showCodexReplies) return;
      await recordEvent({
        schemaVersion: 1,
        id: `codex_reply_${reply.id.slice(0, 12)}`,
        timestamp: reply.timestamp,
        agent: 'codex',
        eventType: 'assistant',
        sessionId: 'codex-desktop-replies',
        title: summarizeReply(reply.text),
        message: reply.phase === 'final' ? 'Codex 完成回复' : 'Codex 回复',
        severity: 'info',
        metadata: {
          source: 'codex-reply-watcher',
          phase: reply.phase,
          sessionFile: reply.sessionFile
        }
      });
    }
  });

  createIslandWindow();
  createTray();
  registerIpc(paths);

  screen.on('display-metrics-changed', positionIsland);
  screen.on('display-added', positionIsland);
  screen.on('display-removed', positionIsland);
  app.on('activate', showIsland);
}

app.on('before-quit', () => {
  codexReplyWatcher?.close();
  if (ipcServer) void ipcServer.close();
});

function createIslandWindow(): void {
  islandWindow = new BrowserWindow({
    width: ISLAND_EXPANDED_SIZE.width,
    height: ISLAND_EXPANDED_SIZE.height,
    minWidth: ISLAND_EXPANDED_SIZE.width,
    minHeight: ISLAND_EXPANDED_SIZE.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  islandWindow.setAlwaysOnTop(true, 'screen-saver');
  islandWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  updateIslandMouseInteractivity();
  islandWindow.on('ready-to-show', () => {
    positionIsland();
    islandWindow?.showInactive();
  });
  islandWindow.on('blur', () => {
    if (!islandExpanded) return;
    islandHovered = false;
    setIslandExpanded(false);
  });

  loadRenderer(islandWindow, 'island');
}

function createSettingsWindow(): BrowserWindow {
  if (settingsWindow && !settingsWindow.isDestroyed()) return settingsWindow;
  settingsWindow = new BrowserWindow({
    width: 920,
    height: 720,
    minWidth: 820,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f8fafc',
    title: 'Vibe Island 设置',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  settingsWindow.setMenu(null);
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
  loadRenderer(settingsWindow, 'settings');
  return settingsWindow;
}

function loadRenderer(window: BrowserWindow, view: 'island' | 'settings'): void {
  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?view=${view}`);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { query: { view } });
  }
}

function positionIsland(): void {
  if (!islandWindow || islandWindow.isDestroyed()) return;
  islandWindow.setBounds(getIslandCanvasBounds(), false);
}

function setIslandExpanded(expanded: boolean): void {
  if (!islandWindow || islandWindow.isDestroyed()) return;
  islandExpanded = expanded;
  positionIsland();
  updateIslandMouseInteractivity();
  islandWindow.webContents.send('island:expanded', expanded);
}

function updateIslandMouseInteractivity(): void {
  if (!islandWindow || islandWindow.isDestroyed()) return;
  islandWindow.setIgnoreMouseEvents(!islandExpanded && !islandHovered, { forward: true });
}

function getIslandCanvasBounds(): Electron.Rectangle {
  const display = screen.getPrimaryDisplay();
  return {
    width: ISLAND_EXPANDED_SIZE.width,
    height: ISLAND_EXPANDED_SIZE.height,
    x: Math.round(display.workArea.x + (display.workArea.width - ISLAND_EXPANDED_SIZE.width) / 2),
    y: Math.round(display.workArea.y + ISLAND_TOP_OFFSET)
  };
}

function createTray(): void {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Vibe Island');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示悬浮岛', click: showIsland },
      { label: '设置', click: openSettings },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ])
  );
  tray.on('click', showIsland);
}

function createTrayIcon(): Electron.NativeImage {
  const svg = encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="9" fill="#0f766e"/><circle cx="16" cy="16" r="7" fill="#f97316"/></svg>'
  );
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${svg}`);
}

function showIsland(): void {
  if (!islandWindow || islandWindow.isDestroyed()) createIslandWindow();
  islandWindow?.showInactive();
  positionIsland();
}

function openSettings(): void {
  const window = createSettingsWindow();
  window.show();
  window.focus();
}

function registerIpc(paths: ReturnType<typeof makeStoragePaths>): void {
  ipcMain.handle('app:snapshot', () => state.snapshot());
  ipcMain.handle('island:set-expanded', (_event, expanded: boolean) => setIslandExpanded(Boolean(expanded)));
  ipcMain.handle('island:set-hovered', (_event, hovered: boolean) => {
    if (!islandWindow || islandWindow.isDestroyed()) return;
    islandHovered = Boolean(hovered);
    updateIslandMouseInteractivity();
  });
  ipcMain.handle('window:settings', openSettings);
  ipcMain.handle('shell:open-path', (_event, path: string) => shell.openPath(path));

  ipcMain.handle('config:update', async (_event, partial: Partial<AppConfig>) => {
    const next = { ...state.getConfig(), ...partial };
    state.setConfig(next);
    if (next.notificationStrategy === 'silent') {
      clearActiveNotification();
    } else if (!next.showCodexReplies && state.getNotification()?.metadata?.source === 'codex-reply-watcher') {
      clearActiveNotification();
    }
    app.setLoginItemSettings({ openAtLogin: next.startAtLogin });
    await saveConfig(paths, next);
    broadcastSnapshot();
    return next;
  });

  ipcMain.handle('agents:install-hook', async (_event, agent: AgentId) => {
    const result = await installHook(agent, helperPath(), process.env.USERPROFILE);
    state.setAgents(await detectAgents(process.env.USERPROFILE, helperPath()));
    broadcastSnapshot();
    return result;
  });

  ipcMain.handle('agents:uninstall-hook', async (_event, agent: AgentId) => {
    const result = await uninstallHook(agent, process.env.USERPROFILE);
    state.setAgents(await detectAgents(process.env.USERPROFILE, helperPath()));
    broadcastSnapshot();
    return result;
  });

  ipcMain.handle('permission:respond', async (_event, response: PermissionResponse) => {
    resolvePermission(response);
    broadcastSnapshot();
  });

  ipcMain.handle('jump:workspace', async (_event, workspace?: string) => {
    const target = state.getConfig().jumpTarget;
    if (target === 'none') return { ok: false, message: 'Jump target is disabled.' };
    if (target === 'terminal') return focusWindowsTerminal();
    return jumpToWorkspace(workspace);
  });

  ipcMain.handle('dev:sample-event', async (_event, agent: AgentId) => {
    await recordEvent(
      normalizeEvent(
        {
          agent,
          eventType: 'session-stop',
          sessionId: `sample-${agent}`,
          cwd: process.cwd(),
          toolName: 'Shell',
          command: 'npm test',
          title: `${agent} 会话完成`
        },
        agent
      )
    );
  });
}

async function recordEvent(event: NormalizedEvent): Promise<void> {
  if (eventDeduper.shouldDrop(event)) return;
  const paths = makeStoragePaths(app.getPath('appData'));
  const sessions = state.applyEvent(event);
  await Promise.all([appendEvent(paths, event), saveSessions(paths, sessions)]);
  const config = state.getConfig();
  if (shouldPromoteWithStrategy(event, config.notificationStrategy)) {
    promoteIslandNotification(event);
  }
  if (config.notifications && config.notificationStrategy !== 'silent' && shouldShowSystemNotification(event)) {
    new Notification({ title: event.title, body: event.message }).show();
  }
  broadcastSnapshot();
}

function promoteIslandNotification(event: NormalizedEvent): void {
  if (!shouldReplaceIslandNotification(state.getNotification(), event)) return;
  state.setNotification(event);
  showIsland();
  if (notificationClearTimer) {
    clearTimeout(notificationClearTimer);
    notificationClearTimer = null;
  }
  if (shouldAutoClearIslandNotification(event)) {
    notificationClearTimer = setTimeout(() => {
      state.clearNotification(event.id);
      notificationClearTimer = null;
      broadcastSnapshot();
    }, 10000);
  }
}

function clearActiveNotification(): void {
  if (notificationClearTimer) {
    clearTimeout(notificationClearTimer);
    notificationClearTimer = null;
  }
  state.clearNotification();
}

function waitForPermission(request: PermissionRequest): Promise<PermissionResponse> {
  clearActiveNotification();
  state.addPermission(request);
  broadcastSnapshot();
  showIsland();
  setIslandExpanded(false);
  const config = state.getConfig();
  if (config.notifications && config.notificationStrategy !== 'silent') {
    new Notification({ title: request.action, body: request.command }).show();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const response = createPermissionTimeoutResponse(request.id);
      resolvePermission(response);
    }, getPermissionNoticeTimeoutMs(request.timeoutMs));

    permissionWaiters.set(request.id, { resolve, timer });
  });
}

function resolvePermission(response: PermissionResponse): void {
  const waiter = permissionWaiters.get(response.id);
  if (waiter) {
    clearTimeout(waiter.timer);
    waiter.resolve(response);
    permissionWaiters.delete(response.id);
  }
  state.resolvePermission(response);
  updateIslandMouseInteractivity();
  broadcastSnapshot();
}

function broadcastSnapshot(): void {
  const snapshot = state.snapshot();
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('app:snapshot', snapshot);
  }
}

function helperPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'scripts', 'vibe-island-hook.mjs');
  return join(process.cwd(), 'scripts', 'vibe-island-hook.mjs');
}

function summarizeReply(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= 80) return compact;
  return `${compact.slice(0, 79)}...`;
}
