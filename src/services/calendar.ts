import dayjs from 'dayjs'
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'
import { storageService } from './storage'
import type { SyncConfig, SyncResult } from '../api/sync'

dayjs.extend(isSameOrBefore)

export type { SyncConfig, SyncResult }
export { startSync, cancelSync, getSyncStatus, onSyncStatus, onSyncComplete } from '../api/sync'

/** Carried from electron-store; delta sync is gone, but useStorage.ts still shapes state around it. */
export interface SyncMetadata {
  deltaToken?: string
  lastEventModified?: string
}
const defaultSyncConfig: SyncConfig = {
  startDate: dayjs().subtract(7, 'day').format('YYYY-MM-DD'),
  endDate: dayjs().format('YYYY-MM-DD'),
}
export function getDefaultSyncConfig(): SyncConfig {
  return { ...defaultSyncConfig }
}

export function validateSyncConfig(config: SyncConfig): boolean {
  const startDate = dayjs(config.startDate)
  const endDate = dayjs(config.endDate)
  return (
    typeof config.startDate === 'string' &&
    typeof config.endDate === 'string' &&
    startDate.isValid() &&
    endDate.isValid() &&
    startDate.isSameOrBefore(endDate) &&
    endDate.diff(startDate, 'days') <= 365
  )
}

export async function getCurrentSyncConfig(): Promise<SyncConfig> {
  const stored = await storageService.getSyncConfig()
  return stored?.startDate && stored?.endDate ? stored : getDefaultSyncConfig()
}

export async function setSyncConfig(config: SyncConfig): Promise<void> {
  if (!validateSyncConfig(config)) throw new Error('Invalid sync configuration')
  await storageService.setSyncConfig(config)
}
