import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  BarChart3,
  Bell,
  Bug,
  ExternalLink,
  FlaskConical,
  Info,
  Keyboard,
  Languages,
  Layers,
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
import type { AgentDescriptor, AgentId, AppConfig, AppSnapshot } from '@shared/types';
import { EventList } from './activityLists';
import { formatDateTime, formatUpdateStatus } from './formatters';
import { getDictionary, type SettingsSectionId } from './i18n';
import { PermissionPanel } from './PermissionPanel';
import { accentThemes, appearanceModeIds, soundNames } from './rendererOptions';
import { KeyValueList, SectionTitle, SettingToggle, ShortcutRow, StatusTile, UsageCard } from './settingsPrimitives';

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

export function SettingsView({ snapshot }: { snapshot: AppSnapshot }): JSX.Element {
  const [busyAgent, setBusyAgent] = useState<AgentId | null>(null);
  const [message, setMessage] = useState<string>('');
  const [liveAgents, setLiveAgents] = useState<AgentDescriptor[]>(snapshot.agents);
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
  const installedAgents = liveAgents.filter((agent) => agent.hookInstalled).length;
  const activeSectionMeta = settingsSections.find((section) => section.id === activeSection) ?? settingsSections[0];
  const activeSectionText = dictionary.sections[activeSectionMeta.id];
  const remoteUrl = snapshot.runtime
    ? snapshot.diagnostics.remoteUrl ?? dictionary.labels.remoteWaiting
    : snapshot.config.remote.enabled
      ? dictionary.labels.remoteWaiting
      : dictionary.labels.remoteDisabled;

  useEffect(() => {
    setLiveAgents(snapshot.agents);
  }, [snapshot.agents]);

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
    if (activeSection !== 'hooks') return undefined;
    void window.vibeIsland
      .refreshAgents()
      .then((agents) => setLiveAgents(agents))
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : String(error));
      });
    return undefined;
  }, [activeSection]);

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
      const result = await window.vibeIsland.toggleHook(agent.id);
      setLiveAgents(await window.vibeIsland.refreshAgents());
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAgent(null);
    }
  }

  async function openAgentConfig(agent: AgentDescriptor): Promise<void> {
    if (!agent.configPath) {
      setMessage(dictionary.labels.configMissing);
      return;
    }
    try {
      const result = await window.vibeIsland.openPath(agent.configPath);
      setMessage(result || `${agent.name} 配置文件已打开。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
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

  function handleMaximizedDragStart(event: ReactPointerEvent<HTMLElement>): void {
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
                    {liveAgents.map((agent, index) => (
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
                            className="icon-button"
                            type="button"
                            onClick={() => void openAgentConfig(agent)}
                            aria-label={`打开 ${agent.name} 配置文件`}
                            disabled={!agent.configPath}
                          >
                            <ExternalLink size={16} />
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

function isInteractiveDragTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('button,input,select,textarea,a,[role="button"]'));
}
