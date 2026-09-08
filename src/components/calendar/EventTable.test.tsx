import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '../../test/utils'
import { 
  createEventTableProps, 
  mockTimedEvent, 
  mockTimedEvent2, 
  mockBillableEvent,
  mockAllDayEvent,
  mockBillableEventType,
  mockNonBillableEventType,
  createMockDayjs
} from '../../test/utils'
import EventTable from './EventTable'
import { saveFile } from '../../api/files'

/**
 * The grid virtualizes its rows, and @tanstack/react-virtual sizes its window
 * from the scroll viewport's `offsetHeight` — which jsdom always reports as 0.
 * virtual-core's calculateRange returns an EMPTY range (not an overscan-sized
 * one) at zero height, so without this the grid renders a header and no body
 * rows at all, and every "no rows" assertion below would pass for the wrong
 * reason. 600px over the virtualizer's 28px row estimate is also what fixes
 * the window size the virtualization suite at the bottom of this file asserts.
 *
 * Only the suites rendering the REAL EventTable are affected; the self-mock
 * below is a hand-rolled table with no virtualizer.
 */
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get() {
    return this.hasAttribute('data-grid-body-viewport') ? 600 : 0
  },
})

// Mock ExcelJS library. The buffer is non-empty so the "Excel Export" suite
// below can assert the export actually hands real bytes to saveFile. The
// real component calls `new ExcelJS.Workbook()` (a property on the default
// export), not `new ExcelJS()` — the mock has to shape it the same way or
// the constructor call throws once real handleExport actually runs it.
vi.mock('exceljs', () => {
  class Workbook {
    addWorksheet = vi.fn(() => ({
      addRow: vi.fn(),
      getRow: vi.fn(() => ({
        font: {},
        fill: {}
      })),
      columns: []
    }))
    xlsx = {
      writeBuffer: vi.fn(() => Promise.resolve(new ArrayBuffer(8)))
    }
  }
  return { default: { Workbook } }
})

// The native Save-As wrapper. Defaults to a successful save; individual
// tests override this to exercise cancellation and failure.
vi.mock('../../api/files', () => ({
  saveFile: vi.fn(() => Promise.resolve(true))
}))

// The rest of this suite renders EventTable via the self-mock below (kept as
// pre-existing), which never touches dayjs formatting. The "Excel Export"
// suite renders the REAL component (via vi.importActual) to exercise the
// actual handleExport logic, which needs dayjs().tz().format('YYYY-MM-DD HHmm')
// to honour its format string for the filename assertion — the suite-wide
// setup.ts mock ignores the format string entirely, so it's overridden here
// the same way TimezoneSettings.test.tsx overrides it locally.
vi.mock('dayjs', () => {
  const mock: any = {
    format: vi.fn((fmt?: string) =>
      fmt === 'YYYY-MM-DD HHmm' ? '2024-01-15 1430' : '2024-01-15'
    ),
    startOf: vi.fn(() => mock),
    endOf: vi.fn(() => mock),
    add: vi.fn(() => mock),
    subtract: vi.fn(() => mock),
    isSame: vi.fn(() => false),
    isBefore: vi.fn(() => false),
    isAfter: vi.fn(() => false),
    isSameOrBefore: vi.fn(() => true),
    diff: vi.fn(() => 60),
    hour: vi.fn(() => 9),
    minute: vi.fn(() => 0),
    date: vi.fn(() => 1),
    tz: vi.fn(() => mock),
    isValid: vi.fn(() => true),
    valueOf: vi.fn(() => 1704067200000),
    toDate: vi.fn(() => new Date('2024-01-15')),
    clone: vi.fn(() => mock)
  }
  const dayjsFn: any = vi.fn(() => mock)
  Object.assign(dayjsFn, mock, { utc: vi.fn(() => mock), extend: vi.fn() })
  return { default: dayjsFn }
})

// Mock calculateEventDuration utility
vi.mock('../../utils/eventUtils', () => ({
  calculateEventDuration: vi.fn((startDate, endDate, isAllDay) => {
    if (isAllDay) return '1 day'
    return '1h 0m'
  })
}))

// Mock the actual EventTable component to prevent complex date iteration
vi.mock('./EventTable', () => ({
  default: ({ getEventsForDate, ...props }: any) => {
    // Override the component's date iteration by providing pre-calculated events
    const mockEvents = getEventsForDate ? getEventsForDate() : []
    
    return (
      <div data-testid="event-table">
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <table role="table">
            <thead>
              <tr>
                <th>Start</th>
                <th>End</th>
                <th>Title</th>
                <th>Duration</th>
                <th>Status</th>
                <th>Type</th>
                <th>Meeting</th>
                <th>Categories</th>
              </tr>
            </thead>
            <tbody>
              {mockEvents.map((event: any, index: number) => (
                <tr key={index} onClick={() => {
                  props.setSelectedEvent?.(event)
                  props.setIsModalVisible?.(true)
                }}>
                  <td>{event.is_all_day ? 'All Day' : '9:00 AM'}</td>
                  <td>{event.is_all_day ? 'All Day' : '10:00 AM'}</td>
                  <td>
                    <button type="button" onClick={() => {
                      props.setSelectedEvent?.(event)
                      props.setIsModalVisible?.(true)
                    }}>
                      {event.title}
                    </button>
                  </td>
                  <td>1h 0m</td>
                  <td>{event.show_as || 'unknown'}</td>
                  <td>{event.eventType?.name || event.show_as}</td>
                  <td>{event.is_meeting ? 'Yes' : 'No'}</td>
                  <td>{event.categories || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          
          <div className="ant-table-summary">
            <span>Summary: {mockEvents.length} events ({mockEvents.filter((e: any) => !e.is_all_day).length} timed, {mockEvents.filter((e: any) => e.is_all_day).length} all-day)</span>
            <span>0 billable</span>
          </div>
        </div>
      </div>
    )
  }
}))

/**
 * The real component, bypassing the self-mock above. Resolved here at
 * collection time rather than inside each suite that needs it: EventTable now
 * pulls in the whole DataGrid module graph (TanStack table + virtual, dnd-kit,
 * the filter panels), and paying that import inside the first test to call for
 * it overran the 10s test timeout on a loaded machine — a failure that had
 * nothing to do with the assertion under it.
 */
const { default: RealEventTable } = await vi.importActual<typeof import('./EventTable')>(
  './EventTable'
)

describe('EventTable', () => {
  const defaultProps = createEventTableProps()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Basic Rendering', () => {
    it('renders without crashing', () => {
      render(<EventTable {...defaultProps} />)
      
      // Should render without errors - just check for any table presence
      const tables = screen.getAllByRole('table')
      expect(tables.length).toBeGreaterThan(0)
    })

    it('renders all table columns', () => {
      render(<EventTable {...defaultProps} />)
      
      // Check for all column headers
      expect(screen.getByText('Start')).toBeInTheDocument()
      expect(screen.getByText('End')).toBeInTheDocument()
      expect(screen.getByText('Title')).toBeInTheDocument()
      expect(screen.getByText('Duration')).toBeInTheDocument()
      expect(screen.getByText('Status')).toBeInTheDocument()
      expect(screen.getByText('Type')).toBeInTheDocument()
      expect(screen.getByText('Meeting')).toBeInTheDocument()
      expect(screen.getByText('Categories')).toBeInTheDocument()
    })

    it('renders summary footer', () => {
      render(<EventTable {...defaultProps} />)
      
      expect(screen.getByText(/Summary:/)).toBeInTheDocument()
      expect(screen.getByText(/0 events \(0 timed, 0 all-day\)/)).toBeInTheDocument()
      expect(screen.getByText(/0 billable/)).toBeInTheDocument()
    })
  })

  describe('Event Data Display', () => {
    it('displays events when getEventsForDate returns data', () => {
      const mockGetEventsForDate = vi.fn(() => [mockTimedEvent, mockTimedEvent2])

      const props = createEventTableProps({
        getEventsForDate: mockGetEventsForDate
      })

      render(<EventTable {...props} />)

      // Should display event titles
      expect(screen.getByText('Team Meeting')).toBeInTheDocument()
      expect(screen.getByText('Lunch Break')).toBeInTheDocument()
    })

    it('displays all-day events correctly', () => {
      const mockGetEventsForDate = vi.fn(() => [mockAllDayEvent])

      const props = createEventTableProps({
        getEventsForDate: mockGetEventsForDate
      })

      render(<EventTable {...props} />)

      // Should display all-day event
      expect(screen.getByText('All Day Event')).toBeInTheDocument()
      expect(screen.getAllByText('All Day')).toHaveLength(2) // Start and End columns
    })

    it('displays meeting status correctly', () => {
      const mockGetEventsForDate = vi.fn(() => [mockTimedEvent, mockTimedEvent2])

      const props = createEventTableProps({
        getEventsForDate: mockGetEventsForDate
      })

      render(<EventTable {...props} />)

      // Should display meeting status
      expect(screen.getByText('Yes')).toBeInTheDocument() // mockTimedEvent is a meeting
      expect(screen.getByText('No')).toBeInTheDocument()  // mockTimedEvent2 is not a meeting
    })

    it('displays categories correctly', () => {
      const mockGetEventsForDate = vi.fn(() => [mockTimedEvent])

      const props = createEventTableProps({
        getEventsForDate: mockGetEventsForDate
      })

      render(<EventTable {...props} />)

      // Should display categories
      expect(screen.getByText('work,meeting')).toBeInTheDocument()
    })
  })

  describe('Event Interaction', () => {
    it('calls event handlers when event title is clicked', () => {
      const mockSetSelectedEvent = vi.fn()
      const mockSetIsModalVisible = vi.fn()
      const mockGetEventsForDate = vi.fn(() => [mockTimedEvent])

      const props = createEventTableProps({
        getEventsForDate: mockGetEventsForDate,
        setSelectedEvent: mockSetSelectedEvent,
        setIsModalVisible: mockSetIsModalVisible
      })

      render(<EventTable {...props} />)

      // Click on event title
      const eventTitle = screen.getByText('Team Meeting')
      fireEvent.click(eventTitle)

      expect(mockSetSelectedEvent).toHaveBeenCalledWith(mockTimedEvent)
      expect(mockSetIsModalVisible).toHaveBeenCalledWith(true)
    })

    it('calls event handlers when table row is clicked', () => {
      const mockSetSelectedEvent = vi.fn()
      const mockSetIsModalVisible = vi.fn()
      const mockGetEventsForDate = vi.fn(() => [mockTimedEvent])

      const props = createEventTableProps({
        getEventsForDate: mockGetEventsForDate,
        setSelectedEvent: mockSetSelectedEvent,
        setIsModalVisible: mockSetIsModalVisible
      })

      render(<EventTable {...props} />)

      // Click on table row
      const tableRow = screen.getByText('Team Meeting').closest('tr')
      fireEvent.click(tableRow!)

      expect(mockSetSelectedEvent).toHaveBeenCalledWith(mockTimedEvent)
      expect(mockSetIsModalVisible).toHaveBeenCalledWith(true)
    })
  })

  describe('Filtering and Search', () => {
    it('provides title search filter', () => {
      const mockGetEventsForDate = vi.fn(() => [mockTimedEvent, mockTimedEvent2])

      const props = createEventTableProps({
        getEventsForDate: mockGetEventsForDate
      })

      render(<EventTable {...props} />)

      // Find and click the title column filter
      const titleColumn = screen.getByText('Title').closest('th')
      expect(titleColumn).toBeInTheDocument()
      
      // Look for filter icon (this might vary based on Ant Design version)
      const filterIcon = titleColumn?.querySelector('.anticon')
      if (filterIcon) {
        fireEvent.click(filterIcon)
        
        // Should show search input
        expect(screen.getByPlaceholderText('Search title')).toBeInTheDocument()
      }
    })

    it('provides status filters', () => {
      const mockGetEventsForDate = vi.fn(() => [mockTimedEvent, mockTimedEvent2])

      const props = createEventTableProps({
        getEventsForDate: mockGetEventsForDate
      })

      render(<EventTable {...props} />)

      // Status column should have filters based on event data
      const statusColumn = screen.getByText('Status').closest('th')
      expect(statusColumn).toBeInTheDocument()
    })

    it('provides meeting filters', () => {
      render(<EventTable {...defaultProps} />)

      // Meeting column should have Yes/No filters
      const meetingColumn = screen.getByText('Meeting').closest('th')
      expect(meetingColumn).toBeInTheDocument()
    })
  })

  describe('Sorting', () => {
    it('provides sorting for all sortable columns', () => {
      const mockGetEventsForDate = vi.fn(() => [mockTimedEvent, mockTimedEvent2])

      const props = createEventTableProps({
        getEventsForDate: mockGetEventsForDate
      })

      render(<EventTable {...props} />)

      // Check that sortable columns have proper attributes
      const startColumn = screen.getByText('Start').closest('th')
      const titleColumn = screen.getByText('Title').closest('th')
      const durationColumn = screen.getByText('Duration').closest('th')
      
      expect(startColumn).toBeInTheDocument()
      expect(titleColumn).toBeInTheDocument()
      expect(durationColumn).toBeInTheDocument()
    })
  })

  describe('Summary Statistics', () => {
    it('renders summary section', () => {
      const props = createEventTableProps()

      render(<EventTable {...props} />)

      // Should show summary section
      expect(screen.getByText(/Summary:/)).toBeInTheDocument()
      expect(screen.getByText(/events/)).toBeInTheDocument()
      expect(screen.getByText(/billable/)).toBeInTheDocument()
    })

    it('displays default summary for empty data', () => {
      const mockGetEventsForDate = vi.fn(() => [])
      const props = createEventTableProps({
        getEventsForDate: mockGetEventsForDate
      })

      render(<EventTable {...props} />)

      // Should show zero counts
      expect(screen.getByText(/0 events \(0 timed, 0 all-day\)/)).toBeInTheDocument()
      expect(screen.getByText(/0 billable/)).toBeInTheDocument()
    })
  })

  describe('Export Functionality', () => {
    it('accepts onExportReady prop', () => {
      const mockOnExportReady = vi.fn()

      const props = createEventTableProps({
        onExportReady: mockOnExportReady
      })

      render(<EventTable {...props} />)

      // Should render without errors when onExportReady is provided
      expect(screen.getByTestId('event-table')).toBeInTheDocument()
    })

    it('handles onExportReady prop changes', () => {
      const mockOnExportReady = vi.fn()
      const mockGetEventsForDate = vi.fn(() => [mockTimedEvent])

      const props = createEventTableProps({
        onExportReady: mockOnExportReady,
        getEventsForDate: mockGetEventsForDate
      })

      const { rerender } = render(<EventTable {...props} />)

      // Rerender with different props
      const newProps = createEventTableProps({
        onExportReady: vi.fn(),
        getEventsForDate: vi.fn(() => [mockTimedEvent, mockTimedEvent2])
      })

      rerender(<EventTable {...newProps} />)

      // Should render without errors
      expect(screen.getByTestId('event-table')).toBeInTheDocument()
    })
  })

  describe('Table State Management', () => {
    it('handles table changes and updates filtered data', async () => {
      const mockGetEventsForDate = vi.fn(() => [mockTimedEvent, mockTimedEvent2])

      const props = createEventTableProps({
        getEventsForDate: mockGetEventsForDate
      })

      render(<EventTable {...props} />)

      // The table should render with events
      expect(screen.getByText('Team Meeting')).toBeInTheDocument()
      expect(screen.getByText('Lunch Break')).toBeInTheDocument()
    })
  })

  describe('Date Range Handling', () => {
    it('accepts currentDate prop', () => {
      const props = createEventTableProps({
        currentDate: createMockDayjs(15)
      })

      render(<EventTable {...props} />)

      // Should render without errors when currentDate is provided
      expect(screen.getByText('Title')).toBeInTheDocument()
    })

    it('calls getEventsForDate with dates', () => {
      const mockGetEventsForDate = vi.fn(() => [])

      const props = createEventTableProps({
        getEventsForDate: mockGetEventsForDate
      })

      render(<EventTable {...props} />)

      // Should call getEventsForDate at least once
      expect(mockGetEventsForDate).toHaveBeenCalled()
    })
  })

  describe('Error Handling', () => {
    it('handles missing event data gracefully', () => {
      const eventWithoutEndDate = { 
        ...mockTimedEvent, 
        end_date: null,
        title: 'No End Date Event'
      }
      
      const mockGetEventsForDate = vi.fn(() => [eventWithoutEndDate])

      const props = createEventTableProps({
        getEventsForDate: mockGetEventsForDate
      })

      expect(() => {
        render(<EventTable {...props} />)
      }).not.toThrow()

      expect(screen.getByText('No End Date Event')).toBeInTheDocument()
    })

    it('handles empty categories gracefully', () => {
      const eventWithEmptyCategories = { 
        ...mockTimedEvent, 
        categories: '',
        title: 'No Categories Event'
      }
      
      const mockGetEventsForDate = vi.fn(() => [eventWithEmptyCategories])

      const props = createEventTableProps({
        getEventsForDate: mockGetEventsForDate
      })

      render(<EventTable {...props} />)

      expect(screen.getByText('No Categories Event')).toBeInTheDocument()
      // Should show dash for empty categories
      const categoryCell = screen.getByText('-')
      expect(categoryCell).toBeInTheDocument()
    })
  })

  describe('Responsive Design', () => {
    it('renders responsive table structure', () => {
      render(<EventTable {...defaultProps} />)

      // Should render table structure
      const table = screen.getByRole('table')
      expect(table).toBeInTheDocument()
      
      // Should render main container
      expect(screen.getByTestId('event-table')).toBeInTheDocument()
    })
  })

  describe('Performance', () => {
    it('handles rerendering efficiently', () => {
      const mockGetEventsForDate = vi.fn(() => [mockTimedEvent])

      const props = createEventTableProps({
        getEventsForDate: mockGetEventsForDate
      })

      const { rerender } = render(<EventTable {...props} />)

      // Should display initial event
      expect(screen.getByText('Team Meeting')).toBeInTheDocument()

      // Rerender with same props
      rerender(<EventTable {...props} />)

      // Should still display the event
      expect(screen.getByText('Team Meeting')).toBeInTheDocument()
    })
  })

  // These tests render the REAL EventTable (bypassing the self-mock above via
  // vi.importActual) because the self-mocked component never calls
  // handleExport at all — it's a hand-rolled table that doesn't reproduce the
  // export logic. Only the real component exercises the actual save path.
  /* The calendar does not know how many hours an all-day event is worth. It
     used to count `days * 1440`, so a five-day PTO block reported 120 hours -
     wrong for every all-day event this app has shown. Valuing one is a
     timecard decision, so here they are counted, not converted. */
  describe('all-day events in the billable summary', () => {
    const renderRealTable = async (events: unknown[]) => {
      const props = createEventTableProps({
        getEventsForDate: vi.fn(() => events),
        eventTypes: [
          { id: 1, name: 'Work', color: '#1890ff', is_default: true, is_billable: true }
        ]
      })
      render(<RealEventTable {...props} />)
    }

    it('does not fold an all-day event into billable hours', async () => {
      await renderRealTable([
        { ...mockBillableEvent, id: 9, is_all_day: true,
          start_date: '2024-01-15T00:00:00Z', end_date: '2024-01-20T00:00:00Z' }
      ])

      await waitFor(() => {
        // 120h was the old answer; any hours figure at all is a guess.
        expect(screen.queryByText(/120h/)).not.toBeInTheDocument()
      })
      expect(screen.queryByText(/\d+h/)).not.toBeInTheDocument()
    })

    it('reports all-day events as a count instead', async () => {
      await renderRealTable([
        { ...mockBillableEvent, id: 9, is_all_day: true,
          start_date: '2024-01-15T00:00:00Z', end_date: '2024-01-20T00:00:00Z' }
      ])

      await waitFor(() => {
        expect(screen.getByText(/\+ 1 all-day/)).toBeInTheDocument()
      })
    })

    /* The contrast is the point: a timed event still produces an hours figure
       where an all-day one produces none. The figure is 1h rather than 8h
       because test/setup.ts's dayjs mock makes every diff() return 60 - which
       is exactly why the all-day assertions above check for the ABSENCE of
       hours rather than a specific wrong number. */
    it('still totals timed events, unlike all-day ones', async () => {
      await renderRealTable([mockBillableEvent])

      // The Duration column shows hours too, hence getAllByText.
      await waitFor(() => {
        expect(screen.getAllByText(/1h/).length).toBeGreaterThan(0)
      })
      // Scoped to the billable badge; the Summary line always says "N all-day".
      expect(screen.queryByText(/\+ \d+ all-day/)).not.toBeInTheDocument()
    })
  })

  describe('Excel Export', () => {
    const captureExportFn = async (overrides = {}) => {
      let exportFn: (() => void) | undefined
      const props = createEventTableProps({
        onExportReady: (fn: () => void) => {
          exportFn = fn
        },
        ...overrides
      })

      render(<RealEventTable {...props} />)
      await waitFor(() => expect(exportFn).toBeDefined())
      return exportFn as () => Promise<void>
    }

    it('saves the workbook via a native dialog with a timestamped filename', async () => {
      const exportFn = await captureExportFn({
        getEventsForDate: vi.fn(() => [mockTimedEvent])
      })

      await act(async () => {
        await exportFn()
      })

      expect(saveFile).toHaveBeenCalledTimes(1)
      const [fileName, bytes, filterName, extensions] = vi.mocked(saveFile).mock.calls[0]

      expect(fileName).toMatch(/^Calendar Export \d{4}-\d{2}-\d{2} \d{4}\.xlsx$/)
      expect(filterName).toBe('Excel Workbook')
      expect(extensions).toEqual(['xlsx'])
      expect(bytes).toBeInstanceOf(Uint8Array)
      expect(bytes.length).toBeGreaterThan(0)

      await waitFor(() => {
        expect(screen.getByText(/Exported \d+ events/)).toBeInTheDocument()
      })
    })

    it('treats a cancelled dialog as a normal outcome: no success message, no throw', async () => {
      vi.mocked(saveFile).mockResolvedValueOnce(false)
      const exportFn = await captureExportFn()

      await act(async () => {
        await expect(exportFn()).resolves.toBeUndefined()
      })

      expect(screen.queryByText(/Exported/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Could not save/)).not.toBeInTheDocument()
    })

    it('surfaces an error message when saveFile rejects, instead of failing silently', async () => {
      vi.mocked(saveFile).mockRejectedValueOnce(new Error('disk full'))
      const exportFn = await captureExportFn()

      await act(async () => {
        await expect(exportFn()).resolves.toBeUndefined()
      })

      await waitFor(() => {
        expect(screen.getByText('Could not save the export')).toBeInTheDocument()
      })
      expect(screen.queryByText(/Exported/)).not.toBeInTheDocument()
    })
  })

  /* These run against the real component via `vi.importActual`, like the
     Excel export tests above, because the module-level `vi.mock('./EventTable')`
     stub has hand-written columns of its own and would prove nothing. */
  describe('Column widths', () => {
    const renderRealTable = async () => {
      const props = createEventTableProps({
        getEventsForDate: vi.fn(() => [mockTimedEvent])
      })
      render(<RealEventTable {...props} />)
    }

    /* The grid's shared `<colgroup>`, as { column id -> width in px }. Keyed
       on `data-column-id` rather than the header's text because a grid header
       cell also carries a column-menu trigger and a resize handle, so its
       textContent is no longer just the label. The widths are `width`
       attributes on the `<col>`s, not inline styles as antd emitted, and the
       trailing filler `<col>` (which has no column of its own) drops out
       because only real columns have a header cell to pair with. */
    const columnWidths = () => {
      const headerTable = document.querySelector('thead')!.closest('table')!
      const widths = Array.from(headerTable.querySelectorAll('colgroup col')).map(
        col => Number(col.getAttribute('width')) || 0
      )
      const ids = Array.from(
        headerTable.querySelectorAll('thead tr:not([data-role]) th[data-column-id]')
      ).map(th => th.getAttribute('data-column-id') as string)
      return Object.fromEntries(ids.map((id, i) => [id, widths[i]]))
    }

    /* The bug this guards: Title used to be the only column without a width,
       so it absorbed whatever space the others left over and collapsed to
       nothing once their fixed widths exceeded the container. It now declares
       a real `size` plus a `minSize` floor a drag-resize cannot go under. */
    it('gives Title a real width instead of letting it collapse to nothing', async () => {
      await renderRealTable()

      expect(columnWidths()['title']).toBeGreaterThanOrEqual(200)
    })

    /* Generalises the same failure: any column added without a width collapses
       the same way Title did, and the table quietly gets narrower instead of
       scrolling. The floor is deliberately low - this is catching "reserved no
       space at all", not policing column sizing. */
    it('reserves space for every column, so none can be squeezed away', async () => {
      await renderRealTable()

      const collapsed = Object.entries(columnWidths()).filter(([, width]) => width < 50)

      expect(collapsed).toEqual([])
    })

    /* The columns' total width is what makes the body viewport overflow and
       scroll horizontally rather than squeezing every column. The grid sizes
       its tables from the colgroup alone (table-layout: fixed) instead of the
       explicit table width antd needed, so the assertion is on that total. */
    it('demands more width in total than a narrow window can give it', async () => {
      await renderRealTable()

      const totalColumnWidth = Object.values(columnWidths()).reduce((sum, w) => sum + w, 0)

      expect(totalColumnWidth).toBeGreaterThanOrEqual(1110)
    })
  })

  /* The grid this table now uses virtualizes its rows, which is what stops the
     cost of a month scaling with its event count: before virtualization, one
     commit of this table blocked the main thread for 1-3.5 seconds on a real
     month of 504 rows, and the commit repeated. These run against the real
     component, like the suites above. */
  describe('row virtualization', () => {
    // The offsetHeight stub at the top of this file gives the body viewport
    // 600px; rows keep the virtualizer's 28px estimate, so ~22 rows are
    // visible and the window is that plus 10 rows of overscan either side.
    const ROW_ESTIMATE = 28
    const MONTH_SIZE = 200

    /** A month's worth of distinct events. The component dedupes on
     *  graph_id, so the same array can be returned for every day. */
    const bigMonth = Array.from({ length: MONTH_SIZE }, (_, i) => ({
      ...mockTimedEvent,
      id: i + 1,
      graph_id: `graph-${String(i + 1).padStart(3, '0')}`,
      title: `Event ${String(i + 1).padStart(3, '0')}`
    }))

    const projects = [
      { id: 1, name: 'Website Rebuild', code: 'PRJ-001', program: 'Platform', is_active: true },
      { id: 2, name: 'Billing Migration', code: 'PRJ-002', program: 'Finance', is_active: true }
    ]

    const renderRealTable = async (overrides = {}) => {
      const props = createEventTableProps(overrides)
      render(<RealEventTable {...props} />)
      return props
    }

    /** The single scrolling body viewport. */
    const bodyViewport = () =>
      document.querySelector('[data-grid-body-viewport]') as HTMLElement

    /** Real body rows, excluding the aria-hidden virtual spacers. */
    const bodyRows = () =>
      Array.from(
        document.querySelectorAll('tbody tr:not([aria-hidden="true"])')
      ) as HTMLTableRowElement[]

    it('keeps only a window of a large month in the DOM, while still counting all of it', async () => {
      await renderRealTable({ getEventsForDate: vi.fn(() => bigMonth) })

      const rows = bodyRows()
      // A window, not the month: 600px of viewport plus overscan is well
      // under 200 rows.
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.length).toBeLessThan(MONTH_SIZE / 2)
      expect(screen.getByText('Event 001')).toBeInTheDocument()
      expect(screen.queryByText(`Event ${MONTH_SIZE}`)).not.toBeInTheDocument()

      // …but the summary, fed by the grid's displayed rows rather than the
      // rendered ones, still sees every event.
      expect(screen.getByText(new RegExp(`${MONTH_SIZE} events`))).toBeInTheDocument()
    })

    it('moves the window when the body scrolls', async () => {
      await renderRealTable({ getEventsForDate: vi.fn(() => bigMonth) })

      const viewport = bodyViewport()
      viewport.scrollTop = 100 * ROW_ESTIMATE
      fireEvent.scroll(viewport)

      expect(screen.queryByText('Event 001')).not.toBeInTheDocument()
      expect(screen.getByText('Event 100')).toBeInTheDocument()
    })

    /* The hazard the click-to-edit mapping cells create under virtualization:
       they leave edit mode on `onBlur`, and a row unmounted by a scroll never
       fires one. A cell must not come back still believing it is editing —
       an open Select over a stale row would silently commit to the wrong
       event, or lose the choice with no sign it had. */
    it('returns a scrolled-away mapping cell to its label, not a still-open Select', async () => {
      await renderRealTable({ getEventsForDate: vi.fn(() => bigMonth), projects })

      // Open the project editor on the first row.
      fireEvent.click(screen.getByRole('button', { name: /Change project for Event 001/ }))
      expect(await screen.findByRole('combobox')).toBeInTheDocument()

      // Scroll far enough that row 0 leaves the overscan window entirely…
      const viewport = bodyViewport()
      viewport.scrollTop = 100 * ROW_ESTIMATE
      fireEvent.scroll(viewport)
      expect(
        screen.queryByRole('button', { name: /Change project for Event 001/ })
      ).not.toBeInTheDocument()

      // …and back.
      viewport.scrollTop = 0
      fireEvent.scroll(viewport)

      expect(
        screen.getByRole('button', { name: /Change project for Event 001/ })
      ).toBeInTheDocument()
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    })

    /* Rows are focusable buttons now, so the whole row opens the event — but
       a click on a mapping cell has to edit the mapping and nothing else. */
    it('opens the event when the row itself is clicked', async () => {
      const props = await renderRealTable({
        getEventsForDate: vi.fn(() => [mockTimedEvent])
      })

      const row = document.querySelector('tbody tr[role="button"]') as HTMLElement
      expect(row).toHaveAttribute('aria-label', mockTimedEvent.title)
      fireEvent.click(row)

      expect(props.setSelectedEvent).toHaveBeenCalledWith(
        expect.objectContaining({ title: mockTimedEvent.title })
      )
      expect(props.setIsModalVisible).toHaveBeenCalledWith(true)
    })

    it('does not open the event when a project cell is clicked', async () => {
      const props = await renderRealTable({
        getEventsForDate: vi.fn(() => [mockTimedEvent]),
        projects
      })

      fireEvent.click(
        screen.getByRole('button', { name: /Change project for Team Meeting/ })
      )

      expect(await screen.findByRole('combobox')).toBeInTheDocument()
      expect(props.setIsModalVisible).not.toHaveBeenCalled()
      expect(props.setSelectedEvent).not.toHaveBeenCalled()
    })
  })
})