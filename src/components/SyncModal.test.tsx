import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Real antd DatePicker calls dayjs().locale(...) while formatting, which the
// global dayjs mock (src/test/setup.ts) doesn't implement. Following the
// same approach as CalendarNavigation.test.tsx: stub DatePicker only.
vi.mock('antd', async () => {
  const actual = await vi.importActual('antd')
  return {
    ...actual,
    DatePicker: vi.fn(() => React.createElement('div', { 'data-testid': 'mock-datepicker' })),
  }
})

import { render, screen, fireEvent, waitFor, act } from '../test/utils'
import SyncModal from './SyncModal'
import * as calendarService from '../services/calendar'

vi.mock('../services/calendar', () => ({
  startSync: vi.fn(() => Promise.resolve()),
  cancelSync: vi.fn(() => Promise.resolve()),
  getSyncStatus: vi.fn(() => Promise.resolve({ isActive: false, canSync: true })),
  getCurrentSyncConfig: vi.fn(() =>
    Promise.resolve({ startDate: '2026-01-01', endDate: '2026-01-31' })
  ),
  getDefaultSyncConfig: vi.fn(() => ({ startDate: '2026-01-01', endDate: '2026-01-31' })),
  setSyncConfig: vi.fn(() => Promise.resolve()),
  onSyncStatus: vi.fn(() => Promise.resolve(vi.fn())),
  onSyncComplete: vi.fn(() => Promise.resolve(vi.fn())),
}))

describe('SyncModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(calendarService.startSync).mockResolvedValue(undefined)
    vi.mocked(calendarService.cancelSync).mockResolvedValue(undefined)
    vi.mocked(calendarService.getSyncStatus).mockResolvedValue({ isActive: false, canSync: true })
    vi.mocked(calendarService.getCurrentSyncConfig).mockResolvedValue({
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    })
    vi.mocked(calendarService.getDefaultSyncConfig).mockReturnValue({
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    })
    vi.mocked(calendarService.onSyncStatus).mockResolvedValue(vi.fn())
    vi.mocked(calendarService.onSyncComplete).mockResolvedValue(vi.fn())
  })

  it('renders nothing when not visible', () => {
    render(<SyncModal visible={false} onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the Sync Calendar button when idle', async () => {
    await act(async () => {
      render(<SyncModal visible={true} onClose={vi.fn()} />)
    })

    expect(screen.getByRole('button', { name: /sync calendar/i })).toBeInTheDocument()
  })

  it('starts a sync when the Sync Calendar button is clicked', async () => {
    await act(async () => {
      render(<SyncModal visible={true} onClose={vi.fn()} />)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /sync calendar/i }))
    })

    expect(calendarService.startSync).toHaveBeenCalled()
  })

  it('disables the Sync Calendar button and shows an offline alert when offline', async () => {
    const originalOnLine = window.navigator.onLine
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true })

    try {
      await act(async () => {
        render(<SyncModal visible={true} onClose={vi.fn()} />)
      })

      expect(screen.getByRole('button', { name: /sync calendar/i })).toBeDisabled()
      expect(screen.getByText('Offline')).toBeInTheDocument()
    } finally {
      Object.defineProperty(window.navigator, 'onLine', { value: originalOnLine, configurable: true })
    }
  })

  it('shows the progress view (not the Sync Calendar button) when a sync is already in flight on mount', async () => {
    vi.mocked(calendarService.getSyncStatus).mockResolvedValue({ isActive: true, canSync: false })

    await act(async () => {
      render(<SyncModal visible={true} onClose={vi.fn()} />)
    })

    await waitFor(() => expect(screen.getByText('Starting sync…')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /sync calendar/i })).not.toBeInTheDocument()
  })

  it('subscribes to sync-status and sync-complete while visible, and unsubscribes on close', async () => {
    const unlistenStatus = vi.fn()
    const unlistenComplete = vi.fn()
    vi.mocked(calendarService.onSyncStatus).mockResolvedValue(unlistenStatus)
    vi.mocked(calendarService.onSyncComplete).mockResolvedValue(unlistenComplete)

    const { rerender } = render(<SyncModal visible={true} onClose={vi.fn()} />)

    await waitFor(() => expect(calendarService.onSyncStatus).toHaveBeenCalled())
    await waitFor(() => expect(calendarService.onSyncComplete).toHaveBeenCalled())

    await act(async () => {
      rerender(<SyncModal visible={false} onClose={vi.fn()} />)
    })

    await waitFor(() => expect(unlistenStatus).toHaveBeenCalled())
    await waitFor(() => expect(unlistenComplete).toHaveBeenCalled())
  })

  it('shows the fetched count and phase once a sync-status event arrives', async () => {
    let statusCallback: ((status: { fetched: number; phase: string }) => void) | undefined
    vi.mocked(calendarService.onSyncStatus).mockImplementation((callback: any) => {
      statusCallback = callback
      return Promise.resolve(vi.fn())
    })

    await act(async () => {
      render(<SyncModal visible={true} onClose={vi.fn()} />)
    })
    await waitFor(() => expect(calendarService.onSyncStatus).toHaveBeenCalled())

    await act(async () => {
      statusCallback?.({ fetched: 250, phase: 'saving' })
    })

    expect(screen.getByText('250 events fetched…')).toBeInTheDocument()
    expect(screen.getByText('saving')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })

  it('cancels the sync when Cancel is clicked during a sync', async () => {
    let statusCallback: ((status: { fetched: number; phase: string }) => void) | undefined
    vi.mocked(calendarService.onSyncStatus).mockImplementation((callback: any) => {
      statusCallback = callback
      return Promise.resolve(vi.fn())
    })

    await act(async () => {
      render(<SyncModal visible={true} onClose={vi.fn()} />)
    })
    await act(async () => {
      statusCallback?.({ fetched: 10, phase: 'fetching' })
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    })

    expect(calendarService.cancelSync).toHaveBeenCalled()
  })

  it('shows created/updated/deleted/total stats once sync-complete reports success', async () => {
    let completeCallback: ((result: unknown) => void) | undefined
    vi.mocked(calendarService.onSyncComplete).mockImplementation((callback: any) => {
      completeCallback = callback
      return Promise.resolve(vi.fn())
    })

    await act(async () => {
      render(<SyncModal visible={true} onClose={vi.fn()} />)
    })
    await waitFor(() => expect(calendarService.onSyncComplete).toHaveBeenCalled())

    await act(async () => {
      completeCallback?.({
        success: true,
        message: 'Successfully synced 42 events for the specified date range.',
        stats: { created: 5, updated: 30, deleted: 7, total: 42 },
      })
    })

    expect(screen.getByText('Sync Complete')).toBeInTheDocument()
    expect(screen.getByText('Successfully synced 42 events for the specified date range.')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('shows a failure alert with the error message when sync-complete reports failure', async () => {
    let completeCallback: ((result: unknown) => void) | undefined
    vi.mocked(calendarService.onSyncComplete).mockImplementation((callback: any) => {
      completeCallback = callback
      return Promise.resolve(vi.fn())
    })

    await act(async () => {
      render(<SyncModal visible={true} onClose={vi.fn()} />)
    })
    await waitFor(() => expect(calendarService.onSyncComplete).toHaveBeenCalled())

    await act(async () => {
      completeCallback?.({
        success: false,
        message: 'Unable to sync while offline. Please check your internet connection.',
        stats: { created: 0, updated: 0, deleted: 0, total: 0 },
        errors: ['Unable to sync while offline. Please check your internet connection.'],
      })
    })

    expect(screen.getByText('Sync Failed')).toBeInTheDocument()
    expect(
      screen.getAllByText('Unable to sync while offline. Please check your internet connection.').length
    ).toBeGreaterThan(0)
  })
})
