import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  Activity,
  AlertTriangle,
  Bell,
  Check,
  ChevronDown,
  Circle,
  ExternalLink,
  Layers,
  MessageCircle,
  MonitorUp,
  Palette,
  PlugZap,
  Power,
  Settings,
  ShieldAlert,
  Terminal,
} from 'lucide-react';
import type {
  AgentDescriptor,
  AgentId,
  AgentSession,
  AppConfig,
  AppSnapshot,
  AccentTheme,
  AppearanceTheme,
  NormalizedEvent,
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
const ISLAND_NOTICE_CANVAS_HEIGHT = 140;
const ISLAND_CANVAS_WIDTH = 560;
const ISLAND_VISUAL_MAX_WIDTH = 520;
const ISLAND_PANEL_CANVAS_HEIGHT = 372;
const ISLAND_LAYOUT_SHRINK_DELAY_MS = 260;
const ISLAND_COLLAPSE_STATE_MS = 240;
const ISLAND_CONTENT_PULSE_MS = 380;
const ISLAND_AUTO_COLLAPSE_IDLE_MS = 8000;

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
  widthSpring: { type: 'spring', stiffness: 540, damping: 48, mass: 0.86 },
  extensionSpring: { type: 'spring', stiffness: 460, damping: 42, mass: 0.82 },
  panel: { duration: 0.42, ease: [0.16, 1, 0.3, 1] }
} as const;

type SettingsSectionId = 'hooks' | 'preferences' | 'appearance' | 'permissions' | 'events';

const settingsSections: Array<{ id: SettingsSectionId; label: string; description: string; icon: JSX.Element }> = [
  { id: 'hooks', label: 'Agent Hooks', description: '安装与测试', icon: <Activity size={16} /> },
  { id: 'preferences', label: '偏好', description: '通知与跳转', icon: <Settings size={16} /> },
  { id: 'appearance', label: '外观', description: '主题与颜色', icon: <Palette size={16} /> },
  { id: 'permissions', label: '权限提示', description: '只读队列', icon: <ShieldAlert size={16} /> },
  { id: 'events', label: '最近事件', description: '运行记录', icon: <Terminal size={16} /> }
];

const appearanceModes: Array<{ id: AppearanceTheme; label: string; description: string }> = [
  { id: 'system', label: '跟随系统', description: '自动匹配 Windows' },
  { id: 'light', label: '浅色', description: '明亮玻璃面板' },
  { id: 'dark', label: '深色', description: '低亮度控制台' }
];

const accentThemes: Array<{ id: AccentTheme; label: string; color: string }> = [
  { id: 'teal', label: '青色', color: '#14b8a6' },
  { id: 'blue', label: '蓝色', color: '#3b82f6' },
  { id: 'violet', label: '紫色', color: '#8b5cf6' },
  { id: 'orange', label: '橙色', color: '#f97316' },
  { id: 'graphite', label: '石墨', color: '#64748b' }
];

const agentLabels: Record<AgentId, string> = {
  codex: 'Codex',
  claude: 'Claude',
  gemini: 'Gemini',
  opencode: 'OpenCode',
  unknown: 'Agent'
};

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

  if (!snapshot) return <div className={`app-shell ${view}`}>载入中</div>;
  return view === 'settings' ? <SettingsView snapshot={snapshot} /> : <IslandView snapshot={snapshot} />;
}

function IslandView({ snapshot }: { snapshot: AppSnapshot }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [collapsing, setCollapsing] = useState(false);
  const cardRef = useRef<HTMLElement | null>(null);
  const barRef = useRef<HTMLButtonElement | null>(null);
  const islandLayoutRef = useRef({ width: ISLAND_CANVAS_WIDTH, height: ISLAND_BAR_CANVAS_HEIGHT });
  const layoutTimerRef = useRef<number | null>(null);
  const collapseTimerRef = useRef<number | null>(null);
  const autoCollapseTimerRef = useRef<number | null>(null);
  const contentPulseTimerRef = useRef<number | null>(null);
  const previousTextKeyRef = useRef<string | null>(null);
  const previousPermissionIdRef = useRef<string | undefined>(undefined);
  const previousNotificationIdRef = useRef<string | null>(null);
  const lastActivityAtRef = useRef(Date.now());
  const [contentChanging, setContentChanging] = useState(false);
  const active = snapshot.sessions[0];
  const notification = snapshot.notification;
  const permission = snapshot.permissions[0];
  const tone = getIslandTone(permission, notification, active);
  const workspaceLabel = active?.title ?? (notification?.workspace ? getWorkspaceName(notification.workspace) : undefined);
  const primaryText = permission ? permission.action : notification?.title ?? workspaceLabel ?? 'Vibe Island';
  const secondaryText = permission ? '需要权限' : notification?.message ?? formatSessionSummary(active);
  const islandWidth = estimateIslandWidth(primaryText, secondaryText);
  const islandCardWidth = expanded ? ISLAND_VISUAL_MAX_WIDTH : islandWidth;
  const textKey = permission?.id ?? notification?.id ?? `${primaryText}:${secondaryText}`;
  const countdown = getIslandCountdown(permission, notification);
  const islandLayout = getIslandLayout(expanded, Boolean(permission));
  const animationState = getIslandAnimationState({ active, collapsing, expanded, notification, permission, tone });
  const statusIconKey = `${tone}-${permission?.id ?? notification?.id ?? active?.status ?? 'idle'}`;

  const beginCollapseState = useCallback(() => {
    setCollapsing(true);
    if (collapseTimerRef.current) window.clearTimeout(collapseTimerRef.current);
    collapseTimerRef.current = window.setTimeout(() => {
      setCollapsing(false);
      collapseTimerRef.current = null;
    }, ISLAND_COLLAPSE_STATE_MS);
  }, []);

  const clearAutoCollapseTimer = useCallback(() => {
    if (autoCollapseTimerRef.current) {
      window.clearTimeout(autoCollapseTimerRef.current);
      autoCollapseTimerRef.current = null;
    }
  }, []);

  const syncHoverAfterCollapse = useCallback(() => {
    window.setTimeout(() => {
      void window.vibeIsland.setIslandHovered(isPointerInsideElement(barRef.current));
    }, 0);
  }, []);

  const requestCollapse = useCallback(
    async (_reason: CollapseReason) => {
      clearAutoCollapseTimer();
      if (expanded) beginCollapseState();
      setExpanded(false);
      await window.vibeIsland.setExpanded(false);
      syncHoverAfterCollapse();
    },
    [beginCollapseState, clearAutoCollapseTimer, expanded, syncHoverAfterCollapse]
  );

  const resetAutoCollapseTimer = useCallback(() => {
    clearAutoCollapseTimer();
    if (!expanded) return;
    autoCollapseTimerRef.current = window.setTimeout(() => {
      void requestCollapse('auto-idle');
    }, ISLAND_AUTO_COLLAPSE_IDLE_MS);
  }, [clearAutoCollapseTimer, expanded, requestCollapse]);

  const markIslandActivity = useCallback(() => {
    lastActivityAtRef.current = Date.now();
    resetAutoCollapseTimer();
  }, [resetAutoCollapseTimer]);

  useEffect(() => {
    const unsubscribe = window.vibeIsland.onExpanded((next) => {
      if (!next) {
        clearAutoCollapseTimer();
        syncHoverAfterCollapse();
      }
      setExpanded((previous) => {
        if (next) {
          lastActivityAtRef.current = Date.now();
          setCollapsing(false);
          if (collapseTimerRef.current) {
            window.clearTimeout(collapseTimerRef.current);
            collapseTimerRef.current = null;
          }
        } else if (previous) {
          beginCollapseState();
        }
        return next;
      });
    });
    return unsubscribe;
  }, [beginCollapseState, clearAutoCollapseTimer, syncHoverAfterCollapse]);

  useEffect(() => {
    return () => {
      if (collapseTimerRef.current) window.clearTimeout(collapseTimerRef.current);
      if (layoutTimerRef.current) window.clearTimeout(layoutTimerRef.current);
      if (autoCollapseTimerRef.current) window.clearTimeout(autoCollapseTimerRef.current);
      if (contentPulseTimerRef.current) window.clearTimeout(contentPulseTimerRef.current);
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
    if (!expanded) {
      clearAutoCollapseTimer();
      return undefined;
    }

    lastActivityAtRef.current = Date.now();
    resetAutoCollapseTimer();
    return clearAutoCollapseTimer;
  }, [clearAutoCollapseTimer, expanded, resetAutoCollapseTimer]);

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
      void requestCollapse('permission-start');
    }
    previousPermissionIdRef.current = permissionId;
  }, [permission?.id, requestCollapse]);

  useEffect(() => {
    const notificationId = notification?.id ?? null;
    const previousNotificationId = previousNotificationIdRef.current;
    if (
      previousNotificationId &&
      !notificationId &&
      expanded &&
      Date.now() - lastActivityAtRef.current >= ISLAND_AUTO_COLLAPSE_IDLE_MS
    ) {
      void requestCollapse('notification-clear');
    }
    previousNotificationIdRef.current = notificationId;
  }, [expanded, notification?.id, requestCollapse]);

  async function toggleExpanded(): Promise<void> {
    const next = !expanded;
    if (!next) {
      await requestCollapse('manual-toggle');
      return;
    }
    clearAutoCollapseTimer();
    lastActivityAtRef.current = Date.now();
    setExpanded(next);
    setCollapsing(false);
    if (collapseTimerRef.current) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
    await window.vibeIsland.setExpanded(next);
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
    if (expanded) {
      markIslandActivity();
      return;
    }
    void window.vibeIsland.setIslandHovered(isPointerInsideElement(barRef.current, event.clientX, event.clientY));
  }

  return (
    <MotionConfig transition={islandMotion.widthSpring}>
      <main className="island-shell">
        <motion.section
          ref={cardRef}
          className={`island-card ${expanded ? 'expanded' : 'collapsed'} ${
            contentChanging ? 'is-content-changing' : ''
          } state-${animationState} tone-${tone}`}
          animate={{ width: islandCardWidth }}
          transition={islandMotion.widthSpring}
          onMouseEnter={(event) => {
            markIslandActivity();
            void window.vibeIsland.setIslandHovered(isPointerInsideElement(barRef.current, event.clientX, event.clientY));
          }}
          onMouseLeave={() => window.vibeIsland.setIslandHovered(false)}
          onPointerDownCapture={() => markIslandActivity()}
          onFocusCapture={() => markIslandActivity()}
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
            {animationState === 'idle' ? <IslandIdleLight width={islandCardWidth} /> : null}
            {countdown ? (
              <IslandCountdown
                key={countdown.key}
                durationMs={countdown.durationMs}
                tone={tone}
                width={islandCardWidth}
              />
            ) : null}
            <div className="island-content">
              <span className={`agent-dot ${permission?.agent ?? notification?.agent ?? active?.agent ?? 'unknown'}`} />
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

          <AnimatePresence initial={false}>
            {permission && !expanded ? (
              <PermissionNotice request={permission} key={permission.id} />
            ) : null}
          </AnimatePresence>

          <AnimatePresence initial={false}>
            {expanded ? (
              <motion.section
                key="island-panel"
                className="island-panel"
                aria-label="Vibe Island 控制面板"
                initial={{ opacity: 0, height: 0, y: -10 }}
                animate={{ opacity: 1, height: 'auto', y: 0 }}
                exit={{ opacity: 0, height: 0, y: -8 }}
                transition={islandMotion.panel}
              >
                {permission ? <PermissionPanel request={permission} /> : null}
                {!permission ? <SessionStrip sessions={snapshot.sessions} /> : null}
                {!permission ? <EventList events={snapshot.events.slice(0, 2)} /> : null}
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
                    onClick={() => window.vibeIsland.jumpWorkspace(active?.workspace)}
                    disabled={!active?.workspace}
                  >
                    <ExternalLink size={16} />
                    跳转
                  </button>
                </div>
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
            <stop offset="68%" stopColor="#14b8a6" />
            <stop offset="100%" stopColor="#60a5fa" />
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
  return (
    <motion.section
      className={`island-extension permission-notice risk-${request.risk}`}
      aria-label="需要权限提示"
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
          <strong>{agentLabels[request.agent]}</strong>
          <em>{formatRisk(request.risk)}</em>
        </div>
        <p>{request.action}</p>
        {request.command ? <code>{request.command}</code> : null}
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
  const contentWidth = primaryUnits * 8.4 + secondaryUnits * 7.2 + 118;
  return Math.max(320, Math.min(520, Math.round(contentWidth)));
}

function getIslandLayout(expanded: boolean, hasPermission: boolean): { width: number; height: number } {
  if (expanded) {
    return { width: ISLAND_CANVAS_WIDTH, height: ISLAND_PANEL_CANVAS_HEIGHT };
  }
  return {
    width: ISLAND_CANVAS_WIDTH,
    height: hasPermission ? ISLAND_NOTICE_CANVAS_HEIGHT : ISLAND_BAR_CANVAS_HEIGHT
  };
}

type IslandAnimationState = 'idle' | 'running' | 'notify' | 'permissionNotice' | 'complete' | 'expanded' | 'collapsing';

function getIslandAnimationState({
  active,
  collapsing,
  expanded,
  notification,
  permission,
  tone
}: {
  active: AgentSession | undefined;
  collapsing: boolean;
  expanded: boolean;
  notification: NormalizedEvent | null;
  permission: PermissionRequest | undefined;
  tone: IslandTone;
}): IslandAnimationState {
  if (collapsing) return 'collapsing';
  if (expanded) return 'expanded';
  if (permission) return 'permissionNotice';
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
  notification: NormalizedEvent | null
): { key: string; durationMs: number } | null {
  if (permission) {
    return {
      key: `permission-${permission.id}`,
      durationMs: getPermissionNoticeTimeoutMs(permission.timeoutMs)
    };
  }
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

function getIslandTone(
  permission: PermissionRequest | undefined,
  notification: NormalizedEvent | null,
  active: AgentSession | undefined
): IslandTone {
  if (permission) return 'permission';
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

function formatSessionSummary(session: AgentSession | undefined): string {
  if (!session) return '空闲';
  if (session.status === 'tool-start') return `${agentLabels[session.agent]} 运行中`;
  if (session.status === 'tool-end') return `${agentLabels[session.agent]} 空闲`;
  if (session.status === 'session-stop') return `${agentLabels[session.agent]} 空闲`;
  if (session.status === 'session-start') return `${agentLabels[session.agent]} 已开始`;
  if (session.status === 'error') return `${agentLabels[session.agent]} 出错`;
  return `${agentLabels[session.agent]} 活动中`;
}

function PermissionPanel({ request }: { request: PermissionRequest }): JSX.Element {
  return (
    <section className={`permission-panel risk-${request.risk}`} aria-label="权限请求">
      <div>
        <div className="section-kicker">{agentLabels[request.agent]} 需要权限</div>
        <h2>{request.action}</h2>
        {request.command ? <code>{request.command}</code> : null}
      </div>
      <div className="permission-readonly">
        <ShieldAlert size={15} />
        <span>仅提示，不执行审批操作；提示超时后返回 timeout。</span>
        <strong>{formatRisk(request.risk)}</strong>
      </div>
    </section>
  );
}

function formatRisk(risk: PermissionRequest['risk']): string {
  if (risk === 'high') return '高风险';
  if (risk === 'medium') return '中风险';
  return '低风险';
}

function SessionStrip({ sessions }: { sessions: AgentSession[] }): JSX.Element {
  if (sessions.length === 0) return <div className="empty-state">暂无活动会话</div>;
  return (
    <section className="session-strip" aria-label="会话列表">
      {sessions.slice(0, 2).map((session) => (
        <button
          className="session-chip"
          type="button"
          key={session.id}
          onClick={() => window.vibeIsland.jumpWorkspace(session.workspace)}
          disabled={!session.workspace}
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
              <span>Windows 控制台</span>
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
                  <strong>{section.label}</strong>
                  <small>{section.description}</small>
                </span>
              </button>
            ))}
          </nav>
          <div className="settings-sidebar-card">
            <PlugZap size={15} />
            <span>{snapshot.runtime ? `${snapshot.runtime.host}:${snapshot.runtime.port}` : '本地 IPC 未启动'}</span>
          </div>
        </aside>

        <section className="settings-main">
          <header className="settings-header">
            <div>
              <div className="section-kicker">Vibe Island Windows</div>
              <h1>{activeSectionMeta.label}</h1>
            </div>
            <div className="settings-stats">
              <span>{installedAgents}/{snapshot.agents.length} Hooks</span>
              <span>{snapshot.permissions.length} 权限提示</span>
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
                            <p>{agent.detected ? agent.configPath : '未检测到本机配置目录'}</p>
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
                            {agent.hookInstalled ? '卸载' : '安装'}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                  {message ? <div className="status-message">{message}</div> : null}
                </section>
              ) : null}

              {activeSection === 'preferences' ? (
                <section className="settings-section">
                  <SectionTitle icon={<Settings size={18} />} title="偏好" />
                  <SettingToggle
                    icon={<Power size={17} />}
                    label="开机启动"
                    checked={snapshot.config.startAtLogin}
                    onChange={(checked) => updateConfig({ startAtLogin: checked })}
                  />
                  <SettingToggle
                    icon={<Bell size={17} />}
                    label="系统通知"
                    checked={snapshot.config.notifications}
                    onChange={(checked) => updateConfig({ notifications: checked })}
                  />
                  <label className="field-row">
                    <span>提示策略</span>
                    <select
                      value={snapshot.config.notificationStrategy}
                      onChange={(event) =>
                        updateConfig({
                          notificationStrategy: event.currentTarget.value as AppConfig['notificationStrategy']
                        })
                      }
                    >
                      <option value="focused">克制</option>
                      <option value="realtime">实时</option>
                      <option value="silent">静默</option>
                    </select>
                  </label>
                  <SettingToggle
                    icon={<Activity size={17} />}
                    label="Codex 回复提示"
                    checked={snapshot.config.showCodexReplies}
                    onChange={(checked) => updateConfig({ showCodexReplies: checked })}
                  />
                  <SettingToggle
                    icon={<MonitorUp size={17} />}
                    label="声音提醒"
                    checked={snapshot.config.sound}
                    onChange={(checked) => updateConfig({ sound: checked })}
                  />
                  <label className="field-row">
                    <span>跳转目标</span>
                    <select
                      value={snapshot.config.jumpTarget}
                      onChange={(event) =>
                        updateConfig({ jumpTarget: event.currentTarget.value as AppConfig['jumpTarget'] })
                      }
                    >
                      <option value="workspace">工作区</option>
                      <option value="terminal">Windows Terminal</option>
                      <option value="none">关闭</option>
                    </select>
                  </label>
                </section>
              ) : null}

              {activeSection === 'appearance' ? (
                <section className="settings-section appearance-section">
                  <SectionTitle icon={<Palette size={18} />} title="外观" />
                  <div className="appearance-preview">
                    <div className="preview-card">
                      <span className="preview-orbit" />
                      <strong>灵动岛预览</strong>
                      <small>主题和强调色会立即保存</small>
                    </div>
                  </div>
                  <div className="choice-grid">
                    {appearanceModes.map((mode) => (
                      <button
                        className={`choice-card ${snapshot.config.theme === mode.id ? 'active' : ''}`}
                        type="button"
                        key={mode.id}
                        onClick={() => updateConfig({ theme: mode.id })}
                      >
                        <strong>{mode.label}</strong>
                        <span>{mode.description}</span>
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
                        {accent.label}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              {activeSection === 'permissions' ? (
                <section className="settings-section">
                  <SectionTitle icon={<ShieldAlert size={18} />} title="权限提示" />
                  {snapshot.permissions.length === 0 ? (
                    <div className="empty-state block">无待处理请求</div>
                  ) : (
                    snapshot.permissions.map((request) => <PermissionPanel request={request} key={request.id} />)
                  )}
                </section>
              ) : null}

              {activeSection === 'events' ? (
                <section className="settings-section wide">
                  <SectionTitle icon={<Terminal size={18} />} title="最近事件" />
                  <EventList events={activeEvents} />
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

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(timestamp));
}

export default App;
