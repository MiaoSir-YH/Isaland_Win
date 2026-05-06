import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  Bug,
  Check,
  ChevronDown,
  Circle,
  ExternalLink,
  FlaskConical,
  Info,
  Keyboard,
  Layers,
  Languages,
  MessageCircle,
  Palette,
  PlugZap,
  Power,
  Radio,
  RefreshCw,
  Server,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Terminal,
  Volume2
} from 'lucide-react';
import type {
  AgentDescriptor,
  AgentId,
  AgentSession,
  AgentUsage,
  AppConfig,
  AppSnapshot,
  AccentTheme,
  AppearanceTheme,
  NormalizedEvent,
  PermissionDecision,
  PermissionRequest
} from '@shared/types';
import {
  getIslandAttentionReason,
  shouldAutoClearIslandNotification,
  type IslandAttentionReason
} from '@shared/attention';
import { getPermissionNoticeTimeoutMs } from '@shared/permission';
import './styles.css';

const ISLAND_NOTIFICATION_PROGRESS_MS = 10000;
const ISLAND_BAR_CANVAS_HEIGHT = 68;
const ISLAND_NOTICE_CANVAS_HEIGHT = 220;
const ISLAND_CANVAS_WIDTH = 560;
const ISLAND_VISUAL_MAX_WIDTH = 520;
const ISLAND_PANEL_CANVAS_HEIGHT = 372;
const ISLAND_PANEL_VISUAL_HEIGHT = 296;
const ISLAND_PANEL_EXPAND_MS = 300;
const ISLAND_PANEL_COLLAPSE_MS = 280;
const ISLAND_NOTICE_COLLAPSE_MS = 240;
const ISLAND_LAYOUT_SHRINK_DELAY_MS = 0;
const ISLAND_CONTENT_PULSE_MS = 380;
const JUMP_FEEDBACK_VISIBLE_MS = 3600;
const ISLAND_AUTO_COLLAPSE_IDLE_MS = 8000;
const ISLAND_AUTO_PEEK_IDLE_MS = 5000;
const ISLAND_PEEK_REVEAL_HOVER_MS = 80;
const ISLAND_PEEK_DOT_SIZE = 44;
const ISLAND_PEEK_COMPRESS_MS = 320;
const ISLAND_PEEK_REVEAL_TRAVEL_MS = 200;

type IslandPeekPhase = 'visible' | 'compressing' | 'peeking' | 'revealing';
type IslandPresentationPhase =
  | 'collapsed'
  | 'expanding'
  | 'expanded'
  | 'collapsing'
  | 'permissionNotice'
  | 'peekCompressing'
  | 'peeking'
  | 'peekRevealing';

type CollapseReason =
  | 'manual-toggle'
  | 'outside-pointer'
  | 'window-blur'
  | 'settings'
  | 'auto-idle'
  | 'permission-start'
  | 'notification-clear'
  | 'escape';

const islandMotion = {
  micro: { duration: 0.12, ease: [0.16, 1, 0.3, 1] },
  content: { duration: 0.18, ease: [0.16, 1, 0.3, 1] },
  widthSpring: { type: 'spring', stiffness: 620, damping: 54, mass: 0.78 },
  peekWidth: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
  extensionSpring: { type: 'spring', stiffness: 460, damping: 42, mass: 0.82 },
  panelGrow: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
  panelShrink: { duration: 0.24, ease: [0.4, 0, 0.2, 1] },
  panelContentIn: { duration: 0.18, ease: [0.16, 1, 0.3, 1], delay: 0.07 },
  panelContentOut: { duration: 0.1, ease: [0.4, 0, 0.2, 1] }
} as const;

type SettingsSectionId =
  | 'hooks'
  | 'usage'
  | 'preferences'
  | 'shortcuts'
  | 'appearance'
  | 'permissions'
  | 'diagnostics'
  | 'advanced'
  | 'events'
  | 'about';

type Locale = AppConfig['language'];

const settingsSections: Array<{ id: SettingsSectionId; icon: JSX.Element }> = [
  { id: 'hooks', icon: <Activity size={16} /> },
  { id: 'usage', icon: <BarChart3 size={16} /> },
  { id: 'preferences', icon: <Settings size={16} /> },
  { id: 'shortcuts', icon: <Keyboard size={16} /> },
  { id: 'appearance', icon: <Palette size={16} /> },
  { id: 'permissions', icon: <ShieldAlert size={16} /> },
  { id: 'diagnostics', icon: <Bug size={16} /> },
  { id: 'advanced', icon: <SlidersHorizontal size={16} /> },
  { id: 'events', icon: <Terminal size={16} /> },
  { id: 'about', icon: <Info size={16} /> }
];

const appearanceModeIds: AppearanceTheme[] = ['system', 'light', 'dark'];

const accentThemes: Array<{ id: AccentTheme; color: string }> = [
  { id: 'classic', color: '#070b18' },
  { id: 'teal', color: '#14b8a6' },
  { id: 'blue', color: '#3b82f6' },
  { id: 'violet', color: '#8b5cf6' },
  { id: 'orange', color: '#f97316' },
  { id: 'graphite', color: '#64748b' }
];

const soundNames: Array<{ id: AppConfig['sound']['name']; label: string }> = [
  { id: 'asterisk', label: 'Asterisk' },
  { id: 'beep', label: 'Beep' },
  { id: 'exclamation', label: 'Exclamation' },
  { id: 'hand', label: 'Hand' },
  { id: 'question', label: 'Question' }
];

const agentLabels: Record<AgentId, string> = {
  codex: 'Codex',
  claude: 'Claude',
  gemini: 'Gemini',
  opencode: 'OpenCode',
  cursor: 'Cursor',
  kimi: 'Kimi',
  qoder: 'Qoder',
  qwen: 'Qwen',
  factory: 'Factory',
  codebuddy: 'CodeBuddy',
  unknown: 'Agent'
};

const dictionaries = {
  'zh-CN': {
    loading: '载入中',
    sections: {
      hooks: ['Agent Hooks', '安装与测试'],
      usage: ['Usage', '额度与刷新'],
      preferences: ['偏好', '通知与跳转'],
      shortcuts: ['Shortcuts', '快捷操作'],
      appearance: ['外观', '主题与颜色'],
      permissions: ['权限提示', '审批队列'],
      diagnostics: ['Diagnostics', '运行诊断'],
      advanced: ['Advanced', '更新与实验'],
      events: ['最近事件', '运行记录'],
      about: ['About', '版本与运行时']
    },
    labels: {
      console: 'Windows 控制台',
      localIpcMissing: '本地 IPC 未启动',
      permissions: '权限提示',
      configMissing: '未检测到本机配置目录',
      install: '安装',
      uninstall: '卸载',
      claudeStatusLine: 'Claude statusLine',
      claudeStatusLineDescription: '安装受管状态栏桥接；检测到用户自定义配置时不会覆盖。',
      preferences: '偏好',
      language: '语言',
      startAtLogin: '开机启动',
      notifications: '系统通知',
      notificationStrategy: '提示策略',
      focused: '克制',
      realtime: '实时',
      silent: '静默',
      codexReplies: 'Codex 回复提示',
      autoPeek: '空闲自动收起',
      clickThrough: '折叠态点击穿透',
      sound: '声音提醒',
      soundName: '提示音',
      volume: '音量',
      jumpTarget: '跳转目标',
      workspace: '终端优先',
      terminal: 'Windows Terminal',
      precise: '精确跳转',
      none: '关闭',
      noUsage: '暂无用量缓存',
      noPending: '无待处理请求',
      refresh: '刷新',
      diagnosticsRefreshed: '诊断信息已刷新。',
      autoUpdate: '自动更新',
      updateChannel: '更新通道',
      checkUpdates: '检查更新',
      remoteApproval: '远程审批',
      remoteToken: '远程 Token',
      tokenPlaceholder: '自动生成',
      remoteWaiting: '远程服务等待运行时',
      remoteDisabled: '远程服务未启用',
      recentEvents: '最近事件',
      unavailable: 'Unavailable',
      reset: 'Reset',
      updated: '更新',
      jumping: '正在跳转...',
      jumpTimeout: '跳转失败：请求超时。'
    },
    appearance: {
      system: ['跟随系统', '自动匹配 Windows'],
      light: ['浅色', '明亮玻璃面板'],
      dark: ['深色', '低亮度控制台']
    },
    accents: {
      classic: '原始',
      teal: '青色',
      blue: '蓝色',
      violet: '紫色',
      orange: '橙色',
      graphite: '石墨'
    }
  },
  'en-US': {
    loading: 'Loading',
    sections: {
      hooks: ['Agent Hooks', 'Install and test'],
      usage: ['Usage', 'Limits and refresh'],
      preferences: ['Preferences', 'Notifications and jump'],
      shortcuts: ['Shortcuts', 'Quick actions'],
      appearance: ['Appearance', 'Theme and colors'],
      permissions: ['Permissions', 'Approval queue'],
      diagnostics: ['Diagnostics', 'Runtime health'],
      advanced: ['Advanced', 'Updates and experiments'],
      events: ['Recent Events', 'Runtime log'],
      about: ['About', 'Version and runtime']
    },
    labels: {
      console: 'Windows Console',
      localIpcMissing: 'Local IPC is not running',
      permissions: 'permission prompts',
      configMissing: 'Local config directory was not detected',
      install: 'Install',
      uninstall: 'Uninstall',
      claudeStatusLine: 'Claude statusLine',
      claudeStatusLineDescription: 'Install a managed status line bridge; existing custom status lines are not overwritten.',
      preferences: 'Preferences',
      language: 'Language',
      startAtLogin: 'Start at login',
      notifications: 'System notifications',
      notificationStrategy: 'Notification strategy',
      focused: 'Focused',
      realtime: 'Realtime',
      silent: 'Silent',
      codexReplies: 'Codex reply alerts',
      autoPeek: 'Auto-hide when idle',
      clickThrough: 'Click-through when collapsed',
      sound: 'Sound alerts',
      soundName: 'Sound',
      volume: 'Volume',
      jumpTarget: 'Jump target',
      workspace: 'Terminal first',
      terminal: 'Windows Terminal',
      precise: 'Precise jump',
      none: 'Disabled',
      noUsage: 'No usage cache',
      noPending: 'No pending requests',
      refresh: 'Refresh',
      diagnosticsRefreshed: 'Diagnostics refreshed.',
      autoUpdate: 'Automatic updates',
      updateChannel: 'Update channel',
      checkUpdates: 'Check for updates',
      remoteApproval: 'Remote approval',
      remoteToken: 'Remote token',
      tokenPlaceholder: 'Auto generated',
      remoteWaiting: 'Remote service is waiting for runtime',
      remoteDisabled: 'Remote service is disabled',
      recentEvents: 'Recent Events',
      unavailable: 'Unavailable',
      reset: 'Reset',
      updated: 'Updated',
      jumping: 'Jumping...',
      jumpTimeout: 'Jump failed: request timed out.'
    },
    appearance: {
      system: ['System', 'Match Windows'],
      light: ['Light', 'Bright glass panels'],
      dark: ['Dark', 'Low-brightness console']
    },
    accents: {
      classic: 'Classic',
      teal: 'Teal',
      blue: 'Blue',
      violet: 'Violet',
      orange: 'Orange',
      graphite: 'Graphite'
    }
  }
} satisfies Record<
  Locale,
  {
    loading: string;
    sections: Record<SettingsSectionId, [string, string]>;
    labels: Record<string, string>;
    appearance: Record<AppearanceTheme, [string, string]>;
    accents: Record<AccentTheme, string>;
  }
>;

function getDictionary(locale: Locale) {
  return dictionaries[locale] ?? dictionaries['zh-CN'];
}

function App(): JSX.Element {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const view = new URLSearchParams(window.location.search).get('view') === 'settings' ? 'settings' : 'island';

  useEffect(() => {
    let mounted = true;
    void window.vibeIsland.getSnapshot().then((next) => {
      if (mounted) setSnapshot(next);
    });
    const unsubscribe = window.vibeIsland.onSnapshot(setSnapshot);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  if (!snapshot) return <div className={`app-shell ${view}`}>{dictionaries['zh-CN'].loading}</div>;
  return view === 'settings' ? <SettingsView snapshot={snapshot} /> : <IslandView snapshot={snapshot} />;
}

function IslandView({ snapshot }: { snapshot: AppSnapshot }): JSX.Element {
  const [presentationPhase, setPresentationPhase] = useState<IslandPresentationPhase>('collapsed');
  const cardRef = useRef<HTMLElement | null>(null);
  const barRef = useRef<HTMLButtonElement | null>(null);
  const islandLayoutRef = useRef({ width: ISLAND_CANVAS_WIDTH, height: ISLAND_BAR_CANVAS_HEIGHT });
  const layoutTimerRef = useRef<number | null>(null);
  const presentationTimerRef = useRef<number | null>(null);
  const autoCollapseTimerRef = useRef<number | null>(null);
  const autoPeekTimerRef = useRef<number | null>(null);
  const peekRevealTimerRef = useRef<number | null>(null);
  const peekTransitionTimerRef = useRef<number | null>(null);
  const contentPulseTimerRef = useRef<number | null>(null);
  const jumpStatusTimerRef = useRef<number | null>(null);
  const previousTextKeyRef = useRef<string | null>(null);
  const previousPermissionIdRef = useRef<string | undefined>(undefined);
  const previousNotificationIdRef = useRef<string | null>(null);
  const lastActivityAtRef = useRef(Date.now());
  const interactionHoldRef = useRef(false);
  const peekingRef = useRef(false);
  const presentationPhaseRef = useRef<IslandPresentationPhase>('collapsed');
  const permissionRef = useRef<PermissionRequest | undefined>(undefined);
  const idlePeekEligibleRef = useRef(false);
  const [contentChanging, setContentChanging] = useState(false);
  const [jumpStatus, setJumpStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const dictionary = getDictionary(snapshot.config.language);
  const visibleSessions = snapshot.sessions.filter((session) => !isLowSignalSession(session));
  const active = visibleSessions[0];
  const jumpTarget = active ? { sessionId: active.id, workspace: active.workspace } : undefined;
  const notification = snapshot.notification;
  const permission = snapshot.permissions[0];
  permissionRef.current = permission;
  const displayNotification = getDisplayNotification(notification);
  const mirroredPrompt = permission ? null : getMirroredPromptNotification(displayNotification);
  const tone = getIslandTone(permission, mirroredPrompt, displayNotification, active);
  const workspaceLabel = active?.title ?? (displayNotification?.workspace ? getWorkspaceName(displayNotification.workspace) : undefined);
  const primaryText = getIslandPrimaryText(permission, mirroredPrompt, displayNotification, active, workspaceLabel);
  const secondaryText = getIslandSecondaryText(permission, mirroredPrompt, displayNotification, active);
  const islandWidth = estimateIslandWidth(primaryText, secondaryText);
  const panelMounted = isPanelPresentationPhase(presentationPhase);
  const panelSettled = presentationPhase === 'expanded';
  const expanded = panelMounted;
  const peekPhase = getPeekPhaseFromPresentation(presentationPhase);
  const peekVisualActive = isPeekPresentationPhase(presentationPhase);
  const permissionNoticeVisible =
    (Boolean(permission) || Boolean(mirroredPrompt)) && !panelMounted && !peekVisualActive;
  const islandCardWidth = panelMounted ? ISLAND_VISUAL_MAX_WIDTH : islandWidth;
  const islandVisualWidth = peekVisualActive ? ISLAND_PEEK_DOT_SIZE : islandCardWidth;
  const islandWidthTransition = peekVisualActive ? islandMotion.peekWidth : islandMotion.widthSpring;
  const textKey = permission?.id ?? mirroredPrompt?.id ?? displayNotification?.id ?? `${primaryText}:${secondaryText}`;
  const countdown = getIslandCountdown(permission, mirroredPrompt, displayNotification);
  const islandLayout = getIslandLayout(presentationPhase, Boolean(permission || mirroredPrompt));
  const autoPeekEnabled = snapshot.config.autoPeekIsland ?? true;
  const idlePeekEligible =
    autoPeekEnabled &&
    !displayNotification &&
    !permission &&
    !isSessionRunning(active);
  idlePeekEligibleRef.current = idlePeekEligible;
  const canAutoPeek = idlePeekEligible && presentationPhase === 'collapsed';
  const animationState = getIslandAnimationState({
    active,
    notification: displayNotification,
    presentationPhase,
    permission,
    mirroredPrompt,
    tone
  });
  const statusIconKey = `${tone}-${permission?.id ?? mirroredPrompt?.id ?? displayNotification?.id ?? active?.status ?? 'idle'}`;

  async function requestJump(target?: string | { sessionId?: string; workspace?: string }): Promise<void> {
    setJumpStatus({ tone: 'success', message: dictionary.labels.jumping });
    if (jumpStatusTimerRef.current) {
      window.clearTimeout(jumpStatusTimerRef.current);
      jumpStatusTimerRef.current = null;
    }
    try {
      const result = await withTimeout(window.vibeIsland.jumpWorkspace(target), 5000, {
        ok: false,
        message: dictionary.labels.jumpTimeout
      });
      setJumpStatus({
        tone: result.ok ? 'success' : 'error',
        message: result.message
      });
      jumpStatusTimerRef.current = window.setTimeout(() => {
        setJumpStatus(null);
        jumpStatusTimerRef.current = null;
      }, JUMP_FEEDBACK_VISIBLE_MS);
    } catch (error) {
      setJumpStatus({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
      jumpStatusTimerRef.current = window.setTimeout(() => {
        setJumpStatus(null);
        jumpStatusTimerRef.current = null;
      }, JUMP_FEEDBACK_VISIBLE_MS);
    }
  }

  const setPresentationPhaseState = useCallback((phase: IslandPresentationPhase) => {
    presentationPhaseRef.current = phase;
    setPresentationPhase(phase);
  }, []);

  const clearPresentationTimer = useCallback(() => {
    if (presentationTimerRef.current) {
      window.clearTimeout(presentationTimerRef.current);
      presentationTimerRef.current = null;
    }
  }, []);

  const clearAutoCollapseTimer = useCallback(() => {
    if (autoCollapseTimerRef.current) {
      window.clearTimeout(autoCollapseTimerRef.current);
      autoCollapseTimerRef.current = null;
    }
  }, []);

  const clearAutoPeekTimer = useCallback(() => {
    if (autoPeekTimerRef.current) {
      window.clearTimeout(autoPeekTimerRef.current);
      autoPeekTimerRef.current = null;
    }
  }, []);

  const clearPeekRevealTimer = useCallback(() => {
    if (peekRevealTimerRef.current) {
      window.clearTimeout(peekRevealTimerRef.current);
      peekRevealTimerRef.current = null;
    }
  }, []);

  const clearPeekTransitionTimer = useCallback(() => {
    if (peekTransitionTimerRef.current) {
      window.clearTimeout(peekTransitionTimerRef.current);
      peekTransitionTimerRef.current = null;
    }
  }, []);

  const setIslandPeekingState = useCallback(
    (next: boolean, options?: { hovered?: boolean }) => {
      const hovered = Boolean(options?.hovered);
      clearPeekTransitionTimer();

      if (next) {
        if (peekingRef.current || presentationPhaseRef.current !== 'collapsed') return;
        setPresentationPhaseState('peekCompressing');
        peekTransitionTimerRef.current = window.setTimeout(() => {
          peekTransitionTimerRef.current = null;
          if (presentationPhaseRef.current !== 'peekCompressing') return;
          peekingRef.current = true;
          setPresentationPhaseState('peeking');
          void window.vibeIsland.setIslandPeeking(true);
        }, ISLAND_PEEK_COMPRESS_MS);
        return;
      }

      if (presentationPhaseRef.current === 'peekCompressing') {
        setPresentationPhaseState(permissionRef.current ? 'permissionNotice' : 'collapsed');
        return;
      }

      if (!peekingRef.current && !isPeekPresentationPhase(presentationPhaseRef.current)) {
        if (hovered) void window.vibeIsland.setIslandHovered(true);
        return;
      }

      setPresentationPhaseState('peekRevealing');
      void window.vibeIsland.setIslandPeeking(false);
      peekTransitionTimerRef.current = window.setTimeout(() => {
        peekTransitionTimerRef.current = null;
        peekingRef.current = false;
        setPresentationPhaseState(permissionRef.current ? 'permissionNotice' : 'collapsed');
        const stillHovered = hovered && interactionHoldRef.current;
        if (stillHovered) void window.vibeIsland.setIslandHovered(true);
        if (!stillHovered && idlePeekEligibleRef.current && !interactionHoldRef.current) {
          clearAutoPeekTimer();
          autoPeekTimerRef.current = window.setTimeout(() => {
            autoPeekTimerRef.current = null;
            if (!interactionHoldRef.current && presentationPhaseRef.current === 'collapsed') setIslandPeekingState(true);
          }, ISLAND_AUTO_PEEK_IDLE_MS);
        }
      }, ISLAND_PEEK_REVEAL_TRAVEL_MS);
    },
    [clearAutoPeekTimer, clearPeekTransitionTimer, setPresentationPhaseState]
  );

  const resetAutoPeekTimer = useCallback(() => {
    clearAutoPeekTimer();
    if (!canAutoPeek || interactionHoldRef.current || peekingRef.current || presentationPhaseRef.current !== 'collapsed') {
      return;
    }
    autoPeekTimerRef.current = window.setTimeout(() => {
      autoPeekTimerRef.current = null;
      if (!interactionHoldRef.current) setIslandPeekingState(true);
    }, ISLAND_AUTO_PEEK_IDLE_MS);
  }, [canAutoPeek, clearAutoPeekTimer, setIslandPeekingState]);

  const revealFromPeek = useCallback(
    (hovered = false) => {
      clearAutoPeekTimer();
      clearPeekRevealTimer();
      if (!peekingRef.current && !isPeekPresentationPhase(presentationPhaseRef.current)) {
        if (hovered) void window.vibeIsland.setIslandHovered(true);
        return;
      }
      setIslandPeekingState(false, { hovered });
    },
    [clearAutoPeekTimer, clearPeekRevealTimer, setIslandPeekingState]
  );

  const armPeekReveal = useCallback(
    (x: number, y: number) => {
      if (!peekingRef.current) return;
      if (!isPointerInsideElement(barRef.current, x, y)) {
        clearPeekRevealTimer();
        return;
      }
      if (peekRevealTimerRef.current) return;
      peekRevealTimerRef.current = window.setTimeout(() => {
        peekRevealTimerRef.current = null;
        if (isPointerInsideElement(barRef.current, x, y)) revealFromPeek(true);
      }, ISLAND_PEEK_REVEAL_HOVER_MS);
    },
    [clearPeekRevealTimer, revealFromPeek]
  );

  const syncHoverAfterCollapse = useCallback(() => {
    window.setTimeout(() => {
      void window.vibeIsland.setIslandHovered(isPointerInsideElement(barRef.current));
    }, 0);
  }, []);

  const finishPanelCollapse = useCallback(() => {
    presentationTimerRef.current = null;
    setPresentationPhaseState(permissionRef.current ? 'permissionNotice' : 'collapsed');
    void window.vibeIsland.setExpanded(false).then(syncHoverAfterCollapse);
  }, [setPresentationPhaseState, syncHoverAfterCollapse]);

  const startExpandSequence = useCallback(
    (options?: { notifyMain?: boolean }) => {
      const currentPhase = presentationPhaseRef.current;
      if (currentPhase === 'expanded' || currentPhase === 'expanding') return;

      clearAutoCollapseTimer();
      clearPresentationTimer();
      revealFromPeek(false);
      lastActivityAtRef.current = Date.now();
      setPresentationPhaseState('expanding');
      void window.vibeIsland.setIslandLayout({ width: ISLAND_CANVAS_WIDTH, height: ISLAND_PANEL_CANVAS_HEIGHT });
      if (options?.notifyMain !== false) void window.vibeIsland.setExpanded(true);

      presentationTimerRef.current = window.setTimeout(() => {
        presentationTimerRef.current = null;
        if (presentationPhaseRef.current === 'expanding') {
          setPresentationPhaseState('expanded');
        }
      }, ISLAND_PANEL_EXPAND_MS);
    },
    [clearAutoCollapseTimer, clearPresentationTimer, revealFromPeek, setPresentationPhaseState]
  );

  const requestCollapse = useCallback(
    async (_reason: CollapseReason) => {
      clearAutoCollapseTimer();
      const currentPhase = presentationPhaseRef.current;
      if (currentPhase === 'collapsing') {
        await new Promise<void>((resolve) => window.setTimeout(resolve, ISLAND_PANEL_COLLAPSE_MS));
        return;
      }

      revealFromPeek(false);
      if (!isPanelPresentationPhase(currentPhase)) {
        setPresentationPhaseState(permissionRef.current ? 'permissionNotice' : 'collapsed');
        await window.vibeIsland.setExpanded(false);
        syncHoverAfterCollapse();
        return;
      }

      clearPresentationTimer();
      setPresentationPhaseState('collapsing');
      presentationTimerRef.current = window.setTimeout(finishPanelCollapse, ISLAND_PANEL_COLLAPSE_MS);
      await new Promise<void>((resolve) => window.setTimeout(resolve, ISLAND_PANEL_COLLAPSE_MS));
    },
    [
      clearAutoCollapseTimer,
      clearPresentationTimer,
      finishPanelCollapse,
      revealFromPeek,
      setPresentationPhaseState,
      syncHoverAfterCollapse
    ]
  );

  const resetAutoCollapseTimer = useCallback(() => {
    clearAutoCollapseTimer();
    if (presentationPhaseRef.current !== 'expanded' || interactionHoldRef.current) return;
    autoCollapseTimerRef.current = window.setTimeout(() => {
      void requestCollapse('auto-idle');
    }, ISLAND_AUTO_COLLAPSE_IDLE_MS);
  }, [clearAutoCollapseTimer, requestCollapse]);

  const markIslandActivity = useCallback(() => {
    lastActivityAtRef.current = Date.now();
    if (peekingRef.current) revealFromPeek(true);
    resetAutoCollapseTimer();
    resetAutoPeekTimer();
  }, [resetAutoCollapseTimer, resetAutoPeekTimer, revealFromPeek]);

  const setInteractionHold = useCallback(
    (held: boolean) => {
      interactionHoldRef.current = held;
      lastActivityAtRef.current = Date.now();
      if (held) {
        clearAutoCollapseTimer();
        clearAutoPeekTimer();
        if (peekingRef.current) revealFromPeek(true);
        return;
      }
      resetAutoCollapseTimer();
      resetAutoPeekTimer();
    },
    [clearAutoCollapseTimer, clearAutoPeekTimer, resetAutoCollapseTimer, resetAutoPeekTimer, revealFromPeek]
  );

  useEffect(() => {
    const unsubscribe = window.vibeIsland.onExpanded((next) => {
      if (!next) {
        clearAutoCollapseTimer();
        if (isPanelPresentationPhase(presentationPhaseRef.current)) {
          void requestCollapse('window-blur');
          return;
        }
        setPresentationPhaseState(permissionRef.current ? 'permissionNotice' : 'collapsed');
        syncHoverAfterCollapse();
        return;
      }
      startExpandSequence({ notifyMain: false });
    });
    return unsubscribe;
  }, [clearAutoCollapseTimer, requestCollapse, setPresentationPhaseState, startExpandSequence, syncHoverAfterCollapse]);

  useEffect(() => {
    return () => {
      if (presentationTimerRef.current) window.clearTimeout(presentationTimerRef.current);
      if (layoutTimerRef.current) window.clearTimeout(layoutTimerRef.current);
      if (autoCollapseTimerRef.current) window.clearTimeout(autoCollapseTimerRef.current);
      if (autoPeekTimerRef.current) window.clearTimeout(autoPeekTimerRef.current);
      if (peekRevealTimerRef.current) window.clearTimeout(peekRevealTimerRef.current);
      if (peekTransitionTimerRef.current) window.clearTimeout(peekTransitionTimerRef.current);
      if (contentPulseTimerRef.current) window.clearTimeout(contentPulseTimerRef.current);
      if (jumpStatusTimerRef.current) window.clearTimeout(jumpStatusTimerRef.current);
      void window.vibeIsland.setIslandPeeking(false);
    };
  }, []);

  useEffect(() => {
    if (previousTextKeyRef.current === null) {
      previousTextKeyRef.current = textKey;
      return undefined;
    }
    if (previousTextKeyRef.current === textKey) return undefined;
    previousTextKeyRef.current = textKey;

    setContentChanging(true);
    if (contentPulseTimerRef.current) window.clearTimeout(contentPulseTimerRef.current);
    contentPulseTimerRef.current = window.setTimeout(() => {
      setContentChanging(false);
      contentPulseTimerRef.current = null;
    }, ISLAND_CONTENT_PULSE_MS);
    return undefined;
  }, [textKey]);

  useEffect(() => {
    const current = islandLayoutRef.current;
    if (islandLayout.width === current.width && islandLayout.height === current.height) {
      return undefined;
    }
    const shouldGrow = islandLayout.width > current.width || islandLayout.height > current.height;

    if (layoutTimerRef.current) {
      window.clearTimeout(layoutTimerRef.current);
      layoutTimerRef.current = null;
    }

    const syncLayout = (): void => {
      islandLayoutRef.current = islandLayout;
      void window.vibeIsland.setIslandLayout(islandLayout);
    };

    if (shouldGrow) {
      syncLayout();
      return undefined;
    }

    layoutTimerRef.current = window.setTimeout(syncLayout, ISLAND_LAYOUT_SHRINK_DELAY_MS);
    return () => {
      if (layoutTimerRef.current) {
        window.clearTimeout(layoutTimerRef.current);
        layoutTimerRef.current = null;
      }
    };
  }, [islandLayout.width, islandLayout.height]);

  useEffect(() => {
    if (!idlePeekEligible || interactionHoldRef.current) {
      clearAutoPeekTimer();
      revealFromPeek(false);
      return undefined;
    }

    if (!canAutoPeek) return undefined;

    resetAutoPeekTimer();

    return clearAutoPeekTimer;
  }, [canAutoPeek, clearAutoPeekTimer, idlePeekEligible, presentationPhase, resetAutoPeekTimer, revealFromPeek]);

  useEffect(() => {
    function handleMouseMove(event: MouseEvent): void {
      armPeekReveal(event.clientX, event.clientY);
    }

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [armPeekReveal]);

  useEffect(() => {
    if (!panelSettled) {
      clearAutoCollapseTimer();
      return undefined;
    }

    lastActivityAtRef.current = Date.now();
    resetAutoCollapseTimer();
    return clearAutoCollapseTimer;
  }, [clearAutoCollapseTimer, panelSettled, resetAutoCollapseTimer]);

  useEffect(() => {
    if (!expanded) return undefined;

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (cardRef.current?.contains(target)) return;
      void requestCollapse('outside-pointer');
    }

    function handleWindowBlur(): void {
      void requestCollapse('window-blur');
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        void requestCollapse('escape');
        return;
      }
      markIslandActivity();
    }

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [expanded, markIslandActivity, requestCollapse]);

  useEffect(() => {
    const permissionId = permission?.id;
    if (permissionId && previousPermissionIdRef.current !== permissionId) {
      setJumpStatus(null);
      if (jumpStatusTimerRef.current) {
        window.clearTimeout(jumpStatusTimerRef.current);
        jumpStatusTimerRef.current = null;
      }
      void requestCollapse('permission-start');
    }
    previousPermissionIdRef.current = permissionId;
  }, [permission?.id, requestCollapse]);

  useEffect(() => {
    if (permission && presentationPhaseRef.current === 'collapsed') {
      setPresentationPhaseState('permissionNotice');
      return undefined;
    }

    if (!permission && presentationPhaseRef.current === 'permissionNotice') {
      clearPresentationTimer();
      presentationTimerRef.current = window.setTimeout(() => {
        presentationTimerRef.current = null;
        if (!permissionRef.current && presentationPhaseRef.current === 'permissionNotice') {
          setPresentationPhaseState('collapsed');
        }
      }, ISLAND_NOTICE_COLLAPSE_MS);
    }

    return undefined;
  }, [clearPresentationTimer, permission, setPresentationPhaseState]);

  useEffect(() => {
    const notificationId = displayNotification?.id ?? null;
    const previousNotificationId = previousNotificationIdRef.current;
    if (
      previousNotificationId &&
      !notificationId &&
      expanded &&
      !interactionHoldRef.current &&
      Date.now() - lastActivityAtRef.current >= ISLAND_AUTO_COLLAPSE_IDLE_MS
    ) {
      void requestCollapse('notification-clear');
    }
    previousNotificationIdRef.current = notificationId;
  }, [displayNotification?.id, expanded, requestCollapse]);

  async function toggleExpanded(): Promise<void> {
    if (peekingRef.current) {
      revealFromPeek(true);
      return;
    }
    if (presentationPhaseRef.current === 'expanded' || presentationPhaseRef.current === 'expanding') {
      await requestCollapse('manual-toggle');
      return;
    }
    startExpandSequence();
  }

  async function openSettingsFromIsland(): Promise<void> {
    await requestCollapse('settings');
    await window.vibeIsland.openSettings();
  }

  function handleSettingsPointerDown(event: React.PointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    void openSettingsFromIsland();
  }

  function handleSettingsClick(event: React.MouseEvent<HTMLButtonElement>): void {
    event.preventDefault();
    event.stopPropagation();
    void openSettingsFromIsland();
  }

  function handlePointerMove(event: React.PointerEvent<HTMLElement>): void {
    if (peekingRef.current) {
      armPeekReveal(event.clientX, event.clientY);
      return;
    }
    if (expanded) {
      markIslandActivity();
      return;
    }
    void window.vibeIsland.setIslandHovered(isPointerInsideElement(barRef.current, event.clientX, event.clientY));
  }

  return (
    <MotionConfig transition={islandMotion.widthSpring}>
      <main
        className={`island-shell ${peekVisualActive ? 'peeking' : ''}`}
        data-theme-mode={snapshot.config.theme}
        data-accent={snapshot.config.accentTheme}
      >
        <motion.section
          ref={cardRef}
          className={`island-card ${panelMounted ? 'expanded' : 'collapsed'} phase-${presentationPhase} ${
            peekVisualActive ? 'is-peeking' : ''
          } peek-${peekPhase} ${
            contentChanging ? 'is-content-changing' : ''
          } state-${animationState} tone-${tone}`}
          animate={{ width: islandVisualWidth }}
          transition={islandWidthTransition}
          onMouseEnter={(event) => {
            setInteractionHold(true);
            void window.vibeIsland.setIslandHovered(isPointerInsideElement(barRef.current, event.clientX, event.clientY));
          }}
          onMouseLeave={() => {
            setInteractionHold(false);
            void window.vibeIsland.setIslandHovered(false);
          }}
          onPointerDownCapture={() => markIslandActivity()}
          onFocusCapture={() => setInteractionHold(true)}
          onBlurCapture={(event) => {
            if (cardRef.current?.contains(event.relatedTarget)) return;
            setInteractionHold(false);
          }}
          onPointerMove={handlePointerMove}
        >
          <motion.button
            ref={barRef}
            className="island-bar"
            type="button"
            onClick={toggleExpanded}
            aria-label="展开或收起 Vibe Island"
            animate={{ y: animationState === 'permissionNotice' ? 1 : 0 }}
            transition={islandMotion.micro}
          >
            <span className="surface-chrome" aria-hidden="true" />
            {animationState === 'idle' ? <IslandIdleLight width={islandVisualWidth} /> : null}
            {countdown ? (
              <IslandCountdown
                key={countdown.key}
                durationMs={countdown.durationMs}
                tone={tone}
                width={islandVisualWidth}
              />
            ) : null}
            <div className="island-content">
              <span className={`agent-dot ${permission?.agent ?? displayNotification?.agent ?? active?.agent ?? 'unknown'}`} />
              <RollingText value={primaryText} textKey={`primary-${textKey}`} className="island-primary" delay={0.06} />
              <RollingText
                value={secondaryText}
                textKey={`secondary-${textKey}`}
                className="island-secondary"
                delay={0.12}
              />
              <span className="status-slot">
                <span className="status-slot-inner" key={statusIconKey}>
                  {renderIslandStatusIcon(tone)}
                </span>
              </span>
              <span className="toggle-slot" aria-hidden="true">
                <ChevronDown className="toggle-chevron" size={16} />
              </span>
            </div>
          </motion.button>

          {!panelMounted ? (
            <AnimatePresence initial={false}>
              {permissionNoticeVisible && permission ? (
                <PermissionNotice request={permission} key="permission-notice" />
              ) : permissionNoticeVisible && mirroredPrompt ? (
                <MirroredPermissionNotice notification={mirroredPrompt} key="mirrored-permission-notice" />
              ) : null}
            </AnimatePresence>
          ) : null}

          <AnimatePresence initial={false}>
            {panelMounted ? (
              <motion.section
                key="island-panel"
                className="island-panel"
                aria-label="Vibe Island 控制面板"
                initial={{ opacity: 0, height: 0, y: -10 }}
                animate={{
                  opacity: presentationPhase === 'collapsing' ? 0 : 1,
                  height: presentationPhase === 'collapsing' ? 0 : ISLAND_PANEL_VISUAL_HEIGHT,
                  y: presentationPhase === 'collapsing' ? -8 : 0
                }}
                exit={{ opacity: 0, height: 0, y: -8 }}
                transition={{
                  height: presentationPhase === 'collapsing' ? islandMotion.panelShrink : islandMotion.panelGrow,
                  opacity:
                    presentationPhase === 'collapsing' ? islandMotion.panelContentOut : islandMotion.panelContentIn,
                  y: presentationPhase === 'collapsing' ? islandMotion.panelShrink : islandMotion.panelGrow
                }}
              >
                <motion.div
                  className="island-panel-content"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{
                    opacity: presentationPhase === 'collapsing' ? 0 : 1,
                    y: presentationPhase === 'collapsing' ? -6 : 0
                  }}
                  transition={
                    presentationPhase === 'collapsing' ? islandMotion.panelContentOut : islandMotion.panelContentIn
                  }
                >
                  {permission ? <PermissionPanel request={permission} compact /> : null}
                  {!permission ? <SessionStrip sessions={visibleSessions} onJump={requestJump} /> : null}
                  {!permission ? <EventList events={snapshot.events.slice(0, 2)} /> : null}
                  {jumpStatus ? <div className={`jump-feedback ${jumpStatus.tone}`}>{jumpStatus.message}</div> : null}
                  <div className="panel-actions">
                    <button
                      className="icon-button label-button"
                      type="button"
                      onPointerDown={handleSettingsPointerDown}
                      onClick={handleSettingsClick}
                    >
                      <Settings size={16} />
                      设置
                    </button>
                    <button
                      className="icon-button label-button"
                      type="button"
                      onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        event.preventDefault();
                        event.stopPropagation();
                        void requestJump(jumpTarget);
                      }}
                    >
                      <ExternalLink size={16} />
                      跳转
                    </button>
                  </div>
                </motion.div>
              </motion.section>
            ) : null}
          </AnimatePresence>
        </motion.section>
      </main>
    </MotionConfig>
  );
}

function IslandIdleLight({ width }: { width: number }): JSX.Element {
  const safeWidth = Math.max(44, width);
  const path = buildCapsulePath(safeWidth, 1.5);

  return (
    <span className="island-idle-light" aria-hidden="true">
      <svg viewBox={`0 0 ${safeWidth} 44`} preserveAspectRatio="none" focusable="false">
        <path className="idle-light-track" d={path} pathLength="100" />
        <path className="idle-light-progress" d={path} pathLength="100" />
      </svg>
    </span>
  );
}

function IslandCountdown({
  durationMs,
  tone,
  width
}: {
  durationMs: number;
  tone: IslandTone;
  width: number;
}): JSX.Element {
  const style = {
    '--countdown-duration': `${Math.max(120, durationMs)}ms`
  } as CSSProperties;
  const safeWidth = Math.max(44, width);
  const path = buildCapsulePath(safeWidth);

  return (
    <span className={`island-countdown countdown-${tone}`} aria-hidden="true" style={style}>
      <svg viewBox={`0 0 ${safeWidth} 44`} preserveAspectRatio="none" focusable="false">
        <defs>
          <linearGradient id={`countdown-gradient-${tone}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f97316" />
            <stop offset="34%" stopColor="#facc15" />
            <stop offset="68%" stopColor="var(--island-accent)" />
            <stop offset="100%" stopColor="var(--island-accent-bright)" />
          </linearGradient>
        </defs>
        <path className="countdown-track" d={path} pathLength="100" />
        <path
          className="countdown-progress"
          d={path}
          pathLength="100"
          stroke={`url(#countdown-gradient-${tone})`}
        />
      </svg>
    </span>
  );
}

function buildCapsulePath(width: number, inset = 1): string {
  const radius = 22 - inset;
  const centerY = 22;
  const top = inset;
  const bottom = 44 - inset;
  const left = inset;
  const right = width - inset;
  const leftArcEnd = left + radius;
  const rightArcStart = right - radius;
  const topCenter = width / 2;

  return [
    `M ${topCenter} ${top}`,
    `H ${rightArcStart}`,
    `A ${radius} ${radius} 0 0 1 ${right} ${centerY}`,
    `A ${radius} ${radius} 0 0 1 ${rightArcStart} ${bottom}`,
    `H ${leftArcEnd}`,
    `A ${radius} ${radius} 0 0 1 ${left} ${centerY}`,
    `A ${radius} ${radius} 0 0 1 ${leftArcEnd} ${top}`,
    `H ${topCenter}`
  ].join(' ');
}

function PermissionNotice({ request }: { request: PermissionRequest }): JSX.Element {
  const [answer, setAnswer] = useState('');
  const [busyDecision, setBusyDecision] = useState<PermissionDecision | null>(null);
  const canSendTypedAnswer = request.kind === 'question' && answer.trim().length > 0;

  useEffect(() => {
    setAnswer('');
    setBusyDecision(null);
  }, [request.id]);

  async function respond(decision: PermissionDecision, selectedAnswer?: string): Promise<void> {
    setBusyDecision(decision);
    try {
      await window.vibeIsland.respondPermission({
        id: request.id,
        decision,
        decidedAt: new Date().toISOString(),
        answer: selectedAnswer?.trim() || (decision === 'answer' ? answer.trim() : undefined),
        scope: decision === 'denyForSession' ? 'session' : 'request'
      });
    } finally {
      setBusyDecision(null);
    }
  }

  return (
    <motion.section
      className={`island-extension permission-notice risk-${request.risk}`}
      aria-label={request.kind === 'question' ? '需要回答提示' : '需要权限提示'}
      initial={{ opacity: 0, height: 0, y: -14 }}
      animate={{ opacity: 1, height: 'auto', y: 0 }}
      exit={{ opacity: 0, height: 0, y: -10 }}
      transition={islandMotion.extensionSpring}
    >
      <motion.div
        className="notice-signal"
        aria-hidden="true"
        initial={{ opacity: 0, scaleY: 0.4 }}
        animate={{ opacity: 1, scaleY: 1 }}
        exit={{ opacity: 0, scaleY: 0.35 }}
        transition={{ ...islandMotion.content, delay: 0.08 }}
      />
      <motion.div
        className="notice-copy"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ ...islandMotion.content, delay: 0.12 }}
      >
        <div className="notice-title">
          {request.kind === 'question' ? <MessageCircle size={14} /> : <ShieldAlert size={14} />}
          <span>{getActionableKindLabel(request)}</span>
          <strong>{agentLabels[request.agent]}</strong>
          <em>{formatRisk(request.risk)}</em>
        </div>
        <p>{request.action}</p>
        {request.prompt ? <p className="notice-prompt">{request.prompt}</p> : null}
        {request.command ? <code>{request.command}</code> : null}
        <InlinePermissionActions
          request={request}
          compact
          answer={answer}
          busyDecision={busyDecision}
          canSendTypedAnswer={canSendTypedAnswer}
          onAnswerChange={setAnswer}
          onRespond={respond}
        />
      </motion.div>
    </motion.section>
  );
}

function MirroredPermissionNotice({ notification }: { notification: NormalizedEvent }): JSX.Element {
  const tool = getMirroredPermissionTool(notification);
  const detail = notification.message ?? '请回到 Claude 会话处理权限确认。';

  return (
    <motion.section
      className="island-extension permission-notice mirrored-permission-notice risk-medium"
      aria-label="Claude 权限提示"
      initial={{ opacity: 0, height: 0, y: -14 }}
      animate={{ opacity: 1, height: 'auto', y: 0 }}
      exit={{ opacity: 0, height: 0, y: -10 }}
      transition={islandMotion.extensionSpring}
    >
      <motion.div
        className="notice-signal"
        aria-hidden="true"
        initial={{ opacity: 0, scaleY: 0.4 }}
        animate={{ opacity: 1, scaleY: 1 }}
        exit={{ opacity: 0, scaleY: 0.35 }}
        transition={{ ...islandMotion.content, delay: 0.08 }}
      />
      <motion.div
        className="notice-copy"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ ...islandMotion.content, delay: 0.12 }}
      >
        <div className="notice-title">
          <ShieldAlert size={14} />
          <span>需要权限</span>
          <strong>{agentLabels[notification.agent]}</strong>
          <em>镜像提示</em>
        </div>
        <p>{tool ? `Claude 请求使用 ${tool}` : 'Claude 请求权限'}</p>
        <p className="notice-prompt">{detail}</p>
      </motion.div>
    </motion.section>
  );
}

function isPointerInsideElement(element: HTMLElement | null, x?: number, y?: number): boolean {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  const pointX = x ?? window.innerWidth / 2;
  const pointY = y ?? 22;
  return pointX >= rect.left && pointX <= rect.right && pointY >= rect.top && pointY <= rect.bottom;
}

function estimateIslandWidth(primaryText: string, secondaryText: string): number {
  const primaryUnits = measureTextUnits(primaryText);
  const secondaryUnits = measureTextUnits(secondaryText);
  const contentWidth = primaryUnits * 7.6 + Math.min(secondaryUnits, 18) * 6.3 + 104;
  return Math.max(240, Math.min(460, Math.round(contentWidth)));
}

function isPanelPresentationPhase(phase: IslandPresentationPhase): boolean {
  return phase === 'expanding' || phase === 'expanded' || phase === 'collapsing';
}

function isPeekPresentationPhase(phase: IslandPresentationPhase): boolean {
  return phase === 'peekCompressing' || phase === 'peeking' || phase === 'peekRevealing';
}

function getPeekPhaseFromPresentation(phase: IslandPresentationPhase): IslandPeekPhase {
  if (phase === 'peekCompressing') return 'compressing';
  if (phase === 'peeking') return 'peeking';
  if (phase === 'peekRevealing') return 'revealing';
  return 'visible';
}

function getIslandLayout(
  presentationPhase: IslandPresentationPhase,
  hasPermission: boolean
): { width: number; height: number } {
  if (isPanelPresentationPhase(presentationPhase)) {
    return { width: ISLAND_CANVAS_WIDTH, height: ISLAND_PANEL_CANVAS_HEIGHT };
  }
  return {
    width: ISLAND_CANVAS_WIDTH,
    height:
      hasPermission || presentationPhase === 'permissionNotice' ? ISLAND_NOTICE_CANVAS_HEIGHT : ISLAND_BAR_CANVAS_HEIGHT
  };
}

type IslandAnimationState =
  | 'idle'
  | 'running'
  | 'notify'
  | 'permissionNotice'
  | 'complete'
  | 'expanded'
  | 'collapsing'
  | 'peeking';

function getIslandAnimationState({
  active,
  notification,
  presentationPhase,
  permission,
  mirroredPrompt,
  tone
}: {
  active: AgentSession | undefined;
  notification: NormalizedEvent | null;
  presentationPhase: IslandPresentationPhase;
  permission: PermissionRequest | undefined;
  mirroredPrompt: NormalizedEvent | null;
  tone: IslandTone;
}): IslandAnimationState {
  if (presentationPhase === 'collapsing') return 'collapsing';
  if (presentationPhase === 'expanding' || presentationPhase === 'expanded') return 'expanded';
  if (isPeekPresentationPhase(presentationPhase)) return 'peeking';
  if (permission || mirroredPrompt) return 'permissionNotice';
  if (tone === 'completed') return 'complete';
  if (notification) return 'notify';
  if (isSessionRunning(active)) return 'running';
  return 'idle';
}

function measureTextUnits(value: string): number {
  return Array.from(value).reduce((sum, char) => sum + (/[\u4e00-\u9fff]/.test(char) ? 1.75 : 1), 0);
}

function getIslandCountdown(
  permission: PermissionRequest | undefined,
  mirroredPrompt: NormalizedEvent | null,
  notification: NormalizedEvent | null
): { key: string; durationMs: number } | null {
  if (permission) {
    return {
      key: `permission-${permission.id}`,
      durationMs: getPermissionNoticeTimeoutMs(permission.timeoutMs)
    };
  }
  if (mirroredPrompt) return null;
  if (notification && shouldAutoClearIslandNotification(notification)) {
    return {
      key: `notification-${notification.id}`,
      durationMs: ISLAND_NOTIFICATION_PROGRESS_MS
    };
  }
  return null;
}

function RollingText({
  value,
  textKey,
  className,
  delay = 0
}: {
  value: string;
  textKey: string;
  className: string;
  delay?: number;
}): JSX.Element {
  return (
    <span className={`${className} text-viewport`}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={textKey}
          className="text-roll-item"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ ...islandMotion.content, delay }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function getWorkspaceName(workspace: string): string {
  return workspace.split(/[\\/]/).filter(Boolean).at(-1) ?? workspace;
}

type IslandTone = Exclude<IslandAttentionReason, 'none'> | 'permission' | 'running' | 'idle';

function getDisplayNotification(notification: NormalizedEvent | null): NormalizedEvent | null {
  if (!notification) return null;
  if (isLowSignalStatusEvent(notification)) return null;
  return notification;
}

function getIslandPrimaryText(
  permission: PermissionRequest | undefined,
  mirroredPrompt: NormalizedEvent | null,
  notification: NormalizedEvent | null,
  active: AgentSession | undefined,
  workspaceLabel: string | undefined
): string {
  if (permission) return permission.action;
  if (mirroredPrompt) return getMirroredPermissionAction(mirroredPrompt);
  if (notification) return notification.title;
  if (active?.status === 'user') return `${agentLabels[active.agent]} 收到输入`;
  return workspaceLabel ?? 'Vibe Island';
}

function getIslandSecondaryText(
  permission: PermissionRequest | undefined,
  mirroredPrompt: NormalizedEvent | null,
  notification: NormalizedEvent | null,
  active: AgentSession | undefined
): string {
  if (permission) return getActionableKindLabel(permission);
  if (mirroredPrompt) return '请在 Claude 会话中审批';
  if (notification) return notification.message ?? formatSessionSummary(active);
  if (active?.status === 'user') return active.lastMessage && active.lastMessage !== active.title ? active.lastMessage : '等待 Agent 响应';
  return formatSessionSummary(active);
}

function getIslandTone(
  permission: PermissionRequest | undefined,
  mirroredPrompt: NormalizedEvent | null,
  notification: NormalizedEvent | null,
  active: AgentSession | undefined
): IslandTone {
  if (permission) return 'permission';
  if (mirroredPrompt) return 'permission';
  if (!notification) return isSessionRunning(active) ? 'running' : 'idle';
  const reason = getIslandAttentionReason(notification);
  return reason === 'none' ? 'realtime' : reason;
}

function isSessionRunning(session: AgentSession | undefined): boolean {
  if (!session) return false;
  return ['tool-start', 'session-start', 'user', 'status'].includes(session.status);
}

function renderIslandStatusIcon(tone: IslandTone): JSX.Element {
  if (tone === 'permission') return <ShieldAlert size={18} className="status-icon warning-icon" />;
  if (tone === 'error') return <AlertTriangle size={18} className="status-icon error-icon" />;
  if (tone === 'completed') {
    return (
      <span className="completion-badge" aria-label="任务完成">
        <Check size={15} />
      </span>
    );
  }
  if (tone === 'question') return <MessageCircle size={18} className="status-icon question-icon" />;
  return (
    <span className="activity-indicator" aria-label={tone === 'idle' ? '空闲' : '运行中'}>
      <Activity size={18} />
    </span>
  );
}

function getMirroredPromptNotification(notification: NormalizedEvent | null): NormalizedEvent | null {
  if (!notification) return null;
  return isMirroredPermissionNotification(notification) ? notification : null;
}

function isMirroredPermissionNotification(notification: NormalizedEvent): boolean {
  if (notification.agent !== 'claude' || notification.eventType !== 'notification') return false;
  const notificationType = String(notification.metadata?.notification_type ?? '').toLowerCase();
  const text = `${notification.title} ${notification.message ?? ''}`.toLowerCase();
  return notificationType === 'permission_prompt' || /needs your permission|需要.*权限/.test(text);
}

function getMirroredPermissionAction(notification: NormalizedEvent): string {
  const tool = getMirroredPermissionTool(notification);
  if (tool) return `请求使用 ${tool}`;
  return notification.title;
}

function getMirroredPermissionTool(notification: NormalizedEvent): string | undefined {
  const directTool = typeof notification.toolName === 'string' && notification.toolName.trim().length > 0 ? notification.toolName : undefined;
  if (directTool) return directTool;
  const metadataTool = notification.metadata?.tool_name;
  if (typeof metadataTool === 'string' && metadataTool.trim().length > 0) return metadataTool;
  const message = notification.message ?? '';
  const englishMatch = message.match(/permission to use\s+(.+?)(?:[.!?]|$)/i);
  if (englishMatch?.[1]) return englishMatch[1].trim();
  const chineseMatch = message.match(/使用(.+?)(?:前)?需要.*权限/);
  return chineseMatch?.[1]?.trim();
}

function formatSessionSummary(session: AgentSession | undefined): string {
  if (!session) return '空闲';
  if (session.status === 'tool-start') return `${agentLabels[session.agent]} 运行中`;
  if (session.status === 'tool-end') return `${agentLabels[session.agent]} 空闲`;
  if (session.status === 'session-stop') return `${agentLabels[session.agent]} 空闲`;
  if (session.status === 'session-start') return `${agentLabels[session.agent]} 已开始`;
  if (session.status === 'user') return `${agentLabels[session.agent]} 收到输入`;
  if (session.status === 'error') return `${agentLabels[session.agent]} 出错`;
  return `${agentLabels[session.agent]} 活动中`;
}

function isLowSignalStatusEvent(event: NormalizedEvent): boolean {
  if (event.metadata?.source === 'jump') return true;
  const notificationType = String(event.metadata?.notification_type ?? '').toLowerCase();
  if (notificationType === 'permission_prompt' || notificationType === 'input_waiting') return false;
  const name = String(
    event.metadata?.hook_event_name ?? event.metadata?.eventType ?? event.metadata?.type ?? event.eventType
  ).toLowerCase();
  if (name === 'statusline') return true;
  return event.eventType === 'status' && /状态更新|status update/i.test(event.title);
}

function isLowSignalSession(session: AgentSession): boolean {
  if (session.metadata?.discoverySource === 'jump') return true;
  return session.status === 'status' && session.lastMessage === 'Discovered local session' && !session.metadata?.terminal;
}

function PermissionPanel({ request, compact = false }: { request: PermissionRequest; compact?: boolean }): JSX.Element {
  const [answer, setAnswer] = useState('');
  const [busyDecision, setBusyDecision] = useState<PermissionDecision | null>(null);
  const kindLabel = getActionableKindLabel(request);
  const canSendTypedAnswer = request.kind === 'question' && answer.trim().length > 0;

  useEffect(() => {
    setAnswer('');
    setBusyDecision(null);
  }, [request.id]);

  async function respond(decision: PermissionDecision, selectedAnswer?: string): Promise<void> {
    setBusyDecision(decision);
    try {
      await window.vibeIsland.respondPermission({
        id: request.id,
        decision,
        decidedAt: new Date().toISOString(),
        answer: selectedAnswer?.trim() || (decision === 'answer' ? answer.trim() : undefined),
        scope: decision === 'denyForSession' ? 'session' : 'request'
      });
    } finally {
      setBusyDecision(null);
    }
  }

  return (
    <section className={`permission-panel risk-${request.risk} kind-${request.kind}`} aria-label={kindLabel}>
      <div>
        <div className="section-kicker">{agentLabels[request.agent]} {kindLabel}</div>
        <h2>{request.action}</h2>
        {request.prompt ? <p>{request.prompt}</p> : null}
        {request.command ? <code>{request.command}</code> : null}
      </div>
      <div className="permission-meta">
        {request.kind === 'question' ? <MessageCircle size={15} /> : <ShieldAlert size={15} />}
        <span>{formatActionableMeta(request)}</span>
        <strong>{formatRisk(request.risk)}</strong>
      </div>
      <InlinePermissionActions
        request={request}
        compact={compact}
        answer={answer}
        busyDecision={busyDecision}
        canSendTypedAnswer={canSendTypedAnswer}
        onAnswerChange={setAnswer}
        onRespond={respond}
      />
    </section>
  );
}

function InlinePermissionActions({
  request,
  compact = false,
  answer,
  busyDecision,
  canSendTypedAnswer,
  onAnswerChange,
  onRespond
}: {
  request: PermissionRequest;
  compact?: boolean;
  answer: string;
  busyDecision: PermissionDecision | null;
  canSendTypedAnswer: boolean;
  onAnswerChange: (value: string) => void;
  onRespond: (decision: PermissionDecision, selectedAnswer?: string) => Promise<void>;
}): JSX.Element {
  const hasChoiceAnswers = request.kind === 'question' && Boolean(request.choices?.length);
  const needsTypedAnswer = request.kind === 'question' && !hasChoiceAnswers;

  return (
    <>
      {request.kind === 'question' ? (
        <div className={`answer-box ${compact ? 'compact' : ''}`}>
          {request.choices?.length ? (
            <div className="answer-choices">
              {request.choices.map((choice) => (
                <button
                  className="decision answer"
                  type="button"
                  key={choice}
                  onClick={() => void onRespond('answer', choice)}
                  disabled={Boolean(busyDecision)}
                >
                  {choice}
                </button>
              ))}
            </div>
          ) : null}
          {needsTypedAnswer ? (
            <label>
              <span>回答</span>
              <textarea
                value={answer}
                rows={compact ? 2 : 3}
                onChange={(event) => onAnswerChange(event.currentTarget.value)}
                placeholder="输入要发送给 Agent 的回复"
              />
            </label>
          ) : null}
        </div>
      ) : null}
      <div className={`permission-actions ${compact ? 'compact' : ''}`}>
        {request.kind === 'permission' ? (
          <>
            <button className="decision allow" type="button" onClick={() => void onRespond('allow')} disabled={Boolean(busyDecision)}>
              允许
            </button>
            <button className="decision deny" type="button" onClick={() => void onRespond('deny')} disabled={Boolean(busyDecision)}>
              拒绝
            </button>
            <button
              className="decision muted"
              type="button"
              onClick={() => void onRespond('denyForSession')}
              disabled={Boolean(busyDecision)}
            >
              本会话拒绝
            </button>
          </>
        ) : (
          <>
            {needsTypedAnswer ? (
              <button
                className="decision allow"
                type="button"
                onClick={() => void onRespond('answer')}
                disabled={Boolean(busyDecision) || !canSendTypedAnswer}
              >
                发送回答
              </button>
            ) : null}
            <button className="decision muted" type="button" onClick={() => void onRespond('deny')} disabled={Boolean(busyDecision)}>
              跳过
            </button>
          </>
        )}
      </div>
    </>
  );
}

function getActionableKindLabel(request: PermissionRequest): string {
  return request.kind === 'question' ? '需要回答' : '需要权限';
}

function formatActionableMeta(request: PermissionRequest): string {
  const timeoutSeconds = Math.ceil(getPermissionNoticeTimeoutMs(request.timeoutMs) / 1000);
  const base = request.kind === 'question' ? '等待输入' : '等待审批';
  return `${base}，${timeoutSeconds} 秒后超时`;
}

function formatRisk(risk: PermissionRequest['risk']): string {
  if (risk === 'high') return '高风险';
  if (risk === 'medium') return '中风险';
  return '低风险';
}

function SessionStrip({
  sessions,
  onJump
}: {
  sessions: AgentSession[];
  onJump: (target?: string | { sessionId?: string; workspace?: string }) => void;
}): JSX.Element {
  if (sessions.length === 0) return <div className="empty-state">暂无活动会话</div>;
  return (
    <section className="session-strip" aria-label="会话列表">
      {sessions.slice(0, 2).map((session) => (
        <button
          className="session-chip"
          type="button"
          key={session.id}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            onJump({ sessionId: session.id, workspace: session.workspace });
          }}
        >
          <span className={`agent-dot ${session.agent}`} />
          <span>{agentLabels[session.agent]}</span>
          <strong>{session.title}</strong>
        </button>
      ))}
    </section>
  );
}

function EventList({ events }: { events: NormalizedEvent[] }): JSX.Element {
  if (events.length === 0) return <div className="empty-state">暂无事件</div>;
  return (
    <section className="event-list" aria-label="最近事件">
      {events.map((event) => (
        <article className={`event-row severity-${event.severity}`} key={event.id}>
          <Circle size={8} fill="currentColor" />
          <div>
            <strong>{event.title}</strong>
            <span>{event.message ?? formatTime(event.timestamp)}</span>
          </div>
        </article>
      ))}
    </section>
  );
}

function SettingsView({ snapshot }: { snapshot: AppSnapshot }): JSX.Element {
  const [busyAgent, setBusyAgent] = useState<AgentId | null>(null);
  const [message, setMessage] = useState<string>('');
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('hooks');
  const [settingsMaximized, setSettingsMaximized] = useState(false);
  const [settingsDragActive, setSettingsDragActive] = useState(false);
  const dictionary = getDictionary(snapshot.config.language);
  const settingsDragStartRef = useRef<{
    screenX: number;
    screenY: number;
    clientX: number;
    clientY: number;
  } | null>(null);
  const settingsDragStartedRef = useRef(false);
  const settingsDragStartingRef = useRef(false);
  const activeEvents = useMemo(() => snapshot.events.slice(0, 8), [snapshot.events]);
  const installedAgents = snapshot.agents.filter((agent) => agent.hookInstalled).length;
  const activeSectionMeta = settingsSections.find((section) => section.id === activeSection) ?? settingsSections[0];
  const activeSectionText = dictionary.sections[activeSectionMeta.id];
  const remoteUrl = snapshot.runtime
    ? snapshot.diagnostics.remoteUrl ?? dictionary.labels.remoteWaiting
    : snapshot.config.remote.enabled
      ? dictionary.labels.remoteWaiting
      : dictionary.labels.remoteDisabled;

  useEffect(() => {
    let mounted = true;
    void window.vibeIsland.getSettingsWindowState().then((state) => {
      if (mounted) setSettingsMaximized(state.maximized);
    });
    const unsubscribe = window.vibeIsland.onSettingsWindowState((state) => {
      setSettingsMaximized(state.maximized);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!settingsDragActive) return undefined;

    const handlePointerMove = (event: PointerEvent): void => {
      const start = settingsDragStartRef.current;
      if (!start) return;
      if (!settingsDragStartedRef.current) {
        const distance = Math.hypot(event.screenX - start.screenX, event.screenY - start.screenY);
        if (distance < 6 || settingsDragStartingRef.current) return;
        settingsDragStartingRef.current = true;
        void window.vibeIsland.beginSettingsWindowDrag(start).then((state) => {
          setSettingsMaximized(state.maximized);
          settingsDragStartedRef.current = true;
          settingsDragStartingRef.current = false;
        });
      }
    };

    const handlePointerUp = (): void => {
      setSettingsDragActive(false);
      settingsDragStartRef.current = null;
      settingsDragStartedRef.current = false;
      settingsDragStartingRef.current = false;
      void window.vibeIsland.endSettingsWindowDrag();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
    window.addEventListener('pointercancel', handlePointerUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [settingsDragActive]);

  async function toggleHook(agent: AgentDescriptor): Promise<void> {
    setBusyAgent(agent.id);
    try {
      const result = agent.hookInstalled
        ? await window.vibeIsland.uninstallHook(agent.id)
        : await window.vibeIsland.installHook(agent.id);
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAgent(null);
    }
  }

  async function updateConfig(partial: Partial<AppConfig>): Promise<void> {
    await window.vibeIsland.updateConfig(partial);
  }

  async function refreshDiagnostics(): Promise<void> {
    try {
      await window.vibeIsland.refreshDiagnostics();
      setMessage(dictionary.labels.diagnosticsRefreshed);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function checkUpdates(): Promise<void> {
    try {
      const result = await window.vibeIsland.checkForUpdates();
      setMessage(result.message ?? formatUpdateStatus(result.status));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function installClaudeStatusLine(): Promise<void> {
    try {
      const result = await window.vibeIsland.installClaudeStatusLine();
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function uninstallClaudeStatusLine(): Promise<void> {
    try {
      const result = await window.vibeIsland.uninstallClaudeStatusLine();
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function handleMaximizedDragStart(event: React.PointerEvent<HTMLElement>): void {
    if (!settingsMaximized || event.button !== 0 || isInteractiveDragTarget(event.target)) return;
    event.preventDefault();
    const currentTarget = event.currentTarget;
    currentTarget.setPointerCapture(event.pointerId);
    settingsDragStartRef.current = {
      screenX: event.screenX,
      screenY: event.screenY,
      clientX: event.clientX,
      clientY: event.clientY
    };
    settingsDragStartedRef.current = false;
    settingsDragStartingRef.current = false;
    setSettingsDragActive(true);
  }

  return (
    <main
      className="settings-shell"
      data-theme-mode={snapshot.config.theme}
      data-accent={snapshot.config.accentTheme}
      data-window-state={settingsMaximized ? 'maximized' : 'normal'}
      data-drag-active={settingsDragActive ? 'true' : 'false'}
    >
      <section className="settings-window" onPointerDownCapture={handleMaximizedDragStart}>
        <aside className="settings-sidebar" aria-label="设置导航">
          <div className="traffic-lights" aria-label="窗口控制">
            <button
              className="traffic-button traffic-close"
              type="button"
              aria-label="关闭"
              onClick={() => window.vibeIsland.controlSettingsWindow('close')}
            />
            <button
              className="traffic-button traffic-minimize"
              type="button"
              aria-label="最小化"
              onClick={() => window.vibeIsland.controlSettingsWindow('minimize')}
            />
            <button
              className="traffic-button traffic-zoom"
              type="button"
              aria-label={settingsMaximized ? '还原' : '最大化'}
              onClick={() =>
                window.vibeIsland.controlSettingsWindow('zoom').then((state) => setSettingsMaximized(state.maximized))
              }
            />
          </div>
          <div className="settings-brand">
            <div className="settings-brand-icon">
              <Layers size={18} />
            </div>
            <div>
              <strong>Vibe Island</strong>
              <span>{dictionary.labels.console}</span>
            </div>
          </div>
          <nav className="settings-nav">
            {settingsSections.map((section) => (
              <button
                className={`settings-nav-item ${activeSection === section.id ? 'active' : ''}`}
                type="button"
                key={section.id}
                onClick={() => setActiveSection(section.id)}
              >
                {section.icon}
                <span>
                  <strong>{dictionary.sections[section.id][0]}</strong>
                  <small>{dictionary.sections[section.id][1]}</small>
                </span>
              </button>
            ))}
          </nav>
          <div className="settings-sidebar-card">
            <PlugZap size={15} />
            <span>{snapshot.runtime ? `${snapshot.runtime.host}:${snapshot.runtime.port}` : dictionary.labels.localIpcMissing}</span>
          </div>
        </aside>

        <section className="settings-main">
          <header className="settings-header">
            <div>
              <div className="section-kicker">Vibe Island Windows</div>
              <h1>{activeSectionText[0]}</h1>
            </div>
            <div className="settings-stats">
              <span>{installedAgents}/{snapshot.agents.length} Hooks</span>
              <span>{snapshot.permissions.length} {dictionary.labels.permissions}</span>
            </div>
          </header>

          <AnimatePresence mode="wait">
            <motion.section
              className="settings-page"
              key={activeSection}
              initial={{ opacity: 0, y: 12, scale: 0.985, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -8, scale: 0.992, filter: 'blur(5px)' }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            >
              {activeSection === 'hooks' ? (
                <section className="settings-section wide">
                  <SectionTitle icon={<Activity size={18} />} title="Agent Hooks" />
                  <div className="agent-list">
                    {snapshot.agents.map((agent, index) => (
                      <article
                        className="agent-row"
                        key={agent.id}
                        style={{ '--item-index': index } as CSSProperties}
                      >
                        <div className="agent-main">
                          <span className={`agent-dot ${agent.id}`} />
                          <div>
                            <h2>{agent.name}</h2>
                            <p>{agent.detected ? agent.configPath : dictionary.labels.configMissing}</p>
                            {agent.experimental ? <p className="warning-text">{agent.note}</p> : null}
                          </div>
                        </div>
                        <div className="agent-actions">
                          <button
                            className="icon-button"
                            type="button"
                            onClick={() => window.vibeIsland.sendSampleEvent(agent.id)}
                            aria-label={`推送 ${agent.name} 测试事件`}
                          >
                            <Terminal size={16} />
                          </button>
                          <button
                            className={`toggle-button ${agent.hookInstalled ? 'active' : ''}`}
                            type="button"
                            onClick={() => toggleHook(agent)}
                            disabled={busyAgent === agent.id}
                          >
                            {agent.hookInstalled ? dictionary.labels.uninstall : dictionary.labels.install}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                  <div className="status-line-actions">
                    <div>
                      <strong>{dictionary.labels.claudeStatusLine}</strong>
                      <span>{dictionary.labels.claudeStatusLineDescription}</span>
                    </div>
                    <div className="panel-actions">
                      <button className="icon-button label-button" type="button" onClick={installClaudeStatusLine}>
                        <Activity size={16} />
                        {dictionary.labels.install}
                      </button>
                      <button className="icon-button label-button" type="button" onClick={uninstallClaudeStatusLine}>
                        <Power size={16} />
                        {dictionary.labels.uninstall}
                      </button>
                    </div>
                  </div>
                  {message ? <div className="status-message">{message}</div> : null}
                </section>
              ) : null}

              {activeSection === 'preferences' ? (
                <section className="settings-section">
                  <SectionTitle icon={<Settings size={18} />} title={dictionary.labels.preferences} />
                  <label className="field-row">
                    <span>
                      <Languages size={17} />
                      {dictionary.labels.language}
                    </span>
                    <select
                      value={snapshot.config.language}
                      onChange={(event) =>
                        updateConfig({ language: event.currentTarget.value as AppConfig['language'] })
                      }
                    >
                      <option value="zh-CN">简体中文</option>
                      <option value="en-US">English</option>
                    </select>
                  </label>
                  <SettingToggle
                    icon={<Power size={17} />}
                    label={dictionary.labels.startAtLogin}
                    checked={snapshot.config.startAtLogin}
                    onChange={(checked) => updateConfig({ startAtLogin: checked })}
                  />
                  <SettingToggle
                    icon={<Bell size={17} />}
                    label={dictionary.labels.notifications}
                    checked={snapshot.config.notifications}
                    onChange={(checked) => updateConfig({ notifications: checked })}
                  />
                  <label className="field-row">
                    <span>{dictionary.labels.notificationStrategy}</span>
                    <select
                      value={snapshot.config.notificationStrategy}
                      onChange={(event) =>
                        updateConfig({
                          notificationStrategy: event.currentTarget.value as AppConfig['notificationStrategy']
                        })
                      }
                    >
                      <option value="focused">{dictionary.labels.focused}</option>
                      <option value="realtime">{dictionary.labels.realtime}</option>
                      <option value="silent">{dictionary.labels.silent}</option>
                    </select>
                  </label>
                  <SettingToggle
                    icon={<Activity size={17} />}
                    label={dictionary.labels.codexReplies}
                    checked={snapshot.config.showCodexReplies}
                    onChange={(checked) => updateConfig({ showCodexReplies: checked })}
                  />
                  <SettingToggle
                    icon={<Layers size={17} />}
                    label={dictionary.labels.autoPeek}
                    checked={snapshot.config.autoPeekIsland}
                    onChange={(checked) => updateConfig({ autoPeekIsland: checked })}
                  />
                  <SettingToggle
                    icon={<PlugZap size={17} />}
                    label={dictionary.labels.clickThrough}
                    checked={snapshot.config.islandClickThrough}
                    onChange={(checked) => updateConfig({ islandClickThrough: checked })}
                  />
                  <SettingToggle
                    icon={<Volume2 size={17} />}
                    label={dictionary.labels.sound}
                    checked={snapshot.config.sound.enabled}
                    onChange={(checked) => updateConfig({ sound: { ...snapshot.config.sound, enabled: checked } })}
                  />
                  <label className="field-row">
                    <span>{dictionary.labels.soundName}</span>
                    <select
                      value={snapshot.config.sound.name}
                      onChange={(event) =>
                        updateConfig({
                          sound: {
                            ...snapshot.config.sound,
                            name: event.currentTarget.value as AppConfig['sound']['name']
                          }
                        })
                      }
                    >
                      {soundNames.map((sound) => (
                        <option value={sound.id} key={sound.id}>
                          {sound.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-row range-row">
                    <span>{dictionary.labels.volume}</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={snapshot.config.sound.volume}
                      onChange={(event) =>
                        updateConfig({
                          sound: {
                            ...snapshot.config.sound,
                            volume: Number(event.currentTarget.value)
                          }
                        })
                      }
                    />
                    <strong>{Math.round(snapshot.config.sound.volume * 100)}%</strong>
                  </label>
                  <label className="field-row">
                    <span>{dictionary.labels.jumpTarget}</span>
                    <select
                      value={snapshot.config.jumpTarget}
                      onChange={(event) =>
                        updateConfig({ jumpTarget: event.currentTarget.value as AppConfig['jumpTarget'] })
                      }
                    >
                      <option value="workspace">{dictionary.labels.workspace}</option>
                      <option value="terminal">{dictionary.labels.terminal}</option>
                      <option value="precise">{dictionary.labels.precise}</option>
                      <option value="none">{dictionary.labels.none}</option>
                    </select>
                  </label>
                </section>
              ) : null}

              {activeSection === 'usage' ? (
                <section className="settings-section wide">
                  <SectionTitle icon={<BarChart3 size={18} />} title="Usage" />
                  {snapshot.usage.length === 0 ? (
                    <div className="empty-state block">{dictionary.labels.noUsage}</div>
                  ) : (
                    <div className="usage-grid">
                      {snapshot.usage.map((usage) => (
                        <UsageCard
                          usage={usage}
                          locale={snapshot.config.language}
                          dictionary={dictionary}
                          key={`${usage.agent}:${usage.source}`}
                        />
                      ))}
                    </div>
                  )}
                </section>
              ) : null}

              {activeSection === 'shortcuts' ? (
                <section className="settings-section wide">
                  <SectionTitle icon={<Keyboard size={18} />} title="Shortcuts" />
                  <div className="shortcut-list">
                    <ShortcutRow keys={['Esc']} label="收起灵动岛面板" />
                    <ShortcutRow keys={['Click']} label="展开或收起灵动岛" />
                    <ShortcutRow keys={['Hover']} label="唤醒自动隐藏的小圆点" />
                    <ShortcutRow keys={['Settings']} label="打开控制台窗口" />
                  </div>
                  <div className="info-row">
                    <Keyboard size={16} />
                    <span>当前版本未暴露全局快捷键配置；这里展示可用交互入口。</span>
                  </div>
                </section>
              ) : null}

              {activeSection === 'appearance' ? (
                <section className="settings-section appearance-section">
                  <SectionTitle icon={<Palette size={18} />} title={dictionary.sections.appearance[0]} />
                  <div className="appearance-preview">
                    <div className="preview-card">
                      <span className="preview-orbit" />
                      <strong>灵动岛预览</strong>
                      <small>主题和强调色会立即保存</small>
                    </div>
                  </div>
                  <div className="choice-grid">
                    {appearanceModeIds.map((mode) => (
                      <button
                        className={`choice-card ${snapshot.config.theme === mode ? 'active' : ''}`}
                        type="button"
                        key={mode}
                        onClick={() => updateConfig({ theme: mode })}
                      >
                        <strong>{dictionary.appearance[mode][0]}</strong>
                        <span>{dictionary.appearance[mode][1]}</span>
                      </button>
                    ))}
                  </div>
                  <div className="accent-picker" aria-label="颜色主题">
                    {accentThemes.map((accent) => (
                      <button
                        className={`accent-option ${snapshot.config.accentTheme === accent.id ? 'active' : ''}`}
                        type="button"
                        key={accent.id}
                        style={{ '--accent-swatch': accent.color } as CSSProperties}
                        onClick={() => updateConfig({ accentTheme: accent.id })}
                      >
                        <span />
                        {dictionary.accents[accent.id]}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              {activeSection === 'permissions' ? (
                <section className="settings-section">
                  <SectionTitle icon={<ShieldAlert size={18} />} title={dictionary.sections.permissions[0]} />
                  {snapshot.permissions.length === 0 ? (
                    <div className="empty-state block">{dictionary.labels.noPending}</div>
                  ) : (
                    snapshot.permissions.map((request) => <PermissionPanel request={request} key={request.id} />)
                  )}
                </section>
              ) : null}

              {activeSection === 'diagnostics' ? (
                <section className="settings-section wide">
                  <SectionTitle icon={<Bug size={18} />} title="Diagnostics" />
                  <div className="diagnostic-grid">
                    <StatusTile
                      label="IPC"
                      value={snapshot.diagnostics.ipcHealthy ? 'Healthy' : 'Offline'}
                      tone={snapshot.diagnostics.ipcHealthy ? 'success' : 'warning'}
                    />
                    <StatusTile label="Runtime" value={snapshot.runtime ? `${snapshot.runtime.host}:${snapshot.runtime.port}` : 'Not running'} />
                    <StatusTile label="Checked" value={formatDateTime(snapshot.diagnostics.checkedAt, snapshot.config.language)} />
                  </div>
                  <KeyValueList
                    items={[
                      ['Runtime file', snapshot.diagnostics.runtimePath],
                      ['Hook helper', snapshot.diagnostics.hookHelperPath],
                      ['Remote URL', snapshot.diagnostics.remoteUrl ?? 'Disabled'],
                      ['Last error', snapshot.diagnostics.lastError ?? 'None']
                    ]}
                  />
                  <div className="panel-actions">
                    <button className="icon-button label-button" type="button" onClick={refreshDiagnostics}>
                      <RefreshCw size={16} />
                      {dictionary.labels.refresh}
                    </button>
                  </div>
                  {message ? <div className="status-message">{message}</div> : null}
                </section>
              ) : null}

              {activeSection === 'advanced' ? (
                <section className="settings-section">
                  <SectionTitle icon={<SlidersHorizontal size={18} />} title={dictionary.sections.advanced[0]} />
                  <SettingToggle
                    icon={<RefreshCw size={17} />}
                    label={dictionary.labels.autoUpdate}
                    checked={snapshot.config.update.enabled}
                    onChange={(checked) =>
                      updateConfig({ update: { ...snapshot.config.update, enabled: checked } })
                    }
                  />
                  <label className="field-row">
                    <span>{dictionary.labels.updateChannel}</span>
                    <select
                      value={snapshot.config.update.channel}
                      onChange={(event) =>
                        updateConfig({
                          update: {
                            ...snapshot.config.update,
                            channel: event.currentTarget.value as AppConfig['update']['channel']
                          }
                        })
                      }
                    >
                      <option value="stable">Stable</option>
                      <option value="prerelease">Prerelease</option>
                    </select>
                  </label>
                  <div className="info-row">
                    <RefreshCw size={16} />
                    <span>{formatUpdateStatus(snapshot.config.update.status)}</span>
                    <button className="icon-button" type="button" onClick={checkUpdates} aria-label={dictionary.labels.checkUpdates}>
                      <RefreshCw size={15} />
                    </button>
                  </div>
                  <SettingToggle
                    icon={<Radio size={17} />}
                    label={dictionary.labels.remoteApproval}
                    checked={snapshot.config.remote.enabled}
                    onChange={(checked) =>
                      updateConfig({ remote: { ...snapshot.config.remote, enabled: checked } })
                    }
                  />
                  <label className="field-row">
                    <span>{dictionary.labels.remoteToken}</span>
                    <input
                      type="password"
                      value={snapshot.config.remote.token ?? ''}
                      placeholder={dictionary.labels.tokenPlaceholder}
                      onChange={(event) =>
                        updateConfig({
                          remote: {
                            ...snapshot.config.remote,
                            token: event.currentTarget.value.trim() || undefined
                          }
                        })
                      }
                    />
                  </label>
                  <div className="info-row">
                    <Server size={16} />
                    <span>{remoteUrl}</span>
                  </div>
                  <SettingToggle
                    icon={<Server size={17} />}
                    label="Codex App Server"
                    checked={snapshot.config.experiments.codexAppServer}
                    onChange={(checked) =>
                      updateConfig({
                        experiments: { ...snapshot.config.experiments, codexAppServer: checked }
                      })
                    }
                  />
                  <SettingToggle
                    icon={<Activity size={17} />}
                    label="Session Discovery"
                    checked={snapshot.config.experiments.sessionDiscovery}
                    onChange={(checked) =>
                      updateConfig({
                        experiments: { ...snapshot.config.experiments, sessionDiscovery: checked }
                      })
                    }
                  />
                  <SettingToggle
                    icon={<FlaskConical size={17} />}
                    label="Precise Jump"
                    checked={snapshot.config.experiments.preciseJump}
                    onChange={(checked) =>
                      updateConfig({
                        experiments: { ...snapshot.config.experiments, preciseJump: checked }
                      })
                    }
                  />
                  {message ? <div className="status-message">{message}</div> : null}
                </section>
              ) : null}

              {activeSection === 'events' ? (
                <section className="settings-section wide">
                  <SectionTitle icon={<Terminal size={18} />} title={dictionary.labels.recentEvents} />
                  <EventList events={activeEvents} />
                </section>
              ) : null}

              {activeSection === 'about' ? (
                <section className="settings-section wide">
                  <SectionTitle icon={<Info size={18} />} title="About" />
                  <div className="about-panel">
                    <div className="settings-brand-icon">
                      <Layers size={18} />
                    </div>
                    <div>
                      <h2>Vibe Island</h2>
                      <p>Private Windows prototype of an AI agent status island.</p>
                    </div>
                  </div>
                  <KeyValueList
                    items={[
                      ['Runtime', snapshot.runtime ? `${snapshot.runtime.host}:${snapshot.runtime.port}` : 'Not running'],
                      ['PID', snapshot.runtime?.pid ? String(snapshot.runtime.pid) : dictionary.labels.unavailable],
                      ['Started', snapshot.runtime?.startedAt ? formatDateTime(snapshot.runtime.startedAt, snapshot.config.language) : dictionary.labels.unavailable],
                      ['Language', snapshot.config.language],
                      ['Theme', `${snapshot.config.theme} / ${snapshot.config.accentTheme}`]
                    ]}
                  />
                </section>
              ) : null}
            </motion.section>
          </AnimatePresence>
        </section>
      </section>
    </main>
  );
}

function SectionTitle({ icon, title }: { icon: JSX.Element; title: string }): JSX.Element {
  return (
    <div className="section-title">
      {icon}
      <h2>{title}</h2>
    </div>
  );
}

function UsageCard({ usage, locale, dictionary }: { usage: AgentUsage; locale: Locale; dictionary: ReturnType<typeof getDictionary> }): JSX.Element {
  return (
    <article className={`usage-card ${usage.available ? 'available' : 'missing'}`}>
      <div className="usage-card-header">
        <span className={`agent-dot ${usage.agent}`} />
        <div>
          <h2>{agentLabels[usage.agent]}</h2>
          <p>{usage.available ? usage.source : usage.message ?? 'Usage unavailable'}</p>
        </div>
      </div>
      <UsageMeter label="5h" window={usage.fiveHour} locale={locale} resetLabel={dictionary.labels.reset} />
      <UsageMeter label="7d" window={usage.sevenDay} locale={locale} resetLabel={dictionary.labels.reset} />
      <span className="usage-updated">{dictionary.labels.updated} {formatDateTime(usage.updatedAt, locale)}</span>
    </article>
  );
}

function UsageMeter({
  label,
  window,
  locale,
  resetLabel
}: {
  label: string;
  window: AgentUsage['fiveHour'];
  locale: Locale;
  resetLabel: string;
}): JSX.Element {
  const used = window?.used;
  const limit = window?.limit;
  const percent = typeof used === 'number' && typeof limit === 'number' && limit > 0 ? Math.min(100, (used / limit) * 100) : 0;

  return (
    <div className="usage-meter">
      <div>
        <span>{label}</span>
        <strong>{formatUsageWindow(window)}</strong>
      </div>
      <div className="usage-track" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
      {window?.resetAt ? <small>{resetLabel} {formatDateTime(window.resetAt, locale)}</small> : null}
    </div>
  );
}

function ShortcutRow({ keys, label }: { keys: string[]; label: string }): JSX.Element {
  return (
    <div className="shortcut-row">
      <span>
        {keys.map((key) => (
          <kbd key={key}>{key}</kbd>
        ))}
      </span>
      <strong>{label}</strong>
    </div>
  );
}

function StatusTile({
  label,
  value,
  tone = 'neutral'
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'success' | 'warning';
}): JSX.Element {
  return (
    <article className={`status-tile tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function KeyValueList({ items }: { items: Array<[string, string | undefined]> }): JSX.Element {
  return (
    <dl className="key-value-list">
      {items.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd title={value}>{value ?? 'Unavailable'}</dd>
        </div>
      ))}
    </dl>
  );
}

function SettingToggle({
  icon,
  label,
  checked,
  onChange
}: {
  icon: JSX.Element;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label className="toggle-row">
      <span>
        {icon}
        {label}
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
    </label>
  );
}

function isInteractiveDragTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('button,input,select,textarea,a,[role="button"]'));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => resolve(fallback), timeoutMs);
    void promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      })
  });
}

function formatTime(timestamp: string, locale: Locale = 'zh-CN'): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(timestamp));
}

function formatDateTime(timestamp: string, locale: Locale = 'zh-CN'): string {
  return new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp));
}

function formatUsageWindow(window: AgentUsage['fiveHour']): string {
  if (!window) return 'No data';
  if (typeof window.used === 'number' && typeof window.limit === 'number') return `${window.used}/${window.limit}`;
  if (typeof window.used === 'number') return `${window.used} used`;
  if (typeof window.limit === 'number') return `${window.limit} limit`;
  return 'No data';
}

function formatUpdateStatus(status: AppConfig['update']['status']): string {
  if (status === 'checking') return 'Checking for updates';
  if (status === 'available') return 'Update available';
  if (status === 'not-available') return 'Up to date';
  if (status === 'error') return 'Update check failed';
  return 'Update idle';
}

export default App;
