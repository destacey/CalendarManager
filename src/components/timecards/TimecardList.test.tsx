import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/utils'
import TimecardList, { monthBounds } from './TimecardList'

const timecards = [
  { id: 1, name: 'October 2026', start_date: '2026-10-01', end_date: '2026-10-31',
    status: 'draft', generated_at: '2026-10-31T18:00:00' },
  { id: 2, name: 'September 2026', start_date: '2026-09-01', end_date: '2026-09-30',
    status: 'submitted', generated_at: '2026-09-30T18:00:00' },
  { id: 3, name: 'November 2026', start_date: '2026-11-01', end_date: '2026-11-30',
    status: 'draft', generated_at: null }
]

const renderList = (overrides = {}) => {
  const props = {
    timecards,
    loading: false,
    onOpen: vi.fn(),
    onCreate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
  render(<TimecardList {...props} />)
  return props
}

describe('monthBounds', () => {
  it('gives the first and last day of a 31-day month', () => {
    expect(monthBounds('2026-10')).toEqual({
      start: '2026-10-01', end: '2026-10-31', name: 'October 2026'
    })
  })

  it('gives 30 days for a 30-day month', () => {
    expect(monthBounds('2026-11')?.end).toBe('2026-11-30')
  })

  /* Day 0 of the next month, rather than a table of month lengths - which is
     what makes February and leap years fall out for free. */
  it('handles February', () => {
    expect(monthBounds('2026-02')?.end).toBe('2026-02-28')
  })

  it('handles a leap February', () => {
    expect(monthBounds('2028-02')?.end).toBe('2028-02-29')
  })

  it('rejects anything that is not YYYY-MM', () => {
    expect(monthBounds('October')).toBeNull()
    expect(monthBounds('2026-13')).toBeNull()
    expect(monthBounds('')).toBeNull()
  })
})

describe('TimecardList', () => {
  it('lists the timecards with their periods', async () => {
    renderList()

    expect(screen.getByText('October 2026')).toBeInTheDocument()
    expect(screen.getByText('2026-10-01 to 2026-10-31')).toBeInTheDocument()
  })

  it('marks a submitted timecard', () => {
    renderList()

    expect(screen.getByText('Submitted')).toBeInTheDocument()
    expect(screen.getAllByText('Draft')).toHaveLength(2)
  })

  /* A timecard that has never pulled from events is empty, and a blank cell
     would not say so. */
  it('says when a timecard has never been pulled', () => {
    renderList()

    expect(screen.getByText('Not yet pulled')).toBeInTheDocument()
  })

  it('opens a timecard when its name is clicked', async () => {
    const user = userEvent.setup()
    const { onOpen } = renderList()

    await user.click(screen.getByRole('button', { name: 'October 2026' }))

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
  })

  it('creates a timecard for a month, defaulting the name', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderList()

    await user.click(screen.getByRole('button', { name: /new timecard/i }))
    const month = await screen.findByPlaceholderText('2026-10')
    await user.clear(month)
    await user.type(month, '2026-12')
    await user.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith('December 2026', '2026-12-01', '2026-12-31')
    })
  })

  it('refuses a month it cannot parse', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderList()

    await user.click(screen.getByRole('button', { name: /new timecard/i }))
    const month = await screen.findByPlaceholderText('2026-10')
    await user.clear(month)
    await user.type(month, 'December')
    await user.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() => {
      expect(screen.getByText('Use YYYY-MM, e.g. 2026-10')).toBeInTheDocument()
    })
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('deletes after the confirmation is accepted', async () => {
    const user = userEvent.setup()
    const { onDelete } = renderList()

    await user.click(screen.getByRole('button', { name: 'Delete October 2026' }))
    await user.click(await screen.findByRole('button', { name: /^yes$/i }))

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
    })
  })

  /* Deleting a timecard must not read as deleting calendar data. */
  it('says the events are untouched when confirming a delete', async () => {
    const user = userEvent.setup()
    renderList()

    await user.click(screen.getByRole('button', { name: 'Delete October 2026' }))

    expect(await screen.findByText(/The events are untouched/)).toBeInTheDocument()
  })

  it('says so when there are none', () => {
    renderList({ timecards: [] })

    expect(screen.getByText('No timecards yet')).toBeInTheDocument()
  })
})
