import { describe, it, expect, vi } from 'vitest'

// The month picker needs a real dayjs. `src/test/setup.ts` replaces dayjs
// globally with a mock that answers every call with the same fixed value,
// which no antd picker can work against; this file opts out of that mock.
vi.unmock('dayjs')

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

  it('opens on the current month', async () => {
    const user = userEvent.setup()
    renderList()

    await user.click(screen.getByRole('button', { name: /new timecard/i }))

    const month = await screen.findByRole('textbox', { name: 'Month' })
    expect(month).toHaveValue(
      new Date().toLocaleString('en-GB', { month: 'long', year: 'numeric' })
    )
  })

  it('creates a timecard for the month picked, defaulting the name', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderList()

    await user.click(screen.getByRole('button', { name: /new timecard/i }))
    await user.click(await screen.findByRole('textbox', { name: 'Month' }))
    // The panel opens on this year; step it to 2026 and take December.
    const year = new Date().getFullYear()
    for (let i = year; i < 2026; i++) {
      await user.click(screen.getByRole('button', { name: /next year/i }))
    }
    await user.click(await screen.findByText('Dec'))
    await user.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith('December 2026', '2026-12-01', '2026-12-31')
    })
  })

  /* No free text to get wrong, and no way to end up with no month at all:
     clearing the box and leaving it puts the month back. */
  it('cannot be left without a month', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderList()

    await user.click(screen.getByRole('button', { name: /new timecard/i }))
    const month = await screen.findByRole('textbox', { name: 'Month' })
    await user.clear(month)
    await user.click(screen.getByRole('button', { name: /^create$/i }))

    const now = new Date()
    const first = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(expect.any(String), first, expect.any(String))
    )
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
