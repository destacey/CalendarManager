import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

/**
 * Calendar sync, owned by Rust (`graph::sync::run`). Field names below match
 * that module's `#[serde(rename_all = "camelCase")]` payloads exactly —
 * these are not remapped.
 */

export interface SyncConfig {
  startDate: string
  endDate: string
}

export type SyncPhase = 'fetching' | 'saving' | 'cleaning'

export interface SyncStatus {
  fetched: number
  phase: SyncPhase
}

export interface SyncStats {
  created: number
  updated: number
  deleted: number
  total: number
}

export interface SyncResult {
  success: boolean
  message: string
  stats: SyncStats
  errors?: string[] | null
}

export interface SyncStatusResponse {
  isActive: boolean
  canSync: boolean
}

/** Refuses (rejects) if a sync is already running. Returns immediately — the sync itself runs in a spawned Rust task and reports progress via the events below. */
export function startSync(): Promise<void> {
  return invoke('start_sync')
}

export function cancelSync(): Promise<void> {
  return invoke('cancel_sync')
}

export function getSyncStatus(): Promise<SyncStatusResponse> {
  return invoke<SyncStatusResponse>('sync_status')
}

/** Fires once per page fetched/saved. Returns an unlisten function — call it on unmount. */
export function onSyncStatus(callback: (status: SyncStatus) => void): Promise<UnlistenFn> {
  return listen<SyncStatus>('sync-status', (event) => callback(event.payload))
}

/** Fires exactly once per sync attempt, however it ended. Returns an unlisten function — call it on unmount. */
export function onSyncComplete(callback: (result: SyncResult) => void): Promise<UnlistenFn> {
  return listen<SyncResult>('sync-complete', (event) => callback(event.payload))
}
