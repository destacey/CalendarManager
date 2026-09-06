import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/utils'
import TimecardDetail from './TimecardDetail'
import {
  getTimecardEntries,
  generateTimecardEntries,
  addTimecardEntry,
  updateTimecardEntry,
  deleteTimecardEntry,
  setTimecardCell,
  reopenTimecard,
  TimecardSubmittedError,
  Timecard
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

// October 2026 starts on a Thursday, so week 1 borrows Sun 27 - Wed 30 Sep.
const draft: Timecard = {
  id: 1,
  name: 'October 2026',
  start_date: '2026-10-01',
  end_date: '2026-10-31',
  status: 'draft',
  generated_at: '2026-10-31T18:00:00'
}

const entries = [
  {
    id: 10, timecard_id: 1, event_id: 5, date: '2026-10-01', hours: 1.5,
    project_id: 1, activity_id: 7, source: 'event', note: null
  },
  {
    id: 11, timecard_id: 1, event_id: null, date: '2026-10-02', hours: 3,
    project_id: 1, activity_id: null, source: 'manual', note: 'Phone call'
  },
  {
    id: 12, timecard_id: 1, event_id: null, date: '2026-10-14', hours: 2,
    project_id: 2, activity_id: null, source: 'event', note: null
  }
]

const projects = [
  { id: 1, name: 'Website Rebuild', code: 'PRJ-001', program: 'Platform', is_active: true },
  { id: 2, name: 'Billing', code: 'PRJ-002', program: null, is_active: true }
]
const activities = [{ id: 7, name: 'Software Development', color: '#1890ff', is_active: true }]

const renderDetail = (timecard = draft) => {
  const onChanged = vi.fn()
  render(<TimecardDetail timecard={timecard} onBack={vi.fn()} onChanged={onChanged} />)
  return { onChanged }
}

const showView = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(screen.getByText(name))
}

describe('TimecardDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getTimecardEntries).mockResolvedValue(entries)
    vi.mocked(getProjects).mockResolvedValue(projects)
    vi.mocked(getActivities).mockResolvedValue(activities)
    vi.mocked(storageService.getWorkingDays).mockResolvedValue([1, 2, 3, 4, 5])
  })

  it('opens on the week grid', async () => {
    renderDetail()

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Week' })).toBeInTheDocument()
    )
    expect(screen.getByRole('spinbutton', { name: 'PRJ-001, Software Development on 2026-10-01' })).toBeInTheDocument()
  })

  /* The number the whole feature exists to produce. */
  it('totals the hours and breaks them down by project', async () => {
    renderDetail()

    await waitFor(() => expect(screen.getByText('6.50 hours')).toBeInTheDocument())
    expect(screen.getByText('PRJ-001 4.50')).toBeInTheDocument()
    expect(screen.getByText('PRJ-002 2.00')).toBeInTheDocument()
  })

  it('shows only the selected week, and moves between them', async () => {
    const user = userEvent.setup()
    renderDetail()
    await waitFor(() =>
      expect(screen.getByRole('spinbutton', { name: 'PRJ-001, Software Development on 2026-10-01' })).toBeInTheDocument()
    )
    // The 14th is two weeks later, so it is not on screen yet.
    expect(
      screen.queryByRole('spinbutton', { name: 'PRJ-002, no activity on 2026-10-14' })
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next week' }))
    await user.click(screen.getByRole('button', { name: 'Next week' }))

    await waitFor(() =>
      expect(screen.getByRole('spinbutton', { name: 'PRJ-002, no activity on 2026-10-14' })).toBeInTheDocument()
    )
  })

  describe('editing a cell', () => {
    it('sets the cell to what was typed', async () => {
      const user = userEvent.setup()
      vi.mocked(setTimecardCell).mockResolvedValue(entries[0])
      renderDetail()
      const cell = await screen.findByRole('spinbutton', { name: 'PRJ-001, Software Development on 2026-10-01' })

      await user.clear(cell)
      await user.type(cell, '4')
      await user.tab()

      await waitFor(() =>
        expect(setTimecardCell).toHaveBeenCalledWith(1, {
          date: '2026-10-01',
          project_id: 1,
          activity_id: 7,
          hours: 4
        })
      )
    })

    /* Clearing is how a cell is deleted, and zero is what says so. */
    it('sends zero when the cell is emptied', async () => {
      const user = userEvent.setup()
      vi.mocked(setTimecardCell).mockResolvedValue(null)
      renderDetail()
      const cell = await screen.findByRole('spinbutton', { name: 'PRJ-001, Software Development on 2026-10-01' })

      await user.clear(cell)
      await user.tab()

      await waitFor(() =>
        expect(setTimecardCell).toHaveBeenCalledWith(1, expect.objectContaining({ hours: 0 }))
      )
    })

    it('does not write when the value has not changed', async () => {
      const user = userEvent.setup()
      renderDetail()
      const cell = await screen.findByRole('spinbutton', { name: 'PRJ-001, Software Development on 2026-10-01' })

      await user.click(cell)
      await user.tab()

      expect(setTimecardCell).not.toHaveBeenCalled()
    })
  })

  describe('the day modal', () => {
    it('opens from the day column header', async () => {
      const user = userEvent.setup()
      renderDetail()
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Items on 2026-10-02' })).toBeInTheDocument()
      )

      await user.click(screen.getByRole('button', { name: 'Items on 2026-10-02' }))

      const dialog = await screen.findByRole('dialog')
      // That day's entry, and not the other week's.
      expect(within(dialog).getByDisplayValue('Phone call')).toBeInTheDocument()
    })

    it('opens from the affordance beside a cell', async () => {
      const user = userEvent.setup()
      renderDetail()
      const opener = await screen.findByRole('button', {
        name: 'Items behind PRJ-001, Software Development on 2026-10-01'
      })

      await user.click(opener)

      expect(await screen.findByRole('dialog')).toBeInTheDocument()
    })

    it('adds an item to that day', async () => {
      const user = userEvent.setup()
      vi.mocked(addTimecardEntry).mockResolvedValue(entries[1])
      renderDetail()
      await user.click(await screen.findByRole('button', { name: 'Items on 2026-10-02' }))

      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: /add item/i }))
      await user.click(within(dialog).getByRole('button', { name: /^add$/i }))

      await waitFor(() =>
        expect(addTimecardEntry).toHaveBeenCalledWith(
          1,
          expect.objectContaining({ date: '2026-10-02', hours: 1 })
        )
      )
    })
  })

  describe('the summary', () => {
    it('totals by project and activity for the whole month', async () => {
      const user = userEvent.setup()
      renderDetail()
      await waitFor(() => expect(screen.getByText('6.50 hours')).toBeInTheDocument())

      await showView(user, 'Summary')

      const table = await screen.findByRole('table')
      expect(within(table).getByText('Software Development')).toBeInTheDocument()
      // The 14th is on another week, but it is still on the month's summary.
      expect(within(table).getByText('PRJ-002 — Billing')).toBeInTheDocument()
    })
  })

  describe('the entries view', () => {
    it('lists every entry with its source', async () => {
      const user = userEvent.setup()
      renderDetail()
      await waitFor(() => expect(screen.getByText('6.50 hours')).toBeInTheDocument())

      await showView(user, 'Entries')

      expect(await screen.findByText('2026-10-14')).toBeInTheDocument()
      expect(screen.getByText('Yours')).toBeInTheDocument()
      expect(screen.getAllByText('From event')).toHaveLength(1)
    })

    it('deletes an entry after confirmation', async () => {
      const user = userEvent.setup()
      vi.mocked(deleteTimecardEntry).mockResolvedValue(true)
      renderDetail()
      await waitFor(() => expect(screen.getByText('6.50 hours')).toBeInTheDocument())
      await showView(user, 'Entries')

      await user.click(await screen.findByRole('button', { name: 'Delete entry on 2026-10-01' }))
      await user.click(await screen.findByRole('button', { name: /^yes$/i }))

      await waitFor(() => expect(deleteTimecardEntry).toHaveBeenCalledWith(10))
    })

    it('edits an entry in place', async () => {
      const user = userEvent.setup()
      vi.mocked(updateTimecardEntry).mockResolvedValue(entries[0])
      renderDetail()
      await waitFor(() => expect(screen.getByText('6.50 hours')).toBeInTheDocument())
      await showView(user, 'Entries')

      const hours = await screen.findByRole('spinbutton', { name: 'Hours on 2026-10-01' })
      await user.clear(hours)
      await user.type(hours, '2')
      await user.tab()

      await waitFor(() =>
        expect(updateTimecardEntry).toHaveBeenCalledWith(10, expect.objectContaining({ hours: 2 }))
      )
    })
  })

  describe('pulling from events', () => {
    it('passes the configured working days', async () => {
      const user = userEvent.setup()
      vi.mocked(storageService.getWorkingDays).mockResolvedValue([1, 2, 3, 4])
      vi.mocked(generateTimecardEntries).mockResolvedValue({
        eventsRead: 10, entriesCreated: 8, manualEntriesKept: 1, unmappedEvents: 0
      })
      renderDetail()
      await waitFor(() => expect(screen.getByText('6.50 hours')).toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: /refresh from events/i }))

      await waitFor(() => {
        expect(generateTimecardEntries).toHaveBeenCalledWith(1, [1, 2, 3, 4])
      })
    })

    /* Unmapped time lands on the Unassigned row rather than a project, so it
       has to be called out or it gets billed to nobody. */
    it('warns when billable events have no project', async () => {
      const user = userEvent.setup()
      vi.mocked(generateTimecardEntries).mockResolvedValue({
        eventsRead: 12, entriesCreated: 8, manualEntriesKept: 0, unmappedEvents: 4
      })
      renderDetail()
      await waitFor(() => expect(screen.getByText('6.50 hours')).toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: /refresh from events/i }))

      await waitFor(() => {
        expect(screen.getByText('4 billable events have no project')).toBeInTheDocument()
      })
    })

    it('says Pull rather than Refresh the first time', async () => {
      renderDetail({ ...draft, generated_at: null })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /pull from events/i })).toBeInTheDocument()
      })
    })
  })

  describe('a submitted timecard', () => {
    const submitted = { ...draft, status: 'submitted' }

    it('says it is locked and why', async () => {
      renderDetail(submitted)

      await waitFor(() => {
        expect(screen.getByText('This timecard is submitted')).toBeInTheDocument()
      })
      expect(screen.getByText(/the calendar keeps syncing underneath/)).toBeInTheDocument()
    })

    it('disables every editing control', async () => {
      renderDetail(submitted)

      await waitFor(() =>
        expect(screen.getByRole('spinbutton', { name: 'PRJ-001, Software Development on 2026-10-01' })).toBeDisabled()
      )
      expect(screen.getByRole('button', { name: /refresh from events/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /add row/i })).toBeDisabled()
    })

    it('offers Reopen instead of Submit', async () => {
      const user = userEvent.setup()
      vi.mocked(reopenTimecard).mockResolvedValue(draft)
      const { onChanged } = renderDetail(submitted)
      await waitFor(() => expect(screen.getByText('6.50 hours')).toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: /^reopen$/i }))

      await waitFor(() => expect(reopenTimecard).toHaveBeenCalledWith(1))
      expect(onChanged).toHaveBeenCalled()
    })

    /* If the backend refuses a write, its message already says to reopen. */
    it('surfaces a refusal from the backend verbatim', async () => {
      const user = userEvent.setup()
      vi.mocked(setTimecardCell).mockRejectedValue(
        new TimecardSubmittedError(
          'This timecard has been submitted. Reopen it before making changes.'
        )
      )
      renderDetail()
      const cell = await screen.findByRole('spinbutton', { name: 'PRJ-001, Software Development on 2026-10-01' })

      await user.clear(cell)
      await user.type(cell, '9')
      await user.tab()

      await waitFor(() => {
        expect(screen.getByText(/Reopen it before making changes/)).toBeInTheDocument()
      })
    })
  })

  it('reports a load failure rather than showing an empty card', async () => {
    vi.mocked(getTimecardEntries).mockRejectedValue(new Error('boom'))
    renderDetail()

    await waitFor(() => {
      expect(screen.getByText('Failed to load the timecard')).toBeInTheDocument()
    })
  })
})
