import { SyncConfig, SyncMetadata } from './calendar';

interface AppConfig {
  appRegistrationId: string | null;
  syncConfig?: SyncConfig;
  syncMetadata?: SyncMetadata;
  timezone?: string;
}

class StorageService {
  private readonly APP_CONFIG_KEY = 'calendar-manager-config';

  getAppRegistrationId(): string | null {
    try {
      const config = this.getConfig();
      return config.appRegistrationId;
    } catch (error) {
      console.error('Error getting app registration ID:', error);
      return null;
    }
  }

  setAppRegistrationId(appRegistrationId: string): void {
    try {
      const config = this.getConfig();
      config.appRegistrationId = appRegistrationId;
      this.setConfig(config);
    } catch (error) {
      console.error('Error setting app registration ID:', error);
    }
  }

  getSyncConfig(): SyncConfig {
    try {
      const config = this.getConfig();
      return config.syncConfig || { 
        startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0]
      };
    } catch (error) {
      console.error('Error getting sync config:', error);
      return { 
        startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0]
      };
    }
  }

  setSyncConfig(syncConfig: SyncConfig): void {
    try {
      const config = this.getConfig();
      config.syncConfig = syncConfig;
      this.setConfig(config);
    } catch (error) {
      console.error('Error setting sync config:', error);
    }
  }

  getSyncMetadata(): SyncMetadata | null {
    try {
      const config = this.getConfig();
      return config.syncMetadata || null;
    } catch (error) {
      console.error('Error getting sync metadata:', error);
      return null;
    }
  }

  setSyncMetadata(syncMetadata: SyncMetadata): void {
    try {
      const config = this.getConfig();
      
      // Clean up undefined values to avoid JSON serialization issues
      const cleanMetadata: SyncMetadata = {};
      if (syncMetadata.lastSyncTime !== undefined && syncMetadata.lastSyncTime !== null) {
        cleanMetadata.lastSyncTime = syncMetadata.lastSyncTime;
      }
      if (syncMetadata.deltaToken !== undefined) {
        cleanMetadata.deltaToken = syncMetadata.deltaToken;
      }
      if (syncMetadata.lastEventModified !== undefined) {
        cleanMetadata.lastEventModified = syncMetadata.lastEventModified;
      }
      
      config.syncMetadata = cleanMetadata;
      this.setConfig(config);
    } catch (error) {
      console.error('Error setting sync metadata:', error);
    }
  }

  private getConfig(): AppConfig {
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

  private setConfig(config: AppConfig): void {
    localStorage.setItem(this.APP_CONFIG_KEY, JSON.stringify(config));
  }

  getTimezone(): string {
    try {
      const config = this.getConfig();
      return config.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch (error) {
      console.error('Error getting timezone:', error);
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
  }

  setTimezone(timezone: string): void {
    try {
      const config = this.getConfig();
      config.timezone = timezone;
      this.setConfig(config);
    } catch (error) {
      console.error('Error setting timezone:', error);
    }
  }

  clearConfig(): void {
    localStorage.removeItem(this.APP_CONFIG_KEY);
  }
}

export const storageService = new StorageService();