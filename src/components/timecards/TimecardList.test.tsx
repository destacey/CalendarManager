import { describe, it, expect, vi } from 'vitest'

// The week picker needs a real dayjs rather than the fixed-value mock
// `src/test/setup.ts` installs globally.
vi.unmock('dayjs')

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/utils'
import TimecardList from './TimecardList'
import { Timecard } from '../../api/timecards'

/**
 * The grid virtualizes its rows, and @tanstack/react-virtual sizes its window
 * from the scroll viewport's `offsetHeight` — which jsdom always reports as 0.
 * Without this stub the grid renders a header and no body rows at all. See
 * DataGrid.test.tsx.
 */
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get() {
    return this.hasAttribute('data-grid-body-viewport') ? 600 : 0
  },
})

const timecards: Timecard[] = [
  {
    id: 1, name: 'Week of 30 Aug 2026', start_date: '2026-08-30', end_date: '2026-09-05',
    status: 'draft', generated_at: '2026-09-05T18:00:00'
  },
  {
    id: 2, name: 'Week of 6 Sep 2026', start_date: '2026-09-06', end_date: '2026-09-12',
    status: 'submitted', generated_at: null
  }
]

const renderList = (overrides = {}) => {
  const props = {
    timecards,
    hoursById: { 1: 37.5, 2: 40 },
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
  it('lists the weeks with their dates and hours', () => {
    renderList()

    expect(screen.getByRole('button', { name: 'Week of 30 Aug 2026' })).toBeInTheDocument()
    expect(screen.getByText('2026-08-30 to 2026-09-05')).toBeInTheDocument()
    expect(screen.getByText('37.50')).toBeInTheDocument()
  })

  it('marks which weeks are submitted', () => {
    renderList()

    expect(screen.getByText('Submitted')).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
  })

  /* An empty week looks the same as a full one until you open it, so a week
     that has never pulled says so. */
  it('says when a week has never pulled from events', () => {
    renderList()

    expect(screen.getByText('Not yet pulled')).toBeInTheDocument()
  })

  it('opens a week', async () => {
    const user = userEvent.setup()
    const { onOpen } = renderList()

    await user.click(screen.getByRole('button', { name: 'Week of 30 Aug 2026' }))

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
  })

  it('creates a week from the date picked', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderList()

    await user.click(screen.getByRole('button', { name: /new week/i }))
    await user.click(screen.getByRole('button', { name: /^create$/i }))

    // Whatever week is current: the picker opens on today.
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.any(String)))
  })

  it('deletes a week after confirmation', async () => {
    const user = userEvent.setup()
    const { onDelete } = renderList()

    // Individual per-row delete buttons were replaced by the grid's single
    // "..." row-actions dropdown, and the grid defaults to sorting by start
    // date descending (as the antd Table's defaultSortOrder did), so "Week
    // of 30 Aug 2026" (the earlier week) is the SECOND displayed row. A menu
    // item's onClick can't host an anchored Popconfirm, so delete now
    // confirms through a modal (confirmDelete), whose OK button reads
    // "Delete" rather than the old Popconfirm's "Yes".
    const actionButtons = screen.getAllByLabelText('Row actions')
    await user.click(actionButtons[1])
    await user.click(await screen.findByText(/delete/i))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }))

    await waitFor(() =>
      expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
    )
  })

  it('points at the report for anything longer than a week', () => {
    renderList()

    expect(screen.getByText(/use the report/i)).toBeInTheDocument()
  })

  it('says so plainly when there are none', () => {
    renderList({ timecards: [] })

    expect(screen.getByText('No timecards yet')).toBeInTheDocument()
  })
})
