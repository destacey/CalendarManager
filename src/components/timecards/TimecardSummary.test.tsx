import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/react'
import { render } from '../../test/utils'
import TimecardSummary from './TimecardSummary'
import { weeksOf } from '../../utils/timecardGrid'
import { TimecardEntry } from '../../api/timecards'

const weeks = weeksOf('2026-09-01', '2026-09-30')

const projects = [
  { id: 1, name: 'Website Rebuild', code: 'PRJ-001', program: 'Platform', is_active: true },
  { id: 2, name: 'Billing', code: 'PRJ-002', program: null, is_active: true }
]
const activities = [
  { id: 7, name: 'Software Development', color: '#1890ff', is_active: true },
  { id: 8, name: 'Meetings', color: '#faad14', is_active: true }
]

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

const renderSummary = (entries: TimecardEntry[]) =>
  render(
    <TimecardSummary
      entries={entries}
      projects={projects}
      activities={activities}
      weeks={weeks}
    />
  )

const rowFor = (label: string) => screen.getByText(label).closest('tr')! as HTMLElement

/** The Total column, which for a one-week row repeats that week's number. */
const totalOf = (row: HTMLElement) => {
  const cells = within(row).getAllByRole('cell')
  return cells[cells.length - 1]
}

describe('TimecardSummary', () => {
  it('gives each project and activity pair a row with its total', () => {
    renderSummary([
      entry({ id: 1, hours: 3 }),
      entry({ id: 2, hours: 1.5, date: '2026-09-08' }),
      entry({ id: 3, hours: 4, activity_id: 8 })
    ])

    expect(totalOf(rowFor('Software Development'))).toHaveTextContent('4.50')
    expect(totalOf(rowFor('Meetings'))).toHaveTextContent('4.00')
  })

  it('splits the totals across the weeks that produced them', () => {
    renderSummary([
      entry({ id: 1, hours: 3 }),
      entry({ id: 2, hours: 1.5, date: '2026-09-08' })
    ])

    const row = rowFor('Software Development')
    // Week 1, week 2, then nothing for weeks 3 to 5.
    expect(within(row).getByText('3.00')).toBeInTheDocument()
    expect(within(row).getByText('1.50')).toBeInTheDocument()
    expect(within(row).getAllByText('—')).toHaveLength(3)
  })

  it('carries the program through, since that is what the totals roll up to', () => {
    renderSummary([entry({})])

    expect(within(rowFor('PRJ-001 — Website Rebuild')).getByText('Platform')).toBeInTheDocument()
  })

  it('totals the whole period', () => {
    renderSummary([entry({ id: 1, hours: 3 }), entry({ id: 2, hours: 2, project_id: 2 })])

    // The footer row, not the Total column header of the same name.
    const footer = document.querySelector('.ant-table-summary tr') as HTMLElement
    expect(totalOf(footer)).toHaveTextContent('5.00')
  })

  /* Unmapped time has to be visible here, or it is billed to nobody. */
  it('shows time with no project rather than hiding it', () => {
    renderSummary([entry({ project_id: null, activity_id: null, hours: 2 })])

    expect(screen.getByText('Unassigned')).toBeInTheDocument()
  })

  it('says so plainly when there is nothing yet', () => {
    renderSummary([])

    expect(screen.getByText('Nothing on this timecard yet')).toBeInTheDocument()
  })
})
