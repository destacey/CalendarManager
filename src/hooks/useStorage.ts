import { useState, useEffect, useCallback } from 'react'
import { storageService } from '../services/storage'
import { SyncConfig, SyncMetadata } from '../services/calendar'

interface UseStorageReturn {
  // Values - always available (with fallbacks)
  appRegistrationId: string | null
  timezone: string
  syncConfig: SyncConfig
  syncMetadata: SyncMetadata | null
  
  // Loading states
  isLoading: boolean
  isLoaded: boolean
  
  // Setters - handle async operations internally
  setAppRegistrationId: (id: string) => Promise<void>
  setTimezone: (timezone: string) => Promise<void>
  setSyncConfig: (config: SyncConfig) => Promise<void>
  setSyncMetadata: (metadata: SyncMetadata) => Promise<void>
  clearConfig: () => Promise<void>
}

export const useStorage = (): UseStorageReturn => {
  const [appRegistrationId, setAppRegistrationIdState] = useState<string | null>(null)
  const [timezone, setTimezoneState] = useState<string>(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [syncConfig, setSyncConfigState] = useState<SyncConfig>({
    startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0]
  })
  const [syncMetadata, setSyncMetadataState] = useState<SyncMetadata | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoaded, setIsLoaded] = useState(false)

  // Load all storage values on mount
  useEffect(() => {
    const loadAllValues = async () => {
      try {
        setIsLoading(true)
        
        const [
          storedAppRegistrationId,
          storedTimezone,
          storedSyncConfig,
          storedSyncMetadata
        ] = await Promise.all([
          storageService.getAppRegistrationId(),
          storageService.getTimezone(),
          storageService.getSyncConfig(),
          storageService.getSyncMetadata()
        ])

        setAppRegistrationIdState(storedAppRegistrationId)
        setTimezoneState(storedTimezone)
        setSyncConfigState(storedSyncConfig)
        setSyncMetadataState(storedSyncMetadata)
        
        setIsLoaded(true)
      } catch (error) {
        console.error('Error loading storage values:', error)
        // Keep fallback values on error
        setIsLoaded(true)
      } finally {
        setIsLoading(false)
      }
    }

    loadAllValues()
  }, [])

  // Async setters that update both storage and state
  const setAppRegistrationId = useCallback(async (id: string) => {
    try {
      await storageService.setAppRegistrationId(id)
      setAppRegistrationIdState(id)
    } catch (error) {
      console.error('Error setting app registration ID:', error)
      throw error
    }
  }, [])

  const setTimezone = useCallback(async (tz: string) => {
    try {
      await storageService.setTimezone(tz)
      setTimezoneState(tz)
    } catch (error) {
      console.error('Error setting timezone:', error)
      throw error
    }
  }, [])

  const setSyncConfig = useCallback(async (config: SyncConfig) => {
    try {
      await storageService.setSyncConfig(config)
      setSyncConfigState(config)
    } catch (error) {
      console.error('Error setting sync config:', error)
      throw error
    }
  }, [])

  const setSyncMetadata = useCallback(async (metadata: SyncMetadata) => {
    try {
      await storageService.setSyncMetadata(metadata)
      setSyncMetadataState(metadata)
    } catch (error) {
      console.error('Error setting sync metadata:', error)
      throw error
    }
  }, [])

  const clearConfig = useCallback(async () => {
    try {
      await storageService.clearConfig()
      setAppRegistrationIdState(null)
      setTimezoneState(Intl.DateTimeFormat().resolvedOptions().timeZone)
      setSyncConfigState({
        startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0]
      })
      setSyncMetadataState(null)
    } catch (error) {
      console.error('Error clearing config:', error)
      throw error
    }
  }, [])

  return {
    // Values (always available with fallbacks)
    appRegistrationId,
    timezone,
    syncConfig,
    syncMetadata,
    
    // Loading states
    isLoading,
    isLoaded,
    
    // Async setters
    setAppRegistrationId,
    setTimezone,
    setSyncConfig,
    setSyncMetadata,
    clearConfig
  }
}