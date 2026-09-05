import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/utils'
import Timecards from './Timecards'
import {
  getTimecards,
  createTimecard,
  deleteTimecard,
  getTimecardEntries,
  submitTimecard
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

const october = {
  id: 1,
  name: 'October 2026',
  start_date: '2026-10-01',
  end_date: '2026-10-31',
  status: 'draft',
  generated_at: null
}

const november = {
  id: 2,
  name: 'November 2026',
  start_date: '2026-11-01',
  end_date: '2026-11-30',
  status: 'submitted',
  generated_at: '2026-11-30T18:00:00'
}

describe('Timecards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getTimecards).mockResolvedValue([october, november])
    vi.mocked(getTimecardEntries).mockResolvedValue([])
    vi.mocked(getProjects).mockResolvedValue([])
    vi.mocked(getActivities).mockResolvedValue([])
    vi.mocked(storageService.getWorkingDays).mockResolvedValue([1, 2, 3, 4, 5])
  })

  it('lists the timecards', async () => {
    render(<Timecards />)

    await waitFor(() => expect(screen.getByText('October 2026')).toBeInTheDocument())
    expect(screen.getByText('November 2026')).toBeInTheDocument()
  })

  it('opens one and comes back to the list', async () => {
    const user = userEvent.setup()
    render(<Timecards />)
    await waitFor(() => expect(screen.getByText('October 2026')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'October 2026' }))

    await waitFor(() => expect(getTimecardEntries).toHaveBeenCalledWith(1))
    expect(screen.queryByText('November 2026')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /all timecards/i }))

    await waitFor(() => expect(screen.getByText('November 2026')).toBeInTheDocument())
  })

  it('creates a timecard from a month and opens it', async () => {
    const user = userEvent.setup()
    const created = { ...october, id: 3, name: 'December 2026' }
    vi.mocked(createTimecard).mockResolvedValue(created)
    vi.mocked(getTimecards).mockResolvedValue([october, november, created])
    render(<Timecards />)
    await waitFor(() => expect(screen.getByText('October 2026')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /new timecard/i }))
    const month = await screen.findByPlaceholderText('2026-10')
    await user.clear(month)
    await user.type(month, '2026-12')
    await user.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() =>
      expect(createTimecard).toHaveBeenCalledWith({
        name: 'December 2026',
        start_date: '2026-12-01',
        end_date: '2026-12-31'
      })
    )
    // Straight into the new card: it is empty until it pulls from events.
    await waitFor(() => expect(getTimecardEntries).toHaveBeenCalledWith(3))
  })

  it('deletes a timecard after confirmation', async () => {
    const user = userEvent.setup()
    vi.mocked(deleteTimecard).mockResolvedValue(true)
    render(<Timecards />)
    await waitFor(() => expect(screen.getByText('October 2026')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Delete October 2026' }))
    await user.click(await screen.findByRole('button', { name: /^yes$/i }))

    await waitFor(() => expect(deleteTimecard).toHaveBeenCalledWith(1))
  })

  /* The reason selection is held by id: a change made in the detail view has
     to reach the list without the two copies drifting apart. */
  it('reflects a submission back in the list', async () => {
    const user = userEvent.setup()
    vi.mocked(submitTimecard).mockResolvedValue({ ...october, status: 'submitted' })
    render(<Timecards />)
    await waitFor(() => expect(screen.getByText('October 2026')).toBeInTheDocument())
    expect(screen.getAllByText('Draft')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'October 2026' }))
    await waitFor(() => expect(getTimecardEntries).toHaveBeenCalledWith(1))

    await user.click(screen.getByRole('button', { name: /^submit$/i }))
    // The confirmation's OK button says Submit too, so it has to be reached
    // through the popconfirm rather than by name alone.
    const confirm = await waitFor(() => {
      const buttons = document.querySelector('.ant-popconfirm-buttons')
      if (!buttons) throw new Error('popconfirm not open')
      return within(buttons as HTMLElement).getByRole('button', { name: /^submit$/i })
    })
    await user.click(confirm)

    await waitFor(() => expect(submitTimecard).toHaveBeenCalledWith(1))
    await user.click(screen.getByRole('button', { name: /all timecards/i }))

    await waitFor(() => expect(screen.getByText('October 2026')).toBeInTheDocument())
    expect(screen.queryByText('Draft')).not.toBeInTheDocument()
    expect(screen.getAllByText('Submitted')).toHaveLength(2)
  })

  it('reports a load failure rather than showing an empty list', async () => {
    vi.mocked(getTimecards).mockRejectedValue(new Error('boom'))
    render(<Timecards />)

    await waitFor(() => {
      expect(screen.getByText('Failed to load timecards')).toBeInTheDocument()
    })
  })
})
