import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/utils'
import TimecardDetail from './TimecardDetail'
import {
  getTimecardEntries,
  generateTimecardEntries,
  addTimecardEntry,
  updateTimecardEntry,
  deleteTimecardEntry,
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
    submitTimecard: vi.fn(),
    reopenTimecard: vi.fn()
  }
})
vi.mock('../../api/projects', () => ({ getProjects: vi.fn() }))
vi.mock('../../api/activities', () => ({ getActivities: vi.fn() }))
vi.mock('../../services/storage', () => ({
  storageService: { getWorkingDays: vi.fn() }
}))

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
    id: 10, timecard_id: 1, event_id: 5, date: '2026-10-05', hours: 1.5,
    project_id: 1, activity_id: 7, source: 'event', note: null
  },
  {
    id: 11, timecard_id: 1, event_id: null, date: '2026-10-06', hours: 3,
    project_id: 1, activity_id: null, source: 'manual', note: 'Phone call'
  },
  {
    id: 12, timecard_id: 1, event_id: null, date: '2026-10-07', hours: 2,
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

describe('TimecardDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getTimecardEntries).mockResolvedValue(entries)
    vi.mocked(getProjects).mockResolvedValue(projects)
    vi.mocked(getActivities).mockResolvedValue(activities)
    vi.mocked(storageService.getWorkingDays).mockResolvedValue([1, 2, 3, 4, 5])
  })

  it('lists the entries', async () => {
    renderDetail()

    await waitFor(() => expect(screen.getByText('2026-10-05')).toBeInTheDocument())
    expect(screen.getByText('2026-10-06')).toBeInTheDocument()
  })

  /* The number the whole feature exists to produce. */
  it('totals the hours and breaks them down by project', async () => {
    renderDetail()

    await waitFor(() => expect(screen.getByText('6.50 hours')).toBeInTheDocument())
    expect(screen.getByText('PRJ-001 4.50')).toBeInTheDocument()
    expect(screen.getByText('PRJ-002 2.00')).toBeInTheDocument()
  })

  /* A manual entry is the one a refresh will not touch, so it is marked. */
  it('marks which entries are yours rather than generated', async () => {
    renderDetail()

    await waitFor(() => expect(screen.getByText('Yours')).toBeInTheDocument())
    expect(screen.getAllByText('From event')).toHaveLength(1)
  })

  /* An entry whose event a sync deleted still belongs on the card. */
  it('shows an entry whose event has been deleted', async () => {
    vi.mocked(getTimecardEntries).mockResolvedValue([
      { ...entries[0], event_id: null, source: 'event' }
    ])
    renderDetail()

    await waitFor(() => expect(screen.getByText('Event (deleted)')).toBeInTheDocument())
  })

  describe('pulling from events', () => {
    it('passes the configured working days', async () => {
      const user = userEvent.setup()
      vi.mocked(storageService.getWorkingDays).mockResolvedValue([1, 2, 3, 4])
      vi.mocked(generateTimecardEntries).mockResolvedValue({
        eventsRead: 10, entriesCreated: 8, manualEntriesKept: 1, unmappedEvents: 0
      })
      renderDetail()
      await waitFor(() => expect(screen.getByText('2026-10-05')).toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: /refresh from events/i }))

      await waitFor(() => {
        expect(generateTimecardEntries).toHaveBeenCalledWith(1, [1, 2, 3, 4])
      })
    })

    /* Unmapped events produce no entry, so silence here would be time
       quietly going missing. */
    it('warns when events produced no entry', async () => {
      const user = userEvent.setup()
      vi.mocked(generateTimecardEntries).mockResolvedValue({
        eventsRead: 12, entriesCreated: 8, manualEntriesKept: 0, unmappedEvents: 4
      })
      renderDetail()
      await waitFor(() => expect(screen.getByText('2026-10-05')).toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: /refresh from events/i }))

      await waitFor(() => {
        expect(screen.getByText('4 events produced no entry')).toBeInTheDocument()
      })
    })

    it('says Pull rather than Refresh the first time', async () => {
      renderDetail({ ...draft, generated_at: null })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /pull from events/i })).toBeInTheDocument()
      })
    })
  })

  describe('editing', () => {
    it('changes the project on an entry', async () => {
      const user = userEvent.setup()
      vi.mocked(updateTimecardEntry).mockResolvedValue(entries[0])
      renderDetail()
      await waitFor(() => expect(screen.getByText('2026-10-05')).toBeInTheDocument())

      await user.click(screen.getByRole('combobox', { name: 'Project on 2026-10-05' }))
      // Another row already HAS PRJ-002, and its selected-value display
      // carries the same title, so this has to pick the dropdown option.
      const matches = await screen.findAllByTitle('PRJ-002 — Billing')
      const option = matches.find(el => el.classList.contains('ant-select-item-option'))
      await user.click(option!)

      await waitFor(() => {
        expect(updateTimecardEntry).toHaveBeenCalledWith(
          10,
          expect.objectContaining({ project_id: 2 })
        )
      })
    })

    it('deletes an entry after confirmation', async () => {
      const user = userEvent.setup()
      vi.mocked(deleteTimecardEntry).mockResolvedValue(true)
      renderDetail()
      await waitFor(() => expect(screen.getByText('2026-10-05')).toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: 'Delete entry on 2026-10-05' }))
      await user.click(await screen.findByRole('button', { name: /^yes$/i }))

      await waitFor(() => expect(deleteTimecardEntry).toHaveBeenCalledWith(10))
    })

    it('adds a manual entry', async () => {
      const user = userEvent.setup()
      vi.mocked(addTimecardEntry).mockResolvedValue(entries[1])
      renderDetail()
      await waitFor(() => expect(screen.getByText('2026-10-05')).toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: /add entry/i }))

      await waitFor(() => expect(addTimecardEntry).toHaveBeenCalledWith(1, expect.any(Object)))
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

      await waitFor(() => expect(screen.getByText('2026-10-05')).toBeInTheDocument())
      expect(screen.getByRole('button', { name: /refresh from events/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /add entry/i })).toBeDisabled()
      expect(screen.getByRole('combobox', { name: 'Project on 2026-10-05' })).toBeDisabled()
    })

    it('offers Reopen instead of Submit', async () => {
      const user = userEvent.setup()
      vi.mocked(reopenTimecard).mockResolvedValue(draft)
      const { onChanged } = renderDetail(submitted)
      await waitFor(() => expect(screen.getByText('2026-10-05')).toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: /^reopen$/i }))

      await waitFor(() => expect(reopenTimecard).toHaveBeenCalledWith(1))
      expect(onChanged).toHaveBeenCalled()
    })

    /* If the backend refuses a write, its message already says to reopen. */
    it('surfaces a refusal from the backend verbatim', async () => {
      const user = userEvent.setup()
      vi.mocked(addTimecardEntry).mockRejectedValue(
        new TimecardSubmittedError(
          'This timecard has been submitted. Reopen it before making changes.'
        )
      )
      renderDetail()
      await waitFor(() => expect(screen.getByText('2026-10-05')).toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: /add entry/i }))

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
