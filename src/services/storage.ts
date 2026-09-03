import type { SyncConfig, SyncMetadata } from './calendar'
import { getConfig, setConfig, clearConfig } from '../api/config'

/**
 * Configuration persistence. Backed by tauri-plugin-store through Rust
 * commands; every read applies its own default so a missing key is never
 * an error.
 */
class StorageService {
  private defaultSyncConfig(): SyncConfig {
    return {
      startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0],
    }
  }

  async getAppRegistrationId(): Promise<string | null> {
    try {
      return await getConfig<string>('appRegistrationId')
    } catch (error) {
      console.error('Error getting app registration ID:', error)
      return null
    }
  }

  async setAppRegistrationId(appRegistrationId: string): Promise<void> {
    try {
      await setConfig('appRegistrationId', appRegistrationId)
    } catch (error) {
      console.error('Error setting app registration ID:', error)
    }
  }

  async getSyncConfig(): Promise<SyncConfig> {
    try {
      return (await getConfig<SyncConfig>('syncConfig')) ?? this.defaultSyncConfig()
    } catch (error) {
      console.error('Error getting sync config:', error)
      return this.defaultSyncConfig()
    }
  }

  async setSyncConfig(syncConfig: SyncConfig): Promise<void> {
    try {
      await setConfig('syncConfig', syncConfig)
    } catch (error) {
      console.error('Error setting sync config:', error)
    }
  }

  async getSyncMetadata(): Promise<SyncMetadata | null> {
    try {
      return await getConfig<SyncMetadata>('syncMetadata')
    } catch (error) {
      console.error('Error getting sync metadata:', error)
      return null
    }
  }

  async setSyncMetadata(syncMetadata: SyncMetadata): Promise<void> {
    try {
      // Drop undefined values so they don't serialize as JSON nulls
      const clean: SyncMetadata = {}
      if (syncMetadata.deltaToken !== undefined) {
        clean.deltaToken = syncMetadata.deltaToken
      }
      if (syncMetadata.lastEventModified !== undefined) {
        clean.lastEventModified = syncMetadata.lastEventModified
      }
      await setConfig('syncMetadata', clean)
    } catch (error) {
      console.error('Error setting sync metadata:', error)
    }
  }

  async getTimezone(): Promise<string> {
    const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    try {
      return (await getConfig<string>('timezone')) ?? systemTimezone
    } catch (error) {
      console.error('Error getting timezone:', error)
      return systemTimezone
    }
  }

  async setTimezone(timezone: string): Promise<void> {
    try {
      await setConfig('timezone', timezone)
    } catch (error) {
      console.error('Error setting timezone:', error)
    }
  }

  async clearConfig(): Promise<void> {
    try {
      await clearConfig()
    } catch (error) {
      console.error('Error clearing config:', error)
    }
  }
}

export const storageService = new StorageService()
