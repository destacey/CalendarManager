import { describe, it, expect, vi, beforeEach } from 'vitest'

// The New month modal uses a month picker, which needs a real dayjs rather
// than the fixed-value mock `src/test/setup.ts` installs globally.
vi.unmock('dayjs')

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/utils'
import Timecards, { monthsTouched } from './Timecards'
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
vi.mock('../../services/storage', () => ({
  storageService: { getWorkingDays: vi.fn() }
}))

/* Sun 30 Aug to Sat 5 Sep is the week August and September share. */
const sharedWeek: Timecard = {
  id: 1, name: 'Week of 30 Aug 2026', start_date: '2026-08-30', end_date: '2026-09-05',
  status: 'draft', generated_at: null
}
const secondWeek: Timecard = {
  id: 2, name: 'Week of 6 Sep 2026', start_date: '2026-09-06', end_date: '2026-09-12',
  status: 'submitted', generated_at: '2026-09-12T18:00:00'
}

const entry = (over: Partial<TimecardEntry>): TimecardEntry => ({
  id: 10,
  timecard_id: 1,
  event_id: null,
  date: '2026-09-01',
  hours: 2,
  project_id: 1,
  activity_id: null,
  source: 'event',
  note: null,
  ...over
})

const pickMonth = async (user: ReturnType<typeof userEvent.setup>, month: string) => {
  await user.click(screen.getByRole('button', { name: /new month/i }))
  await user.click(await screen.findByRole('textbox', { name: 'Month' }))
  for (let year = new Date().getFullYear(); year < 2026; year++) {
    await user.click(screen.getByRole('button', { name: /next year/i }))
  }
  await user.click(await screen.findByText(month))
  await user.click(screen.getByRole('button', { name: /^create$/i }))
}

describe('monthsTouched', () => {
  it('gives one month for a week inside it', () => {
    expect(monthsTouched(secondWeek)).toEqual(['2026-09'])
  })

  /* A week spanning two months belongs to both, which is what makes it appear
     under each and stops either claiming all of its time. */
  it('gives both months for a week that spans them', () => {
    expect(monthsTouched(sharedWeek)).toEqual(['2026-08', '2026-09'])
  })
})

describe('Timecards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getTimecards).mockResolvedValue([sharedWeek, secondWeek])
    vi.mocked(getTimecardEntriesInRange).mockResolvedValue([
      entry({ id: 10, date: '2026-08-31', hours: 4 }),
      entry({ id: 11, date: '2026-09-01', hours: 2 }),
      entry({ id: 12, date: '2026-09-07', hours: 3 })
    ])
    vi.mocked(getTimecardEntries).mockResolvedValue([])
    vi.mocked(getProjects).mockResolvedValue([])
    vi.mocked(getActivities).mockResolvedValue([])
    vi.mocked(storageService.getWorkingDays).mockResolvedValue([1, 2, 3, 4, 5])
  })

  it('lists the months its weeks touch', async () => {
    render(<Timecards />)

    await waitFor(() => expect(screen.getByText('September 2026')).toBeInTheDocument())
    expect(screen.getByText('August 2026')).toBeInTheDocument()
  })

  /* Each month takes only the days that are its own, so the shared week's
     August time is August's and its September time is September's. */
  it("splits a shared week's hours between the two months", async () => {
    render(<Timecards />)

    await waitFor(() => expect(screen.getByText('5.00')).toBeInTheDocument())
    expect(screen.getByText('4.00')).toBeInTheDocument()
  })

  it('counts the weeks of each month and how many are submitted', async () => {
    render(<Timecards />)

    await waitFor(() => expect(screen.getByText('1 of 2 submitted')).toBeInTheDocument())
  })

  it('opens a month on its weeks', async () => {
    const user = userEvent.setup()
    render(<Timecards />)
    await waitFor(() => expect(screen.getByText('September 2026')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'September 2026' }))

    // The first week of the month is what it opens on.
    await waitFor(() => expect(getTimecardEntries).toHaveBeenCalledWith(1))
  })

  describe('creating a month', () => {
    it('creates a timecard for every week it touches, and pulls each', async () => {
      const user = userEvent.setup()
      vi.mocked(getTimecards).mockResolvedValue([])
      vi.mocked(getTimecardEntriesInRange).mockResolvedValue([])
      vi.mocked(createTimecard).mockImplementation(async input => ({
        ...input, id: 99, status: 'draft', generated_at: null
      }))
      vi.mocked(generateTimecardEntries).mockResolvedValue({
        eventsRead: 4, entriesCreated: 4, manualEntriesKept: 0, unmappedEvents: 0
      })
      render(<Timecards />)
      await waitFor(() => expect(screen.getByText('No timecards yet')).toBeInTheDocument())

      await pickMonth(user, 'Dec')

      // December 2026 spans five Sunday-to-Saturday weeks.
      await waitFor(() => expect(createTimecard).toHaveBeenCalledTimes(5))
      expect(createTimecard).toHaveBeenCalledWith({
        name: 'Week of 29 Nov 2026',
        start_date: '2026-11-29',
        end_date: '2026-12-05'
      })
      expect(generateTimecardEntries).toHaveBeenCalledTimes(5)
    })

    /* The shared week already exists when the neighbouring month is created,
       and creating it again would be refused as an overlap. */
    it('skips a week that already has a timecard', async () => {
      const user = userEvent.setup()
      vi.mocked(createTimecard).mockImplementation(async input => ({
        ...input, id: 99, status: 'draft', generated_at: null
      }))
      vi.mocked(generateTimecardEntries).mockResolvedValue({
        eventsRead: 0, entriesCreated: 0, manualEntriesKept: 0, unmappedEvents: 0
      })
      render(<Timecards />)
      await waitFor(() => expect(screen.getByText('September 2026')).toBeInTheDocument())

      await pickMonth(user, 'Aug')

      await waitFor(() => expect(createTimecard).toHaveBeenCalled())
      const starts = vi.mocked(createTimecard).mock.calls.map(([input]) => input.start_date)
      expect(starts).not.toContain('2026-08-30')
    })

    it("reads out the backend's reason when a week cannot be created", async () => {
      const user = userEvent.setup()
      vi.mocked(getTimecards).mockResolvedValue([])
      vi.mocked(getTimecardEntriesInRange).mockResolvedValue([])
      vi.mocked(createTimecard).mockRejectedValue(
        new Error('"Sept 2026" already covers some of 2026-11-29 to 2026-12-05.')
      )
      render(<Timecards />)
      await waitFor(() => expect(screen.getByText('No timecards yet')).toBeInTheDocument())

      await pickMonth(user, 'Dec')

      expect(await screen.findByText(/already covers some of/)).toBeInTheDocument()
      // It stops at the first refusal rather than grinding through the rest.
      expect(createTimecard).toHaveBeenCalledTimes(1)
    })
  })

  it('deletes every week of a month', async () => {
    const user = userEvent.setup()
    vi.mocked(deleteTimecard).mockResolvedValue(true)
    render(<Timecards />)
    await waitFor(() => expect(screen.getByText('September 2026')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Delete September 2026' }))
    await user.click(await screen.findByRole('button', { name: /^yes$/i }))

    await waitFor(() => expect(deleteTimecard).toHaveBeenCalledTimes(2))
  })

  it('reports a load failure rather than showing an empty list', async () => {
    vi.mocked(getTimecards).mockRejectedValue(new Error('boom'))
    render(<Timecards />)

    await waitFor(() => expect(screen.getByText('Failed to load timecards')).toBeInTheDocument())
  })
})
