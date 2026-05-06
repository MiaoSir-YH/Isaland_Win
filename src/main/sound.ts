import { execFile } from 'node:child_process';
import type { SoundConfig } from '@shared/types';

const SOUND_ALIASES: Record<SoundConfig['name'], string> = {
  asterisk: 'SystemAsterisk',
  beep: 'SystemDefault',
  exclamation: 'SystemExclamation',
  hand: 'SystemHand',
  question: 'SystemQuestion'
};

export function playConfiguredSound(config: SoundConfig): void {
  if (!config.enabled) return;
  const alias = SOUND_ALIASES[config.name] ?? SOUND_ALIASES.asterisk;
  const command = `[console]::beep(800,120); Add-Type -AssemblyName PresentationCore; [System.Media.SystemSounds]::${alias}.Play()`;
  const child = execFile('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true }, () => undefined);
  child.unref();
}
