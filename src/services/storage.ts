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

  /**
   * Which weekdays count when splitting a MULTI-DAY all-day event, as
   * 0 = Sunday .. 6 = Saturday. Defaults to Mon–Fri.
   *
   * This is deliberately not a filter on what counts generally — work on a
   * Saturday still counts. It only decides which days a week-long block is
   * spread across.
   */
  async getWorkingDays(): Promise<number[]> {
    const monToFri = [1, 2, 3, 4, 5]
    try {
      const stored = await getConfig<number[]>('workingDays')
      // An empty array would make every multi-day event worth nothing, which
      // is never what someone means by "no working days".
      return stored && stored.length > 0 ? stored : monToFri
    } catch (error) {
      console.error('Error getting working days:', error)
      return monToFri
    }
  }

  async setWorkingDays(days: number[]): Promise<void> {
    try {
      await setConfig('workingDays', days)
    } catch (error) {
      console.error('Error setting working days:', error)
    }
  }

  /** When a synthesised all-day working day starts, as "HH:mm". */
  async getWorkdayStart(): Promise<string> {
    try {
      return (await getConfig<string>('workdayStart')) ?? '08:00'
    } catch (error) {
      console.error('Error getting workday start:', error)
      return '08:00'
    }
  }

  async setWorkdayStart(time: string): Promise<void> {
    try {
      await setConfig('workdayStart', time)
    } catch (error) {
      console.error('Error setting workday start:', error)
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
