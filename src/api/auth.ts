import { invoke } from '@tauri-apps/api/core'

/**
 * Authentication, owned by Rust. The sign-in happens in the system browser
 * and the token exchange happens in Rust, so no access token, refresh token
 * or id_token ever reaches this process.
 */

export interface Account {
  name: string
  username: string
}

export function login(): Promise<Account> {
  return invoke<Account>('login')
}

export function cancelLogin(): Promise<void> {
  return invoke('cancel_login')
}

export function logout(): Promise<void> {
  return invoke('logout')
}

export async function getAccount(): Promise<Account | null> {
  return (await invoke<Account | null>('get_account')) ?? null
}

export function hasSession(): Promise<boolean> {
  return invoke<boolean>('has_session')
}
