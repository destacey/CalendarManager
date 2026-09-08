import { describe, it, expect, vi, beforeEach } from 'vitest'

// The range picker needs a real dayjs rather than the fixed-value mock
// `src/test/setup.ts` installs globally.
vi.unmock('dayjs')

import { screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/utils'
import ExcelJS from 'exceljs'
import TimecardReport from './TimecardReport'
import { getTimecardEntriesInRange, TimecardEntry } from '../../api/timecards'
import { getProjects } from '../../api/projects'
import { getActivities } from '../../api/activities'
import { saveFile } from '../../api/files'

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

vi.mock('../../api/timecards', async () => {
  const actual = await vi.importActual('../../api/timecards')
  return { ...actual, getTimecardEntriesInRange: vi.fn() }
})
vi.mock('../../api/projects', () => ({ getProjects: vi.fn() }))
vi.mock('../../api/activities', () => ({ getActivities: vi.fn() }))
vi.mock('../../api/files', () => ({ saveFile: vi.fn() }))

const projects = [
  { id: 1, name: 'Website Rebuild', code: 'PRJ-001', program: 'Platform', is_active: true },
  { id: 2, name: 'Billing', code: 'PRJ-002', program: null, is_active: true }
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

describe('TimecardReport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getProjects).mockResolvedValue(projects)
    vi.mocked(getActivities).mockResolvedValue(activities)
    vi.mocked(saveFile).mockResolvedValue(true)
    vi.mocked(getTimecardEntriesInRange).mockResolvedValue([
      entry({ id: 1, hours: 2 }),
      entry({ id: 2, hours: 3, date: '2026-09-20' }),
      entry({ id: 3, hours: 4, project_id: 2, activity_id: null })
    ])
  })

  // The grid renders more than one <table> (header + virtualized body), so
  // `getByRole('table')` — used to wait for load before the migration — no
  // longer identifies a single element. The Export button only enables once
  // loading finishes and there is at least one row, so it doubles as the
  // "data has loaded" signal every test below waits on.
  const waitForLoad = () =>
    waitFor(() => expect(screen.getByRole('button', { name: /export/i })).not.toBeDisabled())

  it('reads the current month to start with', async () => {
    render(<TimecardReport />)

    await waitFor(() => expect(getTimecardEntriesInRange).toHaveBeenCalled())
    const [start, end] = vi.mocked(getTimecardEntriesInRange).mock.calls[0]
    const now = new Date()
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    expect(start).toBe(`${month}-01`)
    expect(end.startsWith(month)).toBe(true)
  })

  /* The whole point: one line per project and activity, no dates. */
  it('totals by project and activity, whatever days the time fell on', async () => {
    render(<TimecardReport />)

    // No longer scoped `within(table)` — the grid renders more than one
    // <table> element, so a single row's own cells are queried instead.
    const dev = (await screen.findByText('Software Development')).closest('tr')!
    // The 1st and the 20th, added together.
    expect(within(dev).getByText('5.00')).toBeInTheDocument()
    expect(screen.queryByText('2026-09-01')).not.toBeInTheDocument()
  })

  it('gives the total for the period', async () => {
    render(<TimecardReport />)

    await waitForLoad()
    // The number and its unit are separate elements, so the number carries
    // the emphasis and the word does not. Scoped to the header, because the
    // grid's own footer row shows the same figure.
    expect(screen.getByText('hours').parentElement).toHaveTextContent('9.00')
  })

  it('carries the program, which is what totals roll up to', async () => {
    render(<TimecardReport />)

    expect(await screen.findByText('Platform')).toBeInTheDocument()
  })

  /* Unmapped time has to be visible here, or it is billed to nobody. */
  it('shows time with no project rather than hiding it', async () => {
    vi.mocked(getTimecardEntriesInRange).mockResolvedValue([
      entry({ project_id: null, activity_id: null, hours: 3 })
    ])
    render(<TimecardReport />)

    expect(await screen.findByText('Unassigned')).toBeInTheDocument()
  })

  it('reads a different period when one is chosen', async () => {
    const user = userEvent.setup()
    render(<TimecardReport />)
    await waitFor(() => expect(getTimecardEntriesInRange).toHaveBeenCalled())

    await user.click(screen.getAllByPlaceholderText('Start date')[0])
    await user.click(await screen.findByText('Last month'))

    await waitFor(() => {
      const calls = vi.mocked(getTimecardEntriesInRange).mock.calls
      const [start] = calls[calls.length - 1]
      const now = new Date()
      const previous = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1))
      expect(start).toBe(previous.toISOString().slice(0, 10))
    })
  })

  it('says when a period holds nothing rather than showing an empty table', async () => {
    vi.mocked(getTimecardEntriesInRange).mockResolvedValue([])
    render(<TimecardReport />)

    await waitFor(() =>
      expect(screen.getByText(/No time on any timecard between/)).toBeInTheDocument()
    )
  })

  it('reports a failure rather than an empty report', async () => {
    vi.mocked(getTimecardEntriesInRange).mockRejectedValue(new Error('boom'))
    render(<TimecardReport />)

    await waitFor(() => expect(screen.getByText('Failed to load the report')).toBeInTheDocument())
  })

  describe('exporting', () => {
    /** The workbook handed to the save dialog, parsed back out. */
    const exported = async () => {
      const [name, bytes] = vi.mocked(saveFile).mock.calls[0]
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(bytes as unknown as ArrayBuffer)
      return { name, sheet: workbook.worksheets[0] }
    }

    it('writes the rows to a workbook and offers it for saving', async () => {
      const user = userEvent.setup()
      render(<TimecardReport />)
      await waitForLoad()

      await user.click(screen.getByRole('button', { name: /export/i }))

      await waitFor(() => expect(saveFile).toHaveBeenCalled())
      const { sheet } = await exported()
      // Title, blank, header, two rows, total.
      expect(sheet.rowCount).toBe(6)
      expect(sheet.getRow(3).values).toContain('Project')
    })

    /* A spreadsheet pasted into an email loses its filename and keeps its
       cells, so the period has to be inside it. */
    it('puts the period inside the workbook, not only in the name', async () => {
      const user = userEvent.setup()
      render(<TimecardReport />)
      await waitForLoad()

      await user.click(screen.getByRole('button', { name: /export/i }))

      await waitFor(() => expect(saveFile).toHaveBeenCalled())
      const { name, sheet } = await exported()
      expect(String(sheet.getRow(1).getCell(1).value)).toMatch(/^Timecard report: \d{4}-/)
      expect(name).toMatch(/^Timecard report .* to .*\.xlsx$/)
    })

    /* Hours as numbers, so the spreadsheet can add them up itself rather than
       holding text that looks like a total. */
    it('writes hours as numbers', async () => {
      const user = userEvent.setup()
      render(<TimecardReport />)
      await waitForLoad()

      await user.click(screen.getByRole('button', { name: /export/i }))

      await waitFor(() => expect(saveFile).toHaveBeenCalled())
      const { sheet } = await exported()
      expect(typeof sheet.getRow(4).getCell(5).value).toBe('number')
      // The last row totals the period.
      expect(sheet.getRow(6).getCell(5).value).toBe(9)
    })

    it('names the file for the period', async () => {
      const user = userEvent.setup()
      render(<TimecardReport />)
      await waitForLoad()

      await user.click(screen.getByRole('button', { name: /export/i }))

      await waitFor(() => {
        const [name, , filter, extensions] = vi.mocked(saveFile).mock.calls[0]
        expect(name).toContain('Timecard report')
        expect(filter).toBe('Excel Workbook')
        expect(extensions).toEqual(['xlsx'])
      })
    })

    /* Cancelling a save dialog is a normal thing to do, not a failure. */
    it('says nothing when the save is cancelled', async () => {
      const user = userEvent.setup()
      vi.mocked(saveFile).mockResolvedValue(false)
      render(<TimecardReport />)
      await waitForLoad()

      await user.click(screen.getByRole('button', { name: /export/i }))

      await waitFor(() => expect(saveFile).toHaveBeenCalled())
      expect(screen.queryByText(/Exported/)).not.toBeInTheDocument()
    })

    it('reports a failed save', async () => {
      const user = userEvent.setup()
      vi.mocked(saveFile).mockRejectedValue(new Error('disk full'))
      render(<TimecardReport />)
      await waitForLoad()

      await user.click(screen.getByRole('button', { name: /export/i }))

      expect(await screen.findByText('Could not save the export')).toBeInTheDocument()
    })

    it('offers nothing to export when the period is empty', async () => {
      vi.mocked(getTimecardEntriesInRange).mockResolvedValue([])
      render(<TimecardReport />)

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /export/i })).toBeDisabled()
      )
    })
  })

  describe('the footer total', () => {
    /* A fixture whose sum (7.85) is distinctive from the 9.00 the other
       tests' fixture produces, so a passing assertion can't be coincidence. */
    it('matches the header strip figure', async () => {
      vi.mocked(getTimecardEntriesInRange).mockResolvedValue([
        entry({ id: 1, hours: 3.35 }),
        entry({ id: 2, hours: 4.5, project_id: 2, activity_id: null })
      ])
      render(<TimecardReport />)

      await waitFor(() => expect(screen.getByText('hours').parentElement).toHaveTextContent('7.85'))

      // Project's footer is the literal string 'Total', which becomes this
      // row's accessible name.
      const footerRow = screen.getByRole('row', { name: /total/i })
      expect(within(footerRow).getByText('7.85')).toBeInTheDocument()
    })

    /* Task 23's review found the one gap in the footer feature: no test put
       a footer cell under a PINNED column, where a total drifting out from
       under its frozen column is exactly what the sticky offset exists to
       prevent. Pins Program (which carries no footer of its own) left,
       leaving Hours' real footer total to prove the row still renders and
       lines up correctly around the pinned cell. */
    it('keeps a pinned column footer cell at the same sticky offset as its header', async () => {
      render(<TimecardReport />)
      await waitForLoad()

      const programHeader = screen.getByText('Program').closest('th')!
      fireEvent.click(within(programHeader).getByLabelText('Column menu'))
      const pinParent = await screen.findByRole('menuitem', { name: /pin column/i })
      fireEvent.mouseEnter(pinParent)
      fireEvent.click(await screen.findByRole('menuitem', { name: /pin left/i }))

      const pinnedHeader = document.querySelector(
        'th[data-column-id="program"]'
      ) as HTMLElement
      const pinnedFooterCell = document.querySelector(
        'tfoot td[data-column-id="program"]'
      ) as HTMLElement

      // Assert the inline style attribute, not toHaveStyle — setup.ts stubs
      // getComputedStyle with a fixed object.
      expect(pinnedHeader.style.left).not.toBe('')
      expect(pinnedFooterCell.style.left).toBe(pinnedHeader.style.left)
    })
  })

  describe('column sorting', () => {
    /* The migration onto DataGrid gave Project/Program/Activity an
       accessorFn and let TanStack's default text sort take over, silently
       dropping the original antd `localeCompare` sorter — nothing here used
       to click a header, so the change went unverified. `'cafe'.localeCompare('café')`
       is -1 under a plain call; a case/accent-insensitive default ties the
       two and falls back to insertion order instead, so this pins the exact
       comparator rather than merely "some string sort". */
    it('sorts the Project column with a plain localeCompare, not a case/accent-insensitive default', async () => {
      vi.mocked(getProjects).mockResolvedValue([
        { id: 1, name: 'Cafe One', code: 'café', program: 'Ops', is_active: true },
        { id: 2, name: 'Cafe Two', code: 'cafe', program: 'Ops', is_active: true }
      ])
      // Hours deliberately favor café (project 1): totalsByProjectActivity
      // returns rows sorted by hours descending, so the *pre-sort* (core)
      // row order is café, then cafe. A comparator that ties the two (e.g.
      // sensitivity: 'base') would leave that core order undisturbed on an
      // ascending click — the opposite of what a real localeCompare produces
      // — so this arrangement only passes under the exact restored
      // comparator, not merely "some case/accent-insensitive string sort".
      vi.mocked(getTimecardEntriesInRange).mockResolvedValue([
        entry({ id: 1, project_id: 1, hours: 3 }),
        entry({ id: 2, project_id: 2, hours: 2 })
      ])
      render(<TimecardReport />)
      await waitForLoad()

      fireEvent.click(screen.getByText('Project'))

      const projectCells = () =>
        Array.from(document.querySelectorAll('tbody td[data-column-id="project"]')).map(
          c => c.textContent
        )

      await waitFor(() =>
        expect(projectCells()).toEqual(['cafe — Cafe Two', 'café — Cafe One'])
      )
    })
  })
})
