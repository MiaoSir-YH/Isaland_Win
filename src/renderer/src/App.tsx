import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  Activity,
  AlertTriangle,
  Bell,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  ExternalLink,
  MessageCircle,
  MonitorUp,
  PlugZap,
  Power,
  Settings,
  ShieldAlert,
  Terminal,
  X
} from 'lucide-react';
import type {
  AgentDescriptor,
  AgentId,
  AgentSession,
  AppConfig,
  AppSnapshot,
  NormalizedEvent,
  PermissionRequest,
  PermissionDecision
} from '@shared/types';
import { getIslandAttentionReason, type IslandAttentionReason } from '@shared/attention';
import './styles.css';

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
  const cardRef = useRef<HTMLElement | null>(null);
  const active = snapshot.sessions[0];
  const notification = snapshot.notification;
  const permission = snapshot.permissions[0];
  const tone = getIslandTone(permission, notification, active);
  const workspaceLabel = active?.title ?? (notification?.workspace ? getWorkspaceName(notification.workspace) : undefined);
  const primaryText = permission ? permission.action : notification?.title ?? workspaceLabel ?? 'Vibe Island';
  const secondaryText = permission ? '等待确认' : notification?.message ?? formatSessionSummary(active);
  const islandWidth = estimateIslandWidth(primaryText, secondaryText);
  const textKey = permission?.id ?? notification?.id ?? `${primaryText}:${secondaryText}`;

  useEffect(() => {
    const unsubscribe = window.vibeIsland.onExpanded((next) => {
      setExpanded(next);
    });
    return unsubscribe;
  }, []);

  const syncHoverAfterCollapse = useCallback(() => {
    window.setTimeout(() => {
      void window.vibeIsland.setIslandHovered(isPointerInsideCard(cardRef.current));
    }, 0);
  }, []);

  const collapsePanel = useCallback(async () => {
    setExpanded(false);
    await window.vibeIsland.setExpanded(false);
    syncHoverAfterCollapse();
  }, [syncHoverAfterCollapse]);

  useEffect(() => {
    if (!expanded) return undefined;

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (cardRef.current?.contains(target)) return;
      void collapsePanel();
    }

    function handleWindowBlur(): void {
      void collapsePanel();
    }

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [collapsePanel, expanded]);

  async function toggleExpanded(): Promise<void> {
    const next = !expanded;
    if (!next) {
      await collapsePanel();
      return;
    }
    setExpanded(next);
    await window.vibeIsland.setExpanded(next);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLElement>): void {
    if (expanded) return;
    void window.vibeIsland.setIslandHovered(isPointerInsideCard(cardRef.current, event.clientX, event.clientY));
  }

  return (
    <MotionConfig transition={{ type: 'spring', stiffness: 520, damping: 46, mass: 0.82 }}>
      <main className="island-shell">
        <motion.section
          ref={cardRef}
          className={`island-card ${expanded ? 'expanded' : 'collapsed'} tone-${tone}`}
          animate={{ width: islandWidth }}
          transition={{ type: 'spring', stiffness: 520, damping: 46, mass: 0.82 }}
          onMouseEnter={() => window.vibeIsland.setIslandHovered(true)}
          onMouseLeave={() => window.vibeIsland.setIslandHovered(false)}
          onPointerMove={handlePointerMove}
        >
          <motion.button
            className="island-bar"
            type="button"
            onClick={toggleExpanded}
            aria-label="展开或收起 Vibe Island"
          >
            <span className={`agent-dot ${permission?.agent ?? notification?.agent ?? active?.agent ?? 'unknown'}`} />
            <RollingText value={primaryText} textKey={`primary-${textKey}`} className="island-primary" />
            <RollingText value={secondaryText} textKey={`secondary-${textKey}`} className="island-secondary" />
            {renderIslandStatusIcon(tone)}
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {tone === 'completed' ? <span className="completion-progress" aria-hidden="true" /> : null}
          </motion.button>

          <AnimatePresence initial={false}>
            {expanded ? (
              <motion.section
                key="island-panel"
                className="island-panel"
                aria-label="Vibe Island 控制面板"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              >
                {permission ? <PermissionPanel request={permission} /> : null}
                {!permission ? <SessionStrip sessions={snapshot.sessions} /> : null}
                {!permission ? <EventList events={snapshot.events.slice(0, 2)} /> : null}
                <div className="panel-actions">
                  <button className="icon-button label-button" type="button" onClick={() => window.vibeIsland.openSettings()}>
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

function isPointerInsideCard(card: HTMLElement | null, x?: number, y?: number): boolean {
  if (!card) return false;
  const rect = card.getBoundingClientRect();
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

function measureTextUnits(value: string): number {
  return Array.from(value).reduce((sum, char) => sum + (/[\u4e00-\u9fff]/.test(char) ? 1.75 : 1), 0);
}

function RollingText({
  value,
  textKey,
  className
}: {
  value: string;
  textKey: string;
  className: string;
}): JSX.Element {
  return (
    <span className={`${className} text-viewport`}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={textKey}
          className="text-roll-item"
          initial={{ opacity: 0, y: '100%' }}
          animate={{ opacity: 1, y: '0%' }}
          exit={{ opacity: 0, y: '-100%' }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
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
  async function respond(decision: PermissionDecision): Promise<void> {
    await window.vibeIsland.respondPermission({
      id: request.id,
      decision,
      decidedAt: new Date().toISOString()
    });
  }

  return (
    <section className={`permission-panel risk-${request.risk}`} aria-label="权限请求">
      <div>
        <div className="section-kicker">{agentLabels[request.agent]} 权限请求</div>
        <h2>{request.action}</h2>
        {request.command ? <code>{request.command}</code> : null}
      </div>
      <div className="permission-actions">
        <button className="decision allow" type="button" onClick={() => respond('allow')}>
          <Check size={16} />
          允许
        </button>
        <button className="decision deny" type="button" onClick={() => respond('deny')}>
          <X size={16} />
          拒绝
        </button>
        <button className="decision muted" type="button" onClick={() => respond('denyForSession')}>
          本会话拒绝
        </button>
      </div>
    </section>
  );
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
  const activeEvents = useMemo(() => snapshot.events.slice(0, 8), [snapshot.events]);

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

  return (
    <main className="settings-shell">
      <header className="settings-header">
        <div>
          <div className="section-kicker">Vibe Island Windows</div>
          <h1>Agent 控制中心</h1>
        </div>
        <div className="runtime-pill">
          <PlugZap size={16} />
          {snapshot.runtime ? `${snapshot.runtime.host}:${snapshot.runtime.port}` : '未启动'}
        </div>
      </header>

      <section className="settings-grid">
        <section className="settings-section wide">
          <SectionTitle icon={<Activity size={18} />} title="Agent Hooks" />
          <div className="agent-list">
            {snapshot.agents.map((agent) => (
              <article className="agent-row" key={agent.id}>
                <div className="agent-main">
                  <span className={`agent-dot ${agent.id}`} />
                  <div>
                    <h2>{agent.name}</h2>
                    <p>{agent.detected ? agent.configPath : '未检测到本机配置目录'}</p>
                    {agent.experimental ? <p className="warning-text">{agent.note}</p> : null}
                  </div>
                </div>
                <div className="agent-actions">
                  <button className="icon-button" type="button" onClick={() => window.vibeIsland.sendSampleEvent(agent.id)}>
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
                updateConfig({ notificationStrategy: event.currentTarget.value as AppConfig['notificationStrategy'] })
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
              onChange={(event) => updateConfig({ jumpTarget: event.currentTarget.value as AppConfig['jumpTarget'] })}
            >
              <option value="workspace">工作区</option>
              <option value="terminal">Windows Terminal</option>
              <option value="none">关闭</option>
            </select>
          </label>
          <label className="field-row">
            <span>主题</span>
            <select
              value={snapshot.config.theme}
              onChange={(event) => updateConfig({ theme: event.currentTarget.value as AppConfig['theme'] })}
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
        </section>

        <section className="settings-section">
          <SectionTitle icon={<ShieldAlert size={18} />} title="权限队列" />
          {snapshot.permissions.length === 0 ? (
            <div className="empty-state block">无待处理请求</div>
          ) : (
            snapshot.permissions.map((request) => <PermissionPanel request={request} key={request.id} />)
          )}
        </section>

        <section className="settings-section wide">
          <SectionTitle icon={<Terminal size={18} />} title="最近事件" />
          <EventList events={activeEvents} />
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

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(timestamp));
}

export default App;
