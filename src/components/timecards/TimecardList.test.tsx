import { describe, it, expect, vi } from 'vitest'

// The month picker needs a real dayjs rather than the fixed-value mock
// `src/test/setup.ts` installs globally.
vi.unmock('dayjs')

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/utils'
import TimecardList, { PeriodSummary } from './TimecardList'

const periods: PeriodSummary[] = [
  { month: '2026-09', name: 'September 2026', weeks: 5, submitted: 2, hours: 128.5 },
  { month: '2026-08', name: 'August 2026', weeks: 5, submitted: 5, hours: 140 }
]

const renderList = (overrides = {}) => {
  const props = {
    periods,
    loading: false,
    onOpen: vi.fn(),
    onCreate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
  render(<TimecardList {...props} />)
  return props
}

describe('TimecardList', () => {
  it('lists the months', () => {
    renderList()

    expect(screen.getByRole('button', { name: 'September 2026' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'August 2026' })).toBeInTheDocument()
  })

  /* Weeks are submitted one at a time, so the month's state is a count. */
  it("says how many of the month's weeks are submitted", () => {
    renderList()

    expect(screen.getByText('2 of 5 submitted')).toBeInTheDocument()
    expect(screen.getByText('All 5 submitted')).toBeInTheDocument()
  })

  it('shows the hours dated in each month', () => {
    renderList()

    expect(screen.getByText('128.50')).toBeInTheDocument()
    expect(screen.getByText('140.00')).toBeInTheDocument()
  })

  it('opens a month', async () => {
    const user = userEvent.setup()
    const { onOpen } = renderList()

    await user.click(screen.getByRole('button', { name: 'September 2026' }))

    expect(onOpen).toHaveBeenCalledWith('2026-09')
  })

  it('creates the month that was picked', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderList()

    await user.click(screen.getByRole('button', { name: /new month/i }))
    await user.click(await screen.findByRole('textbox', { name: 'Month' }))
    for (let year = new Date().getFullYear(); year < 2026; year++) {
      await user.click(screen.getByRole('button', { name: /next year/i }))
    }
    await user.click(await screen.findByText('Dec'))
    await user.click(screen.getByRole('button', { name: /^create$/i }))

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('2026-12'))
  })

  it('opens on the current month', async () => {
    const user = userEvent.setup()
    renderList()

    await user.click(screen.getByRole('button', { name: /new month/i }))

    expect(await screen.findByRole('textbox', { name: 'Month' })).toHaveValue(
      new Date().toLocaleString('en-GB', { month: 'long', year: 'numeric' })
    )
  })

  /* Deleting a month takes its weeks with it, including one shared with the
     month next door — worth saying before it happens. */
  it('warns what a month deletion takes with it', async () => {
    const user = userEvent.setup()
    const { onDelete } = renderList()

    await user.click(screen.getByRole('button', { name: 'Delete September 2026' }))

    expect(await screen.findByText(/shared with the month next door/i)).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: /^yes$/i }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('2026-09'))
  })

  it('says so plainly when there are none', () => {
    renderList({ periods: [] })

    expect(screen.getByText('No timecards yet')).toBeInTheDocument()
  })
})
