import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as authApi from '../api/auth'
import { authService } from './auth'

vi.mock('../api/auth', () => ({
  login: vi.fn(),
  cancelLogin: vi.fn(),
  logout: vi.fn(),
  getAccount: vi.fn(),
  hasSession: vi.fn(),
}))

const account = { name: 'Ada Lovelace', username: 'ada@example.com' }

describe('authService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the account on a successful login', async () => {
    vi.mocked(authApi.login).mockResolvedValue(account)

    expect(await authService.login()).toEqual(account)
  })

  it('propagates a login failure so the UI can show it', async () => {
    vi.mocked(authApi.login).mockRejectedValue('Microsoft rejected the sign-in')

    await expect(authService.login()).rejects.toBe('Microsoft rejected the sign-in')
  })

  it('reports a live session', async () => {
    vi.mocked(authApi.hasSession).mockResolvedValue(true)

    expect(await authService.isLoggedIn()).toBe(true)
  })

  it('reports no session', async () => {
    vi.mocked(authApi.hasSession).mockResolvedValue(false)

    expect(await authService.isLoggedIn()).toBe(false)
  })

  it('reads the current account', async () => {
    vi.mocked(authApi.getAccount).mockResolvedValue(account)

    expect(await authService.getCurrentAccount()).toEqual(account)
  })

  it('returns null when there is no account', async () => {
    vi.mocked(authApi.getAccount).mockResolvedValue(null)

    expect(await authService.getCurrentAccount()).toBeNull()
  })

  it('logs out', async () => {
    await authService.logout()

    expect(authApi.logout).toHaveBeenCalled()
  })

  it('exposes no way to obtain a token', () => {
    // Tokens must never cross the IPC boundary.
    const surface = authService as unknown as Record<string, unknown>
    expect(surface.getAccessToken).toBeUndefined()
    expect(surface.getGraphClient).toBeUndefined()
  })
})
