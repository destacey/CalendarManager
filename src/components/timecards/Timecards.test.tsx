import { describe, it, expect, vi, beforeEach } from 'vitest'

// The week picker needs a real dayjs rather than the fixed-value mock
// `src/test/setup.ts` installs globally.
vi.unmock('dayjs')

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/utils'
import Timecards from './Timecards'
import {
  getTimecards,
  createTimecard,
  deleteTimecard,
  getTimecardEntries,
  getTimecardEntriesInRange,
  generateTimecardEntries,
  Timecard,
  TimecardEntry
} from '../../api/timecards'
import { getProjects } from '../../api/projects'
import { getActivities } from '../../api/activities'
import { getEventTypes } from '../../api/eventTypes'
import { storageService } from '../../services/storage'

vi.mock('../../api/timecards', async () => {
  const actual = await vi.importActual('../../api/timecards')
  return {
    ...actual,
    getTimecards: vi.fn(),
    createTimecard: vi.fn(),
    deleteTimecard: vi.fn(),
    getTimecardEntries: vi.fn(),
    getTimecardEntriesInRange: vi.fn(),
    generateTimecardEntries: vi.fn(),
    addTimecardEntry: vi.fn(),
    updateTimecardEntry: vi.fn(),
    deleteTimecardEntry: vi.fn(),
    setTimecardCell: vi.fn(),
    submitTimecard: vi.fn(),
    reopenTimecard: vi.fn()
  }
})
vi.mock('../../api/projects', () => ({ getProjects: vi.fn() }))
vi.mock('../../api/activities', () => ({ getActivities: vi.fn() }))
vi.mock('../../api/eventTypes', () => ({ getEventTypes: vi.fn() }))
vi.mock('../../api/events', () => ({ getEventsByIds: vi.fn() }))
vi.mock('../../api/mapping', () => ({ mapEvents: vi.fn(), unmapEvents: vi.fn() }))
vi.mock('../../services/storage', () => ({
  storageService: { getWorkingDays: vi.fn() }
}))

const week: Timecard = {
  id: 1, name: 'Week of 30 Aug 2026', start_date: '2026-08-30', end_date: '2026-09-05',
  status: 'draft', generated_at: '2026-09-05T18:00:00'
}

const entry = (over: Partial<TimecardEntry>): TimecardEntry => ({
  id: 10,
  timecard_id: 1,
  event_id: null,
  date: '2026-09-01',
  hours: 4,
  project_id: 1,
  activity_id: null,
  source: 'event',
  note: null,
  ...over
})

describe('Timecards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getTimecards).mockResolvedValue([week])
    vi.mocked(getTimecardEntriesInRange).mockResolvedValue([entry({})])
    vi.mocked(getTimecardEntries).mockResolvedValue([])
    vi.mocked(getProjects).mockResolvedValue([])
    vi.mocked(getActivities).mockResolvedValue([])
    vi.mocked(getEventTypes).mockResolvedValue([])
    vi.mocked(storageService.getWorkingDays).mockResolvedValue([1, 2, 3, 4, 5])
  })

  it('lists the weeks with their hours', async () => {
    render(<Timecards />)

    await waitFor(() => expect(screen.getByText('Week of 30 Aug 2026')).toBeInTheDocument())
    expect(screen.getByText('4.00')).toBeInTheDocument()
  })

  it('opens a week', async () => {
    const user = userEvent.setup()
    render(<Timecards />)
    await waitFor(() => expect(screen.getByText('Week of 30 Aug 2026')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Week of 30 Aug 2026' }))

    await waitFor(() => expect(getTimecardEntries).toHaveBeenCalledWith(1))
  })

  describe('creating a week', () => {
    it('creates the Sunday-to-Saturday week around the date picked, and pulls it', async () => {
      const user = userEvent.setup()
      vi.mocked(getTimecards).mockResolvedValue([])
      vi.mocked(getTimecardEntriesInRange).mockResolvedValue([])
      vi.mocked(createTimecard).mockImplementation(async input => ({
        ...input, id: 9, status: 'draft', generated_at: null
      }))
      vi.mocked(generateTimecardEntries).mockResolvedValue({
        eventsRead: 12, entriesCreated: 10, manualEntriesKept: 0, unmappedEvents: 0
      })
      render(<Timecards />)
      await waitFor(() => expect(screen.getByText('No timecards yet')).toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: /new week/i }))
      await user.click(screen.getByRole('button', { name: /^create$/i }))

      await waitFor(() => expect(createTimecard).toHaveBeenCalledTimes(1))
      const [input] = vi.mocked(createTimecard).mock.calls[0]
      // Seven days, Sunday to Saturday, whatever day was chosen.
      expect(new Date(input.start_date + 'T00:00:00Z').getUTCDay()).toBe(0)
      expect(new Date(input.end_date + 'T00:00:00Z').getUTCDay()).toBe(6)
      expect(generateTimecardEntries).toHaveBeenCalledWith(9, [1, 2, 3, 4, 5])
    })

    /* Weeks cannot overlap, so the existing one is opened rather than a
       second attempt being made and refused. */
    it('opens the existing week instead of making a second', async () => {
      const user = userEvent.setup()
      const thisWeek = new Date()
      const sunday = new Date(
        Date.UTC(thisWeek.getFullYear(), thisWeek.getMonth(), thisWeek.getDate() - thisWeek.getDay())
      )
      const saturday = new Date(sunday)
      saturday.setUTCDate(saturday.getUTCDate() + 6)
      vi.mocked(getTimecards).mockResolvedValue([
        {
          ...week,
          id: 4,
          start_date: sunday.toISOString().slice(0, 10),
          end_date: saturday.toISOString().slice(0, 10)
        }
      ])
      render(<Timecards />)
      await waitFor(() => expect(screen.getByText('Week of 30 Aug 2026')).toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: /new week/i }))
      await user.click(screen.getByRole('button', { name: /^create$/i }))

      await waitFor(() => expect(getTimecardEntries).toHaveBeenCalledWith(4))
      expect(createTimecard).not.toHaveBeenCalled()
    })

    it("reads out the backend's reason when a week cannot be created", async () => {
      const user = userEvent.setup()
      vi.mocked(getTimecards).mockResolvedValue([])
      vi.mocked(getTimecardEntriesInRange).mockResolvedValue([])
      vi.mocked(createTimecard).mockRejectedValue(
        new Error('"Sept 2026" already covers some of those dates.')
      )
      render(<Timecards />)
      await waitFor(() => expect(screen.getByText('No timecards yet')).toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: /new week/i }))
      await user.click(screen.getByRole('button', { name: /^create$/i }))

      expect(await screen.findByText(/already covers some of those dates/)).toBeInTheDocument()
    })
  })

  it('deletes a week', async () => {
    const user = userEvent.setup()
    vi.mocked(deleteTimecard).mockResolvedValue(true)
    render(<Timecards />)
    await waitFor(() => expect(screen.getByText('Week of 30 Aug 2026')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Delete Week of 30 Aug 2026' }))
    await user.click(await screen.findByRole('button', { name: /^yes$/i }))

    await waitFor(() => expect(deleteTimecard).toHaveBeenCalledWith(1))
  })

  /* A longer stretch is a question about totals, not a bigger timecard. */
  describe('the report', () => {
    it('is a tab beside the timecards', async () => {
      const user = userEvent.setup()
      render(<Timecards />)
      await waitFor(() => expect(screen.getByText('Week of 30 Aug 2026')).toBeInTheDocument())

      await user.click(screen.getByText('Report'))

      await waitFor(() =>
        expect(screen.getByPlaceholderText('Start date')).toBeInTheDocument()
      )
      expect(screen.queryByText('Week of 30 Aug 2026')).not.toBeInTheDocument()
    })
  })

  it('reports a load failure rather than an empty list', async () => {
    vi.mocked(getTimecards).mockRejectedValue(new Error('boom'))
    render(<Timecards />)

    await waitFor(() => expect(screen.getByText('Failed to load timecards')).toBeInTheDocument())
  })
})
