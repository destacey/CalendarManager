import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/utils'
import TimecardWeekGrid from './TimecardWeekGrid'
import { weeksOf } from '../../utils/timecardGrid'
import { TimecardEntry } from '../../api/timecards'

/* One weekly timecard: Sun 30 Aug to Sat 5 Sep. It owns all seven days even
   though two of them fall in August — that is what makes them editable. */
const week = weeksOf('2026-08-30', '2026-09-05')[0]

const projects = [
  { id: 1, name: 'Website Rebuild', code: 'PRJ-001', program: 'Platform', is_active: true },
  { id: 2, name: 'Billing', code: 'PRJ-002', program: null, is_active: true },
  { id: 3, name: 'Retired', code: 'PRJ-OLD', program: null, is_active: false }
]
const activities = [{ id: 7, name: 'Software Development', color: '#1890ff', is_active: true }]

const entry = (over: Partial<TimecardEntry>): TimecardEntry => ({
  id: 1,
  timecard_id: 1,
  event_id: null,
  date: '2026-09-01',
  hours: 2,
  project_id: 1,
  activity_id: 7,
  source: 'event',
  note: null,
  ...over
})

const renderGrid = (over: {
  entries?: TimecardEntry[]
  month?: string
  disabled?: boolean
} = {}) => {
  const onSetCell = vi.fn()
  const onOpenDay = vi.fn()
  render(
    <TimecardWeekGrid
      entries={over.entries ?? [entry({})]}
      projects={projects}
      activities={activities}
      week={week}
      month={over.month ?? '2026-09'}
      disabled={over.disabled ?? false}
      onSetCell={onSetCell}
      onOpenDay={onOpenDay}
    />
  )
  return { onSetCell, onOpenDay }
}

describe('TimecardWeekGrid', () => {
  beforeEach(() => vi.clearAllMocks())

  /* Queried by role because a scrolling antd table renders a second, hidden
     copy of its header that a text query would also match. */
  it('names the days that belong to the month next door', () => {
    renderGrid()

    expect(screen.getByRole('button', { name: 'Items on 2026-08-30' })).toHaveTextContent(
      'Sun 30 Aug'
    )
    // A day of the month being viewed needs no month to identify it.
    expect(screen.getByRole('button', { name: 'Items on 2026-09-01' })).toHaveTextContent('Tue 1')
  })

  /* The week is the timecard, so it holds those days and nothing else does —
     refusing input on them would leave that time nowhere to go. */
  it('takes input on a day belonging to the month next door', async () => {
    const user = userEvent.setup()
    const { onSetCell } = renderGrid()

    const cell = screen.getByRole('spinbutton', {
      name: 'PRJ-001, Software Development on 2026-08-30'
    })
    await user.clear(cell)
    await user.type(cell, '3')
    await user.tab()

    await waitFor(() => expect(onSetCell).toHaveBeenCalledWith('2026-08-30', 1, 7, 3))
  })

  it('opens the day on an edge day like any other', async () => {
    const user = userEvent.setup()
    const { onOpenDay } = renderGrid()

    await user.click(screen.getByRole('button', { name: 'Items on 2026-08-31' }))

    expect(onOpenDay).toHaveBeenCalledWith('2026-08-31')
  })

  it('puts hours in the cell for their day', () => {
    renderGrid({ entries: [entry({ hours: 3.5 })] })

    expect(
      screen.getByRole('spinbutton', { name: 'PRJ-001, Software Development on 2026-09-01' })
    ).toHaveValue('3.50')
  })

  it('totals each day and the week', () => {
    renderGrid({
      entries: [entry({ id: 1, hours: 2 }), entry({ id: 2, hours: 1, project_id: 2, activity_id: null })]
    })

    expect(screen.getByText('3.00 hours this week')).toBeInTheDocument()
  })

  it('reports a typed value as a cell edit', async () => {
    const user = userEvent.setup()
    const { onSetCell } = renderGrid()

    const cell = screen.getByRole('spinbutton', {
      name: 'PRJ-001, Software Development on 2026-09-01'
    })
    await user.clear(cell)
    await user.type(cell, '6.25')
    await user.tab()

    await waitFor(() => expect(onSetCell).toHaveBeenCalledWith('2026-09-01', 1, 7, 6.25))
  })

  describe('the day affordance', () => {
    it('counts the items behind a cell when there is more than one', () => {
      renderGrid({ entries: [entry({ id: 1 }), entry({ id: 2 }), entry({ id: 3 })] })

      expect(screen.getByText('3')).toBeInTheDocument()
    })

    it('opens the day from the cell', async () => {
      const user = userEvent.setup()
      const { onOpenDay } = renderGrid()

      await user.click(
        screen.getByRole('button', {
          name: 'Items behind PRJ-001, Software Development on 2026-09-01'
        })
      )

      expect(onOpenDay).toHaveBeenCalledWith('2026-09-01')
    })

    it('opens the day from the column header', async () => {
      const user = userEvent.setup()
      const { onOpenDay } = renderGrid()

      await user.click(screen.getByRole('button', { name: 'Items on 2026-09-02' }))

      expect(onOpenDay).toHaveBeenCalledWith('2026-09-02')
    })

    /* Nothing to open on an empty cell, so nothing is offered. */
    it('offers nothing on a cell with no items', () => {
      renderGrid()

      expect(
        screen.queryByRole('button', {
          name: 'Items behind PRJ-001, Software Development on 2026-09-02'
        })
      ).not.toBeInTheDocument()
    })
  })

  describe('rows', () => {
    it('puts each project and activity pair on its own row', () => {
      renderGrid({
        entries: [entry({ id: 1 }), entry({ id: 2, activity_id: null })]
      })

      expect(screen.getAllByText('PRJ-001 — Website Rebuild')).toHaveLength(2)
      expect(screen.getByText('Software Development')).toBeInTheDocument()
      expect(screen.getByText('No activity')).toBeInTheDocument()
    })

    /* Stepping a week must not make rows appear and disappear: the point is
       to see the shape of the month from any week in it. */
    it('keeps a row for a project whose time is in another week', () => {
      renderGrid({ entries: [entry({ date: '2026-09-15', hours: 4 })] })

      expect(
        screen.getByRole('spinbutton', { name: 'PRJ-001, Software Development on 2026-09-01' })
      ).toHaveValue('')
      // The row is there; the hours are not, because they are another week's.
      expect(screen.getByText('0.00 hours this week')).toBeInTheDocument()
    })

    /* Time with no project is a prompt to go and map something. */
    it('shows unmapped time as its own row', () => {
      renderGrid({ entries: [entry({ project_id: null, activity_id: null })] })

      expect(screen.getByText('Unassigned')).toBeInTheDocument()
    })

    it('adds an empty row for a project with no time yet', async () => {
      const user = userEvent.setup()
      renderGrid()

      await user.click(screen.getByRole('button', { name: /add row/i }))
      await user.click(screen.getByRole('combobox', { name: 'Project for the new row' }))
      await user.click(await screen.findByTitle('PRJ-002 — Billing'))
      await user.click(screen.getByRole('button', { name: /^add$/i }))

      expect(
        await screen.findByRole('spinbutton', { name: 'PRJ-002, no activity on 2026-09-01' })
      ).toBeInTheDocument()
    })

    /* Long project lists are the norm, so the select filters as you type —
       while still scrolling normally for anyone who would rather look. */
    it('narrows the project list as you type', async () => {
      const user = userEvent.setup()
      renderGrid()

      await user.click(screen.getByRole('button', { name: /add row/i }))
      const select = screen.getByRole('combobox', { name: 'Project for the new row' })
      await user.click(select)
      expect(await screen.findByTitle('PRJ-001 — Website Rebuild')).toBeInTheDocument()

      await user.type(select, 'Billing')

      expect(await screen.findByTitle('PRJ-002 — Billing')).toBeInTheDocument()
      expect(screen.queryByTitle('PRJ-001 — Website Rebuild')).not.toBeInTheDocument()
    })

    /* An inactive project is history: it may still hold time, but no new row. */
    it('does not offer an inactive project as a new row', async () => {
      const user = userEvent.setup()
      renderGrid()

      await user.click(screen.getByRole('button', { name: /add row/i }))
      await user.click(screen.getByRole('combobox', { name: 'Project for the new row' }))

      expect(screen.queryByTitle('PRJ-OLD — Retired')).not.toBeInTheDocument()
    })
  })

  it('takes no input at all when the timecard is submitted', () => {
    renderGrid({ disabled: true })

    expect(
      screen.getByRole('spinbutton', { name: 'PRJ-001, Software Development on 2026-09-01' })
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: /add row/i })).toBeDisabled()
  })
})
