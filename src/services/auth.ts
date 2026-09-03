import { login, logout, getAccount, hasSession, cancelLogin, Account } from '../api/auth'

export type { Account }

/**
 * Thin facade over the Rust auth commands. There is deliberately no
 * getAccessToken or getGraphClient: tokens stay in Rust, and anything needing
 * Graph data asks Rust for it.
 */
class AuthService {
  /** Opens the system browser and resolves once the code has been exchanged. */
  async login(): Promise<Account> {
    return login()
  }

  async cancelLogin(): Promise<void> {
    return cancelLogin()
  }

  async logout(): Promise<void> {
    return logout()
  }

  async getCurrentAccount(): Promise<Account | null> {
    return getAccount()
  }

  /** Also restores a session from the stored refresh token when one exists. */
  async isLoggedIn(): Promise<boolean> {
    return hasSession()
  }
}

export const authService = new AuthService()
