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
  describe('Excel Export', () => {
    const captureExportFn = async (overrides = {}) => {
      const { default: RealEventTable } = await vi.importActual<typeof import('./EventTable')>(
        './EventTable'
      )
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
      const { default: RealEventTable } = await vi.importActual<typeof import('./EventTable')>(
        './EventTable'
      )
      const props = createEventTableProps({
        getEventsForDate: vi.fn(() => [mockTimedEvent])
      })
      render(<RealEventTable {...props} />)
    }

    /** The `<colgroup>` antd emits, as { header text -> width in px }. */
    const columnWidths = () => {
      const widths = Array.from(document.querySelectorAll('col')).map(col =>
        parseFloat((col.getAttribute('style') || '').replace(/[^0-9.]/g, '')) || 0
      )
      const headers = Array.from(document.querySelectorAll('th')).map(th => th.textContent || '')
      return Object.fromEntries(headers.map((h, i) => [h, widths[i]]))
    }

    /* The bug this guards: Title was the only column without a width, so it
       absorbed whatever space the other seven left over. A virtual table sizes
       every column as `Math.max(width || 0, minWidth || 0)`, so once the other
       columns' fixed widths exceeded the container, Title's share hit zero and
       the column vanished rather than truncating via its `ellipsis` config. */
    it('gives Title a real width instead of letting it collapse to nothing', async () => {
      await renderRealTable()

      expect(columnWidths()['Title']).toBeGreaterThanOrEqual(200)
    })

    /* Generalises the same failure: any column added without a width (or
       minWidth) collapses the same way Title did, and the table quietly gets
       narrower instead of scrolling. The floor is deliberately low - this is
       catching "reserved no space at all", not policing column sizing. */
    it('reserves space for every column, so none can be squeezed away', async () => {
      await renderRealTable()

      const collapsed = Object.entries(columnWidths()).filter(([, width]) => width < 50)

      expect(collapsed).toEqual([])
    })

    /* The table's own width is what makes the container overflow and scroll.
       It has to account for every column, or a narrow window squeezes the
       flexible column to nothing instead of showing a horizontal scrollbar. */
    it('sizes the table to the full width its columns demand', async () => {
      await renderRealTable()

      const totalColumnWidth = Object.values(columnWidths()).reduce((sum, w) => sum + w, 0)
      const tableWidth = parseFloat(
        (document.querySelector('.ant-table-container table')?.getAttribute('style') || '')
          .match(/width:\s*([0-9.]+)px/)?.[1] || '0'
      )

      expect(tableWidth).toBe(totalColumnWidth)
      expect(tableWidth).toBeGreaterThanOrEqual(1110)
    })
  })
})