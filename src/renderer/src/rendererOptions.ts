import type { AccentTheme, AppearanceTheme, AppConfig } from '@shared/types';

export const appearanceModeIds: AppearanceTheme[] = ['system', 'light', 'dark'];

export const accentThemes: Array<{ id: AccentTheme; color: string }> = [
  { id: 'classic', color: '#070b18' },
  { id: 'teal', color: '#14b8a6' },
  { id: 'blue', color: '#3b82f6' },
  { id: 'violet', color: '#8b5cf6' },
  { id: 'orange', color: '#f97316' },
  { id: 'graphite', color: '#64748b' }
];

export const soundNames: Array<{ id: AppConfig['sound']['name']; label: string }> = [
  { id: 'asterisk', label: 'Asterisk' },
  { id: 'beep', label: 'Beep' },
  { id: 'exclamation', label: 'Exclamation' },
  { id: 'hand', label: 'Hand' },
  { id: 'question', label: 'Question' }
];
