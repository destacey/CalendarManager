interface AppConfig {
  appRegistrationId: string | null;
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

  clearConfig(): void {
    localStorage.removeItem(this.APP_CONFIG_KEY);
  }
}

export const storageService = new StorageService();