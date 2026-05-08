import { join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  screen,
  shell,
  Tray
} from 'electron';
import type { AgentId, AppConfig, NormalizedEvent, PermissionRequest, PermissionResponse } from '@shared/types';
import {
  shouldAutoClearIslandNotification,
  shouldClearCompletedIslandNotification,
  shouldPromoteWithStrategy,
  shouldReplaceIslandNotification,
  shouldShowSystemNotification
} from '@shared/attention';
import { EventDeduper } from '@shared/dedupe';
import { normalizeEvent } from '@shared/normalize';
import {
  detectAgents,
  installClaudeStatusLine,
  installHook,
  uninstallClaudeStatusLine,
  uninstallHook
} from '@shared/configAdapters';
import { createPermissionTimeoutResponse, getPermissionNoticeTimeoutMs } from '@shared/permission';
import { startIpcServer, type IpcServerHandle } from './ipcServer';
import { isFinalCodexReplyPhase, startCodexReplyWatcher, type CodexReplyWatcher } from './codexReplyWatcher';
import { startCodexAppServer, type CodexAppServerCoordinator } from './codexAppServer';
import { makeDiagnostics } from './diagnostics';
import { startRemoteServer, type RemotePermissionResponse, type RemoteServerHandle } from './remoteServer';
import { discoverSessions } from './sessionDiscovery';
import { playConfiguredSound } from './sound';
import { checkForUpdates } from './updates';
import { collectUsage } from './usage';
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
type RendererView = 'island' | 'settings';
type IpcHandler<TArgs extends unknown[], TResult> = (
  event: Electron.IpcMainInvokeEvent,
  ...args: TArgs
) => TResult | Promise<TResult>;

let islandWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let ipcServer: IpcServerHandle | null = null;
let codexReplyWatcher: CodexReplyWatcher | null = null;
let codexAppServer: CodexAppServerCoordinator | null = null;
let remoteServer: RemoteServerHandle | null = null;
let state: IslandState;
let storagePaths: ReturnType<typeof makeStoragePaths>;
let lastError: string | undefined;
let islandExpanded = false;
let islandHovered = false;
let islandPeeking = false;
let settingsManuallyMaximized = false;
let settingsRestoreBounds: Electron.Rectangle | null = null;
let settingsDragOffset: { x: number; y: number } | null = null;
let settingsDragBounds: Electron.Rectangle | null = null;
let settingsDragTimer: NodeJS.Timeout | null = null;
let islandPositionTimer: NodeJS.Timeout | null = null;
let islandSurfaceRefreshTimer: NodeJS.Timeout | null = null;
let notificationClearTimer: NodeJS.Timeout | null = null;
const eventDeduper = new EventDeduper();
const ISLAND_SHADOW_GUTTER_X = 24;
const ISLAND_SHADOW_GUTTER_TOP = 12;
const ISLAND_SHADOW_GUTTER_BOTTOM = 42;
const ISLAND_CONTENT_WIDTH = 576;
const ISLAND_CONTENT_COLLAPSED_HEIGHT = 68;
const ISLAND_CONTENT_EXPANDED_HEIGHT = 372;
const ISLAND_COLLAPSED_SIZE = {
  width: ISLAND_CONTENT_WIDTH,
  height: ISLAND_CONTENT_COLLAPSED_HEIGHT + ISLAND_SHADOW_GUTTER_TOP + ISLAND_SHADOW_GUTTER_BOTTOM
};
const ISLAND_EXPANDED_SIZE = {
  width: ISLAND_CONTENT_WIDTH,
  height: ISLAND_CONTENT_EXPANDED_HEIGHT + ISLAND_SHADOW_GUTTER_TOP + ISLAND_SHADOW_GUTTER_BOTTOM
};
const ISLAND_TOP_OFFSET = 4;
const ISLAND_BAR_HEIGHT = 44;
const ISLAND_SHELL_TOP_PADDING = 12;
const ISLAND_PEEK_VISIBLE_HEIGHT = 16;
const ISLAND_PEEK_ANIMATION_MS = 220;
const ISLAND_TRANSPARENCY_REFRESH_DELAY_MS = 220;
const SETTINGS_NORMAL_SIZE = { width: 1100, height: 760 };
const SETTINGS_MIN_SIZE = { width: 940, height: 660 };
let islandLayoutSize = { ...ISLAND_COLLAPSED_SIZE };
const trustedWebContentsViews = new Map<number, RendererView>();

const permissionWaiters = new Map<
  string,
  {
    resolve: (response: PermissionResponse) => void;
    timer: NodeJS.Timeout;
    remoteResolveToken: string;
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
  const userHome = process.env.USERPROFILE ?? app.getPath('home');
  const hookHelper = helperPath();
  storagePaths = paths;
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

  await refreshManagedAgentHooks(userHome, hookHelper);
  const agents = await detectAgents(userHome, hookHelper);
  state = new IslandState({
    config,
    agents,
    sessions: await loadSessions(paths),
    events: await loadRecentEvents(paths),
    runtime: ipcServer.runtime,
    usage: await collectUsage(app.getPath('home')),
    diagnostics: makeDiagnostics({
      runtime: ipcServer.runtime,
      runtimePath: paths.runtime,
      hookHelperPath: hookHelper
    })
  });
  if (config.experiments.sessionDiscovery) {
    state.mergeDiscoveredSessions(await discoverSessions(app.getPath('home')));
  }
  codexReplyWatcher = startCodexReplyWatcher({
    codexHome: join(app.getPath('home'), '.codex'),
    onReply: async (reply) => {
      const isFinalReply = isFinalCodexReplyPhase(reply.phase);
      if (!isFinalReply && !state.getConfig().showCodexReplies) return;
      await recordEvent({
        schemaVersion: 1,
        id: `${isFinalReply ? 'codex_desktop_stop' : 'codex_reply'}_${reply.id.slice(0, 12)}`,
        timestamp: reply.timestamp,
        agent: 'codex',
        eventType: isFinalReply ? 'session-stop' : 'assistant',
        sessionId: 'codex-desktop-replies',
        title: summarizeReply(reply.text),
        message: isFinalReply ? 'Codex 会话完成' : 'Codex 回复',
        severity: isFinalReply ? 'success' : 'info',
        metadata: {
          source: 'codex-reply-watcher',
          phase: reply.phase,
          sessionFile: reply.sessionFile
        }
      });
    }
  });
  codexAppServer = startCodexAppServerForConfig(config);
  if (config.remote.enabled) {
    if (!config.remote.token) {
      config.remote.token = makeRemoteToken();
      await saveConfig(paths, config);
    }
    remoteServer = await startRemoteServer({
      token: config.remote.token,
      onResolution: resolveRemotePermission
    });
    refreshDiagnostics();
  }

  createIslandWindow();
  createTray();
  registerIpc(paths);

  screen.on('display-metrics-changed', () => {
    positionIsland();
    scheduleIslandSurfaceRefresh();
  });
  screen.on('display-added', () => {
    scheduleIslandSurfaceRefresh();
    ensureIslandAlwaysOnTop();
  });
  screen.on('display-removed', () => {
    scheduleIslandSurfaceRefresh();
    ensureIslandAlwaysOnTop();
  });
  powerMonitor.on('resume', () => {
    scheduleIslandSurfaceRefresh();
    ensureIslandAlwaysOnTop();
  });
  powerMonitor.on('unlock-screen', () => {
    scheduleIslandSurfaceRefresh();
    ensureIslandAlwaysOnTop();
  });
  app.on('activate', showIsland);
}

app.on('before-quit', () => {
  codexReplyWatcher?.close();
  codexAppServer?.close();
  if (ipcServer) void ipcServer.close();
  if (remoteServer) void remoteServer.close();
  stopIslandPositionAnimation();
  clearIslandSurfaceRefreshTimer();
});

app.on('window-all-closed', () => undefined);

function createIslandWindow(): void {
  const window = new BrowserWindow({
    width: ISLAND_COLLAPSED_SIZE.width,
    height: ISLAND_COLLAPSED_SIZE.height,
    minWidth: ISLAND_COLLAPSED_SIZE.width,
    minHeight: ISLAND_COLLAPSED_SIZE.height,
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
  islandWindow = window;

  window.setBackgroundColor('#00000000');
  ensureIslandAlwaysOnTop();
  updateIslandMouseInteractivity();
  window.on('ready-to-show', () => {
    positionIsland();
    window.showInactive();
    ensureIslandAlwaysOnTop();
  });
  window.on('show', ensureIslandAlwaysOnTop);
  window.on('blur', () => {
    if (!islandExpanded) return;
    islandHovered = false;
    setIslandExpanded(false);
  });
  window.on('closed', () => {
    trustedWebContentsViews.delete(window.webContents.id);
    if (islandWindow === window) islandWindow = null;
  });

  hardenRendererWindow(window, 'island');
  loadRenderer(window, 'island');
}

function createSettingsWindow(): BrowserWindow {
  if (settingsWindow && !settingsWindow.isDestroyed()) return settingsWindow;
  settingsWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 940,
    minHeight: 660,
    show: false,
    frame: false,
    transparent: true,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    title: 'Vibe Island 设置',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  settingsWindow.setBackgroundColor('#00000000');
  settingsWindow.setMenu(null);
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.on('ready-to-show', () => {
    presentSettingsWindow(settingsWindow);
  });
  settingsWindow.on('maximize', () => emitSettingsWindowState());
  settingsWindow.on('unmaximize', () => emitSettingsWindowState());
  settingsWindow.on('restore', () => emitSettingsWindowState());
  settingsWindow.on('closed', () => {
    trustedWebContentsViews.delete(settingsWindow?.webContents.id ?? -1);
    settingsWindow = null;
    settingsManuallyMaximized = false;
    settingsRestoreBounds = null;
    settingsDragOffset = null;
    settingsDragBounds = null;
    stopSettingsWindowDragLoop();
  });
  hardenRendererWindow(settingsWindow, 'settings');
  loadRenderer(settingsWindow, 'settings');
  return settingsWindow;
}

function loadRenderer(window: BrowserWindow, view: RendererView): void {
  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?view=${view}`);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { query: { view } });
  }
}

function hardenRendererWindow(window: BrowserWindow, view: RendererView): void {
  trustedWebContentsViews.set(window.webContents.id, view);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url, view)) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event, url) => {
    if (!isTrustedRendererUrl(url, view)) event.preventDefault();
  });
}

function isTrustedRendererUrl(rawUrl: string, view: RendererView): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.searchParams.get('view') !== view) return false;
    if (isDev && process.env.ELECTRON_RENDERER_URL) {
      const allowed = new URL(process.env.ELECTRON_RENDERER_URL);
      return url.origin === allowed.origin && url.pathname === allowed.pathname;
    }
    const rendererUrl = pathToFileURL(join(__dirname, '../renderer/index.html'));
    return url.protocol === 'file:' && normalize(fileURLToPath(url)) === normalize(fileURLToPath(rendererUrl));
  } catch {
    return false;
  }
}

function trustedIpc<TArgs extends unknown[], TResult>(
  views: RendererView | RendererView[],
  handler: IpcHandler<TArgs, TResult>
): IpcHandler<TArgs, TResult> {
  const allowedViews = Array.isArray(views) ? views : [views];
  return (event, ...args) => {
    assertTrustedIpcSender(event, allowedViews);
    return handler(event, ...args);
  };
}

function assertTrustedIpcSender(event: Electron.IpcMainInvokeEvent, allowedViews: RendererView[]): void {
  const view = trustedWebContentsViews.get(event.sender.id);
  const senderUrl = event.senderFrame?.url;
  if (!view || !allowedViews.includes(view) || !senderUrl || !isTrustedRendererUrl(senderUrl, view)) {
    throw new Error('Blocked untrusted renderer IPC call.');
  }
}

function positionIsland(animated = false): void {
  if (!islandWindow || islandWindow.isDestroyed()) return;
  const nextBounds = getIslandCanvasBounds();
  if (!animated) {
    stopIslandPositionAnimation();
    islandWindow.setBounds(nextBounds, false);
    ensureIslandAlwaysOnTop();
    return;
  }
  animateIslandBounds(nextBounds);
  ensureIslandAlwaysOnTop();
}

function setIslandExpanded(expanded: boolean): void {
  if (!islandWindow || islandWindow.isDestroyed()) return;
  islandExpanded = expanded;
  islandPeeking = false;
  if (!expanded) islandHovered = false;
  const hasActionableNotice = state.snapshot().permissions.length > 0;
  if (expanded) {
    setIslandLayout(ISLAND_EXPANDED_SIZE);
  } else if (!hasActionableNotice) {
    setIslandLayout(ISLAND_COLLAPSED_SIZE);
  }
  positionIsland();
  updateIslandMouseInteractivity();
  islandWindow.webContents.send('island:expanded', expanded);
}

function setIslandLayout(size: { width: number; height: number }): void {
  if (!islandWindow || islandWindow.isDestroyed()) return;
  const next = {
    width: ISLAND_EXPANDED_SIZE.width,
    height: clamp(Math.round(size.height), ISLAND_COLLAPSED_SIZE.height, ISLAND_EXPANDED_SIZE.height)
  };
  if (next.height > ISLAND_COLLAPSED_SIZE.height) islandPeeking = false;
  if (next.width === islandLayoutSize.width && next.height === islandLayoutSize.height) return;
  islandLayoutSize = next;
  positionIsland();
}

function setIslandPeeking(peeking: boolean): void {
  if (!islandWindow || islandWindow.isDestroyed()) return;
  const next = Boolean(peeking) && !islandExpanded && islandLayoutSize.height === ISLAND_COLLAPSED_SIZE.height;
  if (next === islandPeeking) return;
  islandPeeking = next;
  if (!next) islandHovered = false;
  positionIsland(true);
  if (next) islandWindow.webContents.send('island:peeking');
  updateIslandMouseInteractivity();
}

function updateIslandMouseInteractivity(): void {
  if (!islandWindow || islandWindow.isDestroyed()) return;
  const hasActionableNotice = state.snapshot().permissions.length > 0;
  const ignoreMouseEvents = !islandExpanded && !hasActionableNotice && !islandHovered;
  islandWindow.setIgnoreMouseEvents(ignoreMouseEvents, { forward: ignoreMouseEvents });
}

function getIslandCanvasBounds(): Electron.Rectangle {
  const display = screen.getPrimaryDisplay();
  const peekY =
    display.workArea.y - ISLAND_BAR_HEIGHT - ISLAND_SHELL_TOP_PADDING + ISLAND_PEEK_VISIBLE_HEIGHT;
  return {
    width: islandLayoutSize.width,
    height: islandLayoutSize.height,
    x: Math.round(display.workArea.x + (display.workArea.width - islandLayoutSize.width) / 2),
    y: Math.round(islandPeeking ? peekY : display.workArea.y + ISLAND_TOP_OFFSET)
  };
}

function animateIslandBounds(targetBounds: Electron.Rectangle): void {
  if (!islandWindow || islandWindow.isDestroyed()) return;
  stopIslandPositionAnimation();
  const startBounds = islandWindow.getBounds();
  const startedAt = Date.now();

  islandPositionTimer = setInterval(() => {
    if (!islandWindow || islandWindow.isDestroyed()) {
      stopIslandPositionAnimation();
      return;
    }

    const progress = clamp((Date.now() - startedAt) / ISLAND_PEEK_ANIMATION_MS, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    islandWindow.setBounds(
      {
        x: Math.round(lerp(startBounds.x, targetBounds.x, eased)),
        y: Math.round(lerp(startBounds.y, targetBounds.y, eased)),
        width: targetBounds.width,
        height: targetBounds.height
      },
      false
    );

    if (progress >= 1) {
      stopIslandPositionAnimation();
      islandWindow.setBounds(targetBounds, false);
      ensureIslandAlwaysOnTop();
    }
  }, 16);
}

function stopIslandPositionAnimation(): void {
  if (!islandPositionTimer) return;
  clearInterval(islandPositionTimer);
  islandPositionTimer = null;
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
  const iconDir = app.isPackaged ? join(process.resourcesPath, 'icons') : join(process.cwd(), 'build', 'icons');
  const icon = nativeImage.createEmpty();
  const representations = [
    { size: 16, scaleFactor: 1 },
    { size: 20, scaleFactor: 1.25 },
    { size: 24, scaleFactor: 1.5 },
    { size: 32, scaleFactor: 2 },
    { size: 48, scaleFactor: 3 },
    { size: 64, scaleFactor: 4 }
  ];

  for (const representation of representations) {
    const iconPath = join(iconDir, `vibe-island-tray-${representation.size}.png`);
    if (!existsSync(iconPath)) continue;
    icon.addRepresentation({
      scaleFactor: representation.scaleFactor,
      width: 16,
      height: 16,
      buffer: readFileSync(iconPath)
    });
  }

  if (!icon.isEmpty()) return icon;
  return nativeImage.createFromPath(join(iconDir, 'vibe-island-tray.ico'));
}

function showIsland(): void {
  if (!islandWindow || islandWindow.isDestroyed()) createIslandWindow();
  const wasPeeking = islandPeeking;
  setIslandPeeking(false);
  islandWindow?.showInactive();
  ensureIslandAlwaysOnTop();
  if (islandWindow && !islandWindow.isDestroyed()) {
    islandWindow.webContents.send('app:snapshot', state.snapshot());
  }
  if (wasPeeking) islandWindow?.webContents.send('island:show');
  if (!wasPeeking) positionIsland();
}

function scheduleIslandSurfaceRefresh(): void {
  clearIslandSurfaceRefreshTimer();
  islandSurfaceRefreshTimer = setTimeout(() => {
    islandSurfaceRefreshTimer = null;
    recreateIslandWindowForTransparency();
  }, ISLAND_TRANSPARENCY_REFRESH_DELAY_MS);
}

function clearIslandSurfaceRefreshTimer(): void {
  if (!islandSurfaceRefreshTimer) return;
  clearTimeout(islandSurfaceRefreshTimer);
  islandSurfaceRefreshTimer = null;
}

function recreateIslandWindowForTransparency(): void {
  stopIslandPositionAnimation();
  islandExpanded = false;
  islandHovered = false;
  islandPeeking = false;
  islandLayoutSize = { ...ISLAND_COLLAPSED_SIZE };

  const previous = islandWindow;
  createIslandWindow();
  if (previous && !previous.isDestroyed()) {
    previous.hide();
    previous.destroy();
  }
}

function ensureIslandAlwaysOnTop(): void {
  if (!islandWindow || islandWindow.isDestroyed()) return;
  islandWindow.setAlwaysOnTop(true, 'screen-saver');
  islandWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (islandWindow.isVisible()) islandWindow.moveTop();
}

function openSettings(): void {
  const window = createSettingsWindow();
  presentSettingsWindow(window);
  if (islandExpanded) {
    islandHovered = false;
    setIslandExpanded(false);
  }
}

function presentSettingsWindow(window: BrowserWindow | null): void {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();
  window.moveTop();
  window.focus();
  window.setAlwaysOnTop(true);
  window.setAlwaysOnTop(false);
  emitSettingsWindowState();
}

function getSettingsWindowState(): { maximized: boolean } {
  return {
    maximized: Boolean(
      settingsWindow && !settingsWindow.isDestroyed() && (settingsManuallyMaximized || settingsWindow.isMaximized())
    )
  };
}

function emitSettingsWindowState(): void {
  if (!settingsWindow || settingsWindow.isDestroyed()) return;
  settingsWindow.webContents.send('window:settings-state', getSettingsWindowState());
}

function controlSettingsWindow(action: 'close' | 'minimize' | 'zoom'): { maximized: boolean } {
  if (!settingsWindow || settingsWindow.isDestroyed()) return { maximized: false };
  if (action === 'close') {
    settingsWindow.close();
    return { maximized: false };
  }
  if (action === 'minimize') {
    settingsWindow.minimize();
    return getSettingsWindowState();
  }
  if (settingsManuallyMaximized || settingsWindow.isMaximized()) {
    restoreSettingsWindow();
  } else {
    maximizeSettingsWindowToWorkArea();
  }
  emitSettingsWindowState();
  return getSettingsWindowState();
}

function beginSettingsWindowDrag(point: { screenX: number; screenY: number; clientX: number; clientY: number }): {
  maximized: boolean;
} {
  if (!settingsWindow || settingsWindow.isDestroyed()) return { maximized: false };
  if (!(settingsManuallyMaximized || settingsWindow.isMaximized())) return getSettingsWindowState();

  const restoreBounds = getSafeSettingsRestoreBounds(settingsRestoreBounds ?? undefined);
  const currentBounds = settingsWindow.getBounds();
  const offsetX = clamp(
    Math.round((point.clientX / Math.max(1, currentBounds.width)) * restoreBounds.width),
    96,
    Math.max(96, restoreBounds.width - 96)
  );
  const offsetY = clamp(Math.round(point.clientY), 18, 72);

  settingsManuallyMaximized = false;
  settingsRestoreBounds = null;
  settingsDragOffset = { x: offsetX, y: offsetY };
  settingsDragBounds = {
    ...restoreBounds,
    x: Math.round(point.screenX - offsetX),
    y: Math.round(point.screenY - offsetY)
  };
  if (settingsWindow.isMaximized()) settingsWindow.unmaximize();
  settingsWindow.setBounds(settingsDragBounds, false);
  startSettingsWindowDragLoop();
  emitSettingsWindowState();
  return getSettingsWindowState();
}

function moveSettingsWindowDrag(point: { screenX: number; screenY: number }): void {
  if (!settingsWindow || settingsWindow.isDestroyed() || !settingsDragOffset || !settingsDragBounds) return;
  settingsDragBounds = {
    ...settingsDragBounds,
    x: Math.round(point.screenX - settingsDragOffset.x),
    y: Math.round(point.screenY - settingsDragOffset.y)
  };
  settingsWindow.setBounds(settingsDragBounds, false);
}

function endSettingsWindowDrag(): void {
  settingsDragOffset = null;
  settingsDragBounds = null;
  stopSettingsWindowDragLoop();
}

function startSettingsWindowDragLoop(): void {
  stopSettingsWindowDragLoop();
  settingsDragTimer = setInterval(updateSettingsWindowDragPosition, 16);
  settingsDragTimer.unref?.();
}

function stopSettingsWindowDragLoop(): void {
  if (!settingsDragTimer) return;
  clearInterval(settingsDragTimer);
  settingsDragTimer = null;
}

function updateSettingsWindowDragPosition(): void {
  if (!settingsWindow || settingsWindow.isDestroyed() || !settingsDragOffset || !settingsDragBounds) {
    stopSettingsWindowDragLoop();
    return;
  }
  const cursor = screen.getCursorScreenPoint();
  const nextX = Math.round(cursor.x - settingsDragOffset.x);
  const nextY = Math.round(cursor.y - settingsDragOffset.y);
  if (nextX === settingsDragBounds.x && nextY === settingsDragBounds.y) return;
  settingsDragBounds = {
    ...settingsDragBounds,
    x: nextX,
    y: nextY
  };
  settingsWindow.setBounds(settingsDragBounds, false);
}

function maximizeSettingsWindowToWorkArea(): void {
  if (!settingsWindow || settingsWindow.isDestroyed()) return;
  const currentBounds = settingsWindow.getBounds();
  const display = screen.getDisplayMatching(currentBounds);
  if (!isSameBounds(currentBounds, display.workArea)) {
    settingsRestoreBounds = getSafeSettingsRestoreBounds(currentBounds);
  }
  settingsManuallyMaximized = true;
  if (settingsWindow.isMaximized()) settingsWindow.unmaximize();
  settingsWindow.setBounds(display.workArea, true);
}

function restoreSettingsWindow(): void {
  if (!settingsWindow || settingsWindow.isDestroyed()) return;
  if (settingsWindow.isMaximized()) settingsWindow.unmaximize();
  settingsManuallyMaximized = false;
  if (settingsRestoreBounds) {
    settingsWindow.setBounds(getSafeSettingsRestoreBounds(settingsRestoreBounds), true);
  }
  settingsRestoreBounds = null;
}

function isSameBounds(a: Electron.Rectangle, b: Electron.Rectangle): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function getSafeSettingsRestoreBounds(preferred?: Electron.Rectangle): Electron.Rectangle {
  const reference = preferred ?? settingsWindow?.getBounds() ?? screen.getPrimaryDisplay().workArea;
  const display = screen.getDisplayMatching(reference);
  const maxWidth = Math.max(520, Math.min(SETTINGS_NORMAL_SIZE.width, display.workArea.width - 96));
  const maxHeight = Math.max(420, Math.min(SETTINGS_NORMAL_SIZE.height, display.workArea.height - 96));
  const minWidth = Math.min(SETTINGS_MIN_SIZE.width, maxWidth);
  const minHeight = Math.min(SETTINGS_MIN_SIZE.height, maxHeight);
  const width = clamp(Math.round(preferred?.width ?? SETTINGS_NORMAL_SIZE.width), minWidth, maxWidth);
  const height = clamp(Math.round(preferred?.height ?? SETTINGS_NORMAL_SIZE.height), minHeight, maxHeight);
  const x = clamp(
    Math.round(preferred?.x ?? display.workArea.x + (display.workArea.width - width) / 2),
    display.workArea.x,
    display.workArea.x + Math.max(0, display.workArea.width - width)
  );
  const y = clamp(
    Math.round(preferred?.y ?? display.workArea.y + (display.workArea.height - height) / 2),
    display.workArea.y,
    display.workArea.y + Math.max(0, display.workArea.height - height)
  );
  return { x, y, width, height };
}

function registerIpc(paths: ReturnType<typeof makeStoragePaths>): void {
  ipcMain.handle('app:snapshot', trustedIpc(['island', 'settings'], () => state.snapshot()));
  ipcMain.handle('island:set-expanded', trustedIpc('island', (_event, expanded: boolean) => setIslandExpanded(Boolean(expanded))));
  ipcMain.handle('island:set-hovered', trustedIpc('island', (_event, hovered: boolean) => {
    if (!islandWindow || islandWindow.isDestroyed()) return;
    islandHovered = Boolean(hovered);
    updateIslandMouseInteractivity();
  }));
  ipcMain.handle('island:set-peeking', trustedIpc('island', (_event, peeking: boolean) => {
    setIslandPeeking(Boolean(peeking));
  }));
  ipcMain.handle('island:set-layout', trustedIpc('island', (_event, size: { width: number; height: number }) => {
    setIslandLayout(size);
  }));
  ipcMain.handle('notification:clear-active', trustedIpc('island', () => {
    clearActiveNotification();
    broadcastSnapshot();
  }));
  ipcMain.handle('window:settings', trustedIpc('island', openSettings));
  ipcMain.handle('window:settings-control', trustedIpc('settings', (_event, action: 'close' | 'minimize' | 'zoom') =>
    controlSettingsWindow(action)
  ));
  ipcMain.handle('window:settings-state', trustedIpc('settings', getSettingsWindowState));
  ipcMain.handle('window:settings-drag-start', trustedIpc('settings', (_event, point) => beginSettingsWindowDrag(point)));
  ipcMain.handle('window:settings-drag-move', trustedIpc('settings', (_event, point) => moveSettingsWindowDrag(point)));
  ipcMain.handle('window:settings-drag-end', trustedIpc('settings', endSettingsWindowDrag));
  ipcMain.handle('shell:open-path', trustedIpc('settings', (_event, path: string) => openTrustedPath(path)));

  ipcMain.handle('config:update', trustedIpc('settings', async (_event, partial: Partial<AppConfig>) => {
    const previous = state.getConfig();
    const next = mergeConfig(previous, partial);
    state.setConfig(next);
    if (next.notificationStrategy === 'silent') {
      clearActiveNotification();
    } else if (!next.showCodexReplies && state.getNotification()?.metadata?.source === 'codex-reply-watcher') {
      clearActiveNotification();
    }
    app.setLoginItemSettings({ openAtLogin: next.startAtLogin });
    updateIslandMouseInteractivity();
    await saveConfig(paths, next);
    await refreshRuntimeServices(previous, next);
    broadcastSnapshot();
    return next;
  }));

  ipcMain.handle('agents:install-hook', trustedIpc('settings', async (_event, agent: AgentId) => {
    const result = await installHook(agent, helperPath(), getUserHomePath());
    await refreshAgents();
    broadcastSnapshot();
    return result;
  }));

  ipcMain.handle('agents:uninstall-hook', trustedIpc('settings', async (_event, agent: AgentId) => {
    const result = await uninstallHook(agent, getUserHomePath());
    await refreshAgents();
    broadcastSnapshot();
    return result;
  }));

  ipcMain.handle('agents:toggle-hook', trustedIpc('settings', async (_event, agent: AgentId) => {
    const agents = await refreshAgents();
    const current = agents.find((item) => item.id === agent);
    if (!current) throw new Error(`Unknown agent: ${agent}`);
    const result = current.hookInstalled
      ? await uninstallHook(agent, getUserHomePath())
      : await installHook(agent, helperPath(), getUserHomePath());
    await refreshAgents();
    broadcastSnapshot();
    return result;
  }));

  ipcMain.handle('agents:refresh', trustedIpc('settings', async () => {
    const agents = await refreshAgents();
    broadcastSnapshot();
    return agents;
  }));

  ipcMain.handle('permission:respond', trustedIpc('island', async (_event, response: PermissionResponse) => {
    resolvePermission(response);
    broadcastSnapshot();
  }));

  ipcMain.handle('jump:workspace', trustedIpc('island', async () => ({
    ok: false,
    message: '跳转功能已取消。'
  })));

  ipcMain.handle('agents:install-claude-status-line', trustedIpc('settings', async () => {
    const result = await installClaudeStatusLine(
      `node "${statusLinePath().replace(/"/g, '\\"')}"`
    );
    broadcastSnapshot();
    return result;
  }));

  ipcMain.handle('agents:uninstall-claude-status-line', trustedIpc('settings', async () => {
    const result = await uninstallClaudeStatusLine();
    broadcastSnapshot();
    return result;
  }));

  ipcMain.handle('diagnostics:refresh', trustedIpc('settings', async () => {
    await refreshDiagnostics();
    broadcastSnapshot();
    return state.snapshot().diagnostics;
  }));

  ipcMain.handle('updates:check', trustedIpc('settings', async () => {
    const next = {
      ...state.getConfig(),
      update: await checkForUpdates(state.getConfig().update)
    };
    state.setConfig(next);
    await saveConfig(paths, next);
    broadcastSnapshot();
    return next.update;
  }));

  ipcMain.handle('dev:sample-event', trustedIpc('settings', async (_event, agent: AgentId) => {
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
  }));
}

function openTrustedPath(path: string): Promise<string> {
  if (typeof path !== 'string' || !isKnownConfigPath(path)) {
    throw new Error('Blocked opening an unknown local path.');
  }
  return shell.openPath(path);
}

function isKnownConfigPath(path: string): boolean {
  const target = normalize(path);
  const allowed = [
    storagePaths?.config,
    storagePaths?.events,
    storagePaths?.runtime,
    storagePaths?.sessions,
    ...state.snapshot().agents.flatMap((agent) => [agent.configPath, agent.pluginPath])
  ].filter((item): item is string => typeof item === 'string' && item.length > 0);
  return allowed.some((item) => normalize(item) === target);
}

async function recordEvent(event: NormalizedEvent): Promise<void> {
  if (eventDeduper.shouldDrop(event)) return;
  const paths = makeStoragePaths(app.getPath('appData'));
  const sessions = state.applyEvent(event);
  await Promise.all([appendEvent(paths, event), saveSessions(paths, sessions)]);
  const config = state.getConfig();
  if (shouldClearCompletedIslandNotification(state.getNotification(), event)) {
    clearActiveNotification();
  }
  if (shouldPromoteWithStrategy(event, config.notificationStrategy)) {
    promoteIslandNotification(event);
  }
  if (config.notifications && config.notificationStrategy !== 'silent' && shouldShowSystemNotification(event)) {
    new Notification({ title: event.title, body: event.message }).show();
  }
  if (config.sound.enabled && shouldShowSystemNotification(event)) {
    playConfiguredSound(config.sound);
  }
  remoteServer?.pushEvent(event);
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
  debugPermission('wait:start', {
    id: request.id,
    action: request.action,
    kind: request.kind,
    sessionId: request.sessionId,
    currentPermissions: state.snapshot().permissions.length,
    expanded: islandExpanded,
    hovered: islandHovered
  });
  clearActiveNotification();
  state.addPermission(request);
  debugPermission('wait:after-add', {
    id: request.id,
    permissions: state.snapshot().permissions.map((item) => item.id)
  });
  updateIslandMouseInteractivity();
  broadcastSnapshot();
  showIsland();
  if (islandExpanded) {
    islandExpanded = false;
    islandPeeking = false;
    islandHovered = false;
    positionIsland();
    updateIslandMouseInteractivity();
    islandWindow?.webContents.send('island:expanded', false);
  }
  const config = state.getConfig();
  if (config.notifications && config.notificationStrategy !== 'silent') {
    new Notification({ title: request.action, body: request.command }).show();
  }
  playConfiguredSound(config.sound);
  const remoteResolveToken = makeRemoteToken();

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const response = createPermissionTimeoutResponse(request.id);
      debugPermission('wait:timeout', {
        id: request.id
      });
      resolvePermission(response);
    }, getPermissionNoticeTimeoutMs(request.timeoutMs));

    permissionWaiters.set(request.id, { resolve, timer, remoteResolveToken });
    debugPermission('wait:armed', {
      id: request.id,
      timeoutMs: getPermissionNoticeTimeoutMs(request.timeoutMs),
      waiterCount: permissionWaiters.size
    });
    remoteServer?.pushEvent({
      ...request,
      metadata: {
        ...request.metadata,
        remoteResolveToken
      }
    });
  });
}

function resolveRemotePermission(response: RemotePermissionResponse): boolean {
  const waiter = permissionWaiters.get(response.id);
  if (!waiter || response.remoteResolveToken !== waiter.remoteResolveToken) return false;
  resolvePermission(response);
  return true;
}

function resolvePermission(response: PermissionResponse): boolean {
  debugPermission('resolve:start', {
    id: response.id,
    decision: response.decision,
    pendingBefore: state.snapshot().permissions.map((item) => item.id)
  });
  const waiter = permissionWaiters.get(response.id);
  if (!waiter) {
    debugPermission('resolve:ignored', {
      id: response.id,
      waiterCount: permissionWaiters.size
    });
    return false;
  }
  const pending = state.snapshot().permissions.some((request) => request.id === response.id);
  if (!pending) {
    permissionWaiters.delete(response.id);
    debugPermission('resolve:ignored-not-pending', {
      id: response.id,
      waiterCount: permissionWaiters.size
    });
    return false;
  }
  if (waiter) {
    clearTimeout(waiter.timer);
    waiter.resolve(response);
    permissionWaiters.delete(response.id);
  }
  state.resolvePermission(response);
  updateIslandMouseInteractivity();
  broadcastSnapshot();
  debugPermission('resolve:done', {
    id: response.id,
    pendingAfter: state.snapshot().permissions.map((item) => item.id),
    waiterCount: permissionWaiters.size
  });
  return true;
}

function broadcastSnapshot(): void {
  const snapshot = state.snapshot();
  if (snapshot.permissions.length > 0) {
    debugPermission('snapshot:broadcast', {
      permissions: snapshot.permissions.map((item) => item.id),
      notification: snapshot.notification?.id ?? null,
      windowCount: BrowserWindow.getAllWindows().length
    });
  }
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('app:snapshot', snapshot);
  }
}

function mergeConfig(current: AppConfig, partial: Partial<AppConfig>): AppConfig {
  return {
    ...current,
    ...partial,
    sound: {
      ...current.sound,
      ...(partial.sound ?? {})
    },
    experiments: {
      ...current.experiments,
      ...(partial.experiments ?? {})
    },
    update: {
      ...current.update,
      ...(partial.update ?? {})
    },
    remote: {
      ...current.remote,
      ...(partial.remote ?? {})
    }
  };
}

async function refreshRuntimeServices(previous: AppConfig, config: AppConfig): Promise<void> {
  if (previous.experiments.codexAppServer !== config.experiments.codexAppServer) {
    codexAppServer?.close();
    codexAppServer = startCodexAppServerForConfig(config);
  }

  const remoteChanged =
    previous.remote.enabled !== config.remote.enabled || previous.remote.token !== config.remote.token;
  if (remoteChanged && remoteServer) {
    await remoteServer.close();
    remoteServer = null;
  }
  if (remoteChanged && config.remote.enabled) {
    if (!config.remote.token) {
      config.remote.token = makeRemoteToken();
      state.setConfig(config);
      await saveConfig(storagePaths, config);
    }
    remoteServer = await startRemoteServer({
      token: config.remote.token,
      onResolution: resolveRemotePermission
    });
  }

  state.setUsage(await collectUsage(app.getPath('home')));
  if (config.experiments.sessionDiscovery) {
    state.mergeDiscoveredSessions(await discoverSessions(app.getPath('home')));
  }
  refreshDiagnostics();
}

function startCodexAppServerForConfig(config: AppConfig): CodexAppServerCoordinator | null {
  return startCodexAppServer({
    enabled: config.experiments.codexAppServer,
    onEvent: (event) => {
      void recordEvent(event);
    },
    onError: (message) => {
      lastError = message;
      refreshDiagnostics();
    }
  });
}

function refreshDiagnostics(): void {
  state.setDiagnostics(
    makeDiagnostics({
      runtime: ipcServer?.runtime ?? null,
      runtimePath: storagePaths?.runtime,
      hookHelperPath: helperPath(),
      remoteUrl: remoteServer?.url,
      lastError
    })
  );
}

function makeRemoteToken(): string {
  return randomBytes(24).toString('hex');
}

function debugPermission(stage: string, data: Record<string, unknown>): void {
  try {
    if (!storagePaths) return;
    appendFileSync(
      join(storagePaths.dir, 'permission-debug.log'),
      `${new Date().toISOString()} ${stage} ${JSON.stringify(data)}\n`,
      'utf8'
    );
  } catch {
    // Ignore debug logging failures.
  }
}

function helperPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'scripts', 'vibe-island-hook.mjs');
  return join(process.cwd(), 'scripts', 'vibe-island-hook.mjs');
}

async function refreshManagedAgentHooks(home: string, helperCommand: string): Promise<void> {
  const detectedAgents = await detectAgents(home, helperCommand);
  for (const agent of detectedAgents) {
    if (!agent.hookInstalled || agent.id === 'unknown') continue;
    try {
      await installHook(agent.id, helperCommand, home);
    } catch (error) {
      lastError = `Failed to refresh managed ${agent.name} hook: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  }
}

function statusLinePath(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'scripts', 'vibe-island-statusline.mjs');
  return join(process.cwd(), 'scripts', 'vibe-island-statusline.mjs');
}

function getUserHomePath(): string {
  return process.env.USERPROFILE ?? app.getPath('home');
}

async function refreshAgents(): Promise<ReturnType<typeof state.snapshot>['agents']> {
  const agents = await detectAgents(getUserHomePath(), helperPath());
  state.setAgents(agents);
  return agents;
}

function summarizeReply(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= 80) return compact;
  return `${compact.slice(0, 79)}...`;
}
