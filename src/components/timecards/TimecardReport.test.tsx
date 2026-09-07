import { describe, it, expect, vi, beforeEach } from 'vitest'

// The range picker needs a real dayjs rather than the fixed-value mock
// `src/test/setup.ts` installs globally.
vi.unmock('dayjs')

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/utils'
import ExcelJS from 'exceljs'
import TimecardReport from './TimecardReport'
import { getTimecardEntriesInRange, TimecardEntry } from '../../api/timecards'
import { getProjects } from '../../api/projects'
import { getActivities } from '../../api/activities'
import { saveFile } from '../../api/files'

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

    const table = await screen.findByRole('table')
    const dev = within(table).getByText('Software Development').closest('tr')!
    // The 1st and the 20th, added together.
    expect(within(dev).getByText('5.00')).toBeInTheDocument()
    expect(within(table).queryByText('2026-09-01')).not.toBeInTheDocument()
  })

  it('gives the total for the period', async () => {
    render(<TimecardReport />)

    await screen.findByRole('table')
    // The number and its unit are separate elements, so the number carries
    // the emphasis and the word does not. Scoped to the header, because the
    // table's own Total row shows the same figure.
    expect(screen.getByText('hours').parentElement).toHaveTextContent('9.00')
  })

  it('carries the program, which is what totals roll up to', async () => {
    render(<TimecardReport />)

    const table = await screen.findByRole('table')
    expect(within(table).getByText('Platform')).toBeInTheDocument()
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
      await screen.findByRole('table')

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
      await screen.findByRole('table')

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
      await screen.findByRole('table')

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
      await screen.findByRole('table')

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
      await screen.findByRole('table')

      await user.click(screen.getByRole('button', { name: /export/i }))

      await waitFor(() => expect(saveFile).toHaveBeenCalled())
      expect(screen.queryByText(/Exported/)).not.toBeInTheDocument()
    })

    it('reports a failed save', async () => {
      const user = userEvent.setup()
      vi.mocked(saveFile).mockRejectedValue(new Error('disk full'))
      render(<TimecardReport />)
      await screen.findByRole('table')

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
})
