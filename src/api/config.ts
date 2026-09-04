import { invoke } from '@tauri-apps/api/core'

/**
 * Application configuration, owned by Rust via tauri-plugin-store.
 * Rust needs these values too (auth in M3, sync in M4), so the store is
 * read and written there rather than from the webview.
 */

export async function getConfig<T>(key: string): Promise<T | null> {
  const value = await invoke<T | null>('get_config', { key })
  return value ?? null
}

export async function setConfig(key: string, value: unknown): Promise<void> {
  await invoke('set_config', { key, value })
}

export async function clearConfig(): Promise<void> {
  await invoke('clear_config')
}
