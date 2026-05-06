import type { AgentUsage, AppConfig } from '@shared/types';
import type { Locale } from './i18n';

export function formatTime(timestamp: string, locale: Locale = 'zh-CN'): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(timestamp));
}

export function formatDateTime(timestamp: string, locale: Locale = 'zh-CN'): string {
  return new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp));
}

export function formatUsageWindow(window: AgentUsage['fiveHour']): string {
  if (!window) return 'No data';
  if (typeof window.used === 'number' && typeof window.limit === 'number') return `${window.used}/${window.limit}`;
  if (typeof window.used === 'number') return `${window.used} used`;
  if (typeof window.limit === 'number') return `${window.limit} limit`;
  return 'No data';
}

export function formatUpdateStatus(status: AppConfig['update']['status']): string {
  if (status === 'checking') return 'Checking for updates';
  if (status === 'available') return 'Update available';
  if (status === 'not-available') return 'Up to date';
  if (status === 'error') return 'Update check failed';
  return 'Update idle';
}
