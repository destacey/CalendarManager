import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as configApi from '../api/config'
import { storageService } from './storage'

vi.mock('../api/config', () => ({
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  clearConfig: vi.fn(),
}))

const mockGetConfig = vi.mocked(configApi.getConfig)
const mockSetConfig = vi.mocked(configApi.setConfig)
const mockClearConfig = vi.mocked(configApi.clearConfig)

describe('storageService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('appRegistrationId', () => {
    it('reads the stored client id', async () => {
      mockGetConfig.mockResolvedValue('abc-123')

      const result = await storageService.getAppRegistrationId()

      expect(mockGetConfig).toHaveBeenCalledWith('appRegistrationId')
      expect(result).toBe('abc-123')
    })

    it('returns null when nothing is stored', async () => {
      mockGetConfig.mockResolvedValue(null)

      expect(await storageService.getAppRegistrationId()).toBeNull()
    })

    it('returns null when the backend throws', async () => {
      mockGetConfig.mockRejectedValue(new Error('store unavailable'))

      expect(await storageService.getAppRegistrationId()).toBeNull()
    })

    it('writes the client id', async () => {
      await storageService.setAppRegistrationId('xyz-789')

      expect(mockSetConfig).toHaveBeenCalledWith('appRegistrationId', 'xyz-789')
    })
  })

  describe('timezone', () => {
    it('falls back to the system timezone when unset', async () => {
      mockGetConfig.mockResolvedValue(null)
      const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone

      expect(await storageService.getTimezone()).toBe(systemZone)
    })

    it('prefers the stored timezone', async () => {
      mockGetConfig.mockResolvedValue('Europe/London')

      expect(await storageService.getTimezone()).toBe('Europe/London')
    })
  })

  describe('syncConfig', () => {
    it('returns a default range when unset', async () => {
      mockGetConfig.mockResolvedValue(null)

      const config = await storageService.getSyncConfig()

      expect(config.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(config.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('prefers the stored range', async () => {
      mockGetConfig.mockResolvedValue({ startDate: '2026-01-01', endDate: '2026-01-31' })

      const config = await storageService.getSyncConfig()

      expect(config).toEqual({ startDate: '2026-01-01', endDate: '2026-01-31' })
    })
  })

  describe('syncMetadata', () => {
    it('strips undefined values before writing', async () => {
      await storageService.setSyncMetadata({ deltaToken: 'token-1', lastEventModified: undefined })

      expect(mockSetConfig).toHaveBeenCalledWith('syncMetadata', { deltaToken: 'token-1' })
    })
  })

  describe('clearConfig', () => {
    it('delegates to the backend', async () => {
      await storageService.clearConfig()

      expect(mockClearConfig).toHaveBeenCalled()
    })
  })
})
