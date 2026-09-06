import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/utils'
import TimecardPeriod from './TimecardPeriod'
import {
  getTimecardEntries,
  getTimecardEntriesInRange,
  generateTimecardEntries,
  addTimecardEntry,
  updateTimecardEntry,
  deleteTimecardEntry,
  setTimecardCell,
  submitTimecard,
  reopenTimecard,
  TimecardSubmittedError,
  Timecard,
  TimecardEntry
} from '../../api/timecards'
import { getProjects } from '../../api/projects'
import { getActivities } from '../../api/activities'
import { storageService } from '../../services/storage'

// importActual keeps the real TimecardSubmittedError: an automocked class
// never runs its constructor, so `message` would come back empty and the
// component's instanceof check would stop meaning what these tests expect.
vi.mock('../../api/timecards', async () => {
  const actual = await vi.importActual('../../api/timecards')
  return {
    ...actual,
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

/* September 2026 starts on a Tuesday, so its first week is Sun 30 Aug to
   Sat 5 Sep — the week two months share. */
const weeks: Timecard[] = [
  {
    id: 1, name: 'Week of 30 Aug 2026', start_date: '2026-08-30', end_date: '2026-09-05',
    status: 'draft', generated_at: '2026-09-05T18:00:00'
  },
  {
    id: 2, name: 'Week of 6 Sep 2026', start_date: '2026-09-06', end_date: '2026-09-12',
    status: 'submitted', generated_at: '2026-09-12T18:00:00'
  }
]

const entry = (over: Partial<TimecardEntry>): TimecardEntry => ({
  id: 10,
  timecard_id: 1,
  event_id: 5,
  date: '2026-09-01',
  hours: 1.5,
  project_id: 1,
  activity_id: 7,
  source: 'event',
  note: null,
  ...over
})

/** What week 1 holds, including its two August days. */
const weekOneEntries = [
  entry({ id: 10 }),
  entry({ id: 11, date: '2026-08-31', hours: 4, source: 'manual', event_id: null, note: 'August' })
]

/** What September holds, across both weeks — the August day is not in it. */
const septemberEntries = [
  entry({ id: 10 }),
  entry({ id: 12, timecard_id: 2, date: '2026-09-07', hours: 3, project_id: 2, activity_id: null })
]

const projects = [
  { id: 1, name: 'Website Rebuild', code: 'PRJ-001', program: 'Platform', is_active: true },
  { id: 2, name: 'Billing', code: 'PRJ-002', program: null, is_active: true }
]
const activities = [{ id: 7, name: 'Software Development', color: '#1890ff', is_active: true }]

const renderPeriod = (over: { weeks?: Timecard[] } = {}) => {
  const onChanged = vi.fn()
  render(
    <TimecardPeriod
      month="2026-09"
      weeks={over.weeks ?? weeks}
      onBack={vi.fn()}
      onChanged={onChanged}
    />
  )
  return { onChanged }
}

const showView = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(screen.getByText(name))
}

describe('TimecardPeriod', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getTimecardEntries).mockResolvedValue(weekOneEntries)
    vi.mocked(getTimecardEntriesInRange).mockResolvedValue(septemberEntries)
    vi.mocked(getProjects).mockResolvedValue(projects)
    vi.mocked(getActivities).mockResolvedValue(activities)
    vi.mocked(storageService.getWorkingDays).mockResolvedValue([1, 2, 3, 4, 5])
  })

  it('opens on the first week of the month', async () => {
    renderPeriod()

    await waitFor(() => expect(getTimecardEntries).toHaveBeenCalledWith(1))
    expect(
      screen.getByRole('spinbutton', { name: 'PRJ-001, Software Development on 2026-09-01' })
    ).toBeInTheDocument()
  })

  /* The month total is read by date across the weeks, not summed per
     timecard — so week 1's August days are not in it. */
  it('totals the month by date, not by timecard', async () => {
    renderPeriod()

    await waitFor(() =>
      expect(getTimecardEntriesInRange).toHaveBeenCalledWith('2026-09-01', '2026-09-30')
    )
    expect(await screen.findByText('4.50 hours')).toBeInTheDocument()
  })

  it('steps between the weeks of the month', async () => {
    const user = userEvent.setup()
    renderPeriod()
    await waitFor(() => expect(getTimecardEntries).toHaveBeenCalledWith(1))

    await user.click(screen.getByRole('button', { name: 'Next week' }))

    await waitFor(() => expect(getTimecardEntries).toHaveBeenCalledWith(2))
  })

  it('cannot step past either end of the month', async () => {
    const user = userEvent.setup()
    renderPeriod()
    await waitFor(() => expect(getTimecardEntries).toHaveBeenCalledWith(1))

    expect(screen.getByRole('button', { name: 'Previous week' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Next week' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled())
  })

  describe('the week is what gets submitted', () => {
    it('submits only the week on screen', async () => {
      const user = userEvent.setup()
      vi.mocked(submitTimecard).mockResolvedValue({ ...weeks[0], status: 'submitted' })
      const { onChanged } = renderPeriod()
      await waitFor(() => expect(getTimecardEntries).toHaveBeenCalledWith(1))

      await user.click(screen.getByRole('button', { name: /submit week/i }))
      const confirm = await waitFor(() => {
        const buttons = document.querySelector('.ant-popconfirm-buttons')
        if (!buttons) throw new Error('popconfirm not open')
        return within(buttons as HTMLElement).getByRole('button', { name: /^submit$/i })
      })
      await user.click(confirm)

      await waitFor(() => expect(submitTimecard).toHaveBeenCalledWith(1))
      expect(onChanged).toHaveBeenCalled()
    })

    it('locks the week that is submitted and says the others are unaffected', async () => {
      const user = userEvent.setup()
      renderPeriod()
      await waitFor(() => expect(getTimecardEntries).toHaveBeenCalledWith(1))

      await user.click(screen.getByRole('button', { name: 'Next week' }))

      expect(await screen.findByText('This week is submitted')).toBeInTheDocument()
      expect(screen.getByText(/other weeks of the month are unaffected/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /refresh from events/i })).toBeDisabled()
    })

    it('offers Reopen for a submitted week', async () => {
      const user = userEvent.setup()
      vi.mocked(reopenTimecard).mockResolvedValue(weeks[1])
      renderPeriod()
      await waitFor(() => expect(getTimecardEntries).toHaveBeenCalledWith(1))
      await user.click(screen.getByRole('button', { name: 'Next week' }))

      await user.click(await screen.findByRole('button', { name: /reopen week/i }))

      await waitFor(() => expect(reopenTimecard).toHaveBeenCalledWith(2))
    })

    /* A month with one week submitted still edits the rest. */
    it('leaves the other weeks editable', async () => {
      renderPeriod()

      await waitFor(() =>
        expect(
          screen.getByRole('spinbutton', { name: 'PRJ-001, Software Development on 2026-09-01' })
        ).toBeEnabled()
      )
    })
  })

  describe('pulling from events', () => {
    it('pulls for the week on screen, with the configured working days', async () => {
      const user = userEvent.setup()
      vi.mocked(storageService.getWorkingDays).mockResolvedValue([1, 2, 3, 4])
      vi.mocked(generateTimecardEntries).mockResolvedValue({
        eventsRead: 10, entriesCreated: 8, manualEntriesKept: 1, unmappedEvents: 0
      })
      renderPeriod()
      await waitFor(() => expect(getTimecardEntries).toHaveBeenCalledWith(1))

      await user.click(screen.getByRole('button', { name: /refresh from events/i }))

      await waitFor(() => expect(generateTimecardEntries).toHaveBeenCalledWith(1, [1, 2, 3, 4]))
    })

    it('warns when billable events have no project', async () => {
      const user = userEvent.setup()
      vi.mocked(generateTimecardEntries).mockResolvedValue({
        eventsRead: 12, entriesCreated: 8, manualEntriesKept: 0, unmappedEvents: 4
      })
      renderPeriod()
      await waitFor(() => expect(getTimecardEntries).toHaveBeenCalledWith(1))

      await user.click(screen.getByRole('button', { name: /refresh from events/i }))

      await waitFor(() =>
        expect(screen.getByText('4 billable events have no project')).toBeInTheDocument()
      )
    })
  })

  describe('editing', () => {
    it('sets a cell on the week on screen', async () => {
      const user = userEvent.setup()
      vi.mocked(setTimecardCell).mockResolvedValue(weekOneEntries[0])
      renderPeriod()
      const cell = await screen.findByRole('spinbutton', {
        name: 'PRJ-001, Software Development on 2026-09-01'
      })

      await user.clear(cell)
      await user.type(cell, '4')
      await user.tab()

      await waitFor(() =>
        expect(setTimecardCell).toHaveBeenCalledWith(1, {
          date: '2026-09-01',
          project_id: 1,
          activity_id: 7,
          hours: 4
        })
      )
    })

    /* The week owns its August days, so they are edited here — there is no
       other timecard for that time to live in. */
    it('sets a cell on a day belonging to the month next door', async () => {
      const user = userEvent.setup()
      vi.mocked(setTimecardCell).mockResolvedValue(weekOneEntries[0])
      renderPeriod()
      const cell = await screen.findByRole('spinbutton', {
        name: 'PRJ-001, Software Development on 2026-08-31'
      })

      await user.clear(cell)
      await user.type(cell, '2')
      await user.tab()

      await waitFor(() =>
        expect(setTimecardCell).toHaveBeenCalledWith(
          1,
          expect.objectContaining({ date: '2026-08-31', hours: 2 })
        )
      )
    })

    it('opens a day and shows what is behind it', async () => {
      const user = userEvent.setup()
      renderPeriod()
      await waitFor(() => expect(getTimecardEntries).toHaveBeenCalledWith(1))

      await user.click(screen.getByRole('button', { name: 'Items on 2026-08-31' }))

      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByDisplayValue('August')).toBeInTheDocument()
    })

    it('adds an item to a day', async () => {
      const user = userEvent.setup()
      vi.mocked(addTimecardEntry).mockResolvedValue(weekOneEntries[1])
      renderPeriod()
      await waitFor(() => expect(getTimecardEntries).toHaveBeenCalledWith(1))
      await user.click(screen.getByRole('button', { name: 'Items on 2026-09-01' }))

      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: /add item/i }))
      await user.click(within(dialog).getByRole('button', { name: /^add$/i }))

      await waitFor(() =>
        expect(addTimecardEntry).toHaveBeenCalledWith(
          1,
          expect.objectContaining({ date: '2026-09-01' })
        )
      )
    })

    it('surfaces a refusal from the backend verbatim', async () => {
      const user = userEvent.setup()
      vi.mocked(setTimecardCell).mockRejectedValue(
        new TimecardSubmittedError(
          'This timecard has been submitted. Reopen it before making changes.'
        )
      )
      renderPeriod()
      const cell = await screen.findByRole('spinbutton', {
        name: 'PRJ-001, Software Development on 2026-09-01'
      })

      await user.clear(cell)
      await user.type(cell, '9')
      await user.tab()

      await waitFor(() =>
        expect(screen.getByText(/Reopen it before making changes/)).toBeInTheDocument()
      )
    })
  })

  describe('the month views', () => {
    it('summarises the whole month, not just the open week', async () => {
      const user = userEvent.setup()
      renderPeriod()
      await waitFor(() => expect(getTimecardEntries).toHaveBeenCalledWith(1))

      await showView(user, 'Summary')

      const table = await screen.findByRole('table')
      // Week 2's project, though week 1 is the one on screen.
      expect(within(table).getByText('PRJ-002 — Billing')).toBeInTheDocument()
    })

    it("lists the month's entries across its weeks", async () => {
      const user = userEvent.setup()
      renderPeriod()
      await waitFor(() => expect(getTimecardEntries).toHaveBeenCalledWith(1))

      await showView(user, 'Entries')

      expect(await screen.findByText('2026-09-07')).toBeInTheDocument()
      // The August day belongs to August's total, not this list.
      expect(screen.queryByText('2026-08-31')).not.toBeInTheDocument()
    })

    it('deletes an entry from the entries view', async () => {
      const user = userEvent.setup()
      vi.mocked(deleteTimecardEntry).mockResolvedValue(true)
      renderPeriod()
      await waitFor(() => expect(getTimecardEntries).toHaveBeenCalledWith(1))
      await showView(user, 'Entries')

      await user.click(await screen.findByRole('button', { name: 'Delete entry on 2026-09-01' }))
      await user.click(await screen.findByRole('button', { name: /^yes$/i }))

      await waitFor(() => expect(deleteTimecardEntry).toHaveBeenCalledWith(10))
    })

    it('edits an entry from the entries view', async () => {
      const user = userEvent.setup()
      vi.mocked(updateTimecardEntry).mockResolvedValue(weekOneEntries[0])
      renderPeriod()
      await waitFor(() => expect(getTimecardEntries).toHaveBeenCalledWith(1))
      await showView(user, 'Entries')

      const hours = await screen.findByRole('spinbutton', { name: 'Hours on 2026-09-01' })
      await user.clear(hours)
      await user.type(hours, '2')
      await user.tab()

      await waitFor(() =>
        expect(updateTimecardEntry).toHaveBeenCalledWith(10, expect.objectContaining({ hours: 2 }))
      )
    })
  })

  it('reports a load failure rather than showing an empty month', async () => {
    vi.mocked(getTimecardEntries).mockRejectedValue(new Error('boom'))
    renderPeriod()

    await waitFor(() =>
      expect(screen.getByText('Failed to load the timecard')).toBeInTheDocument()
    )
  })
})
