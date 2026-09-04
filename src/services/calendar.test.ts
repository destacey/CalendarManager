import { describe, it, expect, vi, beforeEach } from 'vitest'

// The global test setup (src/test/setup.ts) mocks `dayjs` with a fixed-value
// stand-in so calendar-grid tests don't do real date math. validateSyncConfig
// needs the real thing to actually compare the two dates it's given.
vi.unmock('dayjs')

import * as syncApi from '../api/sync'
import { startSync, cancelSync, validateSyncConfig } from './calendar'

vi.mock('../api/sync', () => ({
  startSync: vi.fn(),
  cancelSync: vi.fn(),
  getSyncStatus: vi.fn(),
  onSyncStatus: vi.fn(),
  onSyncComplete: vi.fn(),
}))

describe('calendar service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates startSync to the Rust command', async () => {
    vi.mocked(syncApi.startSync).mockResolvedValue(undefined)

    await startSync()

    expect(syncApi.startSync).toHaveBeenCalled()
  })

  it('delegates cancelSync to the Rust command', async () => {
    vi.mocked(syncApi.cancelSync).mockResolvedValue(undefined)

    await cancelSync()

    expect(syncApi.cancelSync).toHaveBeenCalled()
  })

  it('rejects a reversed date range', () => {
    expect(
      validateSyncConfig({ startDate: '2026-03-31', endDate: '2026-03-01' })
    ).toBe(false)
  })

  it('rejects a range over 365 days', () => {
    expect(
      validateSyncConfig({ startDate: '2025-01-01', endDate: '2026-01-02' })
    ).toBe(false)
  })

  it('accepts a valid range within 365 days', () => {
    expect(
      validateSyncConfig({ startDate: '2026-01-01', endDate: '2026-01-31' })
    ).toBe(true)
  })

  it('accepts a range of exactly 365 days', () => {
    expect(
      validateSyncConfig({ startDate: '2025-01-01', endDate: '2026-01-01' })
    ).toBe(true)
  })
})
