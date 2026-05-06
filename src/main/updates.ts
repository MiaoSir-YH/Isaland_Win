import type { UpdateConfig } from '@shared/types';
import { app } from 'electron';
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;

export async function checkForUpdates(config: UpdateConfig): Promise<UpdateConfig> {
  if (!config.enabled) {
    return {
      ...config,
      status: 'idle',
      message: 'Automatic updates are disabled.'
    };
  }

  const lastCheckedAt = new Date().toISOString();
  if (!app.isPackaged) {
    return {
      ...config,
      lastCheckedAt,
      status: 'not-available',
      message: 'Update checks run only from packaged builds.'
    };
  }

  try {
    autoUpdater.autoDownload = false;
    autoUpdater.allowPrerelease = config.channel === 'prerelease';
    const result = await autoUpdater.checkForUpdates();
    const version = result?.updateInfo?.version;
    return {
      ...config,
      lastCheckedAt,
      status: version && version !== app.getVersion() ? 'available' : 'not-available',
      message: version && version !== app.getVersion() ? `Update ${version} is available.` : 'No update is available.'
    };
  } catch (error) {
    return {
      ...config,
      lastCheckedAt,
      status: 'error',
      message: error instanceof Error ? error.message : String(error)
    };
  }
}
