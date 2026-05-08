import type { AccentTheme, AgentId, AppConfig, AppearanceTheme } from '@shared/types';

export type SettingsSectionId =
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

export type Locale = AppConfig['language'];

export const agentLabels: Record<AgentId, string> = {
  codex: 'Codex',
  claude: 'Claude',
  'claude-desktop': 'Claude Desktop',
  'claude-cli': 'Claude CLI',
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

export const dictionaries = {
  'zh-CN': {
    loading: '载入中',
    sections: {
      hooks: ['Agent Hooks', '安装与测试'],
      usage: ['Usage', '额度与刷新'],
      preferences: ['偏好', '通知与声音'],
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
      claudeStatusLine: 'Claude CLI statusLine',
      claudeStatusLineDescription: '安装到 ~/.claude/settings.json 的受管状态栏桥接；检测到用户自定义配置时不会覆盖。',
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
      updated: '更新'
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
      preferences: ['Preferences', 'Notifications and sound'],
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
      claudeStatusLine: 'Claude CLI statusLine',
      claudeStatusLineDescription: 'Install a managed status line bridge in ~/.claude/settings.json; existing custom status lines are not overwritten.',
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
      updated: 'Updated'
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

export function getDictionary(locale: Locale) {
  return dictionaries[locale] ?? dictionaries['zh-CN'];
}
