import { SyncConfig, SyncMetadata } from './calendar';

interface AppConfig {
  appRegistrationId: string | null;
  syncConfig?: SyncConfig;
  syncMetadata?: SyncMetadata;
  timezone?: string;
}

class StorageService {
  private readonly APP_CONFIG_KEY = 'calendar-manager-config';

  // Check if we're in Electron environment
  private get isElectron(): boolean {
    return typeof window !== 'undefined' && window.electronAPI;
  }

  async getAppRegistrationId(): Promise<string | null> {
    try {
      if (this.isElectron) {
        return await window.electronAPI.getConfig('appRegistrationId');
      } else {
        // Fallback to localStorage for web/dev environment
        const config = this.getLocalStorageConfig();
        return config.appRegistrationId;
      }
    } catch (error) {
      console.error('Error getting app registration ID:', error);
      return null;
    }
  }

  async setAppRegistrationId(appRegistrationId: string): Promise<void> {
    try {
      if (this.isElectron) {
        await window.electronAPI.setConfig('appRegistrationId', appRegistrationId);
      } else {
        // Fallback to localStorage for web/dev environment
        const config = this.getLocalStorageConfig();
        config.appRegistrationId = appRegistrationId;
        this.setLocalStorageConfig(config);
      }
    } catch (error) {
      console.error('Error setting app registration ID:', error);
    }
  }

  async getSyncConfig(): Promise<SyncConfig> {
    try {
      const defaultConfig = {
        startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0]
      };

      if (this.isElectron) {
        const config = await window.electronAPI.getConfig('syncConfig');
        return config || defaultConfig;
      } else {
        // Fallback to localStorage for web/dev environment
        const config = this.getLocalStorageConfig();
        return config.syncConfig || defaultConfig;
      }
    } catch (error) {
      console.error('Error getting sync config:', error);
      return {
        startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0]
      };
    }
  }

  async setSyncConfig(syncConfig: SyncConfig): Promise<void> {
    try {
      if (this.isElectron) {
        await window.electronAPI.setConfig('syncConfig', syncConfig);
      } else {
        // Fallback to localStorage for web/dev environment
        const config = this.getLocalStorageConfig();
        config.syncConfig = syncConfig;
        this.setLocalStorageConfig(config);
      }
    } catch (error) {
      console.error('Error setting sync config:', error);
    }
  }

  async getSyncMetadata(): Promise<SyncMetadata | null> {
    try {
      if (this.isElectron) {
        return await window.electronAPI.getConfig('syncMetadata');
      } else {
        // Fallback to localStorage for web/dev environment
        const config = this.getLocalStorageConfig();
        return config.syncMetadata || null;
      }
    } catch (error) {
      console.error('Error getting sync metadata:', error);
      return null;
    }
  }

  async setSyncMetadata(syncMetadata: SyncMetadata): Promise<void> {
    try {
      // Clean up undefined values to avoid JSON serialization issues
      const cleanMetadata: SyncMetadata = {};
      if (syncMetadata.deltaToken !== undefined) {
        cleanMetadata.deltaToken = syncMetadata.deltaToken;
      }
      if (syncMetadata.lastEventModified !== undefined) {
        cleanMetadata.lastEventModified = syncMetadata.lastEventModified;
      }
      
      if (this.isElectron) {
        await window.electronAPI.setConfig('syncMetadata', cleanMetadata);
      } else {
        // Fallback to localStorage for web/dev environment
        const config = this.getLocalStorageConfig();
        config.syncMetadata = cleanMetadata;
        this.setLocalStorageConfig(config);
      }
    } catch (error) {
      console.error('Error setting sync metadata:', error);
    }
  }

  async getTimezone(): Promise<string> {
    try {
      const defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      
      if (this.isElectron) {
        const timezone = await window.electronAPI.getConfig('timezone');
        return timezone || defaultTimezone;
      } else {
        // Fallback to localStorage for web/dev environment
        const config = this.getLocalStorageConfig();
        return config.timezone || defaultTimezone;
      }
    } catch (error) {
      console.error('Error getting timezone:', error);
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
  }

  async setTimezone(timezone: string): Promise<void> {
    try {
      if (this.isElectron) {
        await window.electronAPI.setConfig('timezone', timezone);
      } else {
        // Fallback to localStorage for web/dev environment
        const config = this.getLocalStorageConfig();
        config.timezone = timezone;
        this.setLocalStorageConfig(config);
      }
    } catch (error) {
      console.error('Error setting timezone:', error);
    }
  }

  async clearConfig(): Promise<void> {
    try {
      if (this.isElectron) {
        await window.electronAPI.clearConfig();
      } else {
        // Fallback to localStorage for web/dev environment
        localStorage.removeItem(this.APP_CONFIG_KEY);
      }
    } catch (error) {
      console.error('Error clearing config:', error);
    }
  }

  // Fallback methods for localStorage (dev environment)
  private getLocalStorageConfig(): AppConfig {
    try {
      const configJson = localStorage.getItem(this.APP_CONFIG_KEY);
      if (!configJson) {
        return { appRegistrationId: null };
      }
      return JSON.parse(configJson);
    } catch (error) {
      console.error('Error parsing config from localStorage:', error);
      return { appRegistrationId: null };
    }
  }

  private setLocalStorageConfig(config: AppConfig): void {
    localStorage.setItem(this.APP_CONFIG_KEY, JSON.stringify(config));
  }
}

export const storageService = new StorageService();